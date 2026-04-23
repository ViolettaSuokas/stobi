import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

// ─────────────────────────────────────────────────
// RevenueCat API keys — пришли из EAS Env / expo-constants.
// Для локальной разработки можно временно захардкодить тестовые,
// но для production обязательно задай через:
//   eas env:create production RC_IOS_KEY=appl_xxx
//   eas env:create production RC_ANDROID_KEY=goog_xxx
// ─────────────────────────────────────────────────
const extra = (Constants.expoConfig?.extra ?? {}) as {
  RC_IOS_KEY?: string;
  RC_ANDROID_KEY?: string;
};

// Sandbox fallback — работает только в dev/staging.
// Production: ключи должны прийти через EAS env (RC_IOS_KEY / RC_ANDROID_KEY).
const SANDBOX_KEY = 'test_mCIvELpIYugBvVUFNDasZssXuos';
const RC_IOS_KEY = extra.RC_IOS_KEY ?? SANDBOX_KEY;
const RC_ANDROID_KEY = extra.RC_ANDROID_KEY ?? SANDBOX_KEY;

// RevenueCat's SDK crashes the app with "Wrong API Key" if it detects a
// test_ key in a release build (TestFlight counts as release). Until we
// set real prod keys via EAS secrets, skip initialization entirely for
// release builds. Consequence: no premium purchases in TestFlight, which
// is fine — that's not what testers test.
const IS_PLACEHOLDER_KEY = RC_IOS_KEY === SANDBOX_KEY || RC_ANDROID_KEY === SANDBOX_KEY;
if (!__DEV__ && IS_PLACEHOLDER_KEY) {
  console.warn(
    '[purchases] SANDBOX KEY IN PRODUCTION BUILD — RevenueCat disabled to prevent crash. Set RC_IOS_KEY / RC_ANDROID_KEY via EAS env before App Store release.'
  );
}

let Purchases: any = null;
let isInitialized = false;

/** Check if RevenueCat is configured (not placeholder or empty) */
export function isPurchasesConfigured(): boolean {
  if (!RC_IOS_KEY || RC_IOS_KEY.includes('YOUR_REVENUECAT')) return false;
  // In release builds, a test_ key must be treated as "not configured"
  // — otherwise RC SDK crashes with "Wrong API Key, app will close".
  if (!__DEV__ && IS_PLACEHOLDER_KEY) return false;
  return true;
}

/** Initialize RevenueCat — call once on app start after user logs in */
export async function initPurchases(userId: string): Promise<void> {
  if (!isPurchasesConfigured() || isInitialized) return;

  try {
    Purchases = require('react-native-purchases').default;
    Purchases.configure({
      apiKey: Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY,
      appUserID: userId,
    });
    isInitialized = true;
  } catch {
    // RevenueCat not available (Expo Go) — silent fail
  }
}

/** Get available subscription offerings */
export async function getOfferings(): Promise<any | null> {
  if (!Purchases) return null;

  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch {
    return null;
  }
}

/** Унифицированный метод покупки любого package (подписка или consumable).
 *
 * Server-side state (is_premium, balance) обновляется через RC webhook →
 * Supabase Edge Function с service_role. Клиент только триггерит покупку
 * и получает ответ успех/отказ.
 *
 * Для consumable (booster pack) RC webhook обработает NON_RENEWING_PURCHASE
 * и начислит 💎 по mapping-у в rc-webhook. */
export async function purchasePackage(pkg: any): Promise<boolean> {
  if (!Purchases) return false;
  try {
    const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pkg);
    // Если это подписка — чекаем entitlement
    if (customerInfo?.entitlements?.active?.['Stobi Pro'] !== undefined) return true;
    // Consumable — RC не даёт entitlement, но productIdentifier значит покупка прошла
    if (productIdentifier) return true;
    return false;
  } catch (e: any) {
    if (e?.userCancelled) return false; // User cancelled — не ошибка
    console.warn('purchasePackage failed', e);
    return false;
  }
}

/** @deprecated используй purchasePackage */
export const purchaseSubscription = purchasePackage;

/** Check if user currently has active premium */
export async function checkPremiumStatus(): Promise<boolean> {
  if (!Purchases) {
    // Fallback: check Supabase profile
    if (isSupabaseConfigured()) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_premium, premium_expires_at')
          .eq('id', user.id)
          .single();
        if (!profile) return false;
        if (!profile.is_premium) return false;
        if (profile.premium_expires_at) {
          return new Date(profile.premium_expires_at) > new Date();
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.entitlements.active['Stobi Pro'] !== undefined;
  } catch {
    return false;
  }
}

/** Restore previous purchases (e.g. after reinstall) */
export async function restorePurchases(): Promise<boolean> {
  if (!Purchases) return false;

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return customerInfo.entitlements.active['Stobi Pro'] !== undefined;
  } catch {
    return false;
  }
}
