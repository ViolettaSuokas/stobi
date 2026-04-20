import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

const PENDING_CODE_KEY = 'stobi:pending_referral_code';

export type ReferralStats = {
  invited: number;
  earned: number;
};

export type RedeemResult =
  | { ok: true; bonus: number; newBalance: number }
  | { ok: false; reason: 'not_authenticated' | 'invalid_code' | 'code_not_found' | 'code_expired'
                       | 'cannot_redeem_own_code' | 'already_redeemed' | 'unknown' };

/** Получить (и создать если нет) реф-код текущего юзера. */
export async function getOrCreateReferralCode(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.rpc('get_or_create_referral_code');
    if (error) {
      console.warn('get_or_create_referral_code error', error.message);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (e) {
    console.warn('getOrCreateReferralCode exception', e);
    return null;
  }
}

/** Применить чужой код. */
export async function redeemReferralCode(code: string): Promise<RedeemResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: 'unknown' };
  try {
    const { data, error } = await supabase.rpc('redeem_referral_code', { p_code: code });
    if (!error && data) {
      const parsed = data as { bonus_applied: number; new_balance: number };
      return { ok: true, bonus: parsed.bonus_applied, newBalance: parsed.new_balance };
    }
    const msg = error?.message ?? '';
    if (msg.includes('not_authenticated')) return { ok: false, reason: 'not_authenticated' };
    if (msg.includes('code_not_found')) return { ok: false, reason: 'code_not_found' };
    if (msg.includes('code_expired')) return { ok: false, reason: 'code_expired' };
    if (msg.includes('cannot_redeem_own_code')) return { ok: false, reason: 'cannot_redeem_own_code' };
    if (msg.includes('already_redeemed')) return { ok: false, reason: 'already_redeemed' };
    if (msg.includes('invalid_code')) return { ok: false, reason: 'invalid_code' };
    console.warn('redeem_referral_code error', msg);
    return { ok: false, reason: 'unknown' };
  } catch (e) {
    console.warn('redeemReferralCode exception', e);
    return { ok: false, reason: 'unknown' };
  }
}

/** Статистика рефералов текущего юзера. */
export async function getReferralStats(): Promise<ReferralStats> {
  if (!isSupabaseConfigured()) return { invited: 0, earned: 0 };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { invited: 0, earned: 0 };
    const { data, error } = await supabase.rpc('get_referral_stats');
    if (!error && data) {
      const parsed = data as { invited: number; earned: number };
      return { invited: Number(parsed.invited) || 0, earned: Number(parsed.earned) || 0 };
    }
    return { invited: 0, earned: 0 };
  } catch (e) {
    console.warn('getReferralStats failed', e);
    return { invited: 0, earned: 0 };
  }
}

/** Deep link `stobi.app/invite/CODE` сохраняет код — он применится
 *  автоматически после регистрации. */
export async function savePendingReferralCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_CODE_KEY, code.trim().toUpperCase());
}

export async function getPendingReferralCode(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_CODE_KEY);
}

export async function clearPendingReferralCode(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CODE_KEY);
}

/** Попытаться применить pending код (вызывать после успешной регистрации) */
export async function applyPendingReferralCode(): Promise<RedeemResult | null> {
  const code = await getPendingReferralCode();
  if (!code) return null;
  const result = await redeemReferralCode(code);
  await clearPendingReferralCode();
  return result;
}
