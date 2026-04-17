import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nProvider } from '../lib/i18n';
import { ModalProvider } from '../lib/modal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { initPurchases } from '../lib/purchases';
import { getCurrentUser } from '../lib/auth';
import { initSentry, identifySentryUser } from '../lib/sentry';

// Init crash reporter как можно раньше — до первого useState/useEffect.
initSentry();

export default function RootLayout() {
  useEffect(() => {
    // Параллельно: auth + purchases. Раньше было последовательно — +1-2s на cold start.
    Promise.allSettled([
      getCurrentUser().then((u) => {
        if (u) {
          identifySentryUser({ id: u.id, email: u.email });
          return initPurchases(u.id);
        }
      }),
    ]).catch(() => {});
  }, []);
  return (
    <ErrorBoundary>
    <I18nProvider>
    <ModalProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
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
