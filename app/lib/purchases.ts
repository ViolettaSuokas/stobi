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
const RC_IOS_KEY = extra.RC_IOS_KEY ?? 'test_mCIvELpIYugBvVUFNDasZssXuos';
const RC_ANDROID_KEY = extra.RC_ANDROID_KEY ?? 'test_mCIvELpIYugBvVUFNDasZssXuos';

let Purchases: any = null;
let isInitialized = false;

/** Check if RevenueCat is configured (not placeholder or empty) */
export function isPurchasesConfigured(): boolean {
  return !!RC_IOS_KEY && !RC_IOS_KEY.includes('YOUR_REVENUECAT');
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

/** Purchase a subscription package.
 *
 * После миграции 001+009: клиент больше НЕ пишет is_premium в profiles.
 * Это делает RevenueCat webhook → Supabase Edge Function с service_role.
 * Здесь мы только возвращаем актуальный статус из RC SDK. */
export async function purchaseSubscription(pkg: any): Promise<boolean> {
  if (!Purchases) return false;

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo.entitlements.active['Stobi Pro'] !== undefined;
  } catch (e) {
    console.warn('purchaseSubscription failed', e);
    return false;
  }
}

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
