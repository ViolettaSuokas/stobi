import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

// ─────────────────────────────────────────────────
// ⚠️  ВСТАВЬ КЛЮЧИ ИЗ REVENUECAT DASHBOARD:
//     app.revenuecat.com → Project → API Keys
// ─────────────────────────────────────────────────
const RC_IOS_KEY = 'YOUR_REVENUECAT_IOS_KEY';
const RC_ANDROID_KEY = 'YOUR_REVENUECAT_ANDROID_KEY';

let Purchases: any = null;
let isInitialized = false;

/** Check if RevenueCat is configured */
export function isPurchasesConfigured(): boolean {
  return !RC_IOS_KEY.includes('YOUR_REVENUECAT');
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

/** Purchase a subscription package */
export async function purchaseSubscription(pkg: any): Promise<boolean> {
  if (!Purchases) return false;

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const isPremium = customerInfo.entitlements.active['premium'] !== undefined;

    // Sync premium status to Supabase
    if (isPremium && isSupabaseConfigured()) {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const expiry = customerInfo.entitlements.active['premium']?.expirationDate;
        await supabase.from('profiles').update({
          is_premium: true,
          premium_expires_at: expiry,
        }).eq('id', data.user.id);
      }
    }

    return isPremium;
  } catch {
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
    return customerInfo.entitlements.active['premium'] !== undefined;
  } catch {
    return false;
  }
}

/** Restore previous purchases (e.g. after reinstall) */
export async function restorePurchases(): Promise<boolean> {
  if (!Purchases) return false;

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return customerInfo.entitlements.active['premium'] !== undefined;
  } catch {
    return false;
  }
}
