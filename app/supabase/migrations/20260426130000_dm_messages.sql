-- Direct Messages (1-on-1) — task #18.
--
-- Структура:
--   conversations (a, b, last_message_at, last_message_preview)
--     где a < b лексикографически — гарантирует unique pair regardless of order
--   dm_messages (conversation_id, author_id, body, created_at)
--
-- RLS:
--   conversations.select — only participants (a or b = auth.uid)
--   dm_messages.select — only if user is participant of conversation
--
-- RPC:
--   send_dm(p_to uuid, p_body text) — finds-or-creates conversation,
--   inserts message, updates last_message_*, enqueues push to recipient.
--
-- Rate limit: 30 messages/day per user (server-side check inside RPC).

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references auth.users(id) on delete cascade,
  participant_b uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  -- a < b лексикографически чтобы pair был unique вне зависимости от порядка
  constraint conversations_ordered check (participant_a < participant_b),
  unique (participant_a, participant_b)
);

create index if not exists idx_conversations_a on conversations(participant_a, last_message_at desc);
create index if not exists idx_conversations_b on conversations(participant_b, last_message_at desc);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dm_messages_conv on dm_messages(conversation_id, created_at desc);

-- ────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────

alter table conversations enable row level security;
alter table dm_messages enable row level security;

drop policy if exists conversations_participant_select on conversations;
create policy conversations_participant_select on conversations
  for select using (auth.uid() in (participant_a, participant_b));

drop policy if exists dm_messages_participant_select on dm_messages;
create policy dm_messages_participant_select on dm_messages
  for select using (
    auth.uid() in (
      select participant_a from conversations where id = dm_messages.conversation_id
      union all
      select participant_b from conversations where id = dm_messages.conversation_id
    )
  );

-- Update read_at на свои не-прочитанные (только когда я recipient)
drop policy if exists dm_messages_mark_read on dm_messages;
create policy dm_messages_mark_read on dm_messages
  for update using (
    -- я participant, и я НЕ автор сообщения (нельзя пометить свои)
    auth.uid() in (
      select participant_a from conversations where id = dm_messages.conversation_id
      union all
      select participant_b from conversations where id = dm_messages.conversation_id
    )
    and author_id <> auth.uid()
  );

-- Inserts только через RPC send_dm (security definer обходит RLS).
-- Direct insert от клиента запретить.

-- ────────────────────────────────────────────
-- RPC: send_dm
-- ────────────────────────────────────────────

create or replace function public.send_dm(p_to uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from uuid;
  v_a uuid;
  v_b uuid;
  v_conv_id uuid;
  v_message_id uuid;
  v_recent_count int;
  v_body_clean text;
  v_recipient_lang text;
  v_recipient_chat_enabled boolean;
  v_sender_name text;
  v_title text;
begin
  v_from := auth.uid();
  if v_from is null then raise exception 'not_authenticated'; end if;
  if p_to is null or p_to = v_from then raise exception 'invalid_recipient'; end if;

  v_body_clean := trim(coalesce(p_body, ''));
  if length(v_body_clean) = 0 then raise exception 'empty_message'; end if;
  if length(v_body_clean) > 1000 then raise exception 'message_too_long'; end if;

  -- Rate limit: 30 в день. count messages автора за последние 24h.
  select count(*) into v_recent_count
    from dm_messages
    where author_id = v_from
      and created_at > now() - interval '24 hours';
  if v_recent_count >= 30 then
    raise exception 'rate_limit_exceeded';
  end if;

  -- Recipient existence check (defensive — FK уже это охватывает)
  if not exists(select 1 from auth.users where id = p_to) then
    raise exception 'recipient_not_found';
  end if;

  -- Order pair (a < b)
  if v_from < p_to then
    v_a := v_from; v_b := p_to;
  else
    v_a := p_to; v_b := v_from;
  end if;

  -- Find or create conversation
  select id into v_conv_id
    from conversations where participant_a = v_a and participant_b = v_b;
  if v_conv_id is null then
    insert into conversations (participant_a, participant_b, last_message_at, last_message_preview)
      values (v_a, v_b, now(), substring(v_body_clean from 1 for 80))
      returning id into v_conv_id;
  end if;

  -- Insert message
  insert into dm_messages (conversation_id, author_id, body)
    values (v_conv_id, v_from, v_body_clean)
    returning id into v_message_id;

  -- Update conversation preview (newest)
  update conversations
    set last_message_at = now(),
        last_message_preview = substring(v_body_clean from 1 for 80)
    where id = v_conv_id;

  -- Push recipient (if they have notif_chat_enabled)
  select coalesce(p.notif_chat_enabled, true), coalesce(p.lang, 'ru')
    into v_recipient_chat_enabled, v_recipient_lang
    from profiles p where p.id = p_to;

  select coalesce(p.username, 'Кто-то') into v_sender_name
    from profiles p where p.id = v_from;

  if v_recipient_chat_enabled then
    if v_recipient_lang = 'fi' then
      v_title := v_sender_name;
    elsif v_recipient_lang = 'en' then
      v_title := v_sender_name;
    else
      v_title := v_sender_name;
    end if;
    insert into push_queue (user_id, title, body, data)
      values (
        p_to,
        v_title,
        substring(v_body_clean from 1 for 100),
        jsonb_build_object(
          'type', 'dm',
          'conversation_id', v_conv_id,
          'sender_id', v_from
        )
      );
  end if;

  return jsonb_build_object(
    'message_id', v_message_id,
    'conversation_id', v_conv_id
  );
end;
$$;

-- ────────────────────────────────────────────
-- Helper RPC: list_my_conversations — для inbox-screen
-- Возвращает list with other participant's profile + last message
-- ────────────────────────────────────────────

create or replace function public.list_my_conversations()
returns table (
  conversation_id uuid,
  other_id uuid,
  other_username text,
  other_photo_url text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count integer
)
language sql
security definer
set search_path to 'public'
as $$
  select
    c.id as conversation_id,
    case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end as other_id,
    p.username as other_username,
    p.photo_url as other_photo_url,
    c.last_message_preview,
    c.last_message_at,
    coalesce((
      select count(*)::int from dm_messages m
      where m.conversation_id = c.id
        and m.author_id <> auth.uid()
        and m.read_at is null
    ), 0) as unread_count
  from conversations c
  left join profiles p
    on p.id = (case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end)
  where auth.uid() in (c.participant_a, c.participant_b)
  order by c.last_message_at desc nulls last;
$$;

create or replace function public.mark_dm_thread_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update dm_messages
    set read_at = now()
    where conversation_id = p_conversation_id
      and author_id <> auth.uid()
      and read_at is null;
$$;
