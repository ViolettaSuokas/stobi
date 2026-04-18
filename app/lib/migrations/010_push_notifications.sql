-- ═══════════════════════════════════════════════════════════════════
-- Migration 010: Push notifications — токены + pending queue + триггер
-- ═══════════════════════════════════════════════════════════════════
--
-- Архитектура:
--   1. push_tokens — Expo Push Tokens пользователей (`ExponentPushToken[...]`)
--      Один пользователь может иметь несколько девайсов → несколько токенов
--   2. push_queue — очередь неотправленных уведомлений
--      Триггеры пишут сюда, Edge Function `send-push` разгребает
--   3. on_find_notify_author — after insert on finds → добавить в queue
--      «Твой камень нашли ❤️»
--
-- Локализация: текст уведомления хранится в queue уже локализованный
-- под язык получателя (profiles.lang или 'en' fallback).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- push_tokens
-- ─────────────────────────────────────────────
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  token text not null,                              -- ExponentPushToken[...]
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_id text,                                    -- опциональный ID устройства
  created_at timestamptz default now(),
  last_used_at timestamptz default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

create policy "Users can manage own tokens"
  on push_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- push_queue — Edge Function `send-push` забирает отсюда и помечает sent
-- ─────────────────────────────────────────────
create table if not exists push_queue (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  body text not null,
  data jsonb default '{}',                          -- для deep-link (например stone_id)
  sent boolean default false,
  sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists push_queue_unsent_idx on push_queue (sent) where not sent;

alter table push_queue enable row level security;
-- No client policies — только service_role (Edge Function) читает/пишет.

-- ─────────────────────────────────────────────
-- Добавить столбец `lang` в profiles (если ещё нет)
-- Нужен чтобы отправлять локализованные push-уведомления
-- ─────────────────────────────────────────────
alter table profiles add column if not exists lang text default 'ru';

-- Клиент может UPDATE свой lang через существующую safe-fields policy
-- (миграция 001 не блокирует lang — только balance/is_premium/etc.)

-- ─────────────────────────────────────────────
-- Триггер: on_find_notify_author
-- Когда кто-то находит камень — добавить push-уведомление автору камня
-- ─────────────────────────────────────────────
create or replace function notify_author_on_find()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_stone_name text;
  v_finder_name text;
  v_lang text;
  v_title text;
  v_body text;
begin
  -- Получить author_id и имя камня
  select s.author_id, s.name into v_author_id, v_stone_name
    from stones s where s.id = new.stone_id;

  -- Не пушим самому себе
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  -- Получить имя нашедшего
  select coalesce(p.username, 'Кто-то') into v_finder_name
    from profiles p where p.id = new.user_id;

  -- Язык автора
  select coalesce(p.lang, 'ru') into v_lang
    from profiles p where p.id = v_author_id;

  -- Локализованный текст
  if v_lang = 'fi' then
    v_title := 'Kivesi löydettiin! ❤️';
    v_body := v_finder_name || ' löysi kiven "' || coalesce(v_stone_name, 'kivi') || '". +2 💎';
  elsif v_lang = 'en' then
    v_title := 'Your stone was found! ❤️';
    v_body := v_finder_name || ' found "' || coalesce(v_stone_name, 'stone') || '". +2 💎';
  else
    v_title := 'Твой камень нашли! ❤️';
    v_body := v_finder_name || ' нашёл "' || coalesce(v_stone_name, 'камень') || '". +2 💎';
  end if;

  insert into push_queue (user_id, title, body, data)
    values (
      v_author_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'stone_found', 'stone_id', new.stone_id)
    );

  return new;
end;
$$;

drop trigger if exists on_find_notify_author on finds;
create trigger on_find_notify_author
  after insert on finds
  for each row execute function notify_author_on_find();

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists on_find_notify_author on finds;
-- drop function if exists notify_author_on_find();
-- drop table if exists push_queue;
-- drop table if exists push_tokens;
-- alter table profiles drop column if exists lang;
