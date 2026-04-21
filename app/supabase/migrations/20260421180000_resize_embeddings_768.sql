-- Migration 020 (timestamp 2026-04-21 18:00): embedding size 512 → 768
--
-- Replicate модель andreasjansson/clip-features использует ViT-L/14 →
-- 768-мерный embedding, а мы изначально зарезервировали vector(512)
-- в миграции 017. Переключаем обе колонки и все RPC на 768, пока
-- таблица stones/find_proofs пустая (можно безболезненно ALTER).

drop index if exists stones_embedding_idx;

alter table stones alter column embedding type vector(768);
alter table stones alter column alt_embeddings type vector(768)[];
alter table find_proofs alter column embedding type vector(768);

-- Пересоздаём IVFFLAT index (он зависит от точного типа vector(N))
create index stones_embedding_idx
  on stones using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Обновляем RPC-сигнатуры: vector(512) → vector(768)
-- Для обновления нужно drop + recreate, т.к. PG не умеет менять параметры
-- векторного аргумента in-place.

drop function if exists search_stone_by_embedding(vector(512), integer);
drop function if exists create_stone(text, text, text[], text[], vector(512)[], double precision, double precision, text);
drop function if exists record_find_v2(uuid, text, vector(512), double precision, double precision, jsonb);

-- Пересоздаём в 768-варианте.

create or replace function search_stone_by_embedding(
  p_embedding vector(768),
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
revoke all on function search_stone_by_embedding(vector(768), integer) from public;
grant execute on function search_stone_by_embedding(vector(768), integer) to authenticated;


create or replace function create_stone(
  p_name text,
  p_description text,
  p_tags text[],
  p_photo_urls text[],
  p_embeddings vector(768)[],
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
  v_avg_embedding vector(768);
  v_i integer;
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
    p_photo_urls[1],
    p_lat, p_lng, p_city,
    v_avg_embedding, v_count, now()
  )
  returning id into v_stone_id;

  return jsonb_build_object('stone_id', v_stone_id, 'capture_count', v_count);
end;
$$;
revoke all on function create_stone(text, text, text[], text[], vector(768)[], double precision, double precision, text) from public;
grant execute on function create_stone(text, text, text[], text[], vector(768)[], double precision, double precision, text) to authenticated;


create or replace function record_find_v2(
  p_stone_id uuid,
  p_photo_url text,
  p_embedding vector(768),
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

  select id into v_existing_find_id from finds where user_id = v_user_id and stone_id = p_stone_id;
  if v_existing_find_id is not null then
    return jsonb_build_object('status', 'verified', 'reason', 'already_found', 'reward', 0);
  end if;

  select count(*) into v_daily_author_count
    from finds f join stones s on s.id = f.stone_id
    where s.author_id = v_stone.author_id and f.user_id = v_user_id
      and f.found_at > now() - interval '24 hours';
  if v_daily_author_count >= 2 then
    return jsonb_build_object('status', 'rejected', 'reason', 'per_user_daily_limit', 'reward', 0);
  end if;

  select count(*) into v_global_author_count
    from finds f join stones s on s.id = f.stone_id
    where s.author_id = v_stone.author_id and f.found_at > now() - interval '24 hours';
  if v_global_author_count >= 100 then
    return jsonb_build_object('status', 'rejected', 'reason', 'global_author_limit', 'reward', 0);
  end if;

  if v_stone.embedding is not null then
    v_primary_sim := 1 - (v_stone.embedding <=> p_embedding);
  end if;
  if array_length(v_stone.alt_embeddings, 1) > 0 then
    select max(1 - (alt <=> p_embedding)) into v_alt_sim
      from unnest(v_stone.alt_embeddings) alt;
  end if;
  v_best_sim := greatest(coalesce(v_primary_sim, 0), coalesce(v_alt_sim, 0));

  if p_proof_lat is not null and p_proof_lng is not null then
    v_distance_m := haversine_m(p_proof_lat, p_proof_lng, v_stone.lat, v_stone.lng);
    v_gps_ok := v_distance_m <= 30;
  end if;

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

  if v_status = 'verified' then
    insert into finds (user_id, stone_id, city) values (v_user_id, p_stone_id, v_stone.city)
      returning id into v_find_id;
    update profiles set balance = balance + v_finder_reward where id = v_user_id
      returning balance into v_new_balance;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
      values (v_user_id, v_finder_reward, 'stone_find', p_stone_id::text, v_new_balance);
    update profiles set balance = balance + v_author_reward where id = v_stone.author_id;
    insert into balance_events (user_id, amount, reason, ref_id, balance_after)
      values (v_stone.author_id, v_author_reward, 'author_bonus', p_stone_id::text, null);
    v_reward := v_finder_reward;
  end if;

  insert into find_proofs (
    find_id, stone_id, user_id, photo_url, embedding,
    similarity_score, alt_similarity_score,
    gps_used, ai_used, status, rejection_reason
  ) values (
    v_find_id, p_stone_id, v_user_id, p_photo_url, p_embedding,
    v_primary_sim, v_alt_sim, v_gps_ok,
    (v_best_sim is not null and v_best_sim > 0),
    v_status,
    case when v_status = 'rejected' then v_reason else null end
  )
  returning id into v_proof_id;

  return jsonb_build_object(
    'status', v_status, 'reason', v_reason, 'reward', v_reward,
    'similarity', v_best_sim, 'gps_ok', v_gps_ok,
    'distance_m', coalesce(v_distance_m, -1),
    'find_id', v_find_id, 'proof_id', v_proof_id, 'balance', v_new_balance
  );
end;
$$;
revoke all on function record_find_v2(uuid, text, vector(768), double precision, double precision, jsonb) from public;
grant execute on function record_find_v2(uuid, text, vector(768), double precision, double precision, jsonb) to authenticated;


-- author_approve_pending_find signature тоже зависит от vector size
-- (только внутри — embedding лежит в find_proofs.embedding, которую мы
-- уже поменяли выше). Функция работает поверх fp.embedding → автоматически
-- подцепит новый тип при следующем вызове. Не нужно пересоздавать.

-- reindex_stones_embedding из migration 019 тоже не требует изменений,
-- потому что она ссылается только на колонку stones.embedding (уже
-- обновлена выше).
