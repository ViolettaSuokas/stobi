-- ═══════════════════════════════════════════════════════════════════
-- Migration 012: Referral program
-- ═══════════════════════════════════════════════════════════════════
--
-- Реф-программа: юзер A приглашает B через свой код → B регистрируется,
-- применяет код → оба получают +50 💎.
--
-- Anti-abuse:
--   - Один юзер может применить код ровно один раз (once-per-user)
--   - Нельзя применить свой же код
--   - Код должен быть не старше 1 года (expires_at)
--   - Rate-limit через earn_points RPC сам по себе (20/min)
-- ═══════════════════════════════════════════════════════════════════

-- Referral codes — generated once per user, unique
create table if not exists referral_codes (
  user_id uuid references profiles(id) on delete cascade primary key,
  code text unique not null,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '1 year'
);

create index if not exists referral_codes_code_idx on referral_codes (lower(code));

alter table referral_codes enable row level security;
create policy "Users can read own code" on referral_codes for select using (auth.uid() = user_id);
create policy "Anyone can read code by value (for redemption)"
  on referral_codes for select to authenticated, anon using (true);
-- No INSERT/UPDATE/DELETE policy — только RPC может создавать.

-- Referrals — кто кого пригласил (успешные redeem-ы)
create table if not exists referrals (
  id bigint generated always as identity primary key,
  inviter_id uuid references profiles(id) on delete cascade not null,
  invitee_id uuid references profiles(id) on delete cascade not null,
  code_used text not null,
  inviter_bonus integer not null default 50,
  invitee_bonus integer not null default 50,
  created_at timestamptz default now(),
  unique (invitee_id) -- один юзер может быть приглашён только один раз
);

create index if not exists referrals_inviter_idx on referrals (inviter_id, created_at desc);

alter table referrals enable row level security;
create policy "Users can read own referrals" on referrals for select using (auth.uid() = inviter_id or auth.uid() = invitee_id);

-- ─────────────────────────────────────────────
-- RPC: get_or_create_referral_code
-- Возвращает код для текущего юзера, создаёт если нет.
-- Код = STOBI-{hash(user_id)[0..5]} — читаемый, не раскрывает UUID
-- ─────────────────────────────────────────────
create or replace function get_or_create_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_code text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  select code into v_code from referral_codes where user_id = v_user_id;
  if v_code is not null then return v_code; end if;

  -- Генерируем читаемый код из md5(user_id), берём первые 6 символов
  v_code := 'STOBI-' || upper(substring(md5(v_user_id::text), 1, 6));

  insert into referral_codes (user_id, code) values (v_user_id, v_code)
  on conflict (user_id) do nothing;

  -- Если была race — вернём существующий
  select code into v_code from referral_codes where user_id = v_user_id;
  return v_code;
end;
$$;

revoke all on function get_or_create_referral_code() from public;
grant execute on function get_or_create_referral_code() to authenticated;

-- ─────────────────────────────────────────────
-- RPC: redeem_referral_code
-- Применить чужой код. Возвращает jsonb с bonus_applied и new_balance.
-- ─────────────────────────────────────────────
create or replace function redeem_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- Ищем код (case-insensitive)
  select user_id, expires_at into v_inviter_id, v_expires
    from referral_codes
    where code = v_cleaned or upper(code) = v_cleaned
    limit 1;

  if v_inviter_id is null then raise exception 'code_not_found'; end if;
  if v_expires < now() then raise exception 'code_expired'; end if;
  if v_inviter_id = v_invitee_id then raise exception 'cannot_redeem_own_code'; end if;

  -- Проверяем что invitee ещё не использовал ни один код
  select id into v_existing from referrals where invitee_id = v_invitee_id;
  if v_existing is not null then raise exception 'already_redeemed'; end if;

  -- Записываем referral
  insert into referrals (inviter_id, invitee_id, code_used, inviter_bonus, invitee_bonus)
    values (v_inviter_id, v_invitee_id, v_cleaned, v_inviter_bonus, v_invitee_bonus);

  -- Начисляем invitee (текущий юзер)
  update profiles set balance = coalesce(balance, 0) + v_invitee_bonus
    where id = v_invitee_id returning balance into v_invitee_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_invitee_id, v_invitee_bonus, 'referral_redeemed', v_cleaned, v_invitee_balance);

  -- Начисляем inviter
  update profiles set balance = coalesce(balance, 0) + v_inviter_bonus
    where id = v_inviter_id returning balance into v_inviter_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_inviter_id, v_inviter_bonus, 'referral_invited', v_invitee_id::text, v_inviter_balance);

  -- Push уведомление inviter'у через push_queue
  declare v_lang text;
  declare v_title text;
  declare v_body text;
  begin
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
  end;

  return jsonb_build_object(
    'bonus_applied', v_invitee_bonus,
    'new_balance', v_invitee_balance,
    'inviter_id', v_inviter_id
  );
end;
$$;

revoke all on function redeem_referral_code(text) from public;
grant execute on function redeem_referral_code(text) to authenticated;

-- ─────────────────────────────────────────────
-- RPC: get_referral_stats — сколько юзер пригласил + итоговый earn
-- ─────────────────────────────────────────────
create or replace function get_referral_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid;
  v_count integer;
  v_earned integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'not_authenticated'; end if;

  select count(*), coalesce(sum(inviter_bonus), 0) into v_count, v_earned
    from referrals where inviter_id = v_user_id;

  return jsonb_build_object('invited', v_count, 'earned', v_earned);
end;
$$;

revoke all on function get_referral_stats() from public;
grant execute on function get_referral_stats() to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop function if exists redeem_referral_code(text);
-- drop function if exists get_or_create_referral_code();
-- drop function if exists get_referral_stats();
-- drop table if exists referrals;
-- drop table if exists referral_codes;
