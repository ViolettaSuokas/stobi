// Direct Messages — клиентская обёртка над send_dm RPC + списком
// диалогов + чтением треда.

import { supabase, isSupabaseConfigured } from './supabase';

export type DmConversation = {
  conversationId: string;
  otherId: string;
  otherUsername: string | null;
  otherPhotoUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type DmMessage = {
  id: string;
  authorId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export async function listMyConversations(): Promise<DmConversation[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase.rpc('list_my_conversations');
    if (error || !data) return [];
    return (data as any[]).map((row) => ({
      conversationId: row.conversation_id,
      otherId: row.other_id,
      otherUsername: row.other_username ?? null,
      otherPhotoUrl: row.other_photo_url ?? null,
      lastMessagePreview: row.last_message_preview ?? null,
      lastMessageAt: row.last_message_at ?? null,
      unreadCount: row.unread_count ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function getConversationMessages(conversationId: string, limit = 100): Promise<DmMessage[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('dm_messages')
      .select('id, author_id, body, read_at, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data.map((m: any) => ({
      id: m.id,
      authorId: m.author_id,
      body: m.body,
      readAt: m.read_at ?? null,
      createdAt: m.created_at,
    }));
  } catch {
    return [];
  }
}

export type SendDmResult =
  | { ok: true; messageId: string; conversationId: string }
  | { ok: false; reason: 'rate_limit' | 'too_long' | 'empty' | 'invalid_recipient' | 'unknown' };

export async function sendDm(toUserId: string, body: string): Promise<SendDmResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: 'unknown' };
  try {
    const { data, error } = await supabase.rpc('send_dm', { p_to: toUserId, p_body: body });
    if (error) {
      const msg = String(error.message ?? '').toLowerCase();
      if (msg.includes('rate_limit')) return { ok: false, reason: 'rate_limit' };
      if (msg.includes('too_long')) return { ok: false, reason: 'too_long' };
      if (msg.includes('empty')) return { ok: false, reason: 'empty' };
      if (msg.includes('invalid_recipient')) return { ok: false, reason: 'invalid_recipient' };
      return { ok: false, reason: 'unknown' };
    }
    const result = data as { message_id: string; conversation_id: string };
    return { ok: true, messageId: result.message_id, conversationId: result.conversation_id };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

export async function markThreadRead(conversationId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.rpc('mark_dm_thread_read', { p_conversation_id: conversationId });
  } catch (e) {
    console.warn('markThreadRead failed', e);
  }
}
