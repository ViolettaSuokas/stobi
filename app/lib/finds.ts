import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { trackEvent } from './analytics';
import { getCurrentUser } from './auth';

// Tracks which stones the current user has claimed as found.
// Prevents farming the same stone for repeated 💎 rewards.
//
// Replace internals with a backend call when API is ready:
//   POST /finds  { stoneId, foundAt, photo? }

const STORAGE_KEY = 'stobi:user_finds';

type FindRecord = {
  stoneId: string;
  foundAt: number;
};

async function read(): Promise<FindRecord[]> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  if (!json) return [];
  try {
    return JSON.parse(json) as FindRecord[];
  } catch (e) { console.warn(e);
    return [];
  }
}

async function write(records: FindRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export async function hasFoundStone(stoneId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (!user) return (await read()).some((r) => r.stoneId === stoneId);
      const { data } = await supabase
        .from('finds')
        .select('id')
        .eq('user_id', user.id)
        .eq('stone_id', stoneId)
        .maybeSingle();
      return !!data;
    } catch (e) { console.warn(e);
      // Fall through to AsyncStorage
    }
  }
  const records = await read();
  return records.some((r) => r.stoneId === stoneId);
}

export type FindResult =
  | { ok: true; balance: number | null; reward: number; alreadyFound: boolean }
  | {
      ok: false;
      reason:
        | 'too_far'
        | 'cannot_find_own_stone'
        | 'stone_too_fresh'
        | 'author_daily_limit'
        | 'stone_not_found'
        | 'not_authenticated'
        | 'unknown';
      detail?: string;
    };

/**
 * Records a find via server RPC `record_find` (migration 005).
 *
 * Server enforces atomically (cheat-proof):
 *   - distance ≤ 30 m (haversine on stone's real coords)
 *   - ≤ 2 finds per author per day
 *   - stone must be ≥ 1 hour old
 *   - cannot find own stone
 *   - rewards finder + author in one transaction
 *
 * Guest mode (no Supabase user) falls back to local-only recording with
 * no anti-fraud checks (demo / offline).
 */
export async function markStoneFound(
  stoneId: string,
  proofLat: number,
  proofLng: number
): Promise<FindResult> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        const { data, error } = await supabase.rpc('record_find', {
          p_stone_id: stoneId,
          p_proof_lat: proofLat,
          p_proof_lng: proofLng,
        });
        if (!error && data) {
          await trackEvent('stone_find', { stone_id: stoneId });
          const parsed = data as { balance: number; reward: number; already_found: boolean };
          return {
            ok: true,
            balance: parsed.balance,
            reward: parsed.reward,
            alreadyFound: !!parsed.already_found,
          };
        }
        const msg = error?.message ?? '';
        if (msg.includes('too_far')) return { ok: false, reason: 'too_far', detail: msg };
        if (msg.includes('cannot_find_own_stone')) return { ok: false, reason: 'cannot_find_own_stone' };
        if (msg.includes('stone_too_fresh')) return { ok: false, reason: 'stone_too_fresh', detail: msg };
        if (msg.includes('author_daily_limit')) return { ok: false, reason: 'author_daily_limit' };
        if (msg.includes('stone_not_found')) return { ok: false, reason: 'stone_not_found' };
        if (msg.includes('not_authenticated')) return { ok: false, reason: 'not_authenticated' };
        console.warn('record_find rpc error', msg);
      }
    } catch (e) {
      console.warn('record_find exception', e);
      // Fall through to local (guest/offline)
    }
  }

  // Guest / offline fallback — local only, no anti-fraud
  const records = await read();
  if (!records.some((r) => r.stoneId === stoneId)) {
    records.push({ stoneId, foundAt: Date.now() });
    await write(records);
  }
  return { ok: true, balance: null, reward: 1, alreadyFound: false };
}

export async function getFoundStoneIds(): Promise<string[]> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (!user) return (await read()).map((r) => r.stoneId);
      const { data, error } = await supabase
        .from('finds')
        .select('stone_id')
        .eq('user_id', user.id);
      if (!error && data) return data.map((row: { stone_id: string }) => row.stone_id);
    } catch (e) { console.warn(e);
      // Fall through to AsyncStorage
    }
  }
  const records = await read();
  return records.map((r) => r.stoneId);
}

/** How many stones the user found in the last 24 hours. */
export async function getFindsToday(): Promise<number> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (!user) {
        const records = await read();
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        return records.filter((r) => r.foundAt >= cutoff).length;
      }
      const todayStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('finds')
        .select('id')
        .eq('user_id', user.id)
        .gte('found_at', todayStart);
      if (!error && data) return data.length;
    } catch (e) { console.warn(e);
      // Fall through to AsyncStorage
    }
  }
  const records = await read();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return records.filter((r) => r.foundAt >= cutoff).length;
}

export async function clearFinds(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ────────────────────────────────────────────
// Anti-fraud: max finds per author per day
// ────────────────────────────────────────────

const AUTHOR_FINDS_KEY = 'stobi:finds_by_author';
const MAX_FINDS_PER_AUTHOR_PER_DAY = 2;

type AuthorFindsMap = Record<string, Record<string, number>>;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readAuthorFinds(): Promise<AuthorFindsMap> {
  try {
    const json = await AsyncStorage.getItem(AUTHOR_FINDS_KEY);
    return json ? JSON.parse(json) : {};
  } catch (e) { console.warn(e);
    return {};
  }
}

async function writeAuthorFinds(map: AuthorFindsMap): Promise<void> {
  await AsyncStorage.setItem(AUTHOR_FINDS_KEY, JSON.stringify(map));
}

export async function getFindsOfAuthorToday(authorId: string): Promise<number> {
  const map = await readAuthorFinds();
  const today = todayKey();
  return map[today]?.[authorId] ?? 0;
}

export async function recordAuthorFind(authorId: string): Promise<void> {
  const map = await readAuthorFinds();
  const today = todayKey();
  if (!map[today]) map[today] = {};
  map[today][authorId] = (map[today][authorId] ?? 0) + 1;
  // Clean old days to prevent storage bloat
  for (const key of Object.keys(map)) {
    if (key < today) delete map[key];
  }
  await writeAuthorFinds(map);
}

export function isAuthorLimitReached(count: number): boolean {
  return count >= MAX_FINDS_PER_AUTHOR_PER_DAY;
}
