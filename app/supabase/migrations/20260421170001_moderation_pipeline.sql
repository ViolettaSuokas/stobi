-- ═══════════════════════════════════════════════════════════════════
-- Migration 018: NSFW moderation + upload shadowban
-- ═══════════════════════════════════════════════════════════════════
--
-- Все фото (avatar / stone reference / find proof) проходят через
-- Edge Functions `process-stone-photo` или `process-find-photo`, которые
-- вызывают AWS Rekognition DetectModerationLabels. Если отклонено —
-- клиент пишет в moderation_events, а триггер на этой таблице
-- подсчитывает количество reject-ов за 30 дней и ставит юзеру
-- `profiles.upload_shadowbanned = true` после ≥3.
--
-- Shadowbanned юзер:
--   - не может upload-ить фото (проверка в storage policy)
--   - не видит этого статуса (silent ban) — в UI просто "ошибка"
--   - admin видит в `admin_alerts`, может снять бан вручную
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Profile flag
-- ─────────────────────────────────────────────
alter table profiles add column if not exists upload_shadowbanned boolean default false;

comment on column profiles.upload_shadowbanned is
  'Auto-set after 3+ NSFW rejections in 30 days. Blocks photo uploads silently. Cleared manually by admin.';


-- ─────────────────────────────────────────────
-- 2. moderation_events table
-- ─────────────────────────────────────────────
create table if not exists moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  photo_url text,
  labels jsonb not null,                       -- Rekognition labels array
  source text not null check (source in ('stone_reference', 'find_proof', 'avatar', 'chat_photo')),
  rejected_at timestamptz default now()
);

create index if not exists moderation_events_user_idx
  on moderation_events (user_id, rejected_at desc);

alter table moderation_events enable row level security;

-- Клиентский insert разрешён только на свой user_id
create policy "Users can log own moderation events"
  on moderation_events for insert to authenticated
  with check (auth.uid() = user_id);

-- Чтение только своё (для saneness)
create policy "Users read own moderation events"
  on moderation_events for select to authenticated
  using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- 3. admin_alerts table (для ручного ревью)
-- ─────────────────────────────────────────────
create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shadowban', 'pending_find_stuck', 'stone_hidden_mass')),
  user_id uuid references profiles(id) on delete set null,
  stone_id uuid references stones(id) on delete set null,
  payload jsonb,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table admin_alerts enable row level security;
-- Только service_role читает (через Supabase dashboard или кастомный UI).
-- Нет client policies.


-- ─────────────────────────────────────────────
-- 4. Trigger: auto-shadowban после 3 rejections / 30 days
-- ─────────────────────────────────────────────
create or replace function fn_check_shadowban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reject_count integer;
begin
  select count(*) into v_reject_count
    from moderation_events
    where user_id = new.user_id
      and rejected_at > now() - interval '30 days';

  if v_reject_count >= 3 then
    update profiles set upload_shadowbanned = true
      where id = new.user_id and upload_shadowbanned = false;

    -- Log admin alert (идемпотентно)
    insert into admin_alerts (kind, user_id, payload)
      select 'shadowban', new.user_id, jsonb_build_object('reject_count', v_reject_count)
      where not exists (
        select 1 from admin_alerts
        where kind = 'shadowban'
          and user_id = new.user_id
          and resolved_at is null
      );
  end if;

  return new;
end;
$$;

drop trigger if exists on_moderation_event_inserted on moderation_events;
create trigger on_moderation_event_inserted
  after insert on moderation_events
  for each row execute function fn_check_shadowban();


-- ─────────────────────────────────────────────
-- 5. Storage RLS update — shadowbanned юзеры не могут upload
-- ─────────────────────────────────────────────
-- Модифицируем существующую INSERT policy на storage.objects чтобы
-- она учитывала upload_shadowbanned флаг.

drop policy if exists "Users can upload own photos" on storage.objects;

create policy "Users can upload own photos (not shadowbanned)"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
    and not exists (
      select 1 from profiles
      where id = auth.uid() and upload_shadowbanned = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- 1. Column на profiles:
--   select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name = 'upload_shadowbanned';
--
-- 2. Tables:
--   \d moderation_events
--   \d admin_alerts
--
-- 3. Trigger:
--   select tgname from pg_trigger where tgname = 'on_moderation_event_inserted';
--
-- 4. Тест shadowban (выполнить 3 раза для одного юзера):
--   insert into moderation_events (user_id, labels, source)
--     values ('<uuid>', '[{"name":"Explicit Nudity","conf":0.99}]'::jsonb, 'find_proof');
--   -- После 3-го → profiles.upload_shadowbanned = true, admin_alerts имеет запись.

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists on_moderation_event_inserted on moderation_events;
-- drop function if exists fn_check_shadowban();
-- drop policy if exists "Users can upload own photos (not shadowbanned)" on storage.objects;
-- -- Восстановить старую policy:
-- -- create policy "Users can upload own photos" on storage.objects
-- --   for insert to authenticated
-- --   with check (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
-- drop table if exists admin_alerts;
-- drop table if exists moderation_events;
-- alter table profiles drop column if exists upload_shadowbanned;
