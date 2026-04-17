import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coords, NearbyStone } from './location';
import type { Activity } from './activity';
import type { StonePhotoKey } from './stone-photos';
import { supabase, isSupabaseConfigured } from './supabase';
import { trackEvent } from './analytics';
import { getCurrentUser } from './auth';

// Persists stones the user creates via the "Спрятать камень" flow.
// These show up alongside mock stones on the map and in the user's
// profile activity timeline.
//
// When the real backend ships, the body of these functions becomes
// HTTP calls (POST /stones, GET /stones?author=me) — public API stays
// the same so callers don't change.

const STORAGE_KEY = 'stobi:user_stones';

export type UserStone = {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  tags: string[];
  photo?: StonePhotoKey;
  /** Real photo URI from camera/gallery */
  photoUri?: string;
  coords: Coords;
  city: string;
  /** ms timestamp */
  createdAt: number;
  authorUserId: string;
  authorName: string;
  authorAvatar: string;
  isArtist?: boolean;
};

async function read(): Promise<UserStone[]> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  if (!json) return [];
  try {
    return JSON.parse(json) as UserStone[];
  } catch {
    return [];
  }
}

async function write(stones: UserStone[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stones));
}

export async function getUserStones(): Promise<UserStone[]> {
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (!user) return read(); // fallback if not logged in
      const { data, error } = await supabase
        .from('stones')
        .select('*')
        .eq('author_id', user.id);
      if (error || !data) return read();
      return data.map((row: Record<string, any>) => ({
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        description: row.description ?? undefined,
        tags: row.tags ?? [],
        photoUri: row.photo_url ?? undefined,
        coords: { lat: row.lat, lng: row.lng },
        city: row.city ?? '',
        createdAt: new Date(row.created_at).getTime(),
        authorUserId: row.author_id,
        authorName: user.username,
        authorAvatar: user.avatar,
        isArtist: user.isArtist,
      }));
    } catch (e) {
      console.warn('getUserStones fallback to local', e);
      return read(); // offline fallback
    }
  }
  return read();
}

export async function addUserStone(input: Omit<UserStone, 'id' | 'createdAt'>): Promise<UserStone> {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('stones')
        .insert({
          author_id: input.authorUserId,
          name: input.name,
          emoji: input.emoji,
          description: input.description ?? null,
          tags: input.tags,
          photo_url: input.photoUri ?? null,
          lat: input.coords.lat,
          lng: input.coords.lng,
          city: input.city,
        })
        .select()
        .single();
      if (error || !data) throw error;
      await trackEvent('stone_hide', { stone_id: data.id });
      return {
        id: data.id,
        name: data.name,
        emoji: data.emoji,
        description: data.description ?? undefined,
        tags: data.tags ?? [],
        photoUri: data.photo_url ?? undefined,
        coords: { lat: data.lat, lng: data.lng },
        city: data.city ?? '',
        createdAt: new Date(data.created_at).getTime(),
        authorUserId: data.author_id,
        authorName: input.authorName,
        authorAvatar: input.authorAvatar,
        isArtist: input.isArtist,
      };
    } catch (e) {
      console.warn('addUserStone fallback to local', e);
      // Fall through to AsyncStorage
    }
  }

  const stones = await read();
  const stone: UserStone = {
    ...input,
    id: `user-stone-${Date.now()}`,
    createdAt: Date.now(),
  };
  stones.push(stone);
  await write(stones);
  return stone;
}

export async function deleteUserStone(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('stones').delete().eq('id', id);
      if (!error) return;
    } catch {
      // Fall through to AsyncStorage
    }
  }
  const stones = await read();
  const filtered = stones.filter((s) => s.id !== id);
  await write(filtered);
}

export async function editUserStone(
  id: string,
  updates: Partial<Pick<UserStone, 'name' | 'description' | 'photoUri'>>,
): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const supaUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) supaUpdates.name = updates.name;
      if (updates.description !== undefined) supaUpdates.description = updates.description;
      if (updates.photoUri !== undefined) supaUpdates.photo_url = updates.photoUri;
      const { error } = await supabase.from('stones').update(supaUpdates).eq('id', id);
      if (!error) return;
    } catch {
      // Fall through to AsyncStorage
    }
  }
  const stones = await read();
  const stone = stones.find((s) => s.id === id);
  if (!stone) return;
  if (updates.name !== undefined) stone.name = updates.name;
  if (updates.description !== undefined) stone.description = updates.description;
  if (updates.photoUri !== undefined) stone.photoUri = updates.photoUri;
  await write(stones);
}

export async function clearUserStones(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ────────────────────────────────────────────
// Adapters — convert UserStone to NearbyStone and Activity shapes
// so it merges seamlessly with the existing mock data layers.
// ────────────────────────────────────────────

const USER_STONE_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#F5D0FE', '#A855F7'],
  ['#BFDBFE', '#2563EB'],
  ['#BBF7D0', '#15803D'],
  ['#FDE68A', '#D97706'],
  ['#FCA5A5', '#DC2626'],
  ['#DDD6FE', '#7C3AED'],
];

const USER_STONE_SHAPES = [
  {
    width: 50,
    height: 42,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 22,
  },
  {
    width: 46,
    height: 44,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 38,
  },
  {
    width: 52,
    height: 40,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 42,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 28,
  },
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Convert a user stone to NearbyStone format for the map */
export function toNearbyStone(
  stone: UserStone,
  userCoords: Coords,
  finlandViewBoxConvert: (c: Coords) => { x: number; y: number },
): NearbyStone {
  const colors = USER_STONE_PALETTE[hash(stone.id) % USER_STONE_PALETTE.length];
  const shape = USER_STONE_SHAPES[hash(stone.id) % USER_STONE_SHAPES.length];
  // Project the stone's real coords onto the silhouette viewBox
  const view = finlandViewBoxConvert(stone.coords);
  // Compute distance from user
  const distMeters = haversineSimple(userCoords, stone.coords);
  return {
    id: stone.id,
    emoji: stone.emoji,
    name: stone.name,
    distance: formatDistance(distMeters),
    distanceMeters: distMeters,
    coords: stone.coords,
    visual: { x: view.x / 200, y: view.y / 320 },
    colors,
    shape,
    rotation: (hash(stone.id) % 20) - 10,
    isPremium: false, // user's own stones are never premium-locked
    authorId: stone.authorUserId,
    createdAt: new Date(stone.createdAt).toISOString(),
  };
}

/** Convert a user stone to Activity format for the feed/profile timeline */
export function toActivity(stone: UserStone): Activity {
  const colors = USER_STONE_PALETTE[hash(stone.id) % USER_STONE_PALETTE.length];
  return {
    id: `act-${stone.id}`,
    type: 'hide',
    userId: stone.authorUserId,
    userName: stone.authorName,
    userAvatar: stone.authorAvatar,
    isArtist: stone.isArtist,
    stoneId: stone.id,
    stoneEmoji: stone.emoji,
    stoneName: stone.name,
    stoneColors: colors,
    city: stone.city,
    createdAt: stone.createdAt,
    photo: stone.photo,
    photoUri: stone.photoUri,
  };
}

// Local lightweight haversine to avoid circular import from location.ts
function haversineSimple(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}м`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)}км`;
  return `${Math.round(meters / 1000)}км`;
}
