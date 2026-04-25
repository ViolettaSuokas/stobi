-- Расширяем bypass в profiles_block_protected_updates: разрешаем обновления
-- из SECURITY DEFINER функций (они запускаются как postgres). Это покрывает
-- ВСЕ RPC сразу — earn_points, spend_item, grant_item, record_find_v2,
-- reward_social_share, reward_stone_author, redeem_referral_code и т.д.,
-- без необходимости патчить каждую отдельно.
--
-- Безопасность: SECURITY DEFINER функции пишутся нами (схема public), мы
-- сами решаем что они делают. Direct REST API писатели от authenticated
-- роли продолжают блокироваться. Если кто-то получит DB-доступ и создаст
-- malicious DEFINER функцию — у него уже есть полный контроль над БД и
-- этот trigger всё равно не помогает.

create or replace function profiles_block_protected_updates() returns trigger
language plpgsql
as $$
begin
  -- Service role context (admin tools, server scripts с ключом).
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  -- Все наши mutator-RPC (earn_points, spend_item, grant_item, etc) объявлены
  -- SECURITY DEFINER → внутри них current_user = postgres (owner функции).
  -- Прямые UPDATE'ы от клиента через REST API идут как 'authenticated'.
  if current_user = 'postgres' or current_user = 'supabase_admin' then
    return new;
  end if;

  -- Legacy session-var bypass (см. 20260425150000) — на случай если
  -- кто-то использует SECURITY INVOKER функцию с явным opt-in.
  if current_setting('app.via_balance_rpc', true) = '1' then
    return new;
  end if;

  if new.balance is distinct from old.balance then
    raise exception 'Column "balance" cannot be updated directly. Use earn_points() or spend_item() RPC.';
  end if;
  if new.is_premium is distinct from old.is_premium then
    raise exception 'Column "is_premium" is managed by the RevenueCat webhook.';
  end if;
  if new.premium_expires_at is distinct from old.premium_expires_at then
    raise exception 'Column "premium_expires_at" is managed by the RevenueCat webhook.';
  end if;
  if new.owned_items is distinct from old.owned_items then
    raise exception 'Column "owned_items" cannot be updated directly. Use spend_item() RPC.';
  end if;
  if new.equipped_items is distinct from old.equipped_items then
    return new;  -- visual-only, no cheat risk
  end if;
  return new;
end;
$$;
