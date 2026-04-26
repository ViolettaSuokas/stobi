// Stone comments — публичный thread под каждым камнем.

import { supabase, isSupabaseConfigured } from './supabase';

export type StoneComment = {
  id: string;
  authorId: string;
  authorUsername: string | null;
  authorPhotoUrl: string | null;
  body: string;
  createdAt: string;
};

export async function getStoneComments(stoneId: string, limit = 50): Promise<StoneComment[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('stone_comments')
      .select('id, author_id, body, created_at, profiles!stone_comments_author_id_fkey(username, photo_url)')
      .eq('stone_id', stoneId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as any[]).map((c) => ({
      id: c.id,
      authorId: c.author_id,
      authorUsername: c.profiles?.username ?? null,
      authorPhotoUrl: c.profiles?.photo_url ?? null,
      body: c.body,
      createdAt: c.created_at,
    }));
  } catch {
    return [];
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
