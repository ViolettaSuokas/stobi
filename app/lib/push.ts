// Push-уведомления Stobi.
//
// Flow:
//   1. При логине — request permission (async, не блокирует UI)
//   2. Если granted — получить Expo Push Token
//   3. Сохранить в `push_tokens` таблицу Supabase под user.id
//   4. Навигация по тапу (stone_id в data.data → /stone/[id])
//
// Отправка уведомлений: сервер-side. Триггер `on_find_notify_author`
// (migration 010) добавляет в `push_queue`, Edge Function `send-push`
// разгребает и отправляет через Expo Push API.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, isSupabaseConfigured } from './supabase';

let Notifications: any = null;
let Device: any = null;

async function ensureLoaded(): Promise<boolean> {
  if (Notifications && Device) return true;
  try {
    Notifications = await import('expo-notifications');
    Device = await import('expo-device');

    // Конфигурация default-поведения: показывать notification даже если app open
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        // iOS 14+ в foreground
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    return true;
  } catch (e) {
    console.warn('expo-notifications not available', e);
    return false;
  }
}

/** Запросить разрешение + зарегистрировать токен на сервере. Idempotent. */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!(await ensureLoaded())) return null;
  if (!Device.isDevice) {
    // Симулятор iOS / эмулятор не получают push
    console.info('push: skipping on simulator');
    return null;
  }

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const { status: asked } = await Notifications.requestPermissionsAsync();
      status = asked;
    }
    if (status !== 'granted') {
      console.info('push: permission denied');
      return null;
    }

    // Android — отдельный канал (required)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Stobi',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#5B4FF0',
      });
    }

    // projectId нужен для нового Expo Push (SDK 50+)
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenRes?.data;
    if (!token || typeof token !== 'string') return null;

    // Upsert в push_tokens
    if (isSupabaseConfigured()) {
      const platform = Platform.OS === 'ios' ? 'ios'
        : Platform.OS === 'android' ? 'android'
        : 'web';
      const { error } = await supabase
        .from('push_tokens')
        .upsert(
          { user_id: userId, token, platform, last_used_at: new Date().toISOString() },
          { onConflict: 'user_id,token' }
        );
      if (error) console.warn('push_tokens upsert error', error.message);
    }

    return token;
  } catch (e) {
    console.warn('registerPushToken failed', e);
    return null;
  }
}

/** Listener для нажатия на notification — редирект в соответствующий экран.
 *  Вызвать один раз в _layout.tsx, возвращает cleanup-функцию. */
export async function attachResponseListener(
  onStone: (stoneId: string) => void,
): Promise<() => void> {
  if (!(await ensureLoaded())) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
    const data = response?.notification?.request?.content?.data;
    if (data?.type === 'stone_found' && typeof data.stone_id === 'string') {
      onStone(data.stone_id);
    }
  });
  return () => sub.remove();
}

/** Опционально: удалить токен при логауте (чтобы юзер не получал пуши после выхода) */
export async function unregisterPushToken(userId: string): Promise<void> {
  if (!(await ensureLoaded())) return;
  if (!isSupabaseConfigured()) return;
  try {
    const tokenRes = await Notifications.getExpoPushTokenAsync({
      projectId:
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId,
    });
    const token = tokenRes?.data;
    if (!token) return;
    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  } catch (e) {
    console.warn('unregisterPushToken failed', e);
  }
}
