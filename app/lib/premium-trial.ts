import AsyncStorage from '@react-native-async-storage/async-storage';

// Free 24h Premium trial earned by completing the Daily Challenge
// (find 5 stones in one day). Stores the expiry timestamp so we can show
// "Premium активен на X часов" and unlock features automatically.
//
// Replace internals with backend call when ready:
//   POST /trial/activate → returns expires_at
//   GET  /trial/state    → returns { active, expires_at }

const STORAGE_KEY = 'stobi:premium_trial';
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DAILY_CHALLENGE_GOAL = 5;

type TrialState = {
  expiresAt: number;
};

async function read(): Promise<TrialState | null> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json) as TrialState;
  } catch {
    return null;
  }
}

async function write(state: TrialState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export type TrialInfo = {
  active: boolean;
  /** Milliseconds until expiry, 0 if not active */
  msRemaining: number;
};

export async function getTrialInfo(): Promise<TrialInfo> {
  const state = await read();
  if (!state) return { active: false, msRemaining: 0 };
  const remaining = state.expiresAt - Date.now();
  if (remaining <= 0) return { active: false, msRemaining: 0 };
  return { active: true, msRemaining: remaining };
}

/**
 * Activates a 24h trial. If a trial is already active, extends from now
 * (so user always gets fresh 24h, not stacking).
 */
export async function activateTrial(): Promise<TrialInfo> {
  const expiresAt = Date.now() + TRIAL_DURATION_MS;
  await write({ expiresAt });
  return { active: true, msRemaining: TRIAL_DURATION_MS };
}

export async function clearTrial(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Format remaining ms as "Xч Yм" or "Xм" */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0м';
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return `${hours}ч`;
  return `${hours}ч ${remMin}м`;
}
