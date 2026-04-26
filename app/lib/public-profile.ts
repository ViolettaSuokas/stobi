// Public user profile — view another user's profile + their stones grid.
// Like Stonehiding/Instagram. Anyone can tap a username from feed/chat/
// stone-detail and see what stones they hidden + total likes/finds.

import { supabase, isSupabaseConfigured } from './supabase';

export type PublicProfile = {
  id: string;
  username: string | null;
  bio: string | null;
  avatar: string | null;
  photoUrl: string | null;
  isArtist: boolean;
  createdAt: string | null;
};

export type PublicProfileStats = {
  hiddenCount: number;
  foundCount: number;
  likesReceived: number;
};

export type PublicStoneItem = {
  id: string;
  name: string;
  emoji: string | null;
  photoUrl: string | null;
  city: string | null;
  createdAt: string | null;
  isFound: boolean;
};

/** Fetch profile by user id. Returns null if not found / not configured. */
export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, bio, avatar, photo_url, is_artist, created_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      username: data.username ?? null,
      bio: data.bio ?? null,
      avatar: data.avatar ?? null,
      photoUrl: data.photo_url ?? null,
      isArtist: !!data.is_artist,
      createdAt: data.created_at ?? null,
    };
  } catch {
    return null;
  }
}

/** Stats: hidden / found / likes received (sum across user's stones). */
export async function getPublicProfileStats(userId: string): Promise<PublicProfileStats> {
  if (!isSupabaseConfigured()) {
    return { hiddenCount: 0, foundCount: 0, likesReceived: 0 };
  }
  try {
    const [hiddenRes, foundRes, stonesRes] = await Promise.all([
      supabase
        .from('stones')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId),
      supabase
        .from('finds')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('stones')
        .select('id')
        .eq('author_id', userId),
    ]);
    const stoneIds = (stonesRes.data ?? []).map((s: any) => s.id);
    let likesReceived = 0;
    if (stoneIds.length > 0) {
      const { count } = await supabase
        .from('stone_likes')
        .select('stone_id', { count: 'exact', head: true })
        .in('stone_id', stoneIds);
      likesReceived = count ?? 0;
    }
    return {
      hiddenCount: hiddenRes.count ?? 0,
      foundCount: foundRes.count ?? 0,
      likesReceived,
    };
  } catch {
    return { hiddenCount: 0, foundCount: 0, likesReceived: 0 };
  }
}

/**
 * List stones authored by this user. Includes both currently-hidden and
 * already-found stones (for history grid). Newest first.
 *
 * is_hidden filter — пропускаем soft-hidden stones (если будут).
 */
/**
 * Stones FOUND by this user (через finds → stones embed). Newest find first.
 * isFound всегда true для этого списка.
 */
export async function getUserFoundStonesGrid(userId: string, limit: number = 60): Promise<PublicStoneItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('finds')
      .select('created_at, stones!inner(id, name, emoji, photo_url, city, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((f: any): PublicStoneItem => {
      const s = f.stones;
      return {
        id: s.id,
        name: s.name,
        emoji: s.emoji ?? null,
        photoUrl: s.photo_url ?? null,
        city: s.city ?? null,
        createdAt: f.created_at ?? s.created_at ?? null,
        isFound: true,
      };
    });
  } catch {
    return [];
  }
}

export async function getUserStonesGrid(userId: string, limit: number = 60): Promise<PublicStoneItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('stones')
      .select('id, name, emoji, photo_url, city, created_at')
      .eq('author_id', userId)
      .or('is_hidden.is.null,is_hidden.eq.false')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    // Mark stones with verified finds — для UI overlay "✓ Найден".
    const stoneIds = data.map((s: any) => s.id);
    let foundIds = new Set<string>();
    if (stoneIds.length > 0) {
      const { data: findsRes } = await supabase
        .from('finds')
        .select('stone_id')
        .in('stone_id', stoneIds);
      foundIds = new Set((findsRes ?? []).map((f: any) => f.stone_id));
    }

    return data.map((s: any): PublicStoneItem => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji ?? null,
      photoUrl: s.photo_url ?? null,
      city: s.city ?? null,
      createdAt: s.created_at ?? null,
      isFound: foundIds.has(s.id),
    }));
  } catch {
    return [];
  }
}
