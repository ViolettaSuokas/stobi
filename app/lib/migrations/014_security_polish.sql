-- ═══════════════════════════════════════════════════════════════════
-- Migration 014: Security polish — age gate + webhook dedup + RLS tighten
-- ═══════════════════════════════════════════════════════════════════
--
-- Закрывает три HIGH/MEDIUM блокера из audit 2026-04-18:
--   D. Server-side age gate — COPPA backup к client-check
--   E. push_tokens RLS — убрать UPDATE, оставить только INSERT/SELECT/DELETE
--   F. RC webhook replay protection — таблица webhook_events для dedup
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- D. Server-side age gate
-- ─────────────────────────────────────────────────────────────────
-- profiles.birth_year хранится как smallint (YYYY). Триггер проверяет
-- что user >= 13 лет. Вызывается before_insert на profiles → блок
-- создания аккаунта для детей.
--
-- Client (register.tsx) уже запрашивает DOB через checkbox "I'm 13+",
-- но клиент можно обойти. Server-side trigger = final защита.
--
-- Если birth_year не задан → триггер ничего не делает (back-compat
-- с существующими demo-accounts без DOB).
-- ─────────────────────────────────────────────────────────────────

alter table profiles
  add column if not exists birth_year smallint
  check (birth_year is null or (birth_year >= 1900 and birth_year <= extract(year from now())::int));

create or replace function validate_age_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  age int;
begin
  if new.birth_year is null then
    -- DOB не задан — пропускаем (back-compat, client age-gate сработает)
    return new;
  end if;

  age := current_year - new.birth_year;
  if age < 13 then
    raise exception 'Age requirement not met: must be 13 or older (COPPA)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists before_insert_validate_age on profiles;
create trigger before_insert_validate_age
  before insert or update of birth_year on profiles
  for each row execute function validate_age_on_signup();


-- ─────────────────────────────────────────────────────────────────
-- E. push_tokens RLS — explicit per-action policies
-- ─────────────────────────────────────────────────────────────────
-- Было: "Users can manage own tokens" for all → разрешает UPDATE.
-- Юзеру не нужен UPDATE (девайс не меняется); достаточно
-- INSERT (register), SELECT (read own), DELETE (logout).
-- ─────────────────────────────────────────────────────────────────

drop policy if exists "Users can manage own tokens" on push_tokens;

create policy "Users can read own tokens"
  on push_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own tokens"
  on push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own tokens"
  on push_tokens for delete
  using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────
-- F. webhook_events — dedup для RC webhook replay protection
-- ─────────────────────────────────────────────────────────────────
-- RevenueCat может повторно отправить webhook (network retry) →
-- без dedup профиль обновится дважды (для IS_PREMIUM ок, но для
-- любых «бонус за INITIAL_PURCHASE» = двойные алмазики).
--
-- Edge Function rc-webhook перед обработкой event делает:
--   INSERT INTO webhook_events (event_id, source, payload) → если конфликт
--   unique (event_id, source) = уже видели, skip.
-- ─────────────────────────────────────────────────────────────────

create table if not exists webhook_events (
  id bigint generated always as identity primary key,
  event_id text not null,                              -- RC event.id
  source text not null,                                -- 'revenuecat' | 'stripe' | ...
  received_at timestamptz default now(),
  payload jsonb,
  unique (event_id, source)
);

create index if not exists webhook_events_received_idx
  on webhook_events (source, received_at desc);

-- RLS: только service_role пишет (Edge Function runs as service role)
alter table webhook_events enable row level security;

create policy "Service role writes webhook events"
  on webhook_events for insert
  to service_role
  with check (true);

create policy "Service role reads webhook events"
  on webhook_events for select
  to service_role
  using (true);

-- Retention: автоматически удаляем events > 30 дней (security hygiene).
-- Supabase pg_cron job: см. cleanup_webhook_events() ниже.
create or replace function cleanup_webhook_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from webhook_events
  where received_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Планировщик (требует pg_cron extension). Вызывай вручную если не включен.
-- select cron.schedule('cleanup-webhook-events', '0 3 * * *', 'select cleanup_webhook_events()');
