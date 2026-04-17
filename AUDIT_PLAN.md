# Stobi — План работ после аудита

> Аудит от 5 специалистов (senior dev, QA, accessibility, DevOps, product/growth) выявил 15 блокеров до публикации и наметил 3-недельный путь к TestFlight.
>
> Итоговая оценка готовности: **5.0 / 10** → цель **7.5 / 10** за 3 недели.

---

## 📊 Оценки по областям

| Область | Сейчас | Цель | Блокер релиза? |
|---|---|---|---|
| 🔐 Security / антифрод | 2/10 | 8/10 | **ДА** |
| 🧪 Тесты | 0/10 | 6/10 | Нет (но риск высокий) |
| 👁 Accessibility | 2/10 | 6/10 | Нет |
| 📦 Release readiness | 4.2/10 | 8/10 | **ДА** |
| 📈 Product / Growth | 6/10 | 7.5/10 | Частично |
| 🎨 UX Flow | 6.5/10 | 8/10 | Нет |
| 🎨 UI / Visual | 7.2/10 | 8/10 | Нет |
| 🏗 Архитектура | 6/10 | 7/10 | Нет |
| ⚡ Performance | 6/10 | 7/10 | Нет |
| 🔏 Privacy / GDPR | 4/10 | 8/10 | **ДА** |

---

## 🚨 15 БЛОКЕРОВ до App Store

### Security (7 критичных)
- [x] **B1.** ✅ RPC `earn_points` / `spend_item` / `record_find` / `activate_trial` в Supabase с `security definer` *(миграции 002-005 написаны, ждут накатывания)*
- [x] **B2.** ✅ RLS-запрет прямого UPDATE на `balance`, `is_premium`, `owned_items`, `equipped_items`, `premium_expires_at` *(миграция 001)*
- [x] **B3.** ✅ RevenueCat webhook → Supabase Edge Function *(инструкция + код в 009_revenuecat_webhook.md, клиент `purchases.ts` уже не пишет `is_premium`)*
- [x] **B4.** ✅ Триггер rate-limit: 2 finds/автор/сутки *(встроено в `record_find` RPC, миграция 005)*
- [x] **B5.** ✅ Серверная модерация сообщений + bio + stones *(миграция 007, banned_words table + triggers)*
- [x] **B6.** ✅ Rate-limit чата на сервере: 1/3 сек, 30/час *(миграция 006)*
- [x] **B7.** ✅ Фото: resize 1600 px + strip EXIF *(`lib/photo.ts` + интеграция в add/chat/profile/stone)*

### Store compliance (6)
- [x] **B8.** ✅ `google-services.json` в `.gitignore` *(файл оставлен для локальной сборки — ротировать Firebase API key в Google Cloud Console до релиза)*
- [x] **B9.** ✅ `PrivacyInfo.xcprivacy` *(inline в `app.json.ios.privacyManifests` — Expo prebuild сгенерирует)*
- [x] **B10.** ✅ `NSUserTrackingUsageDescription` в `app.json.ios.infoPlist`
- [x] **B11.** ✅ `supportUrl` / `privacyPolicyUrl` / `termsOfServiceUrl` в `app.json.extra` *(заменить на реальный домен когда купится)*
- [ ] **B12.** Заменить sandbox-ключи RevenueCat на прод через EAS Env *(структура готова: `purchases.ts` читает из `Constants.expoConfig.extra.RC_IOS_KEY` / `RC_ANDROID_KEY`)*
- [ ] **B13.** Настроить iOS signing в `eas.json` (требуется EAS dashboard + Apple Developer аккаунт)

### Product (2)
- [ ] **B14.** Финская локализация всех строк (~1000 €, native speaker из Fiverr / Upwork)
- [ ] **B15.** Добавить поле «дата рождения» в регистрацию (13+) для COPPA/GDPR compliance

### Дополнительно закрыто (в этой же сессии)
- [x] Client-side валидация регистрации (email regex, password ≥8, name 2-32)
- [x] Триал 24 ч → **7 дней** (`premium-trial.ts`)
- [x] Хардкод русского в модалах → i18n (`add.tsx`, `premium.tsx`, `settings.tsx`)
- [x] Fix 50ms modal lag (`modal.tsx`)
- [x] Haptics на find/hide/send/like (`lib/haptics.ts`)
- [x] Оптимистичный like с rollback (`chat.tsx`)
- [x] Sentry integration *(`lib/sentry.ts` + ErrorBoundary + `_layout.tsx` cold start parallelized)*
- [x] Plus plugin `@sentry/react-native` в `app.json`

---

## 🗓️ План на 3 недели

### Неделя 1 — Security + Compliance (блокеры)

#### День 1-2: Supabase бэкенд
- [ ] Написать и накатить RPC `earn_points(amount int)` — с проверкой anti-abuse
- [ ] RPC `spend_item(item_id text)` — проверка владения, баланса, премиум-ограничений
- [ ] RPC `activate_trial()` — проверка что активирован впервые / прошёл cooldown
- [ ] RPC `record_find(stone_id uuid, proof_lat, proof_lng)` — проверка distance < 30 m, ≤2/автор/день, награда автору
- [ ] RLS policy: запретить UPDATE защищённых полей на `profiles`
- [ ] Триггер серверной модерации на `messages` и на `profiles.bio/username`

#### День 3-4: Клиент под новые RPC
- [ ] `points.ts` — заменить `.update({ balance })` на `supabase.rpc('earn_points', {...})`
- [ ] `finds.ts` — переписать на `supabase.rpc('record_find', {...})`
- [ ] `premium-trial.ts` — источник истины сделать Supabase, AsyncStorage только кэш
- [ ] `expo-image-manipulator` интеграция для 3 мест аплоада фото
- [ ] Валидация в `register.tsx`: email regex + password ≥ 8 символов + complexity hint

#### День 5: Store compliance
- [ ] `google-services.json` в `.gitignore`, новый ключ через EAS Secrets
- [ ] Прод-ключи RevenueCat через EAS Env Variables
- [ ] `PrivacyInfo.xcprivacy` сгенерировать (или через Expo plugin)
- [ ] Обновить `app.json`: supportURL, privacy URL, terms URL, NSUserTrackingUsageDescription
- [ ] Опубликовать Privacy Policy и Terms на сайте (не только в приложении)
- [ ] `eas.json` — настроить iOS signing через EAS Dashboard

#### День 6-7: RevenueCat webhook
- [ ] Создать Supabase Edge Function `rc-webhook`
- [ ] В RevenueCat Dashboard → Webhooks → добавить URL edge-функции + secret
- [ ] Функция обрабатывает `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION` → апдейт `profiles.is_premium` и `premium_expires_at`
- [ ] Убрать клиентский `.update({ is_premium })` из `purchases.ts:60`

---

### Неделя 2 — Retention + надёжность

#### День 8: Observability
- [ ] Подключить Sentry (`@sentry/react-native`), обернуть `ErrorBoundary`, добавить release tracking
- [ ] В `analytics.ts` добавить недостающие события: `paywall_shown`, `subscription_purchased`, `trial_activated`, `trial_expired`, `daily_challenge_completed`, `achievement_unlocked`, `onboarding_completed`

#### День 9: Push-уведомления
- [ ] Интеграция `expo-notifications` + получение токенов
- [ ] Таблица `push_tokens` в Supabase
- [ ] Supabase Edge Function для отправки (FCM/APNs через Expo Push API)
- [ ] Триггеры: «твой камень нашли ❤️», «daily challenge доступен», «streak рвётся»

#### День 10: Монетизация — быстрые победы
- [ ] `premium-trial.ts:12` — `TRIAL_DURATION_MS` с 24 ч на 7 дней
- [ ] Добавить годовой план в RevenueCat: ~35 €/год (30% скидка)
- [ ] Добавить booster pack: 100 💎 за 0.99 €, 500 💎 за 3.99 €
- [ ] Переделать дизайн `premium.tsx`: social proof («178k+ в FinStones»), FOMO, бенефиты иконками

#### День 11: Критичные баги
- [ ] Пагинация чата (`chat.tsx`): limit 50, подгрузка при скролле
- [ ] Кэш лидерборда (`feed.tsx`): TTL 5 минут по ключу `(kind, period)`
- [ ] 1-часовой лок на новый камень (`stone/[id].tsx` — проверка `stone.createdAt + 1h`)
- [ ] Forgot password flow: экран + `supabase.auth.resetPasswordForEmail()`
- [ ] Убрать `setTimeout(50)` в `modal.tsx:73`
- [ ] Перестать молча `catch (e) { console.warn(e) }` — показывать toast

#### День 12: UX polish
- [ ] Вынести хардкод русского в `i18n.tsx` (проверенные места: `add.tsx:193`, `premium.tsx:71,217`, `settings.tsx:86`)
- [ ] Исправить смену языка без рестарта (context provider в `i18n.tsx`)
- [ ] `expo-haptics` на find/hide/send/like (selection + notificationAsync)
- [ ] Empty states с Stobi-маскотом: пустая карта, пустой чат, нет достижений, нет своих камней
- [ ] Показать «Открыть за 5 💎» на кнопке reveal до нажатия
- [ ] При denied GPS — не молча подгружать Хельсинки, а показать экран «Включи геолокацию» с CTA

#### День 13-14: Accessibility sprint
- [ ] `accessibilityLabel` + `accessibilityRole` на все Touchable и Pressable (пройти 10 экранов)
- [ ] `hitSlop` ≥ 44pt на мелких кнопках (особенно like в чате)
- [ ] Tab icon height 30 → 44 (`(tabs)/_layout.tsx:177`)
- [ ] Проверить контраст WCAG AA на лавандовом фоне и блюр-кнопках
- [ ] `AccessibilityInfo.isReduceMotionEnabled()` — выключать анимации при включённом setting

---

### Неделя 3 — Тесты + полировка + Finnish

#### День 15-16: Jest
- [ ] Установить `jest-preset-expo` + `@testing-library/react-native`
- [ ] **15 unit-тестов:**
  1. `points.ts` — `buyItem` с premium-only + insufficient balance
  2. `points.ts` — race condition earn/spend
  3. `finds.ts` — идемпотентность `markStoneFound`
  4. `finds.ts` — границы суток в local timezone
  5. `moderation.ts` — translit bypass (ы, щ), spaced words, URL detection
  6. `premium-trial.ts` — повторная активация не стэкается
  7. `achievements.ts` — идемпотентность unlock
  8. `daily-challenge.ts` — streak обнуление при пропущенном дне
  9. `location.ts` — haversineDistance Helsinki-Turku ≈ 170 km
  10. `map.tsx` — `fuzzCoords` детерминированный (один stoneId = одно смещение)
  11. `user-stones.ts` — валидация length/XSS в name/description
  12. `points.ts` — `earnPoints` с отрицательным amount не ломает баланс
  13. `chat.ts` — дедупликация по message_id при сетевом retry
  14. `premium-trial.ts` — expiry проверяется против серверного timestamp
  15. `achievements.ts` — каскад unlock при earnPoints не пропускает события

#### День 17: Detox e2e
- [ ] 5 сценариев:
  1. Guest → onboarding → map → видит камни
  2. Register → hide stone → появляется на карте
  3. Find stone в пределах 30 m → +1 💎 + toast
  4. Chat: отправить сообщение → модерация → появляется в списке
  5. Settings → смена языка → UI сразу переключается

#### День 18-19: Design tokens + UI polish
- [ ] `Constants/Spacing.ts`: `{4, 8, 12, 16, 24, 32, 40}`
- [ ] `Constants/Typography.ts`: `headline1/2/3`, `body`, `caption`
- [ ] Заменить магические числа и хардкод hex в `login.tsx`, `register.tsx`, `premium.tsx`, `onboarding.tsx`, `profile.tsx`
- [ ] FontAwesome → Phosphor в `login.tsx:21`, `register.tsx:28`
- [ ] Shimmer в `Skeleton.tsx` через `expo-linear-gradient`
- [ ] Конфетти / bounce-анимация при находке камня

#### День 20: Финский + сидирование
- [ ] Заказать финский перевод `i18n.tsx.fi` (~400 ключей, бюджет 600-1000 €)
- [ ] Добавить `fi` в LANGUAGE_NAMES, проверить автоопределение по locale
- [ ] Договориться с 20-30 бета-тестерами в Хельсинки из FinStones группы
- [ ] Подготовить их аккаунты и попросить спрятать 2-3 камня каждый (≈60 камней в городе = живая карта к запуску)

#### День 21: Ручной QA + TestFlight
- [ ] Пройти вручную 20 edge-case сценариев (полный список в QA-отчёте)
- [ ] `eas build --profile production --platform ios`
- [ ] `eas submit --platform ios`
- [ ] TestFlight invite первым 20 тестерам

---

## 📈 После TestFlight — growth levers (ранжированы по impact × ease)

- [ ] **Push «твой камень нашли»** — главный retention hook
- [ ] **Триал 7 дней** уже сделан в неделе 2 ✅
- [ ] **Leaderboard sharing**: кнопка «Я на #3 в Stobi этой неделе!» → генерация картинки + Instagram Story / WhatsApp
- [ ] **Реферальная ссылка**: друг регается по твоему коду → обоим +100 💎 + эксклюзивная косметика
- [ ] **XP / уровни 1-50** (было в PLAN.md, не сделано) — каждый уровень открывает 1-2 косметики
- [ ] **Сезонные косметики**: 5 лимитированных скинов в месяц, исчезают через 30 дней
- [ ] **Streak multiplier**: 7 дней подряд → 2x 💎 на находках на сутки
- [ ] **Post-find share**: экран «поделиться находкой» с картинкой карты

---

## ⚠️ 5 главных рисков, которые могут убить продукт

1. **Пустая карта вне Хельсинки** — запускайся ТОЛЬКО в Helsinki-metro в первые 3 месяца
2. **Монетизация протекает** — если триал → платный < 3%, нужно переделывать paywall (social proof, FOMO, annual plan)
3. **Нет endgame после 100 находок** — XP + сезоны реализовать в первые 2 месяца после запуска
4. **Модерация коллапсирует с ростом** — admin-панель и auto-ban на 3 репорта, пока пользователей мало
5. **Feature bloat** — не добавляй новые фичи пока D7 retention < 25%

---

## 📊 3 метрики для трекинга с day 1

1. **Trial Funnel**: `trial_activated → paywall_shown → subscription_purchased` — цель 5%+
2. **Engagement Depth**: `app_open / session_length / stones_found / chat_messages` — цель D1 retention 25%+, avg session 5 мин+
3. **Cold Start**: `location_granted → map_opened → stone_tapped → find_success` — цель 40%+ в Хельсинки. Если < 20% — карта пустая, продукт мёртвый.

---

## 📁 Ключевые файлы аудита

Полные отчёты от 5 специалистов лежат в контексте Claude Code (диалог от 2026-04-17):

1. **Senior Dev audit** — security, code quality, architecture
2. **QA audit** — 15 unit-тестов + 20 edge-cases + список untestable code smells
3. **Accessibility audit** — WCAG 2.1 AA findings
4. **DevOps / release** — App Store blockers, secrets management, OTA strategy
5. **Product / Growth** — экономика, retention, monetization, positioning

---

## ✅ Definition of Done для App Store

Приложение готово к публикации если:
- [ ] Все 15 блокеров выше закрыты
- [ ] Sentry собирает события в проде
- [ ] Jest покрытие `lib/*.ts` ≥ 60%
- [ ] 20 manual QA сценариев пройдены на iOS + Android
- [ ] RevenueCat sandbox purchase протестирован на реальном устройстве
- [ ] Privacy Policy и Terms на финском опубликованы
- [ ] 20+ бета-тестеров спрятали камни в Helsinki-metro
- [ ] Push-уведомления работают на обеих платформах
- [ ] TestFlight билд прошёл Apple Review для beta
