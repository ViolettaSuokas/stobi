-- Раз bonus за share-находки поднят 2 → 5 💎. Dedup-логика не меняется.

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
  v_reward integer := 5;                     -- было 2
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select count(*) into v_existing
    from balance_events
    where user_id = v_user_id
      and reason = 'social_share'
      and ref_id = p_stone_id::text;

  if v_existing > 0 then
    select coalesce(balance, 0) into v_new_balance from profiles where id = v_user_id;
    return jsonb_build_object('rewarded', false, 'balance', v_new_balance, 'reason', 'already_claimed');
  end if;

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
