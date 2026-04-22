-- Tune similarity thresholds in record_find_v2 based on chaos-test findings.
--
-- Chaos test against prod Edge Functions (2026-04-22) measured real CLIP
-- similarity distribution:
--   - same photo, different size           : 0.99
--   - two different photos (picsum random) : 0.69 (baseline noise floor)
--   - two different "stones" (picsum)      : 0.79
--
-- Old threshold 0.60 for pending / GPS-verified is BELOW random noise — a
-- photo of anything near the stone location would auto-verify. Bumping to
-- 0.70 puts the bar just above noise, preserving the "GPS rescues weaker AI"
-- intent without opening the door to drive-by false finds.
--
-- New decision table:
--   ≥ 0.82             → verified (ai_match, strong signal)
--   ≥ 0.70  + GPS ≤30m → verified (ai_match_plus_gps)
--   ≥ 0.70  (no GPS)   → pending  (author reviews photo)
--   <  0.70            → rejected (low_similarity)

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
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
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

  select count(*) into v_fresh_count from finds
    where user_id = v_user_id and created_at > now() - interval '1 day';
  if v_fresh_count >= 10 then
    return jsonb_build_object('status', 'rejected', 'reason', 'daily_find_limit', 'reward', 0);
  end if;

  select count(*) into v_author_daily_count from finds
    where stone_id in (select id from stones where author_id = v_stone.author_id)
      and created_at > now() - interval '1 day';
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
      returning id into v_find_id;
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
