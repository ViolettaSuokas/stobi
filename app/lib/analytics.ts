import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Track an analytics event. Silently fails if Supabase is not configured.
 *
 * Events: app_open, register, login, logout, subscribe, unsubscribe,
 * stone_hide, stone_find, chat_message, achievement_unlock, premium_prompt
 */
export async function trackEvent(
  event: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from('analytics_events').insert({
      event,
      user_id: data?.user?.id ?? null,
      metadata: metadata ?? {},
    });
  } catch {
    // Analytics should never crash the app
  }
}
