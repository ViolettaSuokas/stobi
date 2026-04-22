-- Fix: L2-normalize embeddings after averaging in create_stone.
--
-- Bug: Replicate model andreasjansson/clip-features returns RAW CLIP features
-- (not unit vectors). Averaging 3 capture embeddings with arithmetic mean
-- without re-normalization produces a vector whose magnitude varies with the
-- brightness/detail of captures. Cosine similarity via pgvector `<=>` is
-- mathematically defined for unit vectors — non-unit refs bias matching
-- toward the brightest capture and make threshold 0.82 unstable.
--
-- Two fixes:
--   1. Edge Function replicate.ts now L2-normalizes every returned embedding.
--      → Single-photo refs and find queries are unit vectors from the source.
--   2. create_stone re-normalizes the averaged reference after mean.
--      → Multi-angle reference is a unit vector too.
--
-- Uses pgvector's built-in l2_normalize() (available since pgvector 0.7.0,
-- which is on Supabase Pro/Free since 2024-07).

drop function if exists create_stone(text, text, text[], text[], vector(768)[], double precision, double precision, text);

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
    -- Critical: re-normalize averaged vector for cosine similarity correctness.
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
