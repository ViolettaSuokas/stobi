-- Push notification preferences — server-side enforcement.
--
-- До этого чекбокс "Push-уведомления" в settings.tsx сохранял флаг только
-- в AsyncStorage юзера → server всё равно слал push в push_queue, эффекта
-- от выключения не было.
--
-- Теперь:
--   - profiles.notif_push_enabled (bool, default true) — единый prefs-toggle
--   - все триггеры/RPC что вставляют в push_queue сначала проверяют флаг
--   - юзер выключает → пушей нет
--
-- Меняемые функции:
--   - notify_author_on_find (триггер на finds INSERT)
--   - redeem_referral_code (RPC)
-- Прямых записей в push_queue от клиента нет, так что прикрытие полное.

alter table profiles
  add column if not exists notif_push_enabled boolean not null default true;

-- ────────────────────────────────────────────
-- 1. notify_author_on_find — push автору при находке его камня
-- ────────────────────────────────────────────

create or replace function public.notify_author_on_find()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_author_id uuid;
  v_stone_name text;
  v_finder_name text;
  v_lang text;
  v_title text;
  v_body text;
  v_push_enabled boolean;
begin
  -- Получить author_id и имя камня
  select s.author_id, s.name into v_author_id, v_stone_name
    from stones s where s.id = new.stone_id;

  -- Не пушим самому себе
  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  -- Проверить prefs автора. Если выключено — return без enqueue.
  -- balance_event и in-app уведомление всё равно создаются (это другие
  -- триггеры), мы только не дёргаем APNs/FCM.
  select coalesce(p.notif_push_enabled, true) into v_push_enabled
    from profiles p where p.id = v_author_id;
  if not v_push_enabled then
    return new;
  end if;

  -- Получить имя нашедшего
  select coalesce(p.username, 'Кто-то') into v_finder_name
    from profiles p where p.id = new.user_id;

  -- Язык автора
  select coalesce(p.lang, 'ru') into v_lang
    from profiles p where p.id = v_author_id;

  -- Локализованный текст
  if v_lang = 'fi' then
    v_title := 'Kivesi löydettiin! ❤️';
    v_body := v_finder_name || ' löysi kiven "' || coalesce(v_stone_name, 'kivi') || '". +2 💎';
  elsif v_lang = 'en' then
    v_title := 'Your stone was found! ❤️';
    v_body := v_finder_name || ' found "' || coalesce(v_stone_name, 'stone') || '". +2 💎';
  else
    v_title := 'Твой камень нашли! ❤️';
    v_body := v_finder_name || ' нашёл "' || coalesce(v_stone_name, 'камень') || '". +2 💎';
  end if;

  insert into push_queue (user_id, title, body, data)
    values (
      v_author_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'stone_found', 'stone_id', new.stone_id)
    );

  return new;
end;
$function$;

-- ────────────────────────────────────────────
-- 2. redeem_referral_code — push приглашающему при redeem'е друга
-- ────────────────────────────────────────────
-- Заменяем целиком, добавив проверку notif_push_enabled inviter'а перед
-- блоком insert into push_queue.

create or replace function public.redeem_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invitee_id uuid;
  v_inviter_id uuid;
  v_cleaned text;
  v_expires timestamptz;
  v_existing bigint;
  v_inviter_bonus integer := 50;
  v_invitee_bonus integer := 50;
  v_invitee_balance integer;
  v_inviter_balance integer;
begin
  v_invitee_id := auth.uid();
  if v_invitee_id is null then raise exception 'not_authenticated'; end if;

  v_cleaned := upper(trim(p_code));
  if v_cleaned = '' then raise exception 'invalid_code'; end if;

  select user_id, expires_at into v_inviter_id, v_expires
    from referral_codes
    where code = v_cleaned or upper(code) = v_cleaned
    limit 1;

  if v_inviter_id is null then raise exception 'code_not_found'; end if;
  if v_expires < now() then raise exception 'code_expired'; end if;
  if v_inviter_id = v_invitee_id then raise exception 'cannot_redeem_own_code'; end if;

  select id into v_existing from referrals where invitee_id = v_invitee_id;
  if v_existing is not null then raise exception 'already_redeemed'; end if;

  insert into referrals (inviter_id, invitee_id, code_used, inviter_bonus, invitee_bonus)
    values (v_inviter_id, v_invitee_id, v_cleaned, v_inviter_bonus, v_invitee_bonus);

  update profiles set balance = coalesce(balance, 0) + v_invitee_bonus
    where id = v_invitee_id returning balance into v_invitee_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_invitee_id, v_invitee_bonus, 'referral_redeemed', v_cleaned, v_invitee_balance);

  update profiles set balance = coalesce(balance, 0) + v_inviter_bonus
    where id = v_inviter_id returning balance into v_inviter_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_inviter_id, v_inviter_bonus, 'referral_invited', v_invitee_id::text, v_inviter_balance);

  -- Push inviter'у — только если у него notif_push_enabled=true.
  declare
    v_lang text;
    v_title text;
    v_body text;
    v_push_enabled boolean;
  begin
    select coalesce(p.notif_push_enabled, true) into v_push_enabled
      from profiles p where p.id = v_inviter_id;
    if v_push_enabled then
      select coalesce(p.lang, 'ru') into v_lang from profiles p where p.id = v_inviter_id;
      if v_lang = 'fi' then
        v_title := 'Uusi ystävä liittyi! 🎉';
        v_body := 'Sait +' || v_inviter_bonus || ' 💎 kutsustasi';
      elsif v_lang = 'en' then
        v_title := 'A friend joined! 🎉';
        v_body := 'You got +' || v_inviter_bonus || ' 💎 for your invite';
      else
        v_title := 'Друг присоединился! 🎉';
        v_body := 'Ты получил +' || v_inviter_bonus || ' 💎 за приглашение';
      end if;
      insert into push_queue (user_id, title, body, data)
        values (v_inviter_id, v_title, v_body,
                jsonb_build_object('type', 'referral_redeemed', 'invitee_id', v_invitee_id));
    end if;
  end;

  return jsonb_build_object(
    'bonus_applied', v_invitee_bonus,
    'new_balance', v_invitee_balance,
    'inviter_id', v_inviter_id
  );
end;
$function$;
