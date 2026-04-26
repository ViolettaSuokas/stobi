import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { View, ActivityIndicator, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { I18nProvider } from '../lib/i18n';
import { ModalProvider } from '../lib/modal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { OfflineBanner } from '../components/OfflineBanner';
import { initPurchases } from '../lib/purchases';
import { getCurrentUser } from '../lib/auth';
import { initSentry, identifySentryUser } from '../lib/sentry';
import { registerPushToken, attachResponseListener } from '../lib/push';
import { AppOpened, NotificationOpened } from '../lib/analytics';
import { savePendingReferralCode } from '../lib/referral';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Init crash reporter как можно раньше — до первого useState/useEffect.
initSentry();

/**
 * Eager update check — запрашиваем новый bundle сразу на старте.
 * Если есть → качаем + reload. Если нет → пропускаем мгновенно.
 *
 * Без этого юзер видит обновление только на 2-м cold start (default
 * expo-updates flow: bundle качается фоном, применяется на следующий запуск).
 * С этим: один cold start = свежий код.
 *
 * Ограничения:
 *   - В __DEV__ не работает (Updates disabled в Metro-режиме)
 *   - 5 сек timeout чтобы не висеть на плохой сети
 *   - На ошибке сети — fallback на embedded (норма)
 */
async function checkForEagerUpdate(): Promise<boolean> {
  if (__DEV__) return false;
  try {
    const check = await Promise.race([
      Updates.checkForUpdateAsync(),
      new Promise<{ isAvailable: false }>((resolve) =>
        setTimeout(() => resolve({ isAvailable: false }), 5000),
      ),
    ]);
    if (!check.isAvailable) return false;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return true; // never reached — reloadAsync replaces JS context
  } catch (e) {
    console.warn('eager update check failed', e);
    return false;
  }
}

export default function RootLayout() {
  const [updateChecking, setUpdateChecking] = useState(true);

  useEffect(() => {
    // Eager check — если есть новое OTA, скачиваем и рестартим прямо сейчас.
    // На обычном cold start (нет update) — занимает ~50ms, юзер не замечает.
    void checkForEagerUpdate().finally(() => setUpdateChecking(false));
  }, []);

  useEffect(() => {
    // Session open event — одна точка входа, трекается всегда.
    void AppOpened();

    // Параллельно: auth + purchases + push. Cold start не ждёт финиша.
    Promise.allSettled([
      getCurrentUser().then((u) => {
        if (u) {
          identifySentryUser({ id: u.id, email: u.email });
          // Push registration — async, не блокирует auth flow.
          void registerPushToken(u.id);
          return initPurchases(u.id);
        }
      }),
    ]).catch(() => {});

    // Auth state listener — перерегистрируем push-токен после SIGNED_IN,
    // иначе первый логин в сессии не получает токен до cold-restart.
    // Guard inside registerPushToken проверит session/userId match.
    const authSub = isSupabaseConfigured()
      ? supabase.auth.onAuthStateChange((event, session) => {
          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
            void registerPushToken(session.user.id);
          }
          // Session revoked or refresh failed — bounce user to login so they
          // don't sit on an authed screen issuing 401s to every RPC.
          if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
            router.replace('/login' as any);
          }
        })
      : null;

    // Notification tap → navigate to stone detail / DM thread + track event
    let cleanup: (() => void) | null = null;
    attachResponseListener((payload) => {
      if (payload.type === 'stone') {
        void NotificationOpened('stone_found', payload.stoneId);
        router.push(`/stone/${payload.stoneId}` as any);
      } else if (payload.type === 'dm') {
        void NotificationOpened('dm', payload.conversationId);
        router.push(`/dm/${payload.conversationId}` as any);
      }
    }).then((fn) => { cleanup = fn; });

    // Deep-link handler — stobi://stone/<id> или https://stobi.app/stone/<id>.
    // Парсим URL, если это ссылка на stone — навигируем. Apple/Android
    // вызывают listener когда приложение открывается из универсальной ссылки.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SAFE_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
    const handleUrl = (url: string | null) => {
      if (!url || typeof url !== 'string') return;
      let parsed: ReturnType<typeof Linking.parse>;
      try {
        parsed = Linking.parse(url);
      } catch (e) {
        console.warn('deep link parse failed', e);
        return;
      }
      const parts = (parsed.path ?? '').replace(/^\//, '').split('/');
      // stone/ID — open detail only if ID is a valid UUID.
      if (parts[0] === 'stone' && parts[1] && UUID_RE.test(parts[1])) {
        router.push(`/stone/${parts[1]}` as any);
      }
      // invite/CODE — save pending code only if sanitized.
      if (parts[0] === 'invite' && parts[1] && SAFE_CODE_RE.test(parts[1])) {
        void savePendingReferralCode(parts[1]);
      }
    };
    // Первоначальная ссылка (если app открыт впервые из share)
    Linking.getInitialURL().then(handleUrl);
    // Последующие ссылки (app уже открыт)
    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      cleanup?.();
      linkSub.remove();
      authSub?.data.subscription.unsubscribe();
    };
  }, []);

  // Splash-замена пока eager update check работает. Покажется только
  // если реально качается update (5 сек max), на обычном старте
  // мелькнёт на ~50ms и сразу пропадёт.
  if (updateChecking) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAFAF8', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <ActivityIndicator size="large" color="#5B4FF0" />
        <Text style={{ fontSize: 13, color: '#9B9BAB' }}>Stobi</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
    <I18nProvider>
    <ModalProvider>
      <StatusBar style="dark" />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="feedback" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="stone/[id]"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="premium"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="privacy"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="terms"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="find-anywhere"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="scan-stone"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="pending-approvals"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="diamond-history"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="community-rules"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="user/[id]"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="dm/[id]"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
      </Stack>
    </ModalProvider>
    </I18nProvider>
    </ErrorBoundary>
  );
}
