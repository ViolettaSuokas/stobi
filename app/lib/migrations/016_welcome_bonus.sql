-- ═══════════════════════════════════════════════════════════════════
-- Migration 016: Welcome bonus — +20 💎 на регистрацию
-- ═══════════════════════════════════════════════════════════════════
--
-- Каждый новый аккаунт получает 20 💎 стартового баланса, чтобы юзер
-- мог сразу примерить 1-2 косметики маскота (цены 15-30) до первого
-- find/hide. Снижает порог engagement на onboarding.
--
-- Изменения:
--   1. handle_new_user() теперь создаёт profile с balance = 20
--      и пишет balance_event `welcome_bonus` для аудита.
--   2. Backfill существующих юзеров без welcome_bonus-события:
--      +20 💎 единоразово (временно выключаем profiles-lock trigger).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Update handle_new_user trigger
-- ─────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, username, balance)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    20
  );

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
  values (new.id, 20, 'welcome_bonus', null, 20);

  return new;
end;
$$;

-- Trigger уже существует из baseline, не нужно пересоздавать.


-- ─────────────────────────────────────────────
-- 2. Backfill: все существующие profiles без welcome_bonus события
-- ─────────────────────────────────────────────
-- profiles-lock trigger (migration 001) блокирует любое изменение
-- balance вне RPC. Для одноразового backfill временно отключаем.

alter table profiles disable trigger profiles_protected_updates;

do $$
declare
  v_user record;
  v_new_balance integer;
begin
  for v_user in
    select p.id, p.balance
    from profiles p
    where not exists (
      select 1 from balance_events be
      where be.user_id = p.id and be.reason = 'welcome_bonus'
    )
  loop
    v_new_balance := coalesce(v_user.balance, 0) + 20;

    update profiles set balance = v_new_balance where id = v_user.id;

    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user.id, 20, 'welcome_bonus', null, v_new_balance);
  end loop;
end $$;

alter table profiles enable trigger profiles_protected_updates;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- После applying, каждый юзер должен иметь >=1 welcome_bonus в логе:
--   select count(*) from profiles;
--   select count(*) from balance_events where reason = 'welcome_bonus';
--   -- оба числа должны совпадать.
--
-- И проверить баланс конкретного юзера:
--   select balance from profiles where id = '<uuid>';
--   -- должен быть >= 20.

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- Вернуть старый handle_new_user (без bonus):
--   create or replace function handle_new_user()
--   returns trigger as $$
--   begin
--     insert into profiles (id, username)
--     values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
--     return new;
--   end;
--   $$ language plpgsql security definer;
--
-- Отозвать bonus у всех (ОПАСНО — юзеры уже потратили):
--   alter table profiles disable trigger profiles_protected_updates;
--   update profiles p set balance = greatest(0, balance - 20)
--     where exists (select 1 from balance_events be where be.user_id = p.id and be.reason = 'welcome_bonus');
--   delete from balance_events where reason = 'welcome_bonus';
--   alter table profiles enable trigger profiles_protected_updates;
