-- ═══════════════════════════════════════════════════════════════════
-- Migration 005: record_find RPC (atomic find with anti-fraud)
-- ═══════════════════════════════════════════════════════════════════
--
-- Replaces client-side markStoneFound() in finds.ts.
-- All anti-fraud logic moves to the server:
--   1. Stone must exist
--   2. Cannot find your own stone
--   3. Must be within 30 meters (haversine)
--   4. Max 2 finds per author per day (server-enforced, not AsyncStorage)
--   5. Stone must be older than 1 hour (1h lock for new stones)
--   6. Idempotent: re-calling for same stone returns existing find
--
-- Rewards are atomic:
--   - Finder: +1 💎
--   - Author: +2 💎 (on-find bonus)
--
-- Client usage:
--   const { data, error } = await supabase.rpc('record_find', {
--     p_stone_id: stoneId,
--     p_proof_lat: 60.17,
--     p_proof_lng: 24.94,
--   });
-- ═══════════════════════════════════════════════════════════════════

-- Haversine helper (meters between two lat/lng points)
create or replace function haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language plpgsql
immutable
as $$
declare
  r double precision := 6371000;  -- earth radius in meters
  phi1 double precision := radians(lat1);
  phi2 double precision := radians(lat2);
  dphi double precision := radians(lat2 - lat1);
  dlambda double precision := radians(lng2 - lng1);
  a double precision;
  c double precision;
begin
  a := sin(dphi / 2) ^ 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  return r * c;
end;
$$;

-- Drop the old "reward author" trigger — record_find now does it atomically
drop trigger if exists on_find_reward_author on finds;
drop function if exists reward_stone_author();

create or replace function record_find(
  p_stone_id uuid,
  p_proof_lat double precision,
  p_proof_lng double precision
)
returns jsonb  -- { balance, reward, already_found? }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_stone stones%rowtype;
  v_distance double precision;
  v_existing uuid;
  v_author_finds_today integer;
  v_new_balance integer;
  v_reward integer := 1;           -- REWARD_FIND
  v_author_reward integer := 2;    -- REWARD_AUTHOR_ON_FIND
  v_stone_age interval;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  if p_proof_lat is null or p_proof_lng is null then
    raise exception 'invalid_proof_coords';
  end if;

  select * into v_stone from stones where id = p_stone_id;
  if not found then
    raise exception 'stone_not_found';
  end if;

  -- Rule: cannot find your own stone
  if v_stone.author_id = v_user_id then
    raise exception 'cannot_find_own_stone';
  end if;

  -- Rule: 1-hour lock on newly hidden stones
  v_stone_age := now() - v_stone.created_at;
  if v_stone_age < interval '1 hour' then
    raise exception 'stone_too_fresh: wait % more minutes',
      ceil(extract(epoch from (interval '1 hour' - v_stone_age)) / 60);
  end if;

  -- Rule: must be within 30 meters
  v_distance := haversine_m(p_proof_lat, p_proof_lng, v_stone.lat, v_stone.lng);
  if v_distance > 30 then
    raise exception 'too_far: % meters (need ≤30)', round(v_distance);
  end if;

  -- Idempotency: already found this stone
  select id into v_existing from finds
    where user_id = v_user_id and stone_id = p_stone_id;
  if v_existing is not null then
    select balance into v_new_balance from profiles where id = v_user_id;
    return jsonb_build_object(
      'balance', v_new_balance,
      'reward', 0,
      'already_found', true
    );
  end if;

  -- Anti-fraud: max 2 finds per author per day
  select count(*) into v_author_finds_today
    from finds f
    join stones s on s.id = f.stone_id
    where f.user_id = v_user_id
      and s.author_id = v_stone.author_id
      and f.found_at > now() - interval '24 hours';

  if v_author_finds_today >= 2 then
    raise exception 'author_daily_limit: already found 2 stones from this author today';
  end if;

  -- Insert find
  insert into finds (user_id, stone_id, city)
    values (v_user_id, p_stone_id, v_stone.city);

  -- Reward finder
  update profiles
    set balance = coalesce(balance, 0) + v_reward
    where id = v_user_id
    returning balance into v_new_balance;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, v_reward, 'stone_find', p_stone_id::text, v_new_balance);

  -- Reward author (if they still exist)
  if v_stone.author_id is not null then
    declare v_author_bal integer;
    begin
      update profiles
        set balance = coalesce(balance, 0) + v_author_reward
        where id = v_stone.author_id
        returning balance into v_author_bal;

      if v_author_bal is not null then
        insert into balance_events (user_id, amount, reason, ref_id, balance_after)
          values (v_stone.author_id, v_author_reward, 'author_bonus', p_stone_id::text, v_author_bal);
      end if;
    end;
  end if;

  return jsonb_build_object(
    'balance', v_new_balance,
    'reward', v_reward,
    'already_found', false
  );
end;
$$;

revoke all on function record_find(uuid, double precision, double precision) from public;
grant execute on function record_find(uuid, double precision, double precision) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop function if exists record_find(uuid, double precision, double precision);
-- drop function if exists haversine_m(double precision, double precision, double precision, double precision);
-- -- Restore reward_stone_author() trigger from initial schema.
