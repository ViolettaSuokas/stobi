# `components/` — переиспользуемые UI-компоненты

Здесь лежат **чисто визуальные** элементы, которые можно вставить на любой экран.

## Convention

- Один компонент = один файл `PascalCase.tsx`
- Без бизнес-логики (без Supabase вызовов, без AsyncStorage, без React-навигации)
- Данные — через props, не через хуки
- Стили — `StyleSheet` внутри файла; цвета/отступы/типографика из `constants/`

## Что здесь сейчас

| Файл | Что это |
|---|---|
| `StoneMascot.tsx` | Главный маскот — кастомный SVG-камень (лицо + форма + декор) |
| `ErrorBoundary.tsx` | React Error Boundary → Sentry + fallback экран |
| `Skeleton.tsx` | Shimmer-скелетон + `SkeletonRow` для списков |
| `EmptyState.tsx` | Пустое состояние (мескот + title + subtitle + CTA) |

## Что НЕ кладём сюда

- Screens → `app/` (expo-router routes)
- Провайдеры контекста с логикой → `lib/` (например `lib/modal.tsx`)
- Константы дизайна → `constants/`
- Иконки — они из `phosphor-react-native`, не надо импортить отдельно

## Добавляя новый компонент

1. Создай `components/MyThing.tsx` с `export function MyThing(props) { ... }`
2. Props должны быть типизированы (`type Props = { ... }`)
3. Все текстовые строки — через `useI18n().t('key')`, не хардкод
4. `accessibilityLabel` / `accessibilityRole` обязательны на интерактивах
