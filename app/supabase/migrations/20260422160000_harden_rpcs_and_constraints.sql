-- Security + correctness hardening pass after chaos-audit 2026-04-22.
--
-- Fixes surfaced during the audit that are genuinely dangerous or broken in
-- production:
--
--   1. record_find_v2 uses `finds.created_at` but the column is `found_at`.
--      Any find against a stone older than 1 hour would crash. Only reason
--      chaos tests passed is every test hit earlier rejection branches.
--
--   2. create_stone + record_find_v2 accept calls from users whose
--      profiles.birth_year IS NULL. COPPA + privacy policy say those
--      actions are age-gated. Add explicit check.
--
--   3. profiles.balance has no CHECK constraint. Concurrent deductions
--      could drive it negative. Add `balance >= 0`.
--
--   4. Idempotency check in record_find_v2 uses plain SELECT EXISTS, which
--      is vulnerable to concurrent inserts hitting the unique(user_id,
--      stone_id) constraint on both legs. Rewrite as ON CONFLICT upsert.
--
--   5. finds has no index on found_at. Daily/author caps do full scans.
--      Add index.
--
--   6. push_tokens had `for all using` but no explicit SELECT policy —
--      add one so a user can only read their own tokens.
--
--   7. analytics_events — INSERT was open but SELECT was implicit. Add a
--      deny to make sure users can't read other users' behaviour logs.

-- ─── (3) Non-negative balance ──────────────────────────────────────
-- Before we add the constraint, backfill any drifted values. Current prod
-- should have none (we audited), but we do this defensively.
update profiles set balance = 0 where balance < 0;
alter table profiles
  add constraint profiles_balance_non_negative check (balance >= 0);

-- ─── (5) Index on finds.found_at ───────────────────────────────────
create index if not exists finds_found_at_idx on finds (found_at desc);
create index if not exists finds_user_found_at_idx on finds (user_id, found_at desc);

-- ─── (6) push_tokens: explicit SELECT policy ───────────────────────
drop policy if exists "Users read own tokens" on push_tokens;
create policy "Users read own tokens"
  on push_tokens for select
  to authenticated
  using (auth.uid() = user_id);

-- ─── (7) analytics_events: deny SELECT ──────────────────────────────
drop policy if exists "No read analytics" on analytics_events;
create policy "No read analytics"
  on analytics_events for select
  using (false);

-- ─── (1, 2, 4) create_stone with COPPA gate ─────────────────────────
create or replace function create_stone(
  p_name text,
  p_description text,
  p_tags text[],
  p_photo_urls text[],
  p_embeddings vector(768)[],
  p_lat double precision,
  p_lng double precision,
  p_city text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone_id uuid;
  v_avg_embedding vector(768);
  v_i integer;
  v_count integer;
  v_birth_year integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- COPPA gate: content-creation requires age confirmation.
  select birth_year into v_birth_year from profiles where id = v_user_id;
  if v_birth_year is null then
    raise exception 'birth_year_required' using errcode = '42501';
  end if;

  if array_length(p_photo_urls, 1) < 1 or array_length(p_photo_urls, 1) > 5 then
    raise exception 'Expected 1-5 reference photos, got %', coalesce(array_length(p_photo_urls, 1), 0);
  end if;

  if array_length(p_embeddings, 1) != array_length(p_photo_urls, 1) then
    raise exception 'photo_urls and embeddings length mismatch';
  end if;

  v_count := array_length(p_embeddings, 1);
  v_avg_embedding := p_embeddings[1];
  if v_count > 1 then
    for v_i in 2..v_count loop
      v_avg_embedding := v_avg_embedding + p_embeddings[v_i];
    end loop;
    v_avg_embedding := v_avg_embedding / v_count;
    v_avg_embedding := l2_normalize(v_avg_embedding);
  end if;

  insert into stones (
    author_id, name, description, tags, photo_url, lat, lng, city,
    embedding, capture_count, last_confirmed_at
  ) values (
    v_user_id, p_name, p_description, coalesce(p_tags, '{}'),
    p_photo_urls[1],
    p_lat, p_lng, p_city,
    v_avg_embedding, v_count, now()
  )
  returning id into v_stone_id;

  return jsonb_build_object('stone_id', v_stone_id, 'capture_count', v_count);
end;
$$;
revoke all on function create_stone(text, text, text[], text[], vector(768)[], double precision, double precision, text) from public;
grant execute on function create_stone(text, text, text[], text[], vector(768)[], double precision, double precision, text) to authenticated;

-- ─── record_find_v2: found_at fix + COPPA + race-safe insert ────────
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

  -- COPPA gate
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

  if v_stone.created_at > now() - interval '1 hour' then
    return jsonb_build_object('status', 'rejected', 'reason', 'stone_too_fresh', 'reward', 0);
  end if;

  -- BUG FIX: finds has column found_at (not created_at). Old migration
  -- used created_at which would have 42703'd on any find past the fresh gate.
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
    -- Race-safe insert: if two calls collide on the unique key, ON CONFLICT
    -- DO NOTHING skips the second. v_find_id then stays null and we return
    -- `already_found` semantics below.
    insert into finds (user_id, stone_id, city) values (v_user_id, p_stone_id, v_stone.city)
      on conflict (user_id, stone_id) do nothing
      returning id into v_find_id;

    if v_find_id is null then
      return jsonb_build_object(
        'status', 'already_found', 'reason', 'already_found',
        'balance', (select balance from profiles where id = v_user_id), 'reward', 0
      );
    end if;

    update profiles set balance = balance + v_finder_reward where id = v_user_id
      returning balance into v_new_balance;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
      values (v_user_id, v_finder_reward, 'stone_find', p_stone_id::text, v_new_balance);
    update profiles set balance = balance + v_author_reward where id = v_stone.author_id;
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
revoke all on function record_find_v2(uuid, text, vector(768), double precision, double precision, jsonb) from public;
grant execute on function record_find_v2(uuid, text, vector(768), double precision, double precision, jsonb) to authenticated;
