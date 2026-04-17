# Stobi

Geo-social app про поиск и пряток раскрашенных камней. Финляндия, 178k Facebook-аудитория. React Native + Expo + Supabase + RevenueCat.

## Быстрый старт

```bash
cd app
npm install --legacy-peer-deps
npm start           # Expo Go или dev-client
npm test            # Jest unit-тесты (44 пока)
```

Для реальных сборок:
```bash
cd app
npx eas-cli login
npx eas-cli build --platform all --profile preview
```

## Репозиторий

```
finstones/
├── app/                 ← Expo приложение (всё что ниже — под app/)
│   ├── app/             ← expo-router screens (routes)
│   │   ├── _layout.tsx  ← root layout + providers
│   │   ├── index.tsx    ← splash / initial route
│   │   ├── (tabs)/      ← bottom-tab routes (map/feed/add/chat/profile)
│   │   ├── stone/[id]   ← stone detail modal
│   │   ├── login.tsx, register.tsx, forgot-password.tsx
│   │   ├── premium.tsx, settings.tsx, privacy.tsx, terms.tsx
│   │   └── onboarding.tsx
│   ├── components/      ← переиспользуемые UI (см. components/README.md)
│   ├── constants/       ← дизайн-токены (Colors, Spacing, Typography)
│   ├── lib/             ← бизнес-логика, провайдеры, SQL-миграции
│   │   ├── i18n/        ← мультиязычность (ru/fi/en)
│   │   └── migrations/  ← пронумерованные SQL-миграции Supabase
│   ├── __tests__/       ← Jest unit-тесты
│   ├── assets/          ← картинки, иконки
│   ├── app.json         ← Expo config (Privacy Manifest, plugins)
│   ├── eas.json         ← EAS build profiles
│   └── package.json
├── prototype/           ← старый HTML-прототип (historical reference only)
├── AUDIT_PLAN.md        ← трёхнедельный план после аудита 5 спецов
├── CONCEPT.md           ← продуктовая концепция
├── PLAN.md              ← оригинальный план разработки
├── TODO.md              ← быстрый лист «что делать»
└── README.md            ← (этот файл)
```

## Архитектура в 30 секунд

- **Frontend**: React Native 0.81 + React 19 + Expo SDK 54 + expo-router
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions)
- **Payments**: RevenueCat → Edge Function webhook → `profiles.is_premium`
- **Экономика**: все `💎` начисления и списания через Postgres RPCs (`SECURITY DEFINER`). Клиент не пишет `balance` / `is_premium` напрямую.
- **Антифрод** на трёх уровнях: client UI gates → server RLS triggers → server RPC business rules.

## Гайды по папкам

Каждая папка имеет свой `README.md`:
- [`app/components/README.md`](app/components/README.md) — переиспользуемые UI-компоненты
- [`app/constants/README.md`](app/constants/README.md) — дизайн-токены
- [`app/lib/README.md`](app/lib/README.md) — бизнес-логика и провайдеры
- [`app/lib/migrations/README.md`](app/lib/migrations/README.md) — порядок SQL-миграций

## Стек и зависимости

| Слой | Технология |
|---|---|
| UI | React Native + Expo + `phosphor-react-native` для иконок |
| Routing | `expo-router` (file-based) |
| State | React context (i18n, modal) + AsyncStorage для persist |
| Backend | Supabase (JS SDK + Management API для ops) |
| Auth | Supabase Auth + `@react-native-google-signin` + `expo-apple-authentication` |
| IAP | `react-native-purchases` (RevenueCat) |
| Maps | Leaflet в WebView (`react-native-webview`) — легковесно, oфлайна нет |
| Storage | `expo-secure-store` (auth session) + `AsyncStorage` (кэш + локалка) |
| Observability | Sentry (через `@sentry/react-native`) |
| Tests | Jest + `jest-expo` |

## Окружения и секреты

- `EXPO_TOKEN` — для CI/CD сборок
- `RC_IOS_KEY` / `RC_ANDROID_KEY` — RevenueCat, через `eas env:create production ...`
- `SENTRY_DSN` — через то же
- Supabase URL / anon key — хардкод в `lib/supabase.ts` (публичные, OK)
- Supabase `service_role` — только в Edge Function, никогда в клиенте
- `RC_WEBHOOK_SECRET` — в Supabase Secrets, shared с RC Dashboard

Все чувствительные ключи (прод RC, Sentry) уехали в EAS Env Variables — не коммитятся в репозиторий.

## Дальнейшие шаги

См. [`AUDIT_PLAN.md`](AUDIT_PLAN.md) — состояние 13/15 блокеров закрыто, до App Store осталось:
1. App Store Connect metadata + скриншоты
2. Финский перевод строк i18n
3. Прод-ключи RevenueCat
4. Домен + Privacy Policy / Terms hosting

## Лицензия

Проприетарное приложение. © Violetta Suokas, 2026.
