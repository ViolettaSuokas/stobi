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
  } catch {
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
    } catch {
      // Fall through to AsyncStorage
    }
  }
  const records = await read();
  return records.some((r) => r.stoneId === stoneId);
}

export async function markStoneFound(stoneId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        const { error } = await supabase
          .from('finds')
          .insert({ user_id: user.id, stone_id: stoneId });
        if (!error) {
          await trackEvent('stone_find', { stone_id: stoneId });
          return;
        }
      }
    } catch {
      // Fall through to AsyncStorage
    }
  }
  const records = await read();
  if (records.some((r) => r.stoneId === stoneId)) return;
  records.push({ stoneId, foundAt: Date.now() });
  await write(records);
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
      if (!error && data) return data.map((row: any) => row.stone_id as string);
    } catch {
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
    } catch {
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
