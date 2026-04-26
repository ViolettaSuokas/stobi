-- Comment likes + ability to report any content (comment, stone, message).
--
-- 1) comment_likes — like stone_likes pattern (composite PK + RLS + RPC toggle).
-- 2) content_reports — INSERT policy for authenticated users + helper RPC
--    `report_content(p_target_type, p_target_id, p_category, p_reason)`.

create table if not exists comment_likes (
  comment_id uuid not null references stone_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists idx_comment_likes_comment on comment_likes(comment_id);

alter table comment_likes enable row level security;

drop policy if exists comment_likes_select on comment_likes;
create policy comment_likes_select on comment_likes for select using (true);

drop policy if exists comment_likes_self_insert on comment_likes;
create policy comment_likes_self_insert on comment_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists comment_likes_self_delete on comment_likes;
create policy comment_likes_self_delete on comment_likes
  for delete using (auth.uid() = user_id);

create or replace function public.toggle_comment_like(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_existing boolean;
  v_total integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  select exists(
    select 1 from comment_likes where comment_id = p_comment_id and user_id = v_user_id
  ) into v_existing;

  if v_existing then
    delete from comment_likes where comment_id = p_comment_id and user_id = v_user_id;
  else
    insert into comment_likes (comment_id, user_id) values (p_comment_id, v_user_id)
      on conflict do nothing;
  end if;

  select count(*) into v_total from comment_likes where comment_id = p_comment_id;
  return jsonb_build_object('liked', not v_existing, 'total', v_total);
end;
$$;

-- ────────────────────────────────────────────
-- content_reports: INSERT policy + helper RPC
-- ────────────────────────────────────────────

drop policy if exists content_reports_self_insert on content_reports;
create policy content_reports_self_insert on content_reports
  for insert with check (auth.uid() = reporter_id);

create or replace function public.report_content(
  p_target_type text,
  p_target_id text,
  p_category text default 'other',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid;
  v_id uuid;
begin
  v_me := auth.uid();
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_target_type not in ('comment', 'stone', 'message', 'profile') then
    raise exception 'invalid_target_type';
  end if;

  insert into content_reports (reporter_id, target_type, target_id, category, reason)
    values (v_me, p_target_type, p_target_id, p_category, p_reason)
    returning id into v_id;

  return jsonb_build_object('report_id', v_id);
end;
$$;
