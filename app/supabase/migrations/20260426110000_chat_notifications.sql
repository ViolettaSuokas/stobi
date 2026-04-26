-- Chat push notifications.
--
-- Триггер на messages INSERT: для каждого юзера с notif_chat_enabled=true
-- (кроме автора) — запись в push_queue. Это и push в APNs/FCM, и запись
-- в bell-history (тот же pipeline что мы построили раньше).
--
-- Фильтрация по языку:
--   channel='global' → все юзеры
--   channel='FI' → только юзеры с lang='fi'
--   channel='RU' → только lang='ru'
--   и т.д.
--
-- Защита от спама:
--   - 60-секундный rate-limit per recipient: если юзеру уже пушили < минуты
--     назад из этого же channel, новую запись не делаем (дедупликация
--     по типу+ref_id+таймстампу).
--
-- Toggle: profiles.notif_chat_enabled. Управляется из settings → "Чат-
-- уведомления". Default true (новые юзеры получают пуши пока не выключат).

alter table profiles
  add column if not exists notif_chat_enabled boolean not null default true;

-- ────────────────────────────────────────────
-- Триггер
-- ────────────────────────────────────────────

create or replace function public.notify_chat_recipients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_author_name text;
  v_author_lang text;
  v_recipient record;
  v_title text;
  v_body text;
  v_excerpt text;
  v_channel_label text;
  v_recent_exists boolean;
begin
  -- Имя автора
  select coalesce(p.username, 'Кто-то') into v_author_name
    from profiles p where p.id = new.author_id;

  -- Excerpt — первые 80 символов сообщения. На сервере, чтобы не гонять
  -- лишние данные через push_queue.
  v_excerpt := coalesce(new.text, '');
  if length(v_excerpt) > 80 then
    v_excerpt := substring(v_excerpt from 1 for 80) || '…';
  end if;

  -- Channel label для заголовка пуша. global → пусто, иначе #FI / #RU.
  if new.channel = 'global' or new.channel is null then
    v_channel_label := '';
  else
    v_channel_label := ' #' || new.channel;
  end if;

  -- Получатели: все юзеры с notif_chat_enabled=true, кроме автора.
  -- Для не-global каналов фильтруем по lang (FI=fi, RU=ru, EN=en).
  for v_recipient in
    select p.id, p.lang
    from profiles p
    where p.id <> new.author_id
      and coalesce(p.notif_chat_enabled, true) = true
      and (
        new.channel = 'global'
        or new.channel is null
        or lower(new.channel) = coalesce(p.lang, 'ru')
      )
  loop
    -- Rate-limit: если последний chat-push этому юзеру был < 60 сек назад,
    -- скипаем (дедуп против быстрых множественных сообщений).
    select exists(
      select 1 from push_queue
      where user_id = v_recipient.id
        and (data->>'type') = 'chat_message'
        and created_at > now() - interval '60 seconds'
    ) into v_recent_exists;
    if v_recent_exists then
      continue;
    end if;

    -- Локализованный текст
    if v_recipient.lang = 'fi' then
      v_title := v_author_name || v_channel_label;
      v_body := v_excerpt;
    elsif v_recipient.lang = 'en' then
      v_title := v_author_name || v_channel_label;
      v_body := v_excerpt;
    else
      v_title := v_author_name || v_channel_label;
      v_body := v_excerpt;
    end if;

    insert into push_queue (user_id, title, body, data)
      values (
        v_recipient.id,
        v_title,
        v_body,
        jsonb_build_object(
          'type', 'chat_message',
          'channel', new.channel,
          'message_id', new.id,
          'author_id', new.author_id
        )
      );
  end loop;

  return new;
end;
$function$;

drop trigger if exists on_message_notify_recipients on messages;
create trigger on_message_notify_recipients
  after insert on messages
  for each row
  execute function notify_chat_recipients();
