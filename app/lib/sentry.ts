import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

// Sentry для Stobi.
//
// DSN берём из expo-constants extra.sentryDsn — задаётся через
// EAS Env Variables или напрямую в app.json.extra.sentryDsn.
// Если DSN пуст — инициализация no-op, ничего не ломается локально.
//
// После настройки проекта в Sentry:
//   1. Создать проект React Native на sentry.io
//   2. Скопировать DSN (вида https://xxx@sentry.io/yyy)
//   3. eas env:create production SENTRY_DSN=https://...
//      или добавить в app.json: "extra": { "sentryDsn": "..." }

const extra = (Constants.expoConfig?.extra ?? {}) as {
  sentryDsn?: string;
  SENTRY_DSN?: string;
};
const DSN = extra.sentryDsn ?? extra.SENTRY_DSN ?? process.env.SENTRY_DSN ?? '';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN || !DSN.startsWith('https://')) {
    if (__DEV__) {
      console.info('[Sentry] DSN не настроен, событий не будет. Задай extra.sentryDsn в app.json.');
    }
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      // Production-ready defaults. Уточняй по мере роста:
      tracesSampleRate: __DEV__ ? 0 : 0.2,
      environment: __DEV__ ? 'development' : 'production',
      release: Constants.expoConfig?.version ?? '1.0.0',
      // В dev-сессиях шлём 0 событий — иначе шум при работе над приложением.
      enabled: !__DEV__,
      beforeBreadcrumb(breadcrumb) {
        // Отфильтровать чувствительные данные
        if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
          // Снести query-params с потенциальными токенами
          if (breadcrumb.data?.url) {
            breadcrumb.data.url = String(breadcrumb.data.url).split('?')[0];
          }
        }
        return breadcrumb;
      },
    });
    initialized = true;
  } catch (e) {
    console.warn('[Sentry] init failed', e);
  }
}

/** Привязать пользователя к последующим событиям. Вызывать после login. */
export function identifySentryUser(user: { id: string; email?: string } | null): void {
  if (!initialized) return;
  try {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email });
    } else {
      Sentry.setUser(null);
    }
  } catch {
    // no-op
  }
}

/** Залогировать исключение с доп. контекстом. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    if (__DEV__) console.error('[ex]', error, context);
    return;
  }
  try {
    Sentry.withScope((scope) => {
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          scope.setExtra(key, value);
        }
      }
      Sentry.captureException(error);
    });
  } catch {
    // no-op
  }
}

/** Информационное сообщение. */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!initialized) return;
  try {
    Sentry.captureMessage(message, level);
  } catch {
    // no-op
  }
}
