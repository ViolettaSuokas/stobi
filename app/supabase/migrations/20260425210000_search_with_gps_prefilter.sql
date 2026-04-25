-- search_stone_by_embedding: добавляем GPS pre-filter.
--
-- Раньше: cosine similarity по ВСЕЙ БД stones. На growth этап (10k+ stones)
-- → лишние сравнения + риск false-positive: камень в Финляндии похож на
-- стилистически близкий камень в Швеции → AI выдаёт его в top-3.
--
-- Теперь: если юзер передал координаты, отбираем только stones в радиусе
-- p_radius_km (default 5km) → меньше pool, выше точность, быстрее. Если
-- GPS не передан — fallback на старое поведение (поиск по всей БД).

create or replace function search_stone_by_embedding(
  p_embedding vector,
  p_limit integer default 3,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default 5
) returns table(
  stone_id uuid,
  name text,
  photo_url text,
  similarity double precision,
  author_id uuid,
  city text,
  distance_m double precision
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
      s.city,
      case
        when p_lat is null or p_lng is null then null
        else haversine_m(p_lat, p_lng, s.lat, s.lng)
      end as distance_m
    from stones s
    where (s.is_hidden is null or s.is_hidden = false)
      and s.embedding is not null
      -- GPS pre-filter: если координаты переданы — отсекаем камни
      -- дальше радиуса. Если null — fallback на whole-DB search.
      and (
        p_lat is null or p_lng is null
        or haversine_m(p_lat, p_lng, s.lat, s.lng) <= p_radius_km * 1000
      )
    order by s.embedding <=> p_embedding
    limit p_limit;
end;
$$;

revoke all on function search_stone_by_embedding(vector, integer, double precision, double precision, double precision) from public;
grant execute on function search_stone_by_embedding(vector, integer, double precision, double precision, double precision) to authenticated;
