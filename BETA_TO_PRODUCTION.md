# Stobi — Beta → Production: руководство

> Всё про тестирование, TestFlight/Play Console, OTA-обновления и переход beta-тестеров в полноценных юзеров.
> Обновлено: 2026-04-21.

---

## 1. Куда загружать билды для тестов

### 🍎 iOS — TestFlight
**Это** путь для iOS.
- Сборка через EAS → загружается в **App Store Connect → TestFlight**
- Тестеры получают **приглашение по ссылке/email**
- Ставят бесплатный app "TestFlight" из App Store → через него Stobi
- **Всё работает как в проде:** Apple Sign-In, push, IAP (в sandbox), AI-сканер, модерация
- Лимит: 10 000 external testers через TestFlight link

### 🤖 Android — два варианта
**Вариант A (проще):** APK напрямую
- `npx eas-cli build --platform android --profile preview` → public .apk ссылка
- Шлёшь тестерам → они ставят (разрешить "Unknown sources")
- Без аккаунтов, без лимитов на устройства
- **Минус:** каждое обновление = новый APK вручную (или OTA)

**Вариант B (стандарт):** Google Play Internal Testing
- Нужен **Google Play Console** ($25 разово)
- AAB сборка → upload → добавить email тестеров → они opt-in по ссылке
- Auto-update через Play Store, стандартный trust

**Рекомендация:** до 20 тестеров → APK. Больше — Play Console.

---

## 2. Команды деплоя

### Собрать билды для обеих платформ
```bash
cd /Users/violettasuokas/stobi-1/app
npx eas-cli build --platform all --profile preview
```
~15-20 мин. Получишь **iOS TestFlight build** + **Android APK ссылку**.

### Отправить iOS в TestFlight
```bash
npx eas-cli submit --platform ios --latest
```

### OTA-обновления (95% изменений)
```bash
npx eas-cli update --branch preview --message "Фикс языка"
```
**30 секунд** → все тестеры получают обновление при следующем открытии app.

### Когда нужен НОВЫЙ билд (не OTA)
Только если меняется:
- Native permissions в app.json
- Bundle ID, иконка, splash screen
- Новая native-зависимость (expo-camera, новый SDK)
- Expo SDK upgrade

Для этих случаев → `eas build` + `eas submit` (20 мин).

---

## 3. Workflow правок

| Что изменила | Действие | Время |
|---|---|---|
| Текст / цвет / логика | `eas update --branch preview` | 30 сек |
| Новый экран | `eas update --branch preview` | 30 сек |
| Supabase миграция | `supabase db push` | 30 сек |
| Edge Function | `supabase functions deploy <name>` | 20 сек |
| Permission / icon / native dep | `eas build` + `eas submit` | 20 мин |

---

## 4. Переход beta → production (ключевая часть)

### Главное правило
**Один Supabase проект для test и prod.** Не создавай staging.

Тестовые юзеры → автоматически становятся **день-1 юзерами** после Launch.

### Что переходит из TestFlight в App Store
- ✅ Аккаунты тестеров (Apple / email / Google)
- ✅ Их камни на карте
- ✅ Найденные камни (finds history)
- ✅ Баланс алмазиков
- ✅ Аватар, косметика, equipped items
- ✅ Сообщения в чате
- ✅ Referral-коды
- ✅ AI-embeddings камней (adaptive learning сохраняется)

### Технический механизм
TestFlight не отдельная среда — это **pre-release channel** того же Apple Developer аккаунта. При Release:
1. Ты жмёшь "Release This Version" в App Store Connect
2. Apple публикует build в App Store
3. Тестеры на TestFlight-версии → Apple **автоматически обновляет** их до публичной версии
4. Данные сохраняются (тот же bundle ID + тот же Apple ID)

### Аналогично для Android
Internal Testing → Production track в Play Console. Auto-promote.

---

## 5. Считаются ли тестеры в App Store downloads?

### До launch (TestFlight фаза)
**❌ НЕТ** — публично в App Store ничего не видно (app не опубликован).
Видишь их только в **App Store Connect → TestFlight** dashboard.

### После launch
**✅ ДА** — тестеры становятся настоящими download'ами:
- В первые дни после Launch счётчик покажет ~20-30 installs сразу
- Это засчитывается в **App Store Analytics**:
  - Total Downloads
  - First-Time Downloads (per Apple ID)
  - Active Devices (30 days)
  - Sessions per Active Device
  - Retention

### Почему это полезно
- Apple ранжирует new apps с early traction **выше**
- Day-1 retention ≥ 80% (тестеры уже вовлечены)
- Первые positive ratings в 24 часа после Launch = massive SEO-boost

---

## 6. Cleanup перед submit в App Store

### В идеале — не чистить
Реальный контент от тестеров = ценность для новых юзеров:
- Живые камни на карте → cold-start проблема решена
- Чат не пустой → app не выглядит мёртвым
- Лидерборд живой

### Если есть явный мусор
В Supabase SQL Editor:
```sql
-- Удалить явно спамные/тестовые сообщения
delete from messages where text ilike '%тест%' or text ilike '%test%';

-- Удалить камни без embedding + без find'ов (никто не нашёл)
delete from stones
where embedding is null
  and id not in (select stone_id from finds)
  and created_at < '2026-04-21';  -- только старые seed

-- Обнулить админский balance если нагрели тестами
update profiles set balance = 20 where email = 'violettasuokas@gmail.com';
```

**НЕ ТРОГАЙ:**
- profiles (аккаунты тестеров — они реальные юзеры)
- finds (их история находок)
- real user-created stones с embedding'ами

---

## 7. Stoimость

| Платформа | Разово | Месячно |
|---|---|---|
| Apple Developer | ✅ есть | $99/год |
| Google Play Console | $25 разово | $0 |
| EAS Build (облако) | $0 | 30 бесплатных билдов/мес |
| Expo Updates (OTA) | $0 | до 1000 MAU бесплатно |
| Supabase (Free) | $0 | $0 — пауза после 7 дней неактивности |
| Supabase Pro (рекомендую перед launch) | $0 | $25/мес |
| Replicate CLIP (AI сканер) | $0 | pay-as-you-go, ~$2 на 1000 MAU |
| AWS Rekognition (NSFW) | $0 | free tier 5k/мес, ~$5 после |

**Текущий месячный cost для 30 тестеров:** $0 (всё в free tier)
**После launch на 1000 MAU:** ~$30/мес

---

## 8. Launch day checklist

За 1 день до релиза:
- [ ] RevenueCat прод-ключи в EAS env
- [ ] Sentry DSN настроен
- [ ] AWS Rekognition настроен (NSFW)
- [ ] Firebase API key ротирован
- [ ] Домен stobi.app + Privacy/Terms/Support задеплоены
- [ ] Финский перевод native-speaker QA
- [ ] App Store metadata (описание, keywords, категория)
- [ ] Screenshots iPhone 6.5" (5 штук)
- [ ] Privacy nutrition label заполнен
- [ ] Support URL + Privacy Policy URL + Terms URL

Day 0:
- [ ] Submit for Review в App Store Connect
- [ ] Submit в Google Play Console
- [ ] Apple Review ~1-3 дня
- [ ] По approval: "Release This Version"
- [ ] Попроси первых 20 тестеров оставить **отзыв в App Store в первые 24 часа** — важно для ранжирования

После Launch:
- [ ] Мониторинг App Store Connect Analytics (download spike от бета → prod)
- [ ] Проверка Sentry на crash spikes
- [ ] Sales/subscriptions dashboard в RevenueCat
- [ ] Supabase dashboard — DB usage, API quota

---

## 9. Как напомнить мне об этом в другой сессии

Скажи мне: "открой **BETA_TO_PRODUCTION.md** в /Users/violettasuokas/stobi-1/" — я прочитаю и продолжу.

Также этот документ индексирован в `/Users/violettasuokas/.claude/projects/-Users-violettasuokas-stobi-1/memory/` для авто-подгрузки в будущих сессиях.
