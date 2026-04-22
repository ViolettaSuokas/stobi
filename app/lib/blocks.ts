// Block/unblock users. Required for App Store 1.2 compliance (UGC apps
// must allow blocking). The blocker sees no content from the blocked.
//
// We cache the blocked-id Set in memory + AsyncStorage so chat/map
// filters run without a DB round-trip per render. The cache refreshes
// on login, and after any block/unblock call.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

const CACHE_KEY = 'stobi:blocked_users_v1';

let memCache: Set<string> | null = null;

async function loadFromStorage(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

async function persist(ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify([...ids]));
}

/** Refresh the local block-list from the server. Call after login. */
export async function refreshBlockedUsers(): Promise<Set<string>> {
  if (!isSupabaseConfigured()) {
    memCache = await loadFromStorage();
    return memCache;
  }
  try {
    const { data, error } = await supabase
      .from('user_blocks')
      .select('blocked_id');
    if (error) throw error;
    const set = new Set<string>((data ?? []).map((r: any) => r.blocked_id));
    memCache = set;
    await persist(set);
    return set;
  } catch (e) {
    console.warn('[blocks] refresh failed, using stored cache', e);
    memCache = await loadFromStorage();
    return memCache;
  }
}

export async function getBlockedUserIds(): Promise<Set<string>> {
  if (memCache) return memCache;
  memCache = await loadFromStorage();
  return memCache;
}

export function isBlockedSync(id: string | undefined | null): boolean {
  if (!id || !memCache) return false;
  return memCache.has(id);
}

export async function isBlocked(id: string | undefined | null): Promise<boolean> {
  if (!id) return false;
  const s = memCache ?? (await loadFromStorage());
  memCache = s;
  return s.has(id);
}

export async function blockUser(targetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'offline' };
  }
  try {
    const { error } = await supabase.rpc('block_user', { p_target_id: targetId });
    if (error) {
      const msg = error.message || '';
      if (msg.includes('cannot_block_self')) return { ok: false, error: 'Нельзя заблокировать себя' };
      if (msg.includes('target_not_found')) return { ok: false, error: 'Пользователь не найден' };
      return { ok: false, error: msg || 'Не удалось заблокировать' };
    }
    memCache = memCache ?? (await loadFromStorage());
    memCache.add(targetId);
    await persist(memCache);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Ошибка сети' };
  }
}

export async function unblockUser(targetId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'offline' };
  try {
    const { error } = await supabase.rpc('unblock_user', { p_target_id: targetId });
    if (error) return { ok: false, error: error.message };
    memCache = memCache ?? (await loadFromStorage());
    memCache.delete(targetId);
    await persist(memCache);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Ошибка сети' };
  }
}

export async function clearBlocksCache(): Promise<void> {
  memCache = new Set();
  await AsyncStorage.removeItem(CACHE_KEY);
}
