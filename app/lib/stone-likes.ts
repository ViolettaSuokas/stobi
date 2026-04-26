// Stone likes — heart на stone-detail и в профайл-сетке.
//
// Backend: stone_likes table + toggle_stone_like RPC. Любой залогиненный
// юзер может лайкнуть/убрать лайк на любой камень. Counter публичен.

import { supabase, isSupabaseConfigured } from './supabase';

export type StoneLikeState = {
  liked: boolean;
  total: number;
};

/** Загружает текущий state лайков для камня (мой статус + всего). */
export async function getStoneLikeState(stoneId: string): Promise<StoneLikeState> {
  if (!isSupabaseConfigured()) return { liked: false, total: 0 };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const [totalRes, mineRes] = await Promise.all([
      supabase
        .from('stone_likes')
        .select('user_id', { count: 'exact', head: true })
        .eq('stone_id', stoneId),
      user
        ? supabase
            .from('stone_likes')
            .select('user_id', { head: true, count: 'exact' })
            .eq('stone_id', stoneId)
            .eq('user_id', user.id)
        : Promise.resolve({ count: 0 }),
    ]);
    return {
      liked: (mineRes.count ?? 0) > 0,
      total: totalRes.count ?? 0,
    };
  } catch {
    return { liked: false, total: 0 };
  }
}

/** Атомарно лайк/анлайк через RPC. Возвращает свежий state. */
export async function toggleStoneLike(stoneId: string): Promise<StoneLikeState> {
  if (!isSupabaseConfigured()) return { liked: false, total: 0 };
  try {
    const { data, error } = await supabase.rpc('toggle_stone_like', { p_stone_id: stoneId });
    if (error || !data) return { liked: false, total: 0 };
    const result = data as { liked: boolean; total: number };
    return { liked: !!result.liked, total: result.total ?? 0 };
  } catch (e) {
    console.warn('toggleStoneLike failed', e);
    return { liked: false, total: 0 };
  }
}
