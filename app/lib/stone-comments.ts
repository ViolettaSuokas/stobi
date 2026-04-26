// Stone comments — публичный thread под каждым камнем.

import { supabase, isSupabaseConfigured } from './supabase';

export type StoneComment = {
  id: string;
  authorId: string;
  authorUsername: string | null;
  authorPhotoUrl: string | null;
  body: string;
  createdAt: string;
  likedByMe: boolean;
  likesCount: number;
};

export async function getStoneComments(stoneId: string, limit = 50): Promise<StoneComment[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const [commentsRes, allLikesRes, myLikesRes] = await Promise.all([
      supabase
        .from('stone_comments')
        .select('id, author_id, body, created_at, profiles!stone_comments_author_id_fkey(username, photo_url)')
        .eq('stone_id', stoneId)
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('comment_likes')
        .select('comment_id')
        .in('comment_id', []), // populated below via second pass
      user
        ? supabase
            .from('comment_likes')
            .select('comment_id')
            .eq('user_id', user.id)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (commentsRes.error || !commentsRes.data) return [];

    const commentIds = commentsRes.data.map((c: any) => c.id);
    // Refetch all likes for these specific comments now that we have ids
    const { data: allLikes } = commentIds.length > 0
      ? await supabase.from('comment_likes').select('comment_id').in('comment_id', commentIds)
      : { data: [] as any[] };
    const totalsByComment = new Map<string, number>();
    (allLikes ?? []).forEach((row: any) => {
      totalsByComment.set(row.comment_id, (totalsByComment.get(row.comment_id) ?? 0) + 1);
    });
    const myLiked = new Set<string>(((myLikesRes as any).data ?? []).map((r: any) => r.comment_id));

    return commentsRes.data.map((c: any): StoneComment => ({
      id: c.id,
      authorId: c.author_id,
      authorUsername: c.profiles?.username ?? null,
      authorPhotoUrl: c.profiles?.photo_url ?? null,
      body: c.body,
      createdAt: c.created_at,
      likedByMe: myLiked.has(c.id),
      likesCount: totalsByComment.get(c.id) ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Toggle like on a comment. Returns { liked, total }. */
export async function toggleCommentLike(commentId: string): Promise<{ liked: boolean; total: number }> {
  if (!isSupabaseConfigured()) return { liked: false, total: 0 };
  try {
    const { data, error } = await supabase.rpc('toggle_comment_like', { p_comment_id: commentId });
    if (error || !data) return { liked: false, total: 0 };
    const r = data as { liked: boolean; total: number };
    return { liked: !!r.liked, total: r.total ?? 0 };
  } catch {
    return { liked: false, total: 0 };
  }
}

/** Report a comment / stone / message. category: 'spam' | 'abuse' | 'other'. */
export async function reportContent(
  targetType: 'comment' | 'stone' | 'message' | 'profile',
  targetId: string,
  category: string = 'other',
  reason?: string,
): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured()) return { ok: false };
  try {
    const { error } = await supabase.rpc('report_content', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_category: category,
      p_reason: reason ?? null,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export type AddCommentResult =
  | { ok: true; commentId: string }
  | { ok: false; reason: 'rate_limit' | 'too_long' | 'empty' | 'unknown' };

export async function addStoneComment(stoneId: string, body: string): Promise<AddCommentResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: 'unknown' };
  try {
    const { data, error } = await supabase.rpc('add_stone_comment', {
      p_stone_id: stoneId,
      p_body: body,
    });
    if (error) {
      const msg = String(error.message ?? '').toLowerCase();
      if (msg.includes('rate_limit')) return { ok: false, reason: 'rate_limit' };
      if (msg.includes('too_long')) return { ok: false, reason: 'too_long' };
      if (msg.includes('empty')) return { ok: false, reason: 'empty' };
      return { ok: false, reason: 'unknown' };
    }
    return { ok: true, commentId: (data as any).comment_id };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

/** Делиет свой коммент. Идемпотентно, не падает если уже удалён. */
export async function deleteStoneComment(commentId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.from('stone_comments').delete().eq('id', commentId);
  } catch (e) {
    console.warn('deleteStoneComment failed', e);
  }
}
