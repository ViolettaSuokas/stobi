import { router } from 'expo-router';
import { getCurrentUser } from './auth';
import { AuthGatePrompted } from './analytics';

/**
 * Strict guest gate. Call before any user-action handler.
 *
 * If the user is logged in → returns true, action proceeds.
 * If guest → navigates to the registration screen and returns false.
 *
 * Premium features (extra colors, more stones, artist mode) use a
 * separate premium gate — this one is just for basic auth.
 *
 * Reason передаётся в analytics для понимания какое именно действие
 * конвертирует гостей → зарегистрированных (например: "find stone",
 * "send chat message", "hide stone"). Funnel: auth_gate_prompted →
 * register → auth_gate_converted.
 */
export async function requireAuth(reason?: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (user) return true;

  void AuthGatePrompted(reason ?? 'unknown');
  router.push('/register');
  return false;
}
