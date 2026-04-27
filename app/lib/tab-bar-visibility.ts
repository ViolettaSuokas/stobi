// Глобальный flag для скрытия нижнего tab-bar (Карта/Лента/+/Чат/Профиль).
// Нужен когда экран хочет занять весь viewport — например, чат со Stobi
// в режиме разговора на mascot-табе. Использует useSyncExternalStore чтобы
// CustomTabBar перерисовывался при изменении.
import { useSyncExternalStore } from 'react';

let visible = true;
const listeners = new Set<() => void>();

export function setTabBarVisible(v: boolean) {
  if (visible === v) return;
  visible = v;
  listeners.forEach((cb) => cb());
}

export function useTabBarVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => visible,
    () => true,
  );
}
