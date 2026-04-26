-- Stone likes — heart button on stone detail.
--
-- Любой залогиненный юзер может лайкнуть камень (включая собственный).
-- Counter показывается всем. Author может видеть список лайкнувших в
-- profile-ленте (в будущем).
--
-- Таблица `likes` уже существует но это для chat messages — здесь нужна
-- отдельная stone_likes.

create table if not exists stone_likes (
  stone_id uuid not null references stones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stone_id, user_id)
);

create index if not exists idx_stone_likes_stone on stone_likes(stone_id);
create index if not exists idx_stone_likes_user on stone_likes(user_id);

alter table stone_likes enable row level security;

-- Все могут читать (публичный counter + список лайкнувших на профайле)
drop policy if exists stone_likes_select on stone_likes;
create policy stone_likes_select on stone_likes
  for select using (true);

-- Insert/delete только своих
drop policy if exists stone_likes_self_insert on stone_likes;
create policy stone_likes_self_insert on stone_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists stone_likes_self_delete on stone_likes;
create policy stone_likes_self_delete on stone_likes
  for delete using (auth.uid() = user_id);

-- ────────────────────────────────────────────
-- RPC: toggle_stone_like — атомарно лайк/анлайк + возвращает counter
-- ────────────────────────────────────────────
-- Идемпотентно: если уже лайкнут — снимает лайк, иначе ставит.
-- Возвращает { liked: bool, total: int } чтобы UI мог сразу показать.

create or replace function public.toggle_stone_like(p_stone_id uuid)
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
    select 1 from stone_likes where stone_id = p_stone_id and user_id = v_user_id
  ) into v_existing;

  if v_existing then
    delete from stone_likes where stone_id = p_stone_id and user_id = v_user_id;
  else
    insert into stone_likes (stone_id, user_id) values (p_stone_id, v_user_id)
      on conflict do nothing;
  end if;

  select count(*) into v_total from stone_likes where stone_id = p_stone_id;

  return jsonb_build_object(
    'liked', not v_existing,
    'total', v_total
  );
end;
$$;
