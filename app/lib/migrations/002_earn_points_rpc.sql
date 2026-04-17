-- ═══════════════════════════════════════════════════════════════════
-- Migration 002: earn_points RPC (anti-cheat atomic reward)
-- ═══════════════════════════════════════════════════════════════════
--
-- Replaces client-side read-modify-write on profiles.balance.
-- - SECURITY DEFINER so it can bypass the protected-column trigger.
-- - Atomic UPDATE avoids the race condition on concurrent earns.
-- - Enforces per-user rate limit: max 20 earns per minute.
-- - Logs to balance_events for auditability and reconciliation.
--
-- Client usage:
--   const { data, error } = await supabase.rpc('earn_points', {
--     p_amount: 1,
--     p_reason: 'stone_find',
--     p_ref_id: stoneId,
--   });
-- ═══════════════════════════════════════════════════════════════════

-- Event log for all balance mutations (audit trail)
create table if not exists balance_events (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  amount integer not null,               -- positive = earn, negative = spend
  reason text not null,                  -- 'stone_find' | 'stone_hide' | 'author_bonus' | 'buy_item:<id>' | 'admin'
  ref_id text,                           -- optional stone_id / item_id for traceability
  balance_after integer not null,
  created_at timestamptz default now() not null
);

create index if not exists balance_events_user_idx on balance_events (user_id, created_at desc);

alter table balance_events enable row level security;

create policy "Users can read own balance events"
  on balance_events for select
  using (auth.uid() = user_id);
-- No INSERT policy — only RPCs (security definer) write to this table.

-- ─────────────────────────────────────────────
-- RPC: earn_points
-- ─────────────────────────────────────────────
create or replace function earn_points(
  p_amount integer,
  p_reason text,
  p_ref_id text default null
)
returns integer  -- new balance
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

  -- Rate limit: max 20 earns per minute per user (prevents scripted abuse)
  select count(*) into v_recent_count
    from balance_events
    where user_id = v_user_id
      and amount > 0
      and created_at > now() - interval '1 minute';
  if v_recent_count >= 20 then
    raise exception 'rate_limit_exceeded';
  end if;

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

revoke all on function earn_points(integer, text, text) from public;
grant execute on function earn_points(integer, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop function if exists earn_points(integer, text, text);
-- drop table if exists balance_events;
