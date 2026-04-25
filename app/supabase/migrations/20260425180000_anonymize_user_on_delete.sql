-- GDPR right-to-erasure но с сохранением чужих историй.
--
-- Раньше delete_user кидал каскад: stones → finds других юзеров → ничего
-- не остаётся. Это разрушает историю людей которые **нашли** камни юзера
-- A: их personal record "я нашёл 5 камней" становится "4", при том что
-- они физически нашли камень, потратили время.
--
-- GDPR-correct паттерн:
--   - Камни БЕЗ находок (никто не видел) → полное удаление + photo
--   - Камни С находками → анонимизация (author_id=NULL, name="Удалённый
--     юзер"), photo остаётся как artifact-of-history
--   - Сообщения в чате → анонимизация (author_id=NULL, текст оставляем —
--     другие могли цитировать; name из profiles больше не показывается)
--   - Finds where user is finder → анонимизируем (user_id=NULL),
--     find_proofs тоже
--   - Profile, auth.users → жёсткое удаление
--   - Аватарка из storage → удаление (PII)

-- Шаг 1: разрешить NULL в колонках где сейчас NOT NULL
alter table find_proofs alter column user_id drop not null;
alter table stone_reports alter column reporter_id drop not null;
alter table referrals alter column inviter_id drop not null;
alter table referrals alter column invitee_id drop not null;

-- Шаг 2: пересоздать FK с ON DELETE SET NULL
alter table stones drop constraint if exists stones_author_id_fkey;
alter table stones add constraint stones_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

alter table messages drop constraint if exists messages_author_id_fkey;
alter table messages add constraint messages_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

alter table finds drop constraint if exists finds_user_id_fkey;
alter table finds add constraint finds_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

alter table find_proofs drop constraint if exists find_proofs_user_id_fkey;
alter table find_proofs add constraint find_proofs_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

alter table referrals drop constraint if exists referrals_inviter_id_fkey;
alter table referrals add constraint referrals_inviter_id_fkey
  foreign key (inviter_id) references profiles(id) on delete set null;

alter table referrals drop constraint if exists referrals_invitee_id_fkey;
alter table referrals add constraint referrals_invitee_id_fkey
  foreign key (invitee_id) references profiles(id) on delete set null;

alter table stone_reports drop constraint if exists stone_reports_reporter_id_fkey;
alter table stone_reports add constraint stone_reports_reporter_id_fkey
  foreign key (reporter_id) references profiles(id) on delete set null;

-- Шаг 3: переписать delete_user — pre-delete cleanup перед drop'ом auth.user
create or replace function delete_user() returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_user_id uuid := auth.uid();
  v_orphan_stone record;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 1) Камни юзера БЕЗ находок (никто не нашёл) → реальное удаление.
  --    Стоит до set author_id=NULL (тогда trigger _trigger_delete_stone_photo
  --    через pg_net вызовет edge function для очистки storage).
  for v_orphan_stone in
    select s.id from stones s
    where s.author_id = v_user_id
      and not exists (select 1 from finds f where f.stone_id = s.id)
  loop
    delete from stones where id = v_orphan_stone.id;
  end loop;

  -- 2) Аватарка юзера (если есть) — её path в storage начинается с
  --    <user_id>/avatar/. Чистим явно через pg_net → edge function.
  --    Раньше delete_user пытался DELETE storage.objects напрямую — Supabase
  --    блокирует (storage.protect_delete). Теперь идём через edge function.
  perform net.http_post(
    url := 'https://zlnkzyvtxaksvilujdwu.supabase.co/functions/v1/delete-stone-photo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms'
    ),
    -- Special path-mode: edge function игнорирует param "user_id_avatar" но
    -- path к photo уже зашит. Для MVP мы НЕ передаём avatar, потому что
    -- profiles.photo_url хранит её URL — handle ниже.
    body := jsonb_build_object('photo_url', (select photo_url from profiles where id = v_user_id))
  );

  -- 3) auth.users delete → cascade в profiles → FK SET NULL по всем
  --    зависимым (stones с finds → author_id=NULL, messages → author_id=NULL,
  --    finds где user был finder → user_id=NULL, итд)
  delete from auth.users where id = v_user_id;
end;
$$;
