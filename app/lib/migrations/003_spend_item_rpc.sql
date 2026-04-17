-- ═══════════════════════════════════════════════════════════════════
-- Migration 003: spend_item RPC + item catalog + grant_item RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- Replaces client-side:
--   - points.ts buyItem()       → rpc spend_item(item_id)
--   - points.ts unlockCosmeticById() → rpc grant_item(item_id)
--   - points.ts spendPoints()   → rpc spend_points(amount, reason, ref_id)
--
-- Key protection: item price and premium-only flag are SERVER-SIDE.
-- Client cannot cheat by passing arbitrary prices.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- Item catalog (authoritative, server-side)
-- ─────────────────────────────────────────────
create table if not exists items (
  id text primary key,
  category text not null,             -- 'color' | 'eye' | 'shape' | 'decor'
  price integer not null default 0,
  free_by_default boolean not null default false,
  premium_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now()
);

alter table items enable row level security;
create policy "Anyone can read items" on items for select to authenticated, anon using (active);

-- Seed catalog (mirror of lib/points.ts ALL_ITEMS). Upsert so re-running is safe.
insert into items (id, category, price, free_by_default, premium_only) values
  ('color-lavender',   'color', 0,  true,  false),
  ('color-periwinkle', 'color', 0,  true,  false),
  ('color-pink',       'color', 0,  true,  false),
  ('color-coral',      'color', 0,  true,  false),
  ('color-amber',      'color', 0,  true,  false),
  ('color-mint',       'color', 20, false, false),
  ('color-sky',        'color', 20, false, false),
  ('color-peach',      'color', 20, false, false),
  ('color-galaxy',     'color', 45, false, true),
  ('color-aurora',     'color', 45, false, true),
  ('eye-happy',        'eye',   0,  true,  false),
  ('eye-sleeping',     'eye',   0,  true,  false),
  ('eye-wink',         'eye',   15, false, false),
  ('eye-sparkle',      'eye',   15, false, false),
  ('eye-heart',        'eye',   40, false, true),
  ('shape-pebble',     'shape', 0,  true,  false),
  ('shape-round',      'shape', 0,  true,  false),
  ('shape-egg',        'shape', 20, false, false),
  ('shape-long',       'shape', 20, false, false),
  ('shape-bumpy',      'shape', 25, false, false),
  ('shape-tall',       'shape', 25, false, false),
  ('shape-star',       'shape', 50, false, true),
  ('decor-none',       'decor', 0,  true,  false),
  ('decor-flower',     'decor', 0,  true,  false),
  ('decor-leaf',       'decor', 0,  true,  false),
  ('decor-cat-ears',   'decor', 40, false, true),
  ('decor-glasses',    'decor', 40, false, true),
  ('decor-crown',      'decor', 50, false, true),
  ('decor-wizard',     'decor', 50, false, true)
on conflict (id) do update
  set category = excluded.category,
      price = excluded.price,
      free_by_default = excluded.free_by_default,
      premium_only = excluded.premium_only,
      active = true;

-- ─────────────────────────────────────────────
-- RPC: spend_item
-- ─────────────────────────────────────────────
create or replace function spend_item(p_item_id text)
returns jsonb  -- { balance, owned_items }
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

  -- Already owned?
  if v_profile.owned_items && array[p_item_id] then
    raise exception 'already_owned';
  end if;

  -- Premium-only check (trust server's is_premium — set by RevenueCat webhook)
  if v_item.premium_only then
    v_is_premium := coalesce(v_profile.is_premium, false)
      and (v_profile.premium_expires_at is null or v_profile.premium_expires_at > now());
    if not v_is_premium then
      raise exception 'premium_required';
    end if;
  end if;

  -- Insufficient funds
  if coalesce(v_profile.balance, 0) < v_item.price then
    raise exception 'insufficient';
  end if;

  -- Atomic update: decrement balance and append item
  v_new_balance := v_profile.balance - v_item.price;
  v_new_owned := coalesce(v_profile.owned_items, array[]::text[]) || p_item_id;

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

revoke all on function spend_item(text) from public;
grant execute on function spend_item(text) to authenticated;

-- ─────────────────────────────────────────────
-- RPC: grant_item (for achievements — no price check)
-- ─────────────────────────────────────────────
create or replace function grant_item(p_item_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_item items%rowtype;
  v_owned text[];
  v_new_owned text[];
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  if p_reason is null or p_reason !~ '^achievement:' then
    raise exception 'invalid_reason';
  end if;

  select * into v_item from items where id = p_item_id and active;
  if not found then raise exception 'unknown_item'; end if;

  select owned_items into v_owned from profiles where id = v_user_id;
  if v_owned && array[p_item_id] then
    return jsonb_build_object('already_owned', true);
  end if;

  v_new_owned := coalesce(v_owned, array[]::text[]) || p_item_id;
  update profiles set owned_items = v_new_owned where id = v_user_id;

  return jsonb_build_object('owned_items', to_jsonb(v_new_owned));
end;
$$;

revoke all on function grant_item(text, text) from public;
grant execute on function grant_item(text, text) to authenticated;

-- ─────────────────────────────────────────────
-- RPC: spend_points (generic decrement, e.g. for reveals)
-- ─────────────────────────────────────────────
create or replace function spend_points(
  p_amount integer,
  p_reason text,
  p_ref_id text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance integer;
  v_new_balance integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  if p_amount is null or p_amount <= 0 or p_amount > 100 then
    raise exception 'invalid_amount';
  end if;

  select balance into v_balance from profiles where id = v_user_id for update;
  if v_balance is null then raise exception 'profile_not_found'; end if;
  if v_balance < p_amount then raise exception 'insufficient'; end if;

  v_new_balance := v_balance - p_amount;
  update profiles set balance = v_new_balance where id = v_user_id;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, -p_amount, p_reason, p_ref_id, v_new_balance);

  return v_new_balance;
end;
$$;

revoke all on function spend_points(integer, text, text) from public;
grant execute on function spend_points(integer, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop function if exists spend_item(text);
-- drop function if exists grant_item(text, text);
-- drop function if exists spend_points(integer, text, text);
-- drop table if exists items;
