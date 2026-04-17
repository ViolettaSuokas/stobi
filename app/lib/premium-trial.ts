import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

// Free 7-day Premium trial earned by completing the Daily Challenge
// (find 5 stones in one day). State is server-authoritative via
// `trial_state` table + `activate_trial` / `get_trial_info` RPCs
// (migration 004). AsyncStorage is only a fallback for guest / offline.
//
// Trial duration was 24h historically. Per product audit, 24h converts
// poorly (industry standard is 3–7 days). Bumped to 7 days.

const STORAGE_KEY = 'stobi:premium_trial';
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DAILY_CHALLENGE_GOAL = 5;

type TrialState = {
  expiresAt: number;
};

async function readLocal(): Promise<TrialState | null> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json) as TrialState;
  } catch (e) {
    console.warn('trial parse error', e);
    return null;
  }
}

async function writeLocal(state: TrialState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export type TrialInfo = {
  active: boolean;
  /** Milliseconds until expiry, 0 if not active */
  msRemaining: number;
};

export async function getTrialInfo(): Promise<TrialInfo> {
  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase.rpc('get_trial_info');
        if (!error && data && typeof data === 'object') {
          const parsed = data as { active: boolean; ms_remaining: number };
          return { active: !!parsed.active, msRemaining: Number(parsed.ms_remaining) || 0 };
        }
      }
    } catch (e) {
      console.warn('get_trial_info exception', e);
    }
  }

  const state = await readLocal();
  if (!state) return { active: false, msRemaining: 0 };
  const remaining = state.expiresAt - Date.now();
  if (remaining <= 0) return { active: false, msRemaining: 0 };
  return { active: true, msRemaining: remaining };
}

/**
 * Activates a 7-day trial. Server-side RPC (migration 004) enforces:
 *   - user has ≥5 finds in last 24h
 *   - 30-day cooldown between trials
 * Returns trial info on success, or {active:false} if server rejected.
 */
export async function activateTrial(): Promise<TrialInfo> {
  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase.rpc('activate_trial');
        if (!error && data) {
          const parsed = data as { active: boolean; ms_remaining: number };
          return { active: !!parsed.active, msRemaining: Number(parsed.ms_remaining) || 0 };
        }
        // Server said no — do not cheat by writing local state.
        console.warn('activate_trial rpc error', error?.message);
        return { active: false, msRemaining: 0 };
      }
    } catch (e) {
      console.warn('activate_trial exception', e);
    }
  }

  // Guest fallback only — write local (no real protection).
  const expiresAt = Date.now() + TRIAL_DURATION_MS;
  await writeLocal({ expiresAt });
  return { active: true, msRemaining: TRIAL_DURATION_MS };
}

export async function clearTrial(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Format remaining ms as "Xд Yч" / "Xч Yм" / "Xм" */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0м';
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return hours > 0 ? `${days}д ${hours}ч` : `${days}д`;
  }
  if (totalHours > 0) {
    return minutes > 0 ? `${totalHours}ч ${minutes}м` : `${totalHours}ч`;
  }
  return `${totalMinutes}м`;
}
