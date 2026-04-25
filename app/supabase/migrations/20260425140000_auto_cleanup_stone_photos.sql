-- Автоматическая очистка Storage при удалении stones.
--
-- Зачем: каждый камень = ~150 КБ фото в bucket photos/. До этой миграции
-- удалённые stones оставляли файлы в Storage → orphan → деньги за хранение.
--
-- Подход: AFTER DELETE trigger на stones → через pg_net вызывает Edge
-- Function `delete-stone-photo`, которая через service role удаляет
-- файл (обходя storage.protect_delete который блокирует DELETE из SQL).
--
-- Защита: AFTER DELETE — даже если cleanup упадёт, stone всё равно
-- удалится (anyway пропадёт с карты). Best-effort cleanup, не блокирует
-- основной flow. Edge function идемпотентна (already-deleted = ok).

-- Anon key и project ref хардкодим — anon key публичный (в JS-бандле),
-- ref — публичный URL. Чувствительный service_role_key хранится
-- только в Edge Function как Deno.env (туда попадает из supabase secrets).
create or replace function _trigger_delete_stone_photo() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := 'https://zlnkzyvtxaksvilujdwu.supabase.co/functions/v1/delete-stone-photo';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';
begin
  if OLD.photo_url is null or OLD.photo_url = '' then
    return OLD;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('photo_url', OLD.photo_url)
  );
  return OLD;
end;
$$;

drop trigger if exists stones_cleanup_photo on stones;
create trigger stones_cleanup_photo
  after delete on stones
  for each row execute function _trigger_delete_stone_photo();

-- ───────────────────────────────────────────────────────────
-- Одноразовая чистка существующих orphan'ов через ту же edge function.
-- На момент миграции в bucket photos/ ~71 файл, в stones — 0 row.
-- Все файлы с kind='stone' можно убирать (нет ссылок).
-- Аватары (kind='avatar') не трогаем — они в profiles.photo_url отдельно.
-- ───────────────────────────────────────────────────────────
do $$
declare
  obj record;
  v_url text := 'https://zlnkzyvtxaksvilujdwu.supabase.co/functions/v1/delete-stone-photo';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';
  v_fake_url text;
begin
  -- Edge function ожидает signed-URL, но для одноразовой чистки
  -- собираем псевдо-URL с реальным path. Edge function сама извлечёт
  -- path и удалит через service role (которая в env edge function).
  for obj in
    select name from storage.objects
    where bucket_id = 'photos' and name like '%/stone/%'
  loop
    v_fake_url := 'https://zlnkzyvtxaksvilujdwu.supabase.co/storage/v1/object/sign/photos/'
                  || obj.name || '?token=migration-cleanup';
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      body := jsonb_build_object('photo_url', v_fake_url)
    );
  end loop;
  raise notice 'queued cleanup for orphan stone photos via edge function';
end $$;

-- ───────────────────────────────────────────────────────────
-- Защита: нельзя удалять камень который кто-то нашёл.
-- Если автор удалит — у finder'а пропадёт запись находки и +💎 без причины.
-- BEFORE DELETE → если кидаем ошибку, удаление не происходит.
-- ───────────────────────────────────────────────────────────
create or replace function _block_delete_found_stone() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finds_count int;
begin
  select count(*) into v_finds_count from finds where stone_id = OLD.id;
  if v_finds_count > 0 then
    raise exception 'cannot_delete_found_stone'
      using errcode = '42501',
            hint = format('stone %s has %s finds', OLD.id, v_finds_count);
  end if;
  return OLD;
end;
$$;

drop trigger if exists stones_block_delete_if_found on stones;
create trigger stones_block_delete_if_found
  before delete on stones
  for each row execute function _block_delete_found_stone();
