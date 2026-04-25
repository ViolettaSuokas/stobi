-- Fix: earn_points / spend_item не работают из-за защитного trigger'а на
-- profiles, который блокирует UPDATE на колонку balance кроме как от
-- service_role. Юзерские RPC идут как 'authenticated' → trigger фейлит,
-- балансы не обновляются.
--
-- Решение: RPC устанавливает session variable 'app.via_balance_rpc' = '1'
-- перед UPDATE'ом. Trigger проверяет эту variable и пропускает.
-- set_config(..., is_local=true) — variable сбрасывается в конце транзакции,
-- так что юзер не может оставить её "включённой" для будущих writes.

-- Update trigger: bypass когда RPC явно установил session variable.
create or replace function profiles_block_protected_updates() returns trigger
language plpgsql
as $$
begin
  -- Service role can do anything (admin tools, server-side scripts).
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  -- RPC's earn_points/spend_item set this var via set_config(..., true)
  -- перед UPDATE'ом. Не-RPC прямые писатели (клиент через REST) не имеют
  -- этого флага → trigger блокирует.
  if current_setting('app.via_balance_rpc', true) = '1' then
    return new;
  end if;

  if new.balance is distinct from old.balance then
    raise exception 'Column "balance" cannot be updated directly. Use earn_points() or spend_item() RPC.';
  end if;
  if new.is_premium is distinct from old.is_premium then
    raise exception 'Column "is_premium" is managed by the RevenueCat webhook.';
  end if;
  if new.premium_expires_at is distinct from old.premium_expires_at then
    raise exception 'Column "premium_expires_at" is managed by the RevenueCat webhook.';
  end if;
  if new.owned_items is distinct from old.owned_items then
    raise exception 'Column "owned_items" cannot be updated directly. Use spend_item() RPC.';
  end if;
  if new.equipped_items is distinct from old.equipped_items then
    return new;
  end if;
  return new;
end;
$$;

-- Update earn_points: set session var before UPDATE.
create or replace function earn_points(p_amount integer, p_reason text, p_ref_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_new_balance integer;
  v_recent_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 100 then
    raise exception 'invalid_amount: % (must be 1..100)', p_amount;
  end if;

  if p_reason is null or length(p_reason) = 0 or length(p_reason) > 64 then
    raise exception 'invalid_reason';
  end if;

  -- Rate limit
  select count(*) into v_recent_count
    from balance_events
    where user_id = v_user_id
      and amount > 0
      and created_at > now() - interval '1 minute';
  if v_recent_count >= 20 then
    raise exception 'rate_limit_exceeded';
  end if;

  -- Сигнал trigger'у что update идёт через легитимный RPC.
  perform set_config('app.via_balance_rpc', '1', true);

  update profiles
    set balance = coalesce(balance, 0) + p_amount
    where id = v_user_id
    returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'profile_not_found';
  end if;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, p_amount, p_reason, p_ref_id, v_new_balance);

  return v_new_balance;
end;
$$;

-- spend_item: тот же баг (UPDATE balance + owned_items блокируется).
create or replace function spend_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_item items%rowtype;
  v_profile profiles%rowtype;
  v_new_balance integer;
  v_new_owned text[];
  v_is_premium boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_item from items where id = p_item_id and active;
  if not found then
    raise exception 'unknown_item';
  end if;

  select * into v_profile from profiles where id = v_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_profile.owned_items && array[p_item_id] then
    raise exception 'already_owned';
  end if;

  if v_item.premium_only then
    v_is_premium := coalesce(v_profile.is_premium, false)
      and (v_profile.premium_expires_at is null or v_profile.premium_expires_at > now());
    if not v_is_premium then
      raise exception 'premium_required';
    end if;
  end if;

  if coalesce(v_profile.balance, 0) < v_item.price then
    raise exception 'insufficient';
  end if;

  v_new_balance := v_profile.balance - v_item.price;
  v_new_owned := coalesce(v_profile.owned_items, array[]::text[]) || p_item_id;

  perform set_config('app.via_balance_rpc', '1', true);

  update profiles
    set balance = v_new_balance,
        owned_items = v_new_owned
    where id = v_user_id;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, -v_item.price, 'buy_item', p_item_id, v_new_balance);

  return jsonb_build_object(
    'balance', v_new_balance,
    'owned_items', to_jsonb(v_new_owned)
  );
end;
$$;

-- record_find_v2: тоже UPDATE'ает balance (finder + author rewards).
-- Не переписываем функцию полностью (длинная) — патчим session var через
-- ALTER FUNCTION ... SET local-style hack невозможен, придётся всё-таки
-- переписать. Так как record_find_v2 уже редактировался в 20260425130000,
-- проще: добавить set_config внутри её тела через CREATE OR REPLACE.
-- Делаем здесь полную замену с set_config'ом.
create or replace function record_find_v2(
  p_stone_id uuid,
  p_photo_url text,
  p_embedding vector(768),
  p_proof_lat double precision default null,
  p_proof_lng double precision default null,
  p_nsfw_labels jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone stones%rowtype;
  v_primary_sim float := null;
  v_alt_sim float := null;
  v_best_sim float := null;
  v_has_embedding boolean := false;
  v_distance_m float := null;
  v_gps_ok boolean := false;
  v_status text;
  v_reason text;
  v_find_id uuid := null;
  v_proof_id uuid;
  v_already_found boolean;
  v_finder_reward int := 1;
  v_author_reward int := 1;
  v_new_balance int;
  v_reward int := 0;
  v_fresh_count int;
  v_author_daily_count int;
  v_global_author_count int;
  v_alt_count int;
  v_birth_year int;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select birth_year into v_birth_year from profiles where id = v_user_id;
  if v_birth_year is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'birth_year_required', 'reward', 0);
  end if;

  select * into v_stone from stones where id = p_stone_id and (is_hidden is null or is_hidden = false);
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'stone_not_found', 'reward', 0);
  end if;

  if v_stone.author_id = v_user_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'cannot_find_own_stone', 'reward', 0);
  end if;

  select exists (select 1 from finds where user_id = v_user_id and stone_id = p_stone_id)
    into v_already_found;
  if v_already_found then
    return jsonb_build_object(
      'status', 'already_found', 'reason', 'already_found',
      'balance', (select balance from profiles where id = v_user_id), 'reward', 0
    );
  end if;

  -- Fresh-lock removed in 20260425130000 (was 1h, killed legit fast finds).

  select count(*) into v_fresh_count from finds
    where user_id = v_user_id and found_at > now() - interval '1 day';
  if v_fresh_count >= 10 then
    return jsonb_build_object('status', 'rejected', 'reason', 'daily_find_limit', 'reward', 0);
  end if;

  select count(*) into v_author_daily_count from finds
    where stone_id in (select id from stones where author_id = v_stone.author_id)
      and found_at > now() - interval '1 day';
  if v_author_daily_count >= 20 then
    return jsonb_build_object('status', 'rejected', 'reason', 'author_daily_limit', 'reward', 0);
  end if;

  select count(*) into v_global_author_count from finds
    where stone_id in (select id from stones where author_id = v_stone.author_id);
  if v_global_author_count >= 100 then
    return jsonb_build_object('status', 'rejected', 'reason', 'global_author_limit', 'reward', 0);
  end if;

  if v_stone.embedding is not null then
    v_has_embedding := true;
    v_primary_sim := 1 - (v_stone.embedding <=> p_embedding);
  end if;
  if array_length(v_stone.alt_embeddings, 1) > 0 then
    v_has_embedding := true;
    select max(1 - (alt <=> p_embedding)) into v_alt_sim
      from unnest(v_stone.alt_embeddings) alt;
  end if;
  v_best_sim := greatest(coalesce(v_primary_sim, 0), coalesce(v_alt_sim, 0));

  if p_proof_lat is not null and p_proof_lng is not null then
    v_distance_m := haversine_m(p_proof_lat, p_proof_lng, v_stone.lat, v_stone.lng);
    v_gps_ok := v_distance_m <= 30;
  end if;

  if v_has_embedding then
    if v_best_sim >= 0.82 then
      v_status := 'verified';
      v_reason := 'ai_match';
    elsif v_best_sim >= 0.70 and v_gps_ok then
      v_status := 'verified';
      v_reason := 'ai_match_plus_gps';
    elsif v_best_sim >= 0.70 then
      v_status := 'pending';
      v_reason := 'awaits_author_approval';
    else
      v_status := 'rejected';
      v_reason := 'low_similarity';
    end if;
  else
    if v_gps_ok then
      v_status := 'verified';
      v_reason := 'gps_only_legacy';
    else
      v_status := 'rejected';
      v_reason := 'too_far_legacy_no_embedding';
    end if;
  end if;

  if v_status = 'verified' then
    insert into finds (user_id, stone_id, city) values (v_user_id, p_stone_id, v_stone.city)
      on conflict (user_id, stone_id) do nothing
      returning id into v_find_id;

    if v_find_id is null then
      return jsonb_build_object(
        'status', 'already_found', 'reason', 'already_found',
        'balance', (select balance from profiles where id = v_user_id), 'reward', 0
      );
    end if;

    -- Bypass the protected-update trigger for both balance updates below.
    perform set_config('app.via_balance_rpc', '1', true);

    update profiles set balance = coalesce(balance, 0) + v_finder_reward where id = v_user_id
      returning balance into v_new_balance;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
      values (v_user_id, v_finder_reward, 'stone_find', p_stone_id::text, v_new_balance);
    update profiles set balance = coalesce(balance, 0) + v_author_reward where id = v_stone.author_id;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
      values (v_stone.author_id, v_author_reward, 'author_bonus', p_stone_id::text, null);
    v_reward := v_finder_reward;

    if v_reason in ('ai_match', 'ai_match_plus_gps') then
      v_alt_count := coalesce(array_length(v_stone.alt_embeddings, 1), 0);
      if v_alt_count >= 10 then
        update stones
          set alt_embeddings = v_stone.alt_embeddings[2:10] || p_embedding
          where id = p_stone_id;
      else
        update stones
          set alt_embeddings = coalesce(alt_embeddings, '{}') || p_embedding
          where id = p_stone_id;
      end if;
    end if;
  end if;

  insert into find_proofs (
    find_id, stone_id, user_id, photo_url, embedding,
    similarity_score, alt_similarity_score,
    gps_used, ai_used, status, rejection_reason
  ) values (
    v_find_id, p_stone_id, v_user_id, p_photo_url, p_embedding,
    v_primary_sim, v_alt_sim,
    v_gps_ok, v_has_embedding, v_status, case when v_status = 'rejected' then v_reason end
  ) returning id into v_proof_id;

  if p_nsfw_labels is not null then
    insert into moderation_events (user_id, photo_url, labels, source)
      values (v_user_id, p_photo_url, p_nsfw_labels, 'find');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'reward', v_reward,
    'similarity', v_best_sim,
    'distance_m', v_distance_m,
    'balance', coalesce(v_new_balance, (select balance from profiles where id = v_user_id)),
    'find_id', v_find_id,
    'proof_id', v_proof_id
  );
end;
$$;
