import { router } from 'expo-router';
import { getCurrentUser } from './auth';

/**
 * Strict guest gate. Call before any user-action handler.
 *
 * If the user is logged in → returns true, action proceeds.
 * If guest → navigates to the registration screen and returns false.
 *
 * Premium features (extra colors, more stones, artist mode) use a
 * separate premium gate — this one is just for basic auth.
 */
export async function requireAuth(_reason?: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (user) return true;

  router.push('/register');
  return false;
}
