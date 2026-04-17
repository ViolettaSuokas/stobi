-- ═══════════════════════════════════════════════════════════════════
-- Migration 001: Lock economy columns on profiles
-- ═══════════════════════════════════════════════════════════════════
--
-- Problem: The existing RLS policy "Users can update own profile"
-- allows clients to UPDATE any column, including balance, is_premium,
-- owned_items, equipped_items, premium_expires_at. A user with the
-- anon key can set balance = 999999 in one request.
--
-- Fix: Replace the blanket UPDATE policy with a restrictive one that
-- blocks the protected columns. All economy changes must go through
-- SECURITY DEFINER RPCs (earn_points, spend_item, activate_trial,
-- record_find) or through the service_role (RevenueCat webhook).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Drop the old permissive policy
drop policy if exists "Users can update own profile" on profiles;

-- 2. Create a trigger that blocks writes to protected columns
--    for anon/authenticated roles. Service role bypasses RLS entirely,
--    so the RevenueCat webhook and our RPCs (security definer) still work.
create or replace function profiles_block_protected_updates()
returns trigger
language plpgsql
as $$
begin
  -- Service role can do anything
  if (select auth.role()) = 'service_role' then
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
    -- Equipped is visual-only, we allow client to write it (no cheating risk).
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protected_updates on profiles;
create trigger profiles_protected_updates
  before update on profiles
  for each row execute function profiles_block_protected_updates();

-- 3. Re-create a safe UPDATE policy: only owner, and only unlocked columns.
--    (The trigger above enforces column-level restrictions.)
create policy "Users can update own profile (safe fields)"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════════
-- Verification query — run after applying, should raise an exception:
-- ═══════════════════════════════════════════════════════════════════
-- update profiles set balance = 999 where id = auth.uid();
-- Expected error: 'Column "balance" cannot be updated directly...'

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (uncomment and run to undo)
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists profiles_protected_updates on profiles;
-- drop function if exists profiles_block_protected_updates();
-- drop policy if exists "Users can update own profile (safe fields)" on profiles;
-- create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
