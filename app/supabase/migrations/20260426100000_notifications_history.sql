-- Notifications history for the bell icon.
--
-- Цель: всё что попадает в push_queue также видно юзеру в /notifications
-- screen с состоянием read/unread. Bell icon на карте показывает счётчик
-- непрочитанных.
--
-- Подход: используем существующий push_queue как single source of truth.
-- Уже есть user_id, title, body, data, created_at, sent, sent_at.
-- Добавляем read_at — null означает "не прочитано", timestamp = когда прочёл.
--
-- Также: добавляем триггер `notify_author_on_pending_find` — раньше
-- автор камня НЕ получал push при borderline-находке, только тихо
-- появлялась карточка в pending-approvals. Юзер не понимал что произошло.

-- ────────────────────────────────────────────
-- 1. Колонка read_at
-- ────────────────────────────────────────────

alter table push_queue
  add column if not exists read_at timestamptz;

-- Index для быстрого подсчёта unread'ов на bell badge
create index if not exists idx_push_queue_unread
  on push_queue (user_id, read_at)
  where read_at is null;

-- ────────────────────────────────────────────
-- 2. RLS — юзер видит только свои уведомления
-- ────────────────────────────────────────────

alter table push_queue enable row level security;

drop policy if exists push_queue_self_select on push_queue;
create policy push_queue_self_select on push_queue
  for select using (auth.uid() = user_id);

-- update только service_role + сам юзер (для mark-read)
drop policy if exists push_queue_self_update_read on push_queue;
create policy push_queue_self_update_read on push_queue
  for update using (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- 3. RPCs — mark read
-- ────────────────────────────────────────────

create or replace function public.mark_notification_read(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update push_queue
    set read_at = now()
    where id = p_id
      and user_id = auth.uid()
      and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update push_queue
    set read_at = now()
    where user_id = auth.uid()
      and read_at is null;
end;
$$;

-- ────────────────────────────────────────────
-- 4. Триггер: pending-find → push автору + history-запись
-- ────────────────────────────────────────────

create or replace function public.notify_author_on_pending_find()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_author_id uuid;
  v_stone_name text;
  v_finder_name text;
  v_lang text;
  v_title text;
  v_body text;
  v_push_enabled boolean;
begin
  -- Только для статусов 'pending' / 'pending_review' — не для confirmed/rejected.
  if new.status is null or new.status not like 'pending%' then
    return new;
  end if;

  select s.author_id, s.name into v_author_id, v_stone_name
    from stones s where s.id = new.stone_id;

  -- Не пушим самому себе и если author уже удалён
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  -- Имя нашедшего
  select coalesce(p.username, 'Кто-то') into v_finder_name
    from profiles p where p.id = new.user_id;

  -- Язык + push prefs автора
  select coalesce(p.lang, 'ru'), coalesce(p.notif_push_enabled, true)
    into v_lang, v_push_enabled
    from profiles p where p.id = v_author_id;

  -- Локализованный текст
  if v_lang = 'fi' then
    v_title := 'Tarkista löytö 🤔';
    v_body := v_finder_name || ' luulee löytäneensä kivesi "' || coalesce(v_stone_name, 'kivi') || '". Vahvista profiilissa.';
  elsif v_lang = 'en' then
    v_title := 'Verify a find 🤔';
    v_body := v_finder_name || ' thinks they found "' || coalesce(v_stone_name, 'stone') || '". Approve it in your profile.';
  else
    v_title := 'Похоже твой камень нашли 🤔';
    v_body := v_finder_name || ' думает что нашёл "' || coalesce(v_stone_name, 'камень') || '". Подтверди в профиле.';
  end if;

  -- Insert в push_queue (это и push в APNs/FCM, и запись в bell-history).
  -- Если у юзера выключен push — sent=true сразу, чтобы edge function
  -- не дёргал APNs, но запись всё равно есть в bell-history (юзер увидит
  -- когда откроет /notifications).
  insert into push_queue (user_id, title, body, data, sent, sent_at)
    values (
      v_author_id,
      v_title,
      v_body,
      jsonb_build_object(
        'type', 'pending_find',
        'stone_id', new.stone_id,
        'pending_find_id', new.id
      ),
      not v_push_enabled,
      case when not v_push_enabled then now() else null end
    );

  return new;
end;
$function$;

drop trigger if exists on_pending_find_notify_author on find_proofs;
create trigger on_pending_find_notify_author
  after insert on find_proofs
  for each row
  execute function notify_author_on_pending_find();
