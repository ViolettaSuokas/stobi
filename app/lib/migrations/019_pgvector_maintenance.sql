-- ═══════════════════════════════════════════════════════════════════
-- Migration 019: pgvector IVFFLAT index maintenance
-- ═══════════════════════════════════════════════════════════════════
--
-- IVFFLAT индекс на stones.embedding (создан в 017) использует
-- кластеризацию по `lists=100`. По мере роста числа камней распределение
-- меняется → ANN-точность деградирует. Решение: ежемесячный REINDEX.
--
-- Plus: автоподбор `lists` при REINDEX в зависимости от размера таблицы
-- (рекомендация pgvector: lists ≈ sqrt(rows)).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Enable pg_cron (Supabase Pro — available)
-- ─────────────────────────────────────────────
create extension if not exists pg_cron;


-- ─────────────────────────────────────────────
-- 2. Функция reindex'а с адаптивным lists
-- ─────────────────────────────────────────────
create or replace function reindex_stones_embedding()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows bigint;
  v_lists integer;
begin
  select count(*) into v_rows from stones where embedding is not null;

  -- lists ≈ sqrt(rows), минимум 10, максимум 1000
  v_lists := greatest(10, least(1000, floor(sqrt(v_rows))::integer));

  execute 'drop index if exists stones_embedding_idx';
  execute format(
    'create index stones_embedding_idx on stones using ivfflat (embedding vector_cosine_ops) with (lists = %s)',
    v_lists
  );

  raise notice 'Reindexed stones_embedding_idx: rows=%, lists=%', v_rows, v_lists;
end;
$$;


-- ─────────────────────────────────────────────
-- 3. Schedule ежемесячный REINDEX (1-е число, 3 AM UTC)
-- ─────────────────────────────────────────────
-- Удаляем старую задачу если была (идемпотентно)
select cron.unschedule('stobi_reindex_embeddings')
  where exists (select 1 from cron.job where jobname = 'stobi_reindex_embeddings');

select cron.schedule(
  'stobi_reindex_embeddings',
  '0 3 1 * *',                            -- 03:00 UTC каждое 1-е число месяца
  'select public.reindex_stones_embedding();'
);


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- 1. pg_cron extension:
--   select extname from pg_extension where extname = 'pg_cron';
--
-- 2. Cron job exists:
--   select jobname, schedule, active from cron.job
--   where jobname = 'stobi_reindex_embeddings';
--
-- 3. Ручной запуск для теста:
--   select public.reindex_stones_embedding();
--   -- должен вывести NOTICE с rows и lists.

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- select cron.unschedule('stobi_reindex_embeddings');
-- drop function if exists reindex_stones_embedding();
-- -- pg_cron extension оставить (может использоваться push_queue crons)
