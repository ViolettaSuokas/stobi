# Stobi — TODO

## Перед публикацией в App Store (обязательно)

- [ ] **App Store Connect metadata** — описание, ключевые слова, категория, возрастной рейтинг
- [ ] **Скриншоты** — 5 скриншотов iPhone (6.5" + 5.5"), карта/чат/профиль/камень/онбординг
- [ ] **URL поддержки** — email или сайт для обратной связи
- [ ] **Иконка 1024x1024** — для App Store (проверить что текущая подходит)
- [ ] **RevenueCat Offerings metadata** — Display Name + Description в offerings
- [ ] **Первый билд в TestFlight** — загрузить через EAS Submit
- [ ] **Sandbox-тест подписки** — проверить покупку Stobi Pro Monthly ($3.99)
- [ ] **Privacy Policy / Terms** — перевести на финский (сейчас только английский)

## Улучшения (после запуска)

- [ ] **Server-side rate limiting** — анти-чит (2 камня/автор/день) перенести с клиента на Supabase trigger
- [ ] **Unit-тесты** — Jest: points calculation, GPS distance, moderation filter, achievements
- [ ] **E2E тесты** — Detox: login → map → find stone → chat → profile
- [ ] **Crash reporting** — подключить Sentry или Firebase Crashlytics
- [ ] **Offline-режим** — баннер «Нет сети», кеш камней/сообщений
- [ ] **Dark theme** — переключатель в настройках
- [ ] **Push-уведомления** — новые сообщения в чате, камень найден
- [ ] **Forgot password** — экран сброса пароля
- [ ] **Google Play публикация** — Android metadata + Google Play Console

## Идеи на будущее

- [ ] Друзья / подписки на авторов
- [ ] Избранные камни / wishlist
- [ ] Фильтры на карте (по городу, по автору, по расстоянию)
- [ ] Голосовые сообщения в чате
- [ ] Стикеры / реакции на сообщения
- [ ] Сезонные ивенты (Рождество, Юханнус)
- [ ] AR-камера для поиска камней
