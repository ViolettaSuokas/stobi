-- Fix #2: pgvector НЕ имеет оператора деления вообще (ни на int, ни на float).
-- В прошлой попытке (20260425190000) я заменила int → float — это не помогло,
-- потому что `vector / scalar` не существует в pgvector ни в каком виде.
--
-- Правильный путь: использовать aggregate `avg(vector)` — он встроен в pgvector
-- и сам делает поэлементное усреднение без явного деления.

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
  v_count integer;
  v_birth_year integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select birth_year into v_birth_year from profiles where id = v_user_id;
  if v_birth_year is null then
    raise exception 'birth_year_required' using errcode = '42501';
  end if;

  if array_length(p_photo_urls, 1) < 1 or array_length(p_photo_urls, 1) > 5 then
    raise exception 'Expected 1-5 reference photos, got %', coalesce(array_length(p_photo_urls, 1), 0);
  end if;

  if array_length(p_embeddings, 1) != array_length(p_photo_urls, 1) then
    raise exception 'photo_urls and embeddings length mismatch';
  end if;

  v_count := array_length(p_embeddings, 1);

  if v_count = 1 then
    v_avg_embedding := p_embeddings[1];
  else
    -- avg() — pgvector aggregate. Делает поэлементное усреднение по массиву
    -- векторов, без необходимости в операторе деления (которого в pgvector
    -- просто не существует).
    select avg(emb) into v_avg_embedding from unnest(p_embeddings) as emb;
    v_avg_embedding := l2_normalize(v_avg_embedding);
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
