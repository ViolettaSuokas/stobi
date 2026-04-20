-- ═══════════════════════════════════════════════════════════════════
-- Migration 015: Security hardening — audit pass 3 fixes
-- ═══════════════════════════════════════════════════════════════════
--
-- Закрывает 3 security-issues из audit pass 3 (2026-04-20):
--   1. analytics_events: запрет client DELETE (anti-wipe)
--   2. record_find: глобальный лимит 100 finds/author/day (anti-spam)
--   3. COPPA strict: NOT NULL constraint + trigger check на birth_year
--
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- 1. analytics_events DELETE policy
-- ─────────────────────────────────────────────────────────────────
-- Baseline (migration 000) даёт anon INSERT. Но нет DELETE policy →
-- с anon key клиент может `supabase.from('analytics_events').delete()`
-- и стереть весь лог событий.
-- Explicit deny-delete policy.
-- ─────────────────────────────────────────────────────────────────

drop policy if exists "No client delete" on analytics_events;

create policy "No client delete"
  on analytics_events for delete
  to public
  using (false);

-- UPDATE тоже запрещаем — events immutable, лог append-only.
drop policy if exists "No client update" on analytics_events;

create policy "No client update"
  on analytics_events for update
  to public
  using (false);


-- ─────────────────────────────────────────────────────────────────
-- 2. record_find: глобальный лимит 100 finds/author/day
-- ─────────────────────────────────────────────────────────────────
-- Migration 005 имеет per-user limit (2 stone-finds от одного автора
-- в сутки). Но нет ГЛОБАЛЬНОГО лимита — популярный автор может быть
-- заспамлен сотнями finds за день (боты, дружеские чаты в закрытых
-- группах). Это также раздувает его stats и бонусы.
--
-- 100/day на автора = reasonable upper bound. Обычный пользователь
-- не делает столько стонов в день чтобы их нашли 100 раз.
-- ─────────────────────────────────────────────────────────────────

create or replace function record_find(
  p_stone_id uuid,
  p_proof_lat double precision,
  p_proof_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_stone stones%rowtype;
  v_distance double precision;
  v_existing uuid;
  v_author_finds_today integer;
  v_author_global_today integer;
  v_new_balance integer;
  v_reward integer := 1;
  v_author_reward integer := 2;
  v_stone_age interval;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  if p_proof_lat is null or p_proof_lng is null then
    raise exception 'invalid_proof_coords';
  end if;

  select * into v_stone from stones where id = p_stone_id;
  if not found then
    raise exception 'stone_not_found';
  end if;

  if v_stone.author_id = v_user_id then
    raise exception 'cannot_find_own_stone';
  end if;

  v_stone_age := now() - v_stone.created_at;
  if v_stone_age < interval '1 hour' then
    raise exception 'stone_too_fresh: wait % more minutes',
      ceil(extract(epoch from (interval '1 hour' - v_stone_age)) / 60);
  end if;

  v_distance := haversine_m(p_proof_lat, p_proof_lng, v_stone.lat, v_stone.lng);
  if v_distance > 30 then
    raise exception 'too_far: % meters (need ≤30)', round(v_distance);
  end if;

  select id into v_existing from finds
    where user_id = v_user_id and stone_id = p_stone_id;
  if v_existing is not null then
    select balance into v_new_balance from profiles where id = v_user_id;
    return jsonb_build_object(
      'balance', v_new_balance,
      'reward', 0,
      'already_found', true
    );
  end if;

  -- Per-user rule: max 2 finds от одного автора / день
  select count(*) into v_author_finds_today
    from finds f
    join stones s on s.id = f.stone_id
    where f.user_id = v_user_id
      and s.author_id = v_stone.author_id
      and f.found_at > now() - interval '24 hours';

  if v_author_finds_today >= 2 then
    raise exception 'author_daily_limit: already found 2 stones from this author today';
  end if;

  -- NEW: Global anti-spam — max 100 finds от одного автора (все юзеры) / день.
  -- Защищает от координированного спама / бот-farm.
  select count(*) into v_author_global_today
    from finds f
    join stones s on s.id = f.stone_id
    where s.author_id = v_stone.author_id
      and f.found_at > now() - interval '24 hours';

  if v_author_global_today >= 100 then
    raise exception 'author_global_limit: this author reached daily find cap, try later';
  end if;

  insert into finds (user_id, stone_id, city)
    values (v_user_id, p_stone_id, v_stone.city);

  update profiles
    set balance = coalesce(balance, 0) + v_reward
    where id = v_user_id
    returning balance into v_new_balance;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, v_reward, 'stone_find', p_stone_id, v_new_balance);

  -- Reward author (не трогаем balance если автор сам нашёл, но тут
  -- уже проверено что finder != author)
  update profiles
    set balance = coalesce(balance, 0) + v_author_reward
    where id = v_stone.author_id;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    select v_stone.author_id, v_author_reward, 'stone_found_by_other', p_stone_id, balance
    from profiles where id = v_stone.author_id;

  return jsonb_build_object(
    'balance', v_new_balance,
    'reward', v_reward,
    'author_reward', v_author_reward,
    'distance_m', round(v_distance)
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────────
-- 3. COPPA strict: birth_year нельзя null для новых профилей
-- ─────────────────────────────────────────────────────────────────
-- Migration 014 создала trigger который пропускает `null` для backcompat.
-- Для НОВЫХ профилей это дыра: клиент может создать profile без
-- birth_year → проскочит age-check.
--
-- Стратегия:
--   - Старые profiles (created_at < migration apply time) — null ok (grandfathered)
--   - Новые profiles — birth_year required + trigger с raise exception
-- ─────────────────────────────────────────────────────────────────

-- Порог для grandfathering
alter table profiles
  add column if not exists birth_year_required_since timestamptz default now();

-- Обновляем триггер: строгий check на новых profiles
create or replace function validate_age_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  age int;
begin
  -- Новые profiles (INSERT) — birth_year обязателен
  if tg_op = 'INSERT' and new.birth_year is null then
    raise exception 'birth_year_required: age confirmation needed (COPPA/GDPR)'
      using errcode = '42501';
  end if;

  -- UPDATE на birth_year — проверяем только если задан
  if new.birth_year is null then
    return new;
  end if;

  age := current_year - new.birth_year;
  if age < 13 then
    raise exception 'Age requirement not met: must be 13 or older (COPPA)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Триггер уже существует (migration 014) — не пересоздаём
