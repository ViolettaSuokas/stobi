-- ═══════════════════════════════════════════════
-- Stobi — BASELINE schema (накатывается один раз на новый проект)
--
-- После этого — миграции 001-008 в порядке (см. README.md).
--
-- Замечание: часть правил из этого файла (UPDATE policy на profiles,
-- reward_stone_author trigger) позже изменяется миграцией 001 и 005.
-- НЕ редактируй их здесь — вместо этого пиши новую миграцию 010+.
-- ═══════════════════════════════════════════════

-- 1. Profiles (extends auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text not null,
  avatar text default '🪨',
  bio text,
  is_artist boolean default false,
  is_premium boolean default false,
  premium_expires_at timestamptz,
  balance integer default 0,
  owned_items text[] default '{}',
  equipped_items jsonb default '{}',
  created_at timestamptz default now()
);

-- 2. Stones (hidden by users)
create table stones (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete cascade,
  name text not null,
  emoji text default '🪨',
  description text,
  tags text[] default '{}',
  photo_url text,
  lat double precision not null,
  lng double precision not null,
  city text,
  created_at timestamptz default now()
);

-- 3. Finds (who found which stone)
create table finds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  stone_id uuid references stones(id) on delete cascade,
  found_at timestamptz default now(),
  city text,
  unique(user_id, stone_id)
);

-- 4. Chat messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete cascade,
  text text not null default '',
  photo_url text,
  reply_to_id uuid references messages(id) on delete set null,
  is_edited boolean default false,
  created_at timestamptz default now()
);

-- 5. Likes on messages
create table likes (
  user_id uuid references profiles(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  primary key (user_id, message_id)
);

-- 6. Achievements
create table achievements (
  user_id uuid references profiles(id) on delete cascade,
  achievement_id text not null,
  progress integer default 0,
  unlocked boolean default false,
  unlocked_at timestamptz,
  primary key (user_id, achievement_id)
);

-- 7. Analytics events
create table analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  user_id uuid references profiles(id) on delete set null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════
-- Row Level Security (RLS)
-- ═══════════════════════════════════════════════

-- Profiles
alter table profiles enable row level security;
create policy "Profiles are visible to authenticated users" on profiles for select to authenticated using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Stones (everyone can read, owner can write)
alter table stones enable row level security;
create policy "Anyone can read stones" on stones for select to authenticated using (true);
create policy "Users can insert own stones" on stones for insert with check (auth.uid() = author_id);
create policy "Users can update own stones" on stones for update using (auth.uid() = author_id);
create policy "Users can delete own stones" on stones for delete using (auth.uid() = author_id);

-- Finds
alter table finds enable row level security;
create policy "Users can read own finds" on finds for select using (auth.uid() = user_id);
create policy "Anyone can count finds" on finds for select to authenticated using (true);
create policy "Users can insert own finds" on finds for insert with check (auth.uid() = user_id);

-- Messages (everyone can read)
alter table messages enable row level security;
create policy "Anyone can read messages" on messages for select to authenticated using (true);
create policy "Users can insert own messages" on messages for insert with check (auth.uid() = author_id);
create policy "Users can update own messages" on messages for update using (auth.uid() = author_id);
create policy "Users can delete own messages" on messages for delete using (auth.uid() = author_id);

-- Likes
alter table likes enable row level security;
create policy "Anyone can read likes" on likes for select to authenticated using (true);
create policy "Users can insert own likes" on likes for insert with check (auth.uid() = user_id);
create policy "Users can delete own likes" on likes for delete using (auth.uid() = user_id);

-- Achievements
alter table achievements enable row level security;
create policy "Users can read own achievements" on achievements for select using (auth.uid() = user_id);
create policy "Users can upsert own achievements" on achievements for insert with check (auth.uid() = user_id);
create policy "Users can update own achievements" on achievements for update using (auth.uid() = user_id);

-- Analytics (insert only, no read from client)
alter table analytics_events enable row level security;
create policy "Anyone can insert events" on analytics_events for insert to authenticated with check (true);
create policy "Anon can insert events" on analytics_events for insert to anon with check (true);

-- ═══════════════════════════════════════════════
-- Auto-create profile on signup (trigger)
-- ═══════════════════════════════════════════════

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ═══════════════════════════════════════════════
-- Delete user function (for GDPR account deletion)
-- ═══════════════════════════════════════════════

create or replace function delete_user()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Delete auth user; profiles row is removed via ON DELETE CASCADE.
  delete from auth.users where id = auth.uid();
end;
$$;

-- ═══════════════════════════════════════════════
-- Reward stone author when someone else finds their stone
-- ═══════════════════════════════════════════════

create or replace function reward_stone_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from stones where id = new.stone_id;
  -- Don't reward self-finds (e.g. seeded stones the user technically 'owns')
  if v_author is not null and v_author <> new.user_id then
    update profiles set balance = coalesce(balance, 0) + 2 where id = v_author;
  end if;
  return new;
end;
$$;

drop trigger if exists on_find_reward_author on finds;
create trigger on_find_reward_author
  after insert on finds
  for each row execute function reward_stone_author();
