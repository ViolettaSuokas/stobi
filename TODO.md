# Stobi — TODO

> Обновлено 2026-04-17. Детальный статус по блокерам — в `AUDIT_PLAN.md`.

## 🚨 Требует твоего участия (только ты можешь сделать)

### Домены, аккаунты, деньги
- [ ] **Купить домен** (stobi.app / stobi.fi / другое) и опубликовать Privacy/Terms/Support страницы
- [ ] **Ротировать Firebase API key** в Google Cloud Console → Credentials → Restrict by package `com.stobi.app` + SHA-1 (старый `AIzaSyAti3yBt60f8KCXxKKH_43RRud90Sv56FQ` утёк в git истории)
- [ ] **Финский перевод** — заказать у native speaker (~600-1000 € на Fiverr / Upwork). i18n.tsx уже поддерживает `fi`.
- [ ] **20-30 бета-тестеров** в Helsinki metro — попросить спрятать по 2-3 камня перед запуском

### EAS / Sentry / RevenueCat env
- [ ] **RevenueCat прод-ключи** → EAS Env (получить в RC Dashboard):
  ```
  npx eas-cli env:create production --name RC_IOS_KEY --value appl_xxx
  npx eas-cli env:create production --name RC_ANDROID_KEY --value goog_xxx
  ```
- [ ] **Sentry проект + DSN** (создать на sentry.io, 30 сек):
  ```
  npx eas-cli env:create production --name SENTRY_DSN --value https://xxx@sentry.io/yyy
  ```

### Stone Verification v2 (AI scanner) — внешние шаги
Реализация в коде готова: миграции 017/018/019 + Edge Functions + клиентские libs.
Чтобы включить, нужно:

- [ ] **Supabase Pro upgrade** ($25/мес) — без этого нет pgvector и неограниченных Edge Function вызовов. https://supabase.com/dashboard/project/zlnkzyvtxaksvilujdwu/settings/billing
- [ ] **Применить миграции**:
  - `app/lib/migrations/017_stone_verification.sql` (pgvector + новые RPCs + триггеры)
  - `app/lib/migrations/018_moderation_pipeline.sql` (NSFW shadowban)
  - `app/lib/migrations/019_pgvector_maintenance.sql` (pg_cron reindex)
- [ ] **AWS Rekognition** (для NSFW) — создать IAM user, права `rekognition:DetectModerationLabels`, регион `eu-central-1` (Frankfurt, EU data residency). Положить в Supabase Function secrets:
  ```
  supabase secrets set AWS_ACCESS_KEY_ID=AKIA...
  supabase secrets set AWS_SECRET_ACCESS_KEY=...
  supabase secrets set AWS_REGION=eu-central-1
  ```
- [ ] **Replicate API token** (для CLIP embedding) — https://replicate.com/account/api-tokens → free tier (bootstrap) → Pay-as-you-go когда понадобится. Секрет:
  ```
  supabase secrets set REPLICATE_API_TOKEN=r8_...
  supabase secrets set REPLICATE_CLIP_MODEL_VERSION=<sha256 ver hash>
  ```
  (Взять актуальный version hash с https://replicate.com/pharmapsychotic/clip-interrogator или аналогичной CLIP ViT-B/32 модели.)
- [ ] **Deploy Edge Functions**:
  ```
  supabase functions deploy process-stone-photo
  supabase functions deploy process-find-photo
  ```
- [ ] **Backfill embeddings для существующих 46 seed-камней** — one-shot скрипт (я напишу по запросу)
- [ ] Expected cost: **~$34/мес на 1000 MAU** (Pro + Rekognition + Replicate)

### App Store Connect / Google Play
- [ ] **App Store metadata** — описание, ключевые слова, категория, возрастной рейтинг 4+
- [ ] **Скриншоты** — 5× iPhone (6.5" + 5.5"): карта/чат/профиль/камень/онбординг
- [ ] **Иконка 1024x1024** — проверить что текущая подходит (assets/icon.png)
- [ ] **RevenueCat Offerings metadata** — Display Name + Description
- [ ] **Sandbox-тест подписки** в TestFlight (покупка Stobi Pro Monthly $3.99)
- [ ] **Google Play Console** — Android metadata, Data Safety form, первый билд

## ✅ Закрыто в этой сессии (14 коммитов, подробности в AUDIT_PLAN.md)

### Security — все 7 блокеров
- [x] RPC-economy (earn_points, spend_item, record_find, activate_trial, etc.) — накатано на прод
- [x] RLS-trigger запрещает клиенту писать balance/is_premium/owned_items
- [x] **RevenueCat webhook deployed + зарегистрирован в RC Dashboard, Active, E2E пройден**
- [x] Server-side rate-limit: 2 finds/автор/сутки, 1 msg/3 sec, 30 msg/час, 5 stones/день
- [x] Серверная модерация (20 banned words × 3 языка + URL-детектор)
- [x] Фото resize 1600 px + strip EXIF в 4 местах

### Store compliance — 4/6
- [x] google-services.json в .gitignore
- [x] PrivacyInfo.xcprivacy inline в app.json
- [x] NSUserTrackingUsageDescription + все usage descriptions
- [x] supportUrl / privacyPolicyUrl / termsOfServiceUrl

### Product / UX
- [x] Триал 24 ч → **7 дней** (конверсия должна вырасти 2-3x)
- [x] 13+ age gate в регистрации (COPPA/GDPR)
- [x] Forgot password flow (через Supabase resetPasswordForEmail)
- [x] 1-часовой лок на новый камень (антифрод самофарма) + UI countdown
- [x] Own-stone detect усилен (3 независимых способа)
- [x] Chat pagination (limit 50 + «показать старые»)
- [x] Оптимистичный like с rollback

### Observability
- [x] Sentry integration (ждёт только DSN)
- [x] ErrorBoundary → Sentry
- [x] Cold start распараллелен

### UI / polish
- [x] Shimmer в Skeleton
- [x] EmptyState компонент + пустой чат
- [x] Design tokens: Spacing + Typography
- [x] FontAwesome → Phosphor (AppleLogo, GoogleLogo)
- [x] Haptics (find/hide/send/like)
- [x] Modal 50ms lag убран
- [x] Accessibility labels на tab bar

### Tests
- [x] Jest + jest-expo preset + setup
- [x] **44 unit-теста зелёные** (moderation, location, premium-trial, daily-challenge, points catalog)
- [x] npm test / test:watch / test:coverage скрипты

### i18n
- [x] Хардкод русского из модалок вынесен
- [x] Валидация register на 3 языках
- [x] ~30 новых ключей в ru/fi/en

## 💤 Улучшения (после запуска)

### Могу сделать автономно когда скажешь
- [ ] Accessibility labels на остальные экраны (map, feed, profile, add, stone detail)
- [ ] Empty states для map / feed / profile / achievements
- [ ] Language switch без рестарта приложения
- [ ] Push-уведомления (expo-notifications + tokens table в Supabase)
- [ ] **Booster pack** в premium: «100 💎 за 0.99 €» — одна из главных рекомендаций Product-аудита
- [ ] **Annual plan** — 35 €/год (30% скидка) в RC + UI
- [ ] Больше unit-тестов (chat, user-stones, achievements)
- [ ] E2E Detox — 5 сценариев (login → map → find → chat → settings)
- [ ] Dark theme токены
- [ ] Offline баннер + кеш

### Требуют твоих решений / данных
- [ ] **Leaderboard sharing** — кнопка «Я на #3 в Stobi!» → картинка + Instagram/WhatsApp (нужна картинка-шаблон)
- [ ] **Referral link** — друг регается → обоим +100 💎 (нужна схема наград)
- [ ] **XP / уровни 1-50** (было в PLAN.md, нужен дизайн прогрессии)
- [ ] **Сезонные косметики** (нужен редактор / дизайн сезонов)
- [ ] **Streak multiplier** — 7 дней → 2x 💎 (нужна экономическая балансировка)

## 💡 Идеи на будущее (без дат)

- [ ] Друзья / подписки на авторов
- [ ] Избранные камни / wishlist
- [ ] Фильтры на карте (по городу, по автору, по расстоянию)
- [ ] Голосовые сообщения в чате
- [ ] Стикеры / реакции на сообщения
- [ ] Сезонные ивенты (Рождество, Юханнус)
- [ ] AR-камера для поиска камней
- [ ] Parental controls (для семейного режима)
- [ ] Admin-панель для модерации жалоб

## 🎯 3 метрики для day-1 трекинга

1. **Trial Funnel** — `trial_activated → paywall_shown → subscription_purchased` (цель 5%+)
2. **Engagement** — DAU, avg session, stones/chat per session (цель D1 retention 25%+)
3. **Cold Start** — `location_granted → map_opened → stone_tapped → find_success` (цель 40%+ в Хельсинки; <20% = карта пустая = продукт мёртвый)
