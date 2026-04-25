// Notifications unread count — stub.
//
// Real notifications system not built yet (см. app/notifications.tsx —
// MVP-stub). Когда появится таблица user_notifications + push-pipeline,
// здесь будет supabase-запрос count(*) where read_at is null.
//
// Для UI бейджика пока возвращаем 0 — иконка остаётся "чистой".

export async function getUnreadNotificationsCount(): Promise<number> {
  return 0;
}
