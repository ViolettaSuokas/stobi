// Простая обёртка над NetInfo — реактивный хук для состояния сети.
//
// Использование:
//   const online = useIsOnline();
//   if (!online) <OfflineBanner />
//
// NetInfo разбирается в интернет-соединении (не просто wi-fi) — через
// API reachability checks. На web в RN-web fallback на navigator.onLine.

import { useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// Debounce перед показом offline-бэннера. NetInfo на iOS периодически
// репортит `isInternetReachable = false` на 1-2 секунды при:
//   - переключении wifi ↔ cellular
//   - возвращении из background
//   - DNS-hiccup'ах / failed reachability ping
// Без debounce юзер видит мигающий красный баннер при норм соединении.
const OFFLINE_BANNER_DELAY_MS = 2000;

function isReallyOnline(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

export function useIsOnline(): boolean {
  // Optimistic default: считаем онлайн пока не пришёл первый событие.
  // Иначе при старте показывался бы offline-баннер на секунду.
  const [online, setOnline] = useState(true);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const apply = (next: boolean) => {
      // Going online — отменяем pending offline-таймер и сразу показываем "online".
      if (next) {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        setOnline(true);
        return;
      }
      // Going offline — выставляем таймер. Если в течение delay'я снова станет
      // online — таймер отменится и баннер не покажется.
      if (offlineTimerRef.current) return; // already pending
      offlineTimerRef.current = setTimeout(() => {
        offlineTimerRef.current = null;
        setOnline(false);
      }, OFFLINE_BANNER_DELAY_MS);
    };

    NetInfo.fetch().then((state) => apply(isReallyOnline(state)));
    const unsub = NetInfo.addEventListener((state) => apply(isReallyOnline(state)));

    return () => {
      unsub();
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };
  }, []);

  return online;
}

/** Одноразовая проверка — для если-offline-не-делай flow */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!state.isConnected && state.isInternetReachable !== false;
}
