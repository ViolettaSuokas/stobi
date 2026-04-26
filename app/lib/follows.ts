// Follow / unfollow — asymmetric (как Instagram).
// Бэкенд: user_follows + toggle_follow RPC.

import { supabase, isSupabaseConfigured } from './supabase';

export type FollowState = {
  following: boolean;
  followersCount: number;
  followingCount: number;
};

/** Текущий state для отображения на user-profile screen. */
export async function getFollowState(targetUserId: string): Promise<FollowState> {
  if (!isSupabaseConfigured()) return { following: false, followersCount: 0, followingCount: 0 };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const [followersRes, followingRes, mineRes] = await Promise.all([
      supabase
        .from('user_follows')
        .select('follower_id', { count: 'exact', head: true })
        .eq('followee_id', targetUserId),
      supabase
        .from('user_follows')
        .select('followee_id', { count: 'exact', head: true })
        .eq('follower_id', targetUserId),
      user
        ? supabase
            .from('user_follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('follower_id', user.id)
            .eq('followee_id', targetUserId)
        : Promise.resolve({ count: 0 }),
    ]);
    return {
      following: (mineRes.count ?? 0) > 0,
      followersCount: followersRes.count ?? 0,
      followingCount: followingRes.count ?? 0,
    };
  } catch {
    return { following: false, followersCount: 0, followingCount: 0 };
  }
}

export type FollowListItem = {
  userId: string;
  username: string | null;
  photoUrl: string | null;
  isArtist: boolean;
};

/** Список юзеров на которых подписан target. */
export async function getFollowingList(userId: string): Promise<FollowListItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('user_follows')
      .select('followee_id, profiles!user_follows_followee_id_fkey(id, username, photo_url, is_artist)')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return (data as any[])
      .filter((row) => row.profiles)
      .map((row) => ({
        userId: row.profiles.id,
        username: row.profiles.username ?? null,
        photoUrl: row.profiles.photo_url ?? null,
        isArtist: !!row.profiles.is_artist,
      }));
  } catch {
    return [];
  }
}

/** Список юзеров которые подписаны на target. */
export async function getFollowersList(userId: string): Promise<FollowListItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('user_follows')
      .select('follower_id, profiles!user_follows_follower_id_fkey(id, username, photo_url, is_artist)')
      .eq('followee_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return (data as any[])
      .filter((row) => row.profiles)
      .map((row) => ({
        userId: row.profiles.id,
        username: row.profiles.username ?? null,
        photoUrl: row.profiles.photo_url ?? null,
        isArtist: !!row.profiles.is_artist,
      }));
  } catch {
    return [];
  }
}

/** Атомарный toggle через RPC. Возвращает свежий state. */
export async function toggleFollow(targetUserId: string): Promise<FollowState> {
  if (!isSupabaseConfigured()) return { following: false, followersCount: 0, followingCount: 0 };
  try {
    const { data, error } = await supabase.rpc('toggle_follow', { p_user_id: targetUserId });
    if (error || !data) return { following: false, followersCount: 0, followingCount: 0 };
    const r = data as { following: boolean; followers_count: number; following_count: number };
    return {
      following: !!r.following,
      followersCount: r.followers_count ?? 0,
      followingCount: r.following_count ?? 0,
    };
  } catch (e) {
    console.warn('toggleFollow failed', e);
    return { following: false, followersCount: 0, followingCount: 0 };
  }
}
