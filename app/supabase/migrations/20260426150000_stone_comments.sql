-- Stone comments — публичный thread под каждым камнем (как Stonehiding "Logs").
-- Любой залогиненный юзер может оставить коммент. Все видят. Author камня
-- получает push при новом комменте (если notif_chat_enabled=true).

create table if not exists stone_comments (
  id uuid primary key default gen_random_uuid(),
  stone_id uuid not null references stones(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_stone_comments_stone on stone_comments(stone_id, created_at desc);

alter table stone_comments enable row level security;

drop policy if exists stone_comments_select on stone_comments;
create policy stone_comments_select on stone_comments
  for select using (true);

drop policy if exists stone_comments_self_insert on stone_comments;
create policy stone_comments_self_insert on stone_comments
  for insert with check (auth.uid() = author_id);

drop policy if exists stone_comments_self_delete on stone_comments;
create policy stone_comments_self_delete on stone_comments
  for delete using (auth.uid() = author_id);

-- ────────────────────────────────────────────
-- RPC: add_stone_comment
-- ────────────────────────────────────────────

create or replace function public.add_stone_comment(p_stone_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid;
  v_body_clean text;
  v_comment_id uuid;
  v_recent_count int;
  v_stone_author uuid;
  v_stone_name text;
  v_my_name text;
  v_recipient_lang text;
  v_recipient_chat_enabled boolean;
  v_title text;
begin
  v_me := auth.uid();
  if v_me is null then raise exception 'not_authenticated'; end if;

  v_body_clean := trim(coalesce(p_body, ''));
  if length(v_body_clean) = 0 then raise exception 'empty_body'; end if;
  if length(v_body_clean) > 500 then raise exception 'body_too_long'; end if;

  -- Rate limit: 10/час
  select count(*) into v_recent_count
    from stone_comments
    where author_id = v_me
      and created_at > now() - interval '1 hour';
  if v_recent_count >= 10 then
    raise exception 'rate_limit_exceeded';
  end if;

  insert into stone_comments (stone_id, author_id, body)
    values (p_stone_id, v_me, v_body_clean)
    returning id into v_comment_id;

  -- Push автору камня (если author не текущий юзер и не выключил notif)
  select s.author_id, s.name into v_stone_author, v_stone_name
    from stones s where s.id = p_stone_id;

  if v_stone_author is not null and v_stone_author <> v_me then
    select coalesce(p.notif_chat_enabled, true), coalesce(p.lang, 'ru')
      into v_recipient_chat_enabled, v_recipient_lang
      from profiles p where p.id = v_stone_author;

    if v_recipient_chat_enabled then
      select coalesce(p.username, 'Кто-то') into v_my_name
        from profiles p where p.id = v_me;

      if v_recipient_lang = 'fi' then
        v_title := v_my_name || ' kommentoi kiveäsi';
      elsif v_recipient_lang = 'en' then
        v_title := v_my_name || ' commented on your stone';
      else
        v_title := v_my_name || ' оставил комментарий под твоим камнем';
      end if;

      insert into push_queue (user_id, title, body, data)
        values (
          v_stone_author,
          v_title,
          substring(v_body_clean from 1 for 100),
          jsonb_build_object(
            'type', 'stone_comment',
            'stone_id', p_stone_id,
            'comment_id', v_comment_id,
            'commenter_id', v_me
          )
        );
    end if;
  end if;

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;
