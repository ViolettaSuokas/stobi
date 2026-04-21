-- Social share bonus: +2 💎 за расшаривание находки.
--
-- После verified find клиент показывает CelebrationOverlay с CTA
-- "Поделиться → +2 💎". После успешного нативного share клиент
-- вызывает reward_social_share(stone_id). RPC:
--   1. Проверяет что юзер ещё не получал social_share bonus за этот камень
--      (dedup через balance_events where reason='social_share' и ref_id=stone_id)
--   2. Если нет — начисляет +2 и пишет balance_event
--   3. Возвращает { balance, rewarded: true/false }
--
-- Таким образом юзер не может накручивать балланс многократным re-share.

create or replace function reward_social_share(p_stone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing integer;
  v_new_balance integer;
  v_reward integer := 2;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Проверка: есть ли уже event 'social_share' для этого stone_id?
  select count(*) into v_existing
    from balance_events
    where user_id = v_user_id
      and reason = 'social_share'
      and ref_id = p_stone_id::text;

  if v_existing > 0 then
    -- Уже получал — возвращаем текущий balance без начисления
    select coalesce(balance, 0) into v_new_balance from profiles where id = v_user_id;
    return jsonb_build_object('rewarded', false, 'balance', v_new_balance, 'reason', 'already_claimed');
  end if;

  -- Проверка: камень вообще существует и юзер его нашёл (нельзя шерить
  -- находку которая не его)
  if not exists (
    select 1 from finds
    where user_id = v_user_id and stone_id = p_stone_id
  ) then
    raise exception 'not_found_by_user';
  end if;

  update profiles
    set balance = coalesce(balance, 0) + v_reward
    where id = v_user_id
    returning balance into v_new_balance;

  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
    values (v_user_id, v_reward, 'social_share', p_stone_id::text, v_new_balance);

  return jsonb_build_object('rewarded', true, 'balance', v_new_balance, 'amount', v_reward);
end;
$$;

revoke all on function reward_social_share(uuid) from public;
grant execute on function reward_social_share(uuid) to authenticated;
