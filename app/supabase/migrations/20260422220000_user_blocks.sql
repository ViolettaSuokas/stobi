-- Block user — App Store 1.2 (UGC apps must allow blocking abusive users).
--
-- `user_blocks` is a simple edge-list: blocker sees no content from
-- blocked. Reverse isn't enforced server-side (blocked user sees blocker
-- normally — Twitter-style). All filtering happens via RLS / client.
--
-- Chat messages, stones, content_reports all reference profiles; to
-- prevent abusive users from re-appearing via UI, the client joins
-- against user_blocks on read and filters in queries.
--
-- No rate-limit on block itself — people should be able to block fast.
-- Unique(blocker, blocked) prevents duplicate rows.

create table if not exists user_blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists user_blocks_blocker_idx on user_blocks (blocker_id);
create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

alter table user_blocks enable row level security;

-- Blocker reads own block list (to render UI with who's blocked).
drop policy if exists user_blocks_read_own on user_blocks;
create policy user_blocks_read_own
  on user_blocks for select to authenticated
  using (blocker_id = auth.uid());

-- No direct inserts/deletes — use RPCs.

-- ─── RPC: block_user ─────────────────────────────────────────────────
create or replace function block_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'auth_required'; end if;
  if p_target_id is null then raise exception 'target_required'; end if;
  if p_target_id = v_me then raise exception 'cannot_block_self'; end if;

  -- Verify target exists (avoid leaking block requests on bogus ids).
  if not exists (select 1 from profiles where id = p_target_id) then
    raise exception 'target_not_found';
  end if;

  insert into user_blocks (blocker_id, blocked_id)
    values (v_me, p_target_id)
    on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

revoke all on function block_user(uuid) from public;
grant execute on function block_user(uuid) to authenticated;

-- ─── RPC: unblock_user ───────────────────────────────────────────────
create or replace function unblock_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'auth_required'; end if;
  delete from user_blocks where blocker_id = v_me and blocked_id = p_target_id;
end;
$$;

revoke all on function unblock_user(uuid) from public;
grant execute on function unblock_user(uuid) to authenticated;
