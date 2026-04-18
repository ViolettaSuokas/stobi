import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
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

// Init crash reporter как можно раньше — до первого useState/useEffect.
initSentry();

export default function RootLayout() {
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

    // Notification tap → navigate to stone detail + track event
    let cleanup: (() => void) | null = null;
    attachResponseListener((stoneId) => {
      void NotificationOpened('stone_found', stoneId);
      router.push(`/stone/${stoneId}` as any);
    }).then((fn) => { cleanup = fn; });

    // Deep-link handler — stobi://stone/<id> или https://stobi.app/stone/<id>.
    // Парсим URL, если это ссылка на stone — навигируем. Apple/Android
    // вызывают listener когда приложение открывается из универсальной ссылки.
    const handleUrl = (url: string | null) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      // Поддерживаем "stone/ID" и "/stone/ID" в path
      const parts = (parsed.path ?? '').replace(/^\//, '').split('/');
      if (parts[0] === 'stone' && parts[1]) {
        router.push(`/stone/${parts[1]}` as any);
      }
    };
    // Первоначальная ссылка (если app открыт впервые из share)
    Linking.getInitialURL().then(handleUrl);
    // Последующие ссылки (app уже открыт)
    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      cleanup?.();
      linkSub.remove();
    };
  }, []);
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
      </Stack>
    </ModalProvider>
    </I18nProvider>
    </ErrorBoundary>
  );
}
