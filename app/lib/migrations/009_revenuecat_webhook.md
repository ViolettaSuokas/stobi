# Migration 009: RevenueCat webhook → Supabase Edge Function

Это НЕ SQL-миграция, а отдельный шаг: создать Edge Function и настроить webhook
в RevenueCat Dashboard. Клиент после этого **не пишет** `is_premium` / `premium_expires_at`
напрямую — всё идёт через webhook.

## Шаги

### 1. Создать Edge Function локально

```bash
# В корне проекта (где будет Supabase CLI)
supabase functions new rc-webhook
```

Содержимое `supabase/functions/rc-webhook/index.ts`:

```ts
// RevenueCat webhook receiver.
// Docs: https://docs.revenuecat.com/docs/webhooks
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AUTH_HEADER = Deno.env.get('RC_WEBHOOK_SECRET')!; // set via `supabase secrets set`
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  // Verify RevenueCat shared secret
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${AUTH_HEADER}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const payload = await req.json();
  const event = payload.event;
  if (!event) return new Response('no event', { status: 400 });

  const appUserId = event.app_user_id as string | undefined;
  if (!appUserId) return new Response('no app_user_id', { status: 400 });

  const type = event.type as string; // INITIAL_PURCHASE | RENEWAL | CANCELLATION | EXPIRATION | BILLING_ISSUE | UNCANCELLATION | ...
  const expirationMs = event.expiration_at_ms as number | undefined;

  // Derive is_premium from event type + expiration
  let isPremium = false;
  let expiresAt: string | null = null;

  if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'].includes(type)) {
    isPremium = true;
    if (expirationMs) expiresAt = new Date(expirationMs).toISOString();
  } else if (['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'].includes(type)) {
    // Access until expiration; is_premium stays true until expiry
    if (expirationMs && expirationMs > Date.now()) {
      isPremium = true;
      expiresAt = new Date(expirationMs).toISOString();
    } else {
      isPremium = false;
      expiresAt = null;
    }
  } else {
    // TEST / other events — no-op
    return new Response(JSON.stringify({ ok: true, type, skipped: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_premium: isPremium, premium_expires_at: expiresAt })
    .eq('id', appUserId);

  if (error) {
    console.error('profile update failed', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, type, user: appUserId, is_premium: isPremium }), {
    headers: { 'content-type': 'application/json' },
  });
});
```

### 2. Задать секрет и задеплоить

```bash
# Сгенерировать секрет (любая случайная строка)
supabase secrets set RC_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Задеплоить функцию
supabase functions deploy rc-webhook --no-verify-jwt
```

Запомнить значение `RC_WEBHOOK_SECRET` — понадобится в шаге 3.

### 3. Настроить webhook в RevenueCat

1. RevenueCat Dashboard → Project → **Integrations** → **Webhooks** → **Add Webhook**
2. URL: `https://<project-ref>.supabase.co/functions/v1/rc-webhook`
3. Authorization header: `Bearer <RC_WEBHOOK_SECRET>` (значение из шага 2)
4. Subscribe to events: **все** (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, UNCANCELLATION, BILLING_ISSUE, PRODUCT_CHANGE)
5. Save → отправить test webhook для проверки

### 4. Убрать клиентскую запись is_premium

После того как webhook работает, в клиенте (`app/lib/purchases.ts`) убрать блок `.update({ is_premium: true, premium_expires_at: expiry })`. Этот файл уже отрефакторён в этой же серии изменений — проверь что клиент только читает `is_premium`, но не пишет.

### 5. Тест

1. Купить подписку в TestFlight sandbox
2. Проверить в Supabase Dashboard → Table Editor → profiles: `is_premium=true`, `premium_expires_at` заполнен
3. Проверить в логах Edge Function: событие `INITIAL_PURCHASE` обработано
