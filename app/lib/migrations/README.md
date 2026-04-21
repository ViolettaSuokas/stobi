# Stobi — Supabase migrations

Numbered SQL migrations. Apply in order in Supabase SQL Editor (supabase.com → SQL Editor → New Query).

## Apply order

0. `000_baseline_schema.sql` — таблицы profiles/stones/finds/messages/likes/achievements/analytics_events + базовые RLS-policies + handle_new_user trigger + delete_user RPC. Накатывается **один раз** на новый проект. Прод уже имеет это накатанным.
1. `001_lock_profile_columns.sql` — запрещает клиенту писать `balance`, `is_premium`, `premium_expires_at`, `owned_items`, `equipped_items`
2. `002_earn_points_rpc.sql` — серверная функция начисления алмазиков (идемпотентная, с event-log)
3. `003_spend_item_rpc.sql` — серверная функция покупки косметики (проверка владения, премиум-гейт, списание)
4. `004_activate_trial_rpc.sql` — серверная активация 7-дневного триала по daily challenge
5. `005_record_find_rpc.sql` — серверная фиксация находки (distance ≤30m, ≤2 finds/автор/день, награда автору)
6. `006_server_rate_limits.sql` — триггеры rate-limit на messages и stones
7. `007_moderation_trigger.sql` — серверная модерация сообщений и bio/username
8. `008_storage_policies.sql` — политики Supabase Storage для bucket `photos`
9. `010_push_notifications.sql` — таблицы push_tokens, push_queue + triggers
10. `011_feedback_table.sql` — feedback (in-app issue report)
11. `012_referral_program.sql` — referral codes + redeem RPCs
12. `013_expanded_cosmetics.sql` — seed новых косметик
13. `014_security_polish.sql` — webhook_events dedup (RC) + rate-limit doc
14. `015_security_hardening.sql` — analytics_events lock + record_find глобальный лимит + COPPA strict
15. `016_welcome_bonus.sql` — +20💎 новым юзерам (handle_new_user trigger + backfill)
16. `017_stone_verification.sql` — **v2 find flow**: pgvector + AI-embedding matching + stone_reports auto-hide + find_proofs аудит. **Требует Supabase Pro**.
17. `018_moderation_pipeline.sql` — moderation_events + автоматический upload-shadowban после 3 reject/30д
18. `019_pgvector_maintenance.sql` — pg_cron ежемесячный REINDEX IVFFLAT с адаптивным `lists`

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
