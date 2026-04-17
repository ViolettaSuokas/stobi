# Stobi — Supabase migrations

Numbered SQL migrations. Apply in order in Supabase SQL Editor (supabase.com → SQL Editor → New Query).

## Apply order

1. `001_lock_profile_columns.sql` — запрещает клиенту писать `balance`, `is_premium`, `premium_expires_at`, `owned_items`, `equipped_items`
2. `002_earn_points_rpc.sql` — серверная функция начисления алмазиков (идемпотентная, с event-log)
3. `003_spend_item_rpc.sql` — серверная функция покупки косметики (проверка владения, премиум-гейт, списание)
4. `004_activate_trial_rpc.sql` — серверная активация 7-дневного триала по daily challenge
5. `005_record_find_rpc.sql` — серверная фиксация находки (distance ≤30m, ≤2 finds/автор/день, награда автору)
6. `006_server_rate_limits.sql` — триггеры rate-limit на messages и stones
7. `007_moderation_trigger.sql` — серверная модерация сообщений и bio/username
8. `008_storage_policies.sql` — политики Supabase Storage для bucket `photos`

## Как применять

```bash
# Вариант 1: через Supabase Dashboard → SQL Editor
# Скопировать содержимое каждого файла, выполнить один за другим.

# Вариант 2: через supabase CLI
supabase db push --file 001_lock_profile_columns.sql
```

## Откат

Каждый файл содержит `-- ROLLBACK` секцию в конце (закомментирована).
Раскомментировать и выполнить для отката конкретной миграции.

## После применения всех миграций

Клиент (`points.ts`, `finds.ts`, `purchases.ts`, `premium-trial.ts`) автоматически использует новые RPC.
Проверить в приложении: смена баланса, покупка косметики, активация триала, находка камня.
