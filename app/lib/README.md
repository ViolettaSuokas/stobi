# `lib/` — бизнес-логика и инфраструктура

Всё что не является просто UI: доступ к Supabase, AsyncStorage, расчёты,
провайдеры контекста, моделирование данных.

## Карта файлов

### Платформа / провайдеры
| Файл | Назначение |
|---|---|
| `supabase.ts` | Клиент Supabase (URL, anon key, storage adapter для SSR/web/native) |
| `i18n/` | Папка: провайдер мультиязычности + строки по языкам |
| `modal.tsx` | Глобальные модальные окна (`useModal`) |
| `analytics.ts` | Событийная аналитика (пока в `analytics_events` таблицу) |
| `sentry.ts` | Crash reporting wrapper (no-op если DSN не задан) |
| `cache.ts` | TTL-кэш в памяти для получаемых с сервера данных |
| `haptics.ts` | Тактильный отклик (success/warn/tap и т.д.) |
| `photo.ts` | Ресайз + EXIF strip для фото перед upload |

### Доменные модули (бизнес-логика)
| Файл | Назначение |
|---|---|
| `auth.ts` | Регистрация, вход, Google/Apple Sign-In, demo-аккаунты |
| `auth-gate.ts` | Хелпер `requireAuth()` — если гость, редирект на login |
| `points.ts` | Каталог косметик + RPC-вызовы (earn/spend/buyItem) |
| `finds.ts` | Находки камней через `record_find` RPC + лимиты |
| `user-stones.ts` | CRUD пользовательских камней |
| `user-stone-styles.ts` | Детерминированная генерация формы/цвета камня по id |
| `stone-photos.ts` | Маппинг ключей на bundled фото |
| `achievements.ts` | Ачивки (def + progress + unlock + грант косметик) |
| `daily-challenge.ts` | Ежедневный челлендж + streak |
| `premium-trial.ts` | 7-дневный триал через `activate_trial` RPC |
| `purchases.ts` | RevenueCat SDK wrapper (init / purchase / restore) |
| `location.ts` | GPS + обратный геокодинг + haversine + seeding |
| `activity.ts` | Лента активности (hide / find events) |
| `chat.ts` | Сообщения + пагинация + лайки + репорты |
| `moderation.ts` | Клиентский filter (сервер делает то же в миграции 007) |
| `reveals.ts` | Какие камни уже "раскрыты" юзером за 💎 |

### SQL
| Файл | Назначение |
|---|---|
| `migrations/` | Пронумерованные SQL-миграции (см. свой README) |

## Convention

- Всё асинхронное — `async`/`await`, возвращают Promise
- RPC-first: если есть серверная функция — вызываем её, AsyncStorage только fallback для guest/offline
- Ошибки RPC — логировать через `console.warn`, не глотать молча
- Не импортим UI-компоненты (иначе tree-shake разваливается)

## Добавляя новый модуль

1. Создай `lib/myThing.ts` — pure logic + типы
2. Если модуль дёргает Supabase — используй `isSupabaseConfigured()` + try/catch + local fallback
3. Если новая RPC на сервере — сначала миграция в `migrations/`, потом клиент
4. Тесты — `__tests__/myThing.test.ts` (pure-функции без mock-heavy = приоритет)
