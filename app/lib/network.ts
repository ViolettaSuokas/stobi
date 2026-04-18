// Простая обёртка над NetInfo — реактивный хук для состояния сети.
//
// Использование:
//   const online = useIsOnline();
//   if (!online) <OfflineBanner />
//
// NetInfo разбирается в интернет-соединении (не просто wi-fi) — через
// API reachability checks. На web в RN-web fallback на navigator.onLine.

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useIsOnline(): boolean {
  // Optimistic default: считаем онлайн пока не пришёл первый событие.
  // Иначе при старте показывался бы offline-баннер на секунду.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Первичный snapshot
    NetInfo.fetch().then((state) => {
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    // Подписка на изменения
    const unsub = NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    return unsub;
  }, []);

  return online;
}

/** Одноразовая проверка — для если-offline-не-делай flow */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!state.isConnected && state.isInternetReachable !== false;
}
