-- ═══════════════════════════════════════════════════════════════════
-- Migration 004: activate_trial RPC + trial_state table
-- ═══════════════════════════════════════════════════════════════════
--
-- Replaces client-side activateTrial() in premium-trial.ts.
-- Key change: trial state is server-authoritative, not AsyncStorage.
-- Previously a user could edit AsyncStorage to get unlimited trial.
--
-- Trial duration: 7 days (was 24h — per product audit, 24h converts poorly).
--
-- Activation rules:
--   - Requires ≥5 finds in the last 24 hours (daily challenge)
--   - Once activated, cannot re-activate until previous trial expires
--     AND at least 30 days have passed since activation (cooldown)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists trial_state (
  user_id uuid references profiles(id) on delete cascade primary key,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null default 'daily_challenge'  -- future: 'referral', 'promo'
);

alter table trial_state enable row level security;

create policy "Users can read own trial state"
  on trial_state for select using (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies — only via RPC.

create or replace function get_trial_info()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_state trial_state%rowtype;
  v_ms_remaining bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  select * into v_state from trial_state where user_id = v_user_id;
  if not found or v_state.expires_at <= now() then
    return jsonb_build_object('active', false, 'ms_remaining', 0);
  end if;

  v_ms_remaining := extract(epoch from (v_state.expires_at - now())) * 1000;
  return jsonb_build_object('active', true, 'ms_remaining', v_ms_remaining);
end;
$$;

revoke all on function get_trial_info() from public;
grant execute on function get_trial_info() to authenticated;

create or replace function activate_trial()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_finds_24h integer;
  v_existing trial_state%rowtype;
  v_duration interval := interval '7 days';
  v_cooldown interval := interval '30 days';
  v_new_expires timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  -- Require 5 finds in the last 24 hours (daily challenge)
  select count(*) into v_finds_24h
    from finds
    where user_id = v_user_id
      and found_at > now() - interval '24 hours';

  if v_finds_24h < 5 then
    raise exception 'daily_challenge_incomplete: % finds in last 24h, need 5', v_finds_24h;
  end if;

  -- Cooldown: cannot re-activate if previous trial ended less than 30 days ago
  select * into v_existing from trial_state where user_id = v_user_id;
  if found then
    if v_existing.expires_at > now() then
      raise exception 'trial_already_active';
    end if;
    if v_existing.activated_at > now() - v_cooldown then
      raise exception 'trial_cooldown: wait 30 days between trials';
    end if;
  end if;

  v_new_expires := now() + v_duration;

  insert into trial_state (user_id, activated_at, expires_at, source)
    values (v_user_id, now(), v_new_expires, 'daily_challenge')
    on conflict (user_id) do update
      set activated_at = excluded.activated_at,
          expires_at = excluded.expires_at,
          source = excluded.source;

  return jsonb_build_object(
    'active', true,
    'ms_remaining', extract(epoch from v_duration) * 1000
  );
end;
$$;

revoke all on function activate_trial() from public;
grant execute on function activate_trial() to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop function if exists activate_trial();
-- drop function if exists get_trial_info();
-- drop table if exists trial_state;
