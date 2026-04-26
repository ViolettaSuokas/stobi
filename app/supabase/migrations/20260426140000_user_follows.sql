-- User follows — asymmetric (Instagram-style).
-- A may follow B without mutual approval. Used for:
--   1. "See new stones from people I follow" feed-filter (future)
--   2. Save someone's profile to revisit
--   3. Foundation for "stories" / "activity from friends" features
--
-- DM/messaging остаётся свободным (любой может писать любому), follow
-- влияет только на feed-discovery.

create table if not exists user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  -- Нельзя follow'ить себя
  check (follower_id <> followee_id)
);

create index if not exists idx_follows_follower on user_follows(follower_id);
create index if not exists idx_follows_followee on user_follows(followee_id);

alter table user_follows enable row level security;

-- Все могут читать (counters публичные)
drop policy if exists user_follows_select on user_follows;
create policy user_follows_select on user_follows
  for select using (true);

-- Insert/delete только своих (я могу follow/unfollow других, но не от их имени)
drop policy if exists user_follows_self_insert on user_follows;
create policy user_follows_self_insert on user_follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists user_follows_self_delete on user_follows;
create policy user_follows_self_delete on user_follows
  for delete using (auth.uid() = follower_id);

-- ────────────────────────────────────────────
-- RPC: toggle_follow — atomic follow/unfollow + counters
-- ────────────────────────────────────────────

create or replace function public.toggle_follow(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid;
  v_existing boolean;
  v_followers int;
  v_following int;
begin
  v_me := auth.uid();
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_user_id is null or p_user_id = v_me then raise exception 'invalid_target'; end if;

  select exists(
    select 1 from user_follows where follower_id = v_me and followee_id = p_user_id
  ) into v_existing;

  if v_existing then
    delete from user_follows where follower_id = v_me and followee_id = p_user_id;
  else
    insert into user_follows (follower_id, followee_id) values (v_me, p_user_id)
      on conflict do nothing;
  end if;

  -- Counter того кого мы зафоллоулили (followers count)
  select count(*) into v_followers from user_follows where followee_id = p_user_id;
  -- На сколько подписан target юзер (following count)
  select count(*) into v_following from user_follows where follower_id = p_user_id;

  return jsonb_build_object(
    'following', not v_existing,
    'followers_count', v_followers,
    'following_count', v_following
  );
end;
$$;
