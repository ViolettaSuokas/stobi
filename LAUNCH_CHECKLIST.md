# Stobi — Launch Checklist

> Пошаговый план последних 7 дней до публикации в App Store + Google Play.
> Когда будешь готова — поставь дату «Launch Day» и отсчитывай назад.

---

## 🗓️ T-7 дней до Launch Day

### Backend / инфра
- [ ] Проверить что в Supabase Dashboard нет pending миграций (в `lib/migrations/` все накатаны)
- [ ] В Supabase → Settings → Database → **Reset database password**. Старый пароль (который давала Claude) больше не нужен. После сброса я не смогу дергать SQL — но к этому моменту всё уже настроено.
- [ ] Ротировать Supabase Personal Access Token: https://supabase.com/dashboard/account/tokens → Revoke старый, создать новый только если хочешь продолжать автоматизацию.
- [ ] Включить **Point-in-time recovery** в Supabase (если на платном плане) — защита от случайного DROP TABLE.
- [ ] Проверить что cron-job `stobi-push-sender` активен: SQL `select * from cron.job;`.

### RevenueCat (обязательно перед app store submit)
- [ ] Создать 6 products в RC dashboard → Products → New:
  - `stobi_free_trial` — subscription, 7-day free trial → €3.99/mo
  - `stobi_monthly` — subscription, €3.99/mo
  - `stobi_annual` — subscription, €35/yr
  - `stobi_pack_small` — non-consumable, €0.99 (100 💎)
  - `stobi_pack_medium` — non-consumable, €3.99 (500 💎)
  - `stobi_pack_large` — non-consumable, €9.99 (1500 💎)
- [ ] Сгруппировать в один Offering `Stobi Pro` в RC dashboard
- [ ] Те же product IDs создать в App Store Connect + Google Play Console
- [ ] Получить прод-ключи RC → задать в EAS:
  ```
  npx eas-cli env:create production --name RC_IOS_KEY --value appl_xxx
  npx eas-cli env:create production --name RC_ANDROID_KEY --value goog_xxx
  ```

### Apple Developer / App Store Connect
- [ ] App Store Connect → My Apps → New App → bundle `com.stobi.app`
- [ ] App Information:
  - Primary language: Finnish (если launch в Финляндии)
  - Category: **Social Networking** (или **Lifestyle**)
  - Age Rating: **4+** (с chat moderation это ок, но Apple может поднять до 9+ — пусть решают)
- [ ] Pricing: Free + in-app purchases
- [ ] App Privacy: заполнить nutrition label. Опорные галочки:
  - Data Used to Track You: **None** (у нас NSPrivacyTracking=false)
  - Data Linked to You: Contact Info (Email), Identifiers (User ID), Location (Precise), Photos
  - Data Not Linked to You: Diagnostics
- [ ] Screenshots iPhone 6.5" (1290×2796): карта, find-celebration, hide flow, chat, profile
- [ ] Описание + keywords (подсказка ниже)
- [ ] Support URL: `https://stobi.app/support`
- [ ] Privacy Policy URL: `https://stobi.app/privacy`
- [ ] Terms of Service URL: `https://stobi.app/terms`
- [ ] Submit for Review (обычно 1-3 дня)

### Google Play Console
- [ ] Store listing → заполнить metadata
- [ ] Data safety form — аналогично App Store privacy
- [ ] Content rating: fill questionnaire
- [ ] Target API level: 34+ (Expo 54 даёт это автоматически)
- [ ] Upload AAB через `eas submit --platform android`

### Firebase / Google Cloud (безопасность)
- [ ] В Google Cloud Console ротировать Firebase API key `AIzaSyAti3yBt60f8KCXxKKH_43RRud90Sv56FQ` — он утёк в git history. Restrict by package `com.stobi.app` + SHA-1 fingerprint.

### Домен + сайт
- [x] Куплен домен `stobi.app`
- [ ] Настроить DNS: Namecheap → Manage → Custom DNS → указать на Vercel/Cloudflare
- [ ] Сайт опубликован: landing + `/privacy` + `/terms` + `/support`
- [ ] `apple-app-site-association` файл в `/.well-known/` для iOS Universal Links
- [ ] `assetlinks.json` файл в `/.well-known/` для Android App Links

---

## 🗓️ T-3 дня

### Финальный QA на обоих платформах
- [ ] Скачать свежий APK/IPA с EAS
- [ ] Пройти golden path: splash → onboarding → map → find stone → hide stone → chat → profile → premium paywall
- [ ] Проверить i18n во всех 3 языках: ru → fi → en (смена языка в settings)
- [ ] Offline-режим: включить airplane mode → должен появиться red banner «Нет соединения»
- [ ] Push: test-событие из Supabase `push_queue` → `insert into push_queue (user_id, title, body, data) values ('твой-id', 'Тест', 'Проверка', '{}'::jsonb);` → через ≤1 мин прилетит
- [ ] Покупка booster pack в sandbox App Store → проверить что +100 💎 пришли на баланс (через RC webhook)

### Beta testers
- [ ] Зарегистрировать UDID 5-10 устройств beta-тестеров через EAS: `eas device:create`
- [ ] Разослать TestFlight ссылку (iOS) или APK (Android) 20-30 людям в Helsinki metro из FinStones группы
- [ ] Попросить спрятать 2-3 камня каждый → **к launch у нас ~60 real stones в Хельсинки**
- [ ] Попросить native-speaker прочитать финские строки и дать фидбек на 5-10 переводов

### Мониторинг готов
- [ ] Зайти в Sentry (когда создашь проект + добавишь DSN в EAS) → проверить что crash-report работает (можно специально вызвать ошибку в dev build)
- [ ] SQL-дашборд (см. ниже) — сохранить в закладки

---

## 🗓️ T-1 день

- [ ] Финальный билд: `eas build --platform all --profile production`
- [ ] Submit в App Store + Google Play
- [ ] Подготовить launch пост для FinStones Facebook группы (на финском)
- [ ] Instagram-анонс с мескотом (использовать Claude Design для картинки)
- [ ] Email теплому кругу (~50 человек) с TestFlight ссылкой

---

## 🚀 Launch Day (T = 0)

- [ ] Apple одобрил → App goes live → делай Launch Post в FinStones группе
- [ ] Готовься отвечать на комменты / DM — первые 48 часов критичны
- [ ] Открой **SQL-дашборд ниже** и обновляй каждый час первые сутки

---

## 📊 SQL-дашборд для первых 7 дней

Открой https://supabase.com/dashboard/project/zlnkzyvtxaksvilujdwu/sql и сохраняй как queries.

### 1. Общая воронка установок → активных юзеров

```sql
select
  date(created_at) as day,
  count(*) as new_users
from auth.users
where created_at > now() - interval '7 days'
group by day order by day desc;
```

### 2. Событийная воронка (trial conversion)

```sql
with funnel as (
  select
    count(*) filter (where event = 'app_open') as opens,
    count(*) filter (where event = 'onboarding_completed') as onboarded,
    count(distinct user_id) filter (where event = 'map_opened') as map_opened,
    count(*) filter (where event = 'stone_find') as finds,
    count(*) filter (where event = 'paywall_shown') as paywall_shown,
    count(*) filter (where event = 'trial_activated') as trials,
    count(*) filter (where event = 'subscription_purchased') as subs,
    count(*) filter (where event = 'booster_purchased') as boosters
  from analytics_events
  where created_at > now() - interval '7 days'
)
select * from funnel;
```

### 3. Top-10 самых активных пользователей

```sql
select
  p.username,
  count(f.id) as finds,
  count(s.id) as hides,
  p.balance as diamonds
from profiles p
left join finds f on f.user_id = p.id
left join stones s on s.author_id = p.id
group by p.id, p.username, p.balance
order by finds + hides desc
limit 10;
```

### 4. Retention D1 / D7 (grows with time)

```sql
with signups as (
  select id, created_at::date as signup_date from auth.users
),
activity as (
  select
    s.id as user_id,
    s.signup_date,
    max(a.created_at::date) as last_active
  from signups s
  left join analytics_events a on a.user_id = s.id
  group by s.id, s.signup_date
)
select
  signup_date,
  count(*) as signups,
  count(*) filter (where last_active >= signup_date + interval '1 day') as d1_returned,
  count(*) filter (where last_active >= signup_date + interval '7 days') as d7_returned
from activity
group by signup_date
order by signup_date desc;
```

### 5. Города — где нашли больше всего

```sql
select city, count(*) as finds
from finds
where found_at > now() - interval '7 days'
group by city
order by finds desc limit 10;
```

### 6. Push-статистика

```sql
select
  count(*) filter (where sent) as sent,
  count(*) filter (where not sent) as pending,
  date(created_at) as day
from push_queue
group by day order by day desc limit 7;
```

### 7. Выручка (mock — пока RC webhooks поступают)

```sql
select
  reason,
  count(*) as transactions,
  sum(case when reason like 'booster_pack:stobi_pack_small'  then 0.99 end) +
  sum(case when reason like 'booster_pack:stobi_pack_medium' then 3.99 end) +
  sum(case when reason like 'booster_pack:stobi_pack_large'  then 9.99 end) as revenue_eur
from balance_events
where created_at > now() - interval '30 days'
  and reason like 'booster_pack:%';
```

### 8. Модерация — отклонённые сообщения / спам

Текущая схема не логирует отказы триггеров. Когда понадобится — можно добавить таблицу `moderation_log` в отдельной миграции.

---

## 🎯 3 метрики которые нужно смотреть каждый день

1. **Trial Funnel**: `paywall_shown → trial_activated → subscription_purchased` — цель **≥5%** конверсии.
2. **D1 Retention**: из тех кто зарегался вчера, сколько зашли сегодня — цель **≥25%**.
3. **Cold Start**: из тех кто дал permission на location, сколько дошли до `stone_find` — цель **≥40%** в Helsinki.

Если любая из 3 метрик в красной зоне первую неделю — напиши мне, разберёмся.

---

## 🆘 Что делать если...

### Apple Review отклонил
Обычные причины:
1. **4.0 Design** — "слишком простое приложение" → добавь скриншоты с чаром и лидербордами, покажи depth
2. **5.1.1 Privacy** — Privacy nutrition label не совпадает с реальностью → проверь что в app.json декларировано
3. **2.1 Crash on launch** — Sentry уже подключен, проверь логи, обычно фикс деплоится OTA через Expo Updates за 5 минут

### Первый негативный отзыв
- Ответь в течение **24 часов** — публично и вежливо
- Если баг — прямо пообещай фикс в следующем апдейте + OTA push через Expo
- Не удаляй негатив, не спорь

### Crash spike в Sentry
- Проверь что-то в production отличается от dev (обычно env vars / secrets не подтянулись)
- Быстрый rollback: `eas update --branch production --message "rollback"` вернёт предыдущую JS-версию

### Пользователи жалуются на пустую карту
- Это **#1 launch risk** из product-аудита
- Митигация — seeded камни (46 шт по всей Финляндии) уже в коде
- Долгосрочно: начать делать partnerships с local art groups чтобы они спрятали реальные камни

---

## Готовый текст для метаданных App Store

### Название
**Stobi — Painted Stones**

### Subtitle (iOS, 30 chars)
Find art. Hide joy. ❤️

### Keywords (iOS, 100 chars)
painted stones,geocaching,finland,community,treasure,hunt,outdoor,art,stones,family,kids,suomi

### Short description (Google Play, 80 chars)
Прячь и находи раскрашенные камни по всей Финляндии. 178 000+ искателей.

### Full description (opening paragraph, ru)
```
Stobi — это игра-сообщество для всей семьи. Раскрашивай камни, прячь в
любимых местах города, находи чужие по GPS. За каждую находку — 💎
алмазики, кастомизация мескота, достижения. 178 000+ людей уже
присоединились через нашу группу в Facebook.

✨ Как играть:
🪨 Прячь — найди красивый камень, раскрась и оставь в парке/на пляже
🔍 Ищи — открой карту, подойди к отмеченному месту, сделай фото
💎 Получай — за каждое действие алмазики, одевай своего Stobi

👨‍👩‍👧 Семейное приложение с модерацией чата. PEGI 4+. Финский / русский / английский.
```

Финская и английская версии — попросить у native-speaker.

---

Это живой документ — обновляй по ходу. Удачи! 🚀
