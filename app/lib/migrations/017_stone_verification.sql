-- ═══════════════════════════════════════════════════════════════════
-- Migration 017: Stone verification v2 — pgvector + AI-match + reports
-- ═══════════════════════════════════════════════════════════════════
--
-- Переводит find-flow на визуальный AI-матчинг вместо GPS-proximity.
-- Архитектура:
--   1. `stones.embedding` — CLIP ViT-B/32 vector(512) эталона камня
--   2. `stones.alt_embeddings` — embeddings из одобренных finds (adaptive learning)
--   3. `stone_reports` + auto-hide trigger — пользователи репортят «камня нет»,
--      после ≥3 репортов + 30 дней без успешного find камень скрывается с карты
--   4. `find_proofs` — аудит каждого find с similarity score (для fraud-анализа)
--   5. `record_find_v2` RPC — принимает embedding+optional GPS, возвращает
--      status ('verified' | 'pending' | 'rejected')
--
-- Предпосылка: Supabase Pro для pgvector extension.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 0. Enable pgvector (требует Supabase Pro)
-- ─────────────────────────────────────────────
create extension if not exists vector;


-- ─────────────────────────────────────────────
-- 1. Расширение таблицы stones
-- ─────────────────────────────────────────────
alter table stones add column if not exists embedding vector(512);
alter table stones add column if not exists alt_embeddings vector(512)[] default '{}';
alter table stones add column if not exists is_hidden boolean default false;
alter table stones add column if not exists hidden_at timestamptz;
alter table stones add column if not exists hidden_reason text;
alter table stones add column if not exists last_confirmed_at timestamptz default now();
alter table stones add column if not exists reference_quality text default 'ok'
  check (reference_quality in ('ok', 'needs_recapture'));
alter table stones add column if not exists capture_count int default 1;

comment on column stones.embedding is 'CLIP ViT-B/32 embedding of reference photo (averaged across capture angles)';
comment on column stones.alt_embeddings is 'Embeddings from approved finds — adaptive learning (FIFO max 10)';
comment on column stones.is_hidden is 'true when >=3 reports in 90d AND no find in 30d; hidden from map';
comment on column stones.last_confirmed_at is 'Updated on successful find or author_confirm_stone; drives auto-hide window';

-- ANN index для быстрого similarity search через pgvector IVFFLAT.
-- lists=100 подходит для 1k–100k камней. Переиндексация миграцией 019.
create index if not exists stones_embedding_idx
  on stones using ivfflat (embedding vector_cosine_ops) with (lists = 100);


-- ─────────────────────────────────────────────
-- 2. Новая таблица stone_reports («камня здесь нет»)
-- ─────────────────────────────────────────────
create table if not exists stone_reports (
  id uuid primary key default gen_random_uuid(),
  stone_id uuid references stones(id) on delete cascade not null,
  reporter_id uuid references profiles(id) on delete cascade not null,
  reporter_lat double precision not null,
  reporter_lng double precision not null,
  distance_m integer not null,
  reason text,
  created_at timestamptz default now(),
  unique (reporter_id, stone_id)
);

create index if not exists stone_reports_stone_idx
  on stone_reports (stone_id, created_at desc);
create index if not exists stone_reports_reporter_idx
  on stone_reports (reporter_id, created_at desc);

alter table stone_reports enable row level security;

-- Любой authenticated юзер может читать count репортов на камень (для UI прозрачности)
create policy "Anyone can read reports"
  on stone_reports for select to authenticated using (true);

-- Писать можно только через RPC report_stone_missing (security definer).
-- Клиентский insert блокируется отсутствием policy.


-- ─────────────────────────────────────────────
-- 3. Новая таблица find_proofs (аудит + adaptive learning)
-- ─────────────────────────────────────────────
create table if not exists find_proofs (
  id uuid primary key default gen_random_uuid(),
  find_id uuid references finds(id) on delete cascade,
  -- find_id может быть NULL если status='pending' и finds-запись ещё не создана
  stone_id uuid references stones(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  photo_url text not null,
  embedding vector(512) not null,
  similarity_score float,                   -- против stone.embedding (primary)
  alt_similarity_score float,               -- max против stone.alt_embeddings[]
  nsfw_labels jsonb,                         -- Rekognition labels (если >0 → rejected)
  gps_used boolean default false,
  ai_used boolean default false,
  status text not null check (status in ('verified', 'pending', 'rejected')),
  rejection_reason text,
  created_at timestamptz default now()
);

create index if not exists find_proofs_status_idx
  on find_proofs (status, created_at desc);
create index if not exists find_proofs_stone_idx
  on find_proofs (stone_id, created_at desc);
create index if not exists find_proofs_user_idx
  on find_proofs (user_id, created_at desc);

alter table find_proofs enable row level security;

create policy "Users read own proofs"
  on find_proofs for select to authenticated
  using (auth.uid() = user_id);

-- Автор камня видит pending proofs против своего камня (для approve/reject)
create policy "Authors see pending proofs for own stones"
  on find_proofs for select to authenticated
  using (
    status = 'pending'
    and stone_id in (select id from stones where author_id = auth.uid())
  );


-- ─────────────────────────────────────────────
-- 4. RPC: search_stone_by_embedding
--    Используется «Нашёл камень где-то ещё» — ANN top-3 на весь кат.
-- ─────────────────────────────────────────────
create or replace function search_stone_by_embedding(
  p_embedding vector(512),
  p_limit integer default 3
) returns table (
  stone_id uuid,
  name text,
  photo_url text,
  similarity float,
  author_id uuid,
  city text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      s.id as stone_id,
      s.name,
      s.photo_url,
      1 - (s.embedding <=> p_embedding) as similarity,
      s.author_id,
      s.city
    from stones s
    where s.is_hidden = false
      and s.embedding is not null
    order by s.embedding <=> p_embedding
    limit p_limit;
end;
$$;

revoke all on function search_stone_by_embedding(vector(512), integer) from public;
grant execute on function search_stone_by_embedding(vector(512), integer) to authenticated;


-- ─────────────────────────────────────────────
-- 5. RPC: create_stone
--    Принимает массив photo_urls + embeddings, усредняет в один reference.
--    GPS сохраняется как и раньше (с randomization на клиенте).
-- ─────────────────────────────────────────────
create or replace function create_stone(
  p_name text,
  p_description text,
  p_tags text[],
  p_photo_urls text[],
  p_embeddings vector(512)[],
  p_lat double precision,
  p_lng double precision,
  p_city text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone_id uuid;
  v_avg_embedding vector(512);
  v_i integer;
  v_sum float[];
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if array_length(p_photo_urls, 1) < 1 or array_length(p_photo_urls, 1) > 5 then
    raise exception 'Expected 1-5 reference photos, got %', coalesce(array_length(p_photo_urls, 1), 0);
  end if;

  if array_length(p_embeddings, 1) != array_length(p_photo_urls, 1) then
    raise exception 'photo_urls and embeddings length mismatch';
  end if;

  -- Усредняем embeddings по всем ракурсам. pgvector поддерживает
  -- поэлементное сложение через `+` и деление на скаляр через `/`.
  v_count := array_length(p_embeddings, 1);
  v_avg_embedding := p_embeddings[1];
  if v_count > 1 then
    for v_i in 2..v_count loop
      v_avg_embedding := v_avg_embedding + p_embeddings[v_i];
    end loop;
    v_avg_embedding := v_avg_embedding / v_count;
  end if;

  insert into stones (
    author_id, name, description, tags, photo_url, lat, lng, city,
    embedding, capture_count, last_confirmed_at
  ) values (
    v_user_id, p_name, p_description, coalesce(p_tags, '{}'),
    p_photo_urls[1],         -- первое фото как primary (для миниатюр)
    p_lat, p_lng, p_city,
    v_avg_embedding, v_count, now()
  )
  returning id into v_stone_id;

  return jsonb_build_object('stone_id', v_stone_id, 'capture_count', v_count);
end;
$$;

revoke all on function create_stone(text, text, text[], text[], vector(512)[], double precision, double precision, text) from public;
grant execute on function create_stone(text, text, text[], text[], vector(512)[], double precision, double precision, text) to authenticated;


-- ─────────────────────────────────────────────
-- 6. Haversine helper (уже есть в 005, повторно не создаём)
-- ─────────────────────────────────────────────
-- haversine_m() определена в migration 005. Используем.


-- ─────────────────────────────────────────────
-- 7. RPC: record_find_v2
--    Принимает photo_url + embedding + optional GPS. Сравнивает с
--    stone.embedding и всеми alt_embeddings. Возвращает status/reward.
-- ─────────────────────────────────────────────
create or replace function record_find_v2(
  p_stone_id uuid,
  p_photo_url text,
  p_embedding vector(512),
  p_proof_lat double precision default null,
  p_proof_lng double precision default null,
  p_nsfw_labels jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone stones%rowtype;
  v_primary_sim float;
  v_alt_sim float;
  v_best_sim float;
  v_gps_ok boolean := false;
  v_distance_m float;
  v_status text;
  v_reason text;
  v_reward integer := 0;
  v_author_reward integer := 2;
  v_finder_reward integer := 1;
  v_find_id uuid;
  v_proof_id uuid;
  v_existing_find_id uuid;
  v_daily_author_count integer;
  v_global_author_count integer;
  v_new_balance integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- NSFW блок — сразу reject
  if p_nsfw_labels is not null and jsonb_array_length(p_nsfw_labels) > 0 then
    insert into find_proofs (stone_id, user_id, photo_url, embedding, nsfw_labels, status, rejection_reason)
    values (p_stone_id, v_user_id, p_photo_url, p_embedding, p_nsfw_labels, 'rejected', 'nsfw');
    return jsonb_build_object('status', 'rejected', 'reason', 'nsfw', 'reward', 0);
  end if;

  select * into v_stone from stones where id = p_stone_id;
  if v_stone.id is null then
    raise exception 'Stone not found';
  end if;

  if v_stone.is_hidden then
    return jsonb_build_object('status', 'rejected', 'reason', 'stone_hidden', 'reward', 0);
  end if;

  if v_stone.author_id = v_user_id then
    return jsonb_build_object('status', 'rejected', 'reason', 'own_stone', 'reward', 0);
  end if;

  -- Idempotency — already found by this user
  select id into v_existing_find_id
    from finds where user_id = v_user_id and stone_id = p_stone_id;
  if v_existing_find_id is not null then
    return jsonb_build_object(
      'status', 'verified',
      'reason', 'already_found',
      'reward', 0
    );
  end if;

  -- Anti-spam: per-user 2/день, global 100/день на автора (как в 015)
  select count(*) into v_daily_author_count
    from finds f
    join stones s on s.id = f.stone_id
    where s.author_id = v_stone.author_id
      and f.user_id = v_user_id
      and f.found_at > now() - interval '24 hours';
  if v_daily_author_count >= 2 then
    return jsonb_build_object('status', 'rejected', 'reason', 'per_user_daily_limit', 'reward', 0);
  end if;

  select count(*) into v_global_author_count
    from finds f
    join stones s on s.id = f.stone_id
    where s.author_id = v_stone.author_id
      and f.found_at > now() - interval '24 hours';
  if v_global_author_count >= 100 then
    return jsonb_build_object('status', 'rejected', 'reason', 'global_author_limit', 'reward', 0);
  end if;

  -- Similarity против primary embedding
  if v_stone.embedding is not null then
    v_primary_sim := 1 - (v_stone.embedding <=> p_embedding);
  end if;

  -- Max similarity против alt_embeddings
  if array_length(v_stone.alt_embeddings, 1) > 0 then
    select max(1 - (alt <=> p_embedding))
      into v_alt_sim
      from unnest(v_stone.alt_embeddings) alt;
  end if;

  v_best_sim := greatest(coalesce(v_primary_sim, 0), coalesce(v_alt_sim, 0));

  -- GPS check (если переданы координаты)
  if p_proof_lat is not null and p_proof_lng is not null then
    v_distance_m := haversine_m(p_proof_lat, p_proof_lng, v_stone.lat, v_stone.lng);
    v_gps_ok := v_distance_m <= 30;
  end if;

  -- Решение:
  if v_best_sim >= 0.82 then
    v_status := 'verified';
    v_reason := 'ai_match';
  elsif v_best_sim >= 0.60 and v_gps_ok then
    v_status := 'verified';
    v_reason := 'ai_match_plus_gps';
  elsif v_best_sim >= 0.60 then
    v_status := 'pending';
    v_reason := 'awaits_author_approval';
  else
    v_status := 'rejected';
    v_reason := 'low_similarity';
  end if;

  -- Verified — начисляем сразу, создаём find
  if v_status = 'verified' then
    insert into finds (user_id, stone_id, city)
    values (v_user_id, p_stone_id, v_stone.city)
    returning id into v_find_id;

    -- Finder reward
    update profiles set balance = balance + v_finder_reward where id = v_user_id
      returning balance into v_new_balance;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, v_finder_reward, 'stone_find', p_stone_id::text, v_new_balance);

    -- Author reward
    update profiles set balance = balance + v_author_reward where id = v_stone.author_id;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_stone.author_id, v_author_reward, 'author_bonus', p_stone_id::text, null);

    v_reward := v_finder_reward;
  end if;

  -- Proof запись всегда
  insert into find_proofs (
    find_id, stone_id, user_id, photo_url, embedding,
    similarity_score, alt_similarity_score,
    gps_used, ai_used, status, rejection_reason
  ) values (
    v_find_id, p_stone_id, v_user_id, p_photo_url, p_embedding,
    v_primary_sim, v_alt_sim,
    v_gps_ok, (v_best_sim is not null and v_best_sim > 0),
    v_status,
    case when v_status = 'rejected' then v_reason else null end
  )
  returning id into v_proof_id;

  return jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'reward', v_reward,
    'similarity', v_best_sim,
    'gps_ok', v_gps_ok,
    'distance_m', coalesce(v_distance_m, -1),
    'find_id', v_find_id,
    'proof_id', v_proof_id,
    'balance', v_new_balance
  );
end;
$$;

revoke all on function record_find_v2(uuid, text, vector(512), double precision, double precision, jsonb) from public;
grant execute on function record_find_v2(uuid, text, vector(512), double precision, double precision, jsonb) to authenticated;


-- ─────────────────────────────────────────────
-- 8. RPC: author_approve_pending_find
--    Автор одобряет pending find. Reward начисляется + embedding
--    добавляется в alt_embeddings (adaptive learning).
-- ─────────────────────────────────────────────
create or replace function author_approve_pending_find(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proof find_proofs%rowtype;
  v_stone stones%rowtype;
  v_find_id uuid;
  v_new_balance integer;
  v_alt_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_proof from find_proofs where id = p_proof_id;
  if v_proof.id is null then
    raise exception 'Proof not found';
  end if;
  if v_proof.status != 'pending' then
    raise exception 'Proof is not pending';
  end if;

  select * into v_stone from stones where id = v_proof.stone_id;
  if v_stone.author_id != v_user_id then
    raise exception 'Only stone author can approve';
  end if;

  -- Создаём find
  insert into finds (user_id, stone_id, city)
  values (v_proof.user_id, v_proof.stone_id, v_stone.city)
  returning id into v_find_id;

  -- Награды
  update profiles set balance = balance + 1 where id = v_proof.user_id
    returning balance into v_new_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
  values (v_proof.user_id, 1, 'stone_find', v_proof.stone_id::text, v_new_balance);

  update profiles set balance = balance + 2 where id = v_stone.author_id;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
  values (v_stone.author_id, 2, 'author_bonus', v_proof.stone_id::text, null);

  -- Update proof status + link
  update find_proofs set status = 'verified', find_id = v_find_id where id = p_proof_id;

  -- Adaptive learning: добавляем embedding в alt_embeddings (FIFO max 10)
  v_alt_count := coalesce(array_length(v_stone.alt_embeddings, 1), 0);
  if v_alt_count >= 10 then
    -- Trim oldest (assume append order). Берём последние 9 + новый.
    update stones
      set alt_embeddings = v_stone.alt_embeddings[2:10] || v_proof.embedding
      where id = v_stone.id;
  else
    update stones
      set alt_embeddings = coalesce(alt_embeddings, '{}') || v_proof.embedding
      where id = v_stone.id;
  end if;

  return jsonb_build_object('find_id', v_find_id, 'balance', v_new_balance);
end;
$$;

revoke all on function author_approve_pending_find(uuid) from public;
grant execute on function author_approve_pending_find(uuid) to authenticated;


-- ─────────────────────────────────────────────
-- 9. RPC: report_stone_missing
-- ─────────────────────────────────────────────
create or replace function report_stone_missing(
  p_stone_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone stones%rowtype;
  v_distance_m float;
  v_daily_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_stone from stones where id = p_stone_id;
  if v_stone.id is null then
    raise exception 'Stone not found';
  end if;

  if v_stone.author_id = v_user_id then
    raise exception 'Cannot report own stone';
  end if;

  v_distance_m := haversine_m(p_lat, p_lng, v_stone.lat, v_stone.lng);
  if v_distance_m > 50 then
    raise exception 'Must be within 50m of stone to report (you are % m away)', round(v_distance_m);
  end if;

  -- Rate limit: 5 reports / юзер / день
  select count(*) into v_daily_count
    from stone_reports
    where reporter_id = v_user_id
      and created_at > now() - interval '24 hours';
  if v_daily_count >= 5 then
    raise exception 'Daily report limit reached (5/day)';
  end if;

  insert into stone_reports (
    stone_id, reporter_id, reporter_lat, reporter_lng, distance_m, reason
  ) values (
    p_stone_id, v_user_id, p_lat, p_lng, round(v_distance_m), p_reason
  )
  on conflict (reporter_id, stone_id) do update
    set reporter_lat = excluded.reporter_lat,
        reporter_lng = excluded.reporter_lng,
        distance_m = excluded.distance_m,
        reason = excluded.reason,
        created_at = now();

  return jsonb_build_object('ok', true, 'distance_m', round(v_distance_m));
end;
$$;

revoke all on function report_stone_missing(uuid, double precision, double precision, text) from public;
grant execute on function report_stone_missing(uuid, double precision, double precision, text) to authenticated;


-- ─────────────────────────────────────────────
-- 10. RPC: author_confirm_stone
--     Автор подтверждает что камень на месте → сброс reports + revive
-- ─────────────────────────────────────────────
create or replace function author_confirm_stone(
  p_stone_id uuid,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_stone stones%rowtype;
  v_distance_m float;
  v_deleted_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_stone from stones where id = p_stone_id;
  if v_stone.id is null then
    raise exception 'Stone not found';
  end if;

  if v_stone.author_id != v_user_id then
    raise exception 'Only author can confirm';
  end if;

  v_distance_m := haversine_m(p_lat, p_lng, v_stone.lat, v_stone.lng);
  if v_distance_m > 30 then
    raise exception 'Must be within 30m to confirm (you are % m away)', round(v_distance_m);
  end if;

  delete from stone_reports where stone_id = p_stone_id;
  get diagnostics v_deleted_count = row_count;

  update stones
    set is_hidden = false,
        hidden_at = null,
        hidden_reason = null,
        last_confirmed_at = now()
    where id = p_stone_id;

  return jsonb_build_object(
    'ok', true,
    'reports_cleared', v_deleted_count,
    'distance_m', round(v_distance_m)
  );
end;
$$;

revoke all on function author_confirm_stone(uuid, double precision, double precision) from public;
grant execute on function author_confirm_stone(uuid, double precision, double precision) to authenticated;


-- ─────────────────────────────────────────────
-- 11. RPC: request_reference_recapture
-- ─────────────────────────────────────────────
create or replace function request_reference_recapture(p_stone_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_author uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select author_id into v_author from stones where id = p_stone_id;
  if v_author != v_user_id then
    raise exception 'Only author can request recapture';
  end if;

  update stones set reference_quality = 'needs_recapture' where id = p_stone_id;
end;
$$;

revoke all on function request_reference_recapture(uuid) from public;
grant execute on function request_reference_recapture(uuid) to authenticated;


-- ─────────────────────────────────────────────
-- 12. Trigger: fn_evaluate_hide
--     После insert в stone_reports проверяем нужно ли скрыть камень.
--     Условия: >=3 репортов за 90 дней И последний find/confirm >30 дней назад.
-- ─────────────────────────────────────────────
create or replace function fn_evaluate_hide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_count integer;
  v_stone_last_confirmed timestamptz;
begin
  select count(*) into v_report_count
    from stone_reports
    where stone_id = new.stone_id
      and created_at > now() - interval '90 days';

  select last_confirmed_at into v_stone_last_confirmed
    from stones where id = new.stone_id;

  if v_report_count >= 3 and v_stone_last_confirmed < now() - interval '30 days' then
    update stones
      set is_hidden = true,
          hidden_at = now(),
          hidden_reason = 'community_reports'
      where id = new.stone_id
        and is_hidden = false;
  end if;

  return new;
end;
$$;

drop trigger if exists on_stone_report_inserted on stone_reports;
create trigger on_stone_report_inserted
  after insert on stone_reports
  for each row execute function fn_evaluate_hide();


-- ─────────────────────────────────────────────
-- 13. Trigger: fn_reset_reports_on_find
--     Успешный find → сбрасывает все pending reports на камень
--     и обновляет last_confirmed_at. Камень автоматически "оживает".
-- ─────────────────────────────────────────────
create or replace function fn_reset_reports_on_find()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from stone_reports where stone_id = new.stone_id;

  update stones
    set last_confirmed_at = now(),
        is_hidden = false,
        hidden_at = null,
        hidden_reason = null
    where id = new.stone_id;

  return new;
end;
$$;

drop trigger if exists on_find_reset_reports on finds;
create trigger on_find_reset_reports
  after insert on finds
  for each row execute function fn_reset_reports_on_find();


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- 1. Extension enabled:
--   select extname from pg_extension where extname = 'vector';
--
-- 2. Columns added:
--   \d stones
--
-- 3. IVFFLAT index:
--   select indexname from pg_indexes where indexname = 'stones_embedding_idx';
--
-- 4. RPCs:
--   select proname from pg_proc where proname in (
--     'create_stone', 'record_find_v2', 'author_approve_pending_find',
--     'report_stone_missing', 'author_confirm_stone', 'request_reference_recapture',
--     'search_stone_by_embedding'
--   );
--
-- 5. Triggers:
--   select tgname from pg_trigger where tgname in (
--     'on_stone_report_inserted', 'on_find_reset_reports'
--   );

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (ОПАСНО — потеряете все embeddings и reports)
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists on_find_reset_reports on finds;
-- drop trigger if exists on_stone_report_inserted on stone_reports;
-- drop function if exists fn_reset_reports_on_find();
-- drop function if exists fn_evaluate_hide();
-- drop function if exists request_reference_recapture(uuid);
-- drop function if exists author_confirm_stone(uuid, double precision, double precision);
-- drop function if exists report_stone_missing(uuid, double precision, double precision, text);
-- drop function if exists author_approve_pending_find(uuid);
-- drop function if exists record_find_v2(uuid, text, vector(512), double precision, double precision, jsonb);
-- drop function if exists create_stone(text, text, text[], text[], vector(512)[], double precision, double precision, text);
-- drop function if exists search_stone_by_embedding(vector(512), integer);
-- drop table if exists find_proofs;
-- drop table if exists stone_reports;
-- drop index if exists stones_embedding_idx;
-- alter table stones drop column if exists embedding;
-- alter table stones drop column if exists alt_embeddings;
-- alter table stones drop column if exists is_hidden;
-- alter table stones drop column if exists hidden_at;
-- alter table stones drop column if exists hidden_reason;
-- alter table stones drop column if exists last_confirmed_at;
-- alter table stones drop column if exists reference_quality;
-- alter table stones drop column if exists capture_count;
-- drop extension if exists vector;
