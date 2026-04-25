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
 * @deprecated Use `markStoneFoundV2` instead. Legacy GPS-only find.
 * Still used by `app/stone/[id].tsx` as fallback for stones without
 * embeddings (pre-AI-verification seed data). Remove after 2026-07-01
 * when all active stones have embeddings.
 *
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
// V2: AI-based find flow (migration 017)
// ────────────────────────────────────────────

export type FindStatus = 'verified' | 'pending' | 'rejected';

export type FindResultV2 =
  | {
      ok: true;
      status: FindStatus;
      reason: string;
      reward: number;
      similarity: number | null;
      balance: number | null;
      findId?: string;
      proofId?: string;
    }
  | {
      ok: false;
      reason: string;
      detail?: string;
    };

/**
 * Records a find via server RPC `record_find_v2` (migration 017).
 *
 * Accepts a scanned photo (already moderated + embedded via edge function),
 * its 512-dim CLIP embedding, and optional GPS coordinates.
 *
 * Server decision:
 *   - AI similarity ≥0.82 → verified
 *   - 0.60–0.82 + GPS ≤30m → verified
 *   - 0.60–0.82 + no GPS → pending (author approves)
 *   - <0.60 → rejected
 *   - NSFW labels present → rejected + moderation_event on client side
 */
export async function markStoneFoundV2(args: {
  stoneId: string;
  photoUrl: string;
  embedding: number[];
  lat?: number | null;
  lng?: number | null;
  nsfwLabels?: unknown[] | null;
}): Promise<FindResultV2> {
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: 'supabase_not_configured' };
  }

  try {
    const { data, error } = await supabase.rpc('record_find_v2', {
      p_stone_id: args.stoneId,
      p_photo_url: args.photoUrl,
      p_embedding: args.embedding,
      p_proof_lat: args.lat ?? null,
      p_proof_lng: args.lng ?? null,
      p_nsfw_labels: args.nsfwLabels ?? null,
    });
    if (error) {
      console.warn('record_find_v2 rpc error', error.message);
      return { ok: false, reason: 'rpc_error', detail: error.message };
    }
    const parsed = data as {
      status: FindStatus;
      reason: string;
      reward: number;
      similarity: number | null;
      balance: number | null;
      find_id?: string;
      proof_id?: string;
    };
    if (parsed.status === 'verified') {
      await trackEvent('stone_find', { stone_id: args.stoneId, path: 'v2_verified' });
    } else if (parsed.status === 'pending') {
      await trackEvent('stone_find_pending', { stone_id: args.stoneId });
    } else {
      await trackEvent('stone_find_rejected', {
        stone_id: args.stoneId,
        reason: parsed.reason,
      });
    }
    return {
      ok: true,
      status: parsed.status,
      reason: parsed.reason,
      reward: parsed.reward,
      similarity: parsed.similarity,
      balance: parsed.balance,
      findId: parsed.find_id,
      proofId: parsed.proof_id,
    };
  } catch (e: any) {
    console.warn('record_find_v2 exception', e);
    return { ok: false, reason: 'exception', detail: e?.message ?? String(e) };
  }
}

// ────────────────────────────────────────────
// Pending finds — для автора одобрить/отклонить
// ────────────────────────────────────────────

export type PendingFind = {
  proofId: string;
  stoneId: string;
  finderId: string;
  finderUsername: string;
  finderAvatar: string;
  photoUrl: string;
  similarity: number;
  createdAt: number;
};

/** Получить pending finds для камня (или для всех своих камней если stoneId=null). */
export async function getPendingFindsForMyStones(stoneId?: string | null): Promise<PendingFind[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase.rpc('get_pending_finds_for_my_stones', {
      p_stone_id: stoneId ?? null,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.warn('get_pending_finds error', error.message);
      return [];
    }
    return (data as Array<{
      proof_id: string;
      stone_id: string;
      finder_id: string;
      finder_username: string;
      finder_avatar: string;
      photo_url: string;
      similarity: number;
      created_at: string;
    }>).map((row) => ({
      proofId: row.proof_id,
      stoneId: row.stone_id,
      finderId: row.finder_id,
      finderUsername: row.finder_username ?? 'Удалённый юзер',
      finderAvatar: row.finder_avatar ?? '🪨',
      photoUrl: row.photo_url,
      similarity: row.similarity,
      createdAt: new Date(row.created_at).getTime(),
    }));
  } catch (e) {
    console.warn('getPendingFindsForMyStones exception', e);
    return [];
  }
}

/** Автор одобряет pending find — finder получает 💎, find становится verified. */
export async function approvePendingFind(proofId: string): Promise<{ ok: boolean; balance?: number; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'supabase_not_configured' };
  try {
    const { data, error } = await supabase.rpc('author_approve_pending_find', {
      p_proof_id: proofId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, balance: (data as { balance?: number })?.balance };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/** Автор отклоняет pending find — статус 'rejected', никаких начислений. */
export async function rejectPendingFind(proofId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'supabase_not_configured' };
  try {
    const { error } = await supabase.rpc('author_reject_pending_find', {
      p_proof_id: proofId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/** Top-3 nearest stones by cosine similarity — used for "найти где-то ещё". */
export type StoneSearchHit = {
  stoneId: string;
  name: string;
  photoUrl: string | null;
  similarity: number;
  authorId: string;
  city: string | null;
};

export async function searchStoneByEmbedding(
  embedding: number[],
  limit = 3,
  coords?: { lat: number; lng: number } | null,
  radiusKm = 5,
): Promise<StoneSearchHit[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    // GPS pre-filter: server отсечёт камни дальше radiusKm от текущих
    // координат → меньше false-positive (визуально похожий камень в другой
    // стране) + быстрее при scale. Если coords нет — server делает
    // whole-DB search как раньше (fallback).
    const { data, error } = await supabase.rpc('search_stone_by_embedding', {
      p_embedding: embedding,
      p_limit: limit,
      p_lat: coords?.lat ?? null,
      p_lng: coords?.lng ?? null,
      p_radius_km: radiusKm,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.warn('search_stone_by_embedding error', error.message);
      return [];
    }
    return (data as Array<{
      stone_id: string;
      name: string;
      photo_url: string | null;
      similarity: number;
      author_id: string;
      city: string | null;
      distance_m: number | null;
    }>).map((row) => ({
      stoneId: row.stone_id,
      name: row.name,
      photoUrl: row.photo_url,
      similarity: row.similarity,
      authorId: row.author_id,
      city: row.city,
    }));
  } catch (e) {
    console.warn('search_stone_by_embedding exception', e);
    return [];
  }
}

/** Author approves a pending find → reward + adaptive learning. */
export async function authorApprovePendingFind(proofId: string): Promise<{
  ok: boolean;
  balance?: number | null;
  error?: string;
}> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'not_configured' };
  try {
    const { data, error } = await supabase.rpc('author_approve_pending_find', {
      p_proof_id: proofId,
    });
    if (error) return { ok: false, error: error.message };
    const parsed = data as { balance: number | null };
    return { ok: true, balance: parsed?.balance ?? null };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ────────────────────────────────────────────
// Stone missing report + author confirm (migration 017)
// ────────────────────────────────────────────

export async function reportStoneMissing(
  stoneId: string,
  lat: number,
  lng: number,
  reason?: string,
): Promise<{ ok: boolean; distance?: number; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'not_configured' };
  try {
    const { data, error } = await supabase.rpc('report_stone_missing', {
      p_stone_id: stoneId,
      p_lat: lat,
      p_lng: lng,
      p_reason: reason ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const parsed = data as { ok: boolean; distance_m: number };
    await trackEvent('stone_report_missing', { stone_id: stoneId });
    return { ok: true, distance: parsed?.distance_m };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function authorConfirmStone(
  stoneId: string,
  lat: number,
  lng: number,
): Promise<{ ok: boolean; reportsCleared?: number; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'not_configured' };
  try {
    const { data, error } = await supabase.rpc('author_confirm_stone', {
      p_stone_id: stoneId,
      p_lat: lat,
      p_lng: lng,
    });
    if (error) return { ok: false, error: error.message };
    const parsed = data as { ok: boolean; reports_cleared: number };
    await trackEvent('stone_author_confirm', { stone_id: stoneId });
    return { ok: true, reportsCleared: parsed?.reports_cleared };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Bonus за шейр находки в соцсетях (+2 💎). Dedup-guarded — один stone_id
 * может быть одобрен ровно один раз для юзера. migration 210000.
 */
export async function rewardSocialShare(
  stoneId: string,
): Promise<{ rewarded: boolean; balance: number; amount?: number; error?: string }> {
  if (!isSupabaseConfigured()) return { rewarded: false, balance: 0, error: 'not_configured' };
  try {
    const { data, error } = await supabase.rpc('reward_social_share', { p_stone_id: stoneId });
    if (error) return { rewarded: false, balance: 0, error: error.message };
    const parsed = data as { rewarded: boolean; balance: number; amount?: number };
    if (parsed?.rewarded) {
      await trackEvent('social_share_bonus', { stone_id: stoneId, amount: parsed.amount });
    }
    return {
      rewarded: !!parsed?.rewarded,
      balance: parsed?.balance ?? 0,
      amount: parsed?.amount,
    };
  } catch (e: any) {
    return { rewarded: false, balance: 0, error: e?.message ?? String(e) };
  }
}

export async function requestReferenceRecapture(
  stoneId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'not_configured' };
  try {
    const { error } = await supabase.rpc('request_reference_recapture', {
      p_stone_id: stoneId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
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
