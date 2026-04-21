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
import { savePendingReferralCode } from '../lib/referral';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

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

    // Auth state listener — перерегистрируем push-токен после SIGNED_IN,
    // иначе первый логин в сессии не получает токен до cold-restart.
    // Guard inside registerPushToken проверит session/userId match.
    const authSub = isSupabaseConfigured()
      ? supabase.auth.onAuthStateChange((event, session) => {
          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
            void registerPushToken(session.user.id);
          }
        })
      : null;

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
      const parts = (parsed.path ?? '').replace(/^\//, '').split('/');
      // stone/ID — открываем детейл
      if (parts[0] === 'stone' && parts[1]) {
        router.push(`/stone/${parts[1]}` as any);
      }
      // invite/CODE — сохраняем pending код, применим после регистрации
      if (parts[0] === 'invite' && parts[1]) {
        void savePendingReferralCode(parts[1]);
        // Если юзер залогинен — мы не применяем здесь, так как
        // redeem_referral_code нужно вызвать руками (может не пройти
        // из-за already_redeemed). Покажем diff на профиле — потом.
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
      </Stack>
    </ModalProvider>
    </I18nProvider>
    </ErrorBoundary>
  );
}
