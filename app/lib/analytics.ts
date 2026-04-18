import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Analytics — событийный лог в Supabase `analytics_events` таблицу.
 *
 * Server-side уже работает. Здесь — типизированные helper-ы чтобы
 * не опечататься в строковых именах событий и передавать правильный
 * shape метаданных.
 *
 * ## 3 Day-1 метрики из product-аудита (должны трекаться обязательно):
 *
 * 1. **Trial Funnel** — `paywall_shown` → `trial_activated` →
 *    `subscription_purchased`. Цель: 5%+ конверсии.
 * 2. **Engagement Depth** — `app_open` + `session_end` + `stone_find`
 *    + `stone_hide` + `chat_sent`. Цель: D1 retention 25%+.
 * 3. **Cold Start** — `location_granted` → `map_opened` →
 *    `stone_tapped` → `stone_find` (success). Цель: 40%+ в Хельсинки.
 *
 * Как анализировать: открой Supabase SQL Editor →
 *   select event, count(*) from analytics_events
 *   where created_at > now() - interval '7 days'
 *   group by event order by count desc;
 *
 * Для настоящих дашбордов (DAU/retention/funnels) — интегрируй
 * Amplitude/Mixpanel/PostHog когда будет время. Структура событий
 * уже подходит для экспорта в любой из них.
 */

// ─────────────────────────────────────────────
// Low-level writer. Silent, never throws.
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Typed helpers — используй вместо trackEvent(raw_string, ...)
// Добавляя новое событие — заведи helper тут. Это единый catalog.
// ─────────────────────────────────────────────

// Lifecycle
export const AppOpened = () => trackEvent('app_open');
export const OnboardingCompleted = () => trackEvent('onboarding_completed');

// Auth
export const Registered = (source: 'email' | 'google' | 'apple') =>
  trackEvent('register', { source });
export const LoggedIn = (source: 'email' | 'google' | 'apple' | 'demo') =>
  trackEvent('login', { source });
export const LoggedOut = () => trackEvent('logout');
export const AccountDeleted = () => trackEvent('account_deleted');
export const PasswordResetRequested = (email: string) =>
  trackEvent('password_reset_requested', { email });

// Core loop — stone find/hide
export const StoneTapped = (stoneId: string, distanceM?: number) =>
  trackEvent('stone_tapped', { stone_id: stoneId, distance_m: distanceM });
export const StoneFindAttempted = (stoneId: string) =>
  trackEvent('stone_find_attempted', { stone_id: stoneId });
export const StoneFindFailed = (stoneId: string, reason: string) =>
  trackEvent('stone_find_failed', { stone_id: stoneId, reason });
export const StoneFound = (stoneId: string, reward: number) =>
  trackEvent('stone_find', { stone_id: stoneId, reward });
export const StoneHidden = (stoneId: string) =>
  trackEvent('stone_hide', { stone_id: stoneId });
export const StoneDeleted = (stoneId: string) =>
  trackEvent('stone_deleted', { stone_id: stoneId });
export const StoneRevealed = (stoneId: string, cost: number) =>
  trackEvent('stone_revealed', { stone_id: stoneId, cost });

// Location / Map
export const LocationGranted = () => trackEvent('location_granted');
export const LocationDenied = () => trackEvent('location_denied');
export const MapOpened = (filter?: string) =>
  trackEvent('map_opened', { filter });
export const MapFilterChanged = (filter: string) =>
  trackEvent('map_filter_changed', { filter });

// Chat
export const ChatMessageSent = (channel: string, hasPhoto: boolean) =>
  trackEvent('chat_sent', { channel, has_photo: hasPhoto });
export const ChatMessageReported = (messageId: string, authorId: string) =>
  trackEvent('report_message', { message_id: messageId, author_id: authorId });
export const ChatLiked = (messageId: string) =>
  trackEvent('chat_liked', { message_id: messageId });

// Monetization — Premium
export const PaywallShown = (source: 'profile' | 'premium_cosmetic' | 'stone_reveal' | 'other') =>
  trackEvent('paywall_shown', { source });
export const PaywallDismissed = (source: string) =>
  trackEvent('paywall_dismissed', { source });
export const TrialActivated = (source: 'daily_challenge' | 'manual') =>
  trackEvent('trial_activated', { source });
export const TrialExpired = () => trackEvent('trial_expired');
export const SubscriptionPurchased = (plan: 'monthly' | 'annual', priceEur: number) =>
  trackEvent('subscription_purchased', { plan, price_eur: priceEur });
export const SubscriptionRestored = () => trackEvent('subscription_restored');
export const SubscriptionCancelled = () => trackEvent('subscription_cancelled');
export const BoosterPackPurchased = (packId: string, amount: number, priceEur: number) =>
  trackEvent('booster_purchased', { pack_id: packId, amount, price_eur: priceEur });

// Gameplay progression
export const AchievementUnlocked = (achievementId: string, reward: number) =>
  trackEvent('achievement_unlocked', { achievement_id: achievementId, reward });
export const DailyChallengeCompleted = (challengeId: string) =>
  trackEvent('daily_challenge_completed', { challenge_id: challengeId });
export const ItemPurchased = (itemId: string, price: number) =>
  trackEvent('item_purchased', { item_id: itemId, price });

// Viral
export const ShareTapped = (type: 'stone' | 'leaderboard' | 'invite', refId?: string) =>
  trackEvent('share_tapped', { type, ref_id: refId });

// Engagement
export const LanguageChanged = (lang: string) =>
  trackEvent('language_changed', { lang });
export const NotificationReceived = (type: string) =>
  trackEvent('notification_received', { type });
export const NotificationOpened = (type: string, refId?: string) =>
  trackEvent('notification_opened', { type, ref_id: refId });
