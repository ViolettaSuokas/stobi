# Push-notification secrets

**Эти секреты уже в Supabase Secrets и подставляются в Edge Function автоматически.**
Тебе ничего руками трогать не надо, файл здесь только для справки на будущее.

## PUSH_FUNCTION_SECRET
Используется cron-job'ом `stobi-push-sender` (pg_cron) для авторизации при
вызове `send-push` Edge Function.

Если хочешь ротировать:
```sql
-- 1. Новый секрет
supabase secrets set PUSH_FUNCTION_SECRET=$(openssl rand -hex 32)
-- 2. Обновить cron-job с новым секретом
select cron.unschedule('stobi-push-sender');
-- (затем пересоздать с новым значением в Authorization header)
```

## URL
`https://zlnkzyvtxaksvilujdwu.supabase.co/functions/v1/send-push`

## Как это работает
1. Триггер `on_find_notify_author` (migration 010) после insert в finds
   → пишет в `push_queue` с локализованным текстом
2. pg_cron job `stobi-push-sender` каждую минуту вызывает Edge Function
3. Edge Function читает queue, тянет tokens из `push_tokens`,
   отправляет батчем на `exp.host/--/api/v2/push/send`
4. Помечает items как sent=true

## Когда заработает у пользователя
- На iOS симуляторе push не придёт (Apple не поддерживает)
- На настоящем iPhone — работает сразу после первого логина (там registerPushToken спросит разрешение)
- На Android — аналогично

## Триггеры расширения в будущем
Добавляй в migration 011+ новые триггеры по паттерну `notify_author_on_find`:
- `on_chat_reply_notify_parent` — ответили на твоё сообщение
- `on_achievement_unlock_notify_user` — получил ачивку
- `on_daily_challenge_reset_notify_all` — новый челлендж (cron)
