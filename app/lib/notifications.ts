// Notifications history — bell icon в карте + /notifications screen.
//
// Источник правды: таблица push_queue. У каждой записи есть user_id,
// title, body, data (jsonb с type/stone_id/etc), sent, read_at.
//   read_at = null  → unread
//   read_at = ts    → прочитано (юзер видел в bell)
//
// Bell icon показывает unread count (badge), screen — полный список.

import { supabase, isSupabaseConfigured } from './supabase';

export type NotificationItem = {
  id: number;
  title: string;
  body: string;
  type: string;
  stoneId: string | null;
  pendingFindId: string | null;
  inviteeId: string | null;
  conversationId: string | null;
  senderId: string | null;
  createdAt: string;
  readAt: string | null;
};

function rowToNotification(row: any): NotificationItem {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    title: row.title ?? '',
    body: row.body ?? '',
    type: typeof data.type === 'string' ? data.type : 'unknown',
    stoneId: typeof data.stone_id === 'string' ? data.stone_id : null,
    pendingFindId: typeof data.pending_find_id === 'string' ? data.pending_find_id : null,
    inviteeId: typeof data.invitee_id === 'string' ? data.invitee_id : null,
    conversationId: typeof data.conversation_id === 'string' ? data.conversation_id : null,
    senderId: typeof data.sender_id === 'string' ? data.sender_id : null,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/** Unread count для bell-badge на карте. */
export async function getUnreadNotificationsCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count } = await supabase
      .from('push_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Список уведомлений для bell-screen. Limit 50 by default. */
export async function getNotifications(limit: number = 50): Promise<NotificationItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('push_queue')
      .select('id, title, body, data, created_at, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToNotification);
  } catch {
    return [];
  }
}

/** Помечаем одну нотификацию как прочитанную. Идемпотентно. */
export async function markNotificationRead(id: number): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.rpc('mark_notification_read', { p_id: id });
  } catch (e) {
    console.warn('markNotificationRead failed', e);
  }
}

/** Помечаем все как прочитанные — например когда юзер открыл bell-screen. */
export async function markAllNotificationsRead(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await supabase.rpc('mark_all_notifications_read');
  } catch (e) {
    console.warn('markAllNotificationsRead failed', e);
  }
}
