// Лёгкая обёртка над expo-haptics.
//
// Зачем обёртка:
//   - Централизованные "события" (found/hide/send/like) — проще переиначить
//     паттерн один раз для всего приложения.
//   - Silent fallback на Web и в Expo Go если модуль недоступен.
//   - Уважает системную настройку «Reduce Motion / Haptics».
//
// Вызов синхронный с точки зрения UX (await не нужен), но функции
// возвращают Promise — при желании можно awaited.

import { Platform, AccessibilityInfo } from 'react-native';

let Haptics: typeof import('expo-haptics') | null = null;
let reduceMotion = false;

async function init(): Promise<void> {
  if (Haptics !== null) return;
  try {
    Haptics = await import('expo-haptics');
  } catch {
    // not available (e.g. web)
  }
  try {
    reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
    AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotion = enabled;
    });
  } catch {
    reduceMotion = false;
  }
}

// Initialize lazily on first call — cheap and safe.
void init();

function disabled(): boolean {
  return Platform.OS === 'web' || reduceMotion || !Haptics;
}

/** Light tap — для отправки сообщения, like, переключения таба. */
export async function tap(): Promise<void> {
  if (disabled() || !Haptics) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // no-op
  }
}

/** Medium impact — для найденного/спрятанного камня, покупки. */
export async function success(): Promise<void> {
  if (disabled() || !Haptics) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no-op
  }
}

/** Warning — лимит rate, не прошла модерация. */
export async function warn(): Promise<void> {
  if (disabled() || !Haptics) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // no-op
  }
}

/** Error — неудачная покупка, RPC reject. */
export async function error(): Promise<void> {
  if (disabled() || !Haptics) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // no-op
  }
}

/** Selection change — выбор элемента в списке, скролл к снап-поинту. */
export async function selection(): Promise<void> {
  if (disabled() || !Haptics) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // no-op
  }
}
