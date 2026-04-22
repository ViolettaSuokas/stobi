// Universal content reporting: stones, users, messages, photos.
//
// Every user-facing surface that shows another person's content needs a
// report affordance — required by App Store 1.2 (UGC apps must have
// reporting + blocking). Server enforces rate-limit + dedupe; this
// module is a thin wrapper over the RPC.

import { supabase, isSupabaseConfigured } from './supabase';

export type ReportTargetType = 'stone' | 'user' | 'message' | 'photo';

export type ReportCategory =
  | 'nsfw'
  | 'child_safety'
  | 'harassment'
  | 'unsafe_location'
  | 'spam'
  | 'other';

export type ReportResult =
  | { ok: true; reportId: string | null; deduped: boolean }
  | { ok: false; error: string };

const ERROR_MESSAGES: Record<string, string> = {
  auth_required: 'Войди в аккаунт чтобы отправить жалобу.',
  invalid_target_type: 'Техническая ошибка. Попробуй позже.',
  invalid_category: 'Выбери категорию.',
  reason_required_for_other: 'Опиши причину (хотя бы 5 символов).',
  reason_too_long: 'Причина слишком длинная (макс 500).',
  rate_limit_exceeded: 'Слишком много жалоб за сутки. Попробуй завтра.',
  cannot_report_self: 'Нельзя жаловаться на самого себя.',
};

export async function fileContentReport(args: {
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  reason?: string;
}): Promise<ReportResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'offline' };
  }
  try {
    const { data, error } = await supabase.rpc('file_content_report', {
      p_target_type: args.targetType,
      p_target_id: args.targetId,
      p_category: args.category,
      p_reason: args.reason ?? null,
    });
    if (error) {
      const code = error.message.split(':')[0].trim();
      return { ok: false, error: ERROR_MESSAGES[code] ?? 'Не удалось отправить жалобу.' };
    }
    const d = data as { ok?: boolean; report_id?: string | null; deduped?: boolean } | null;
    if (!d?.ok) {
      return { ok: false, error: 'Не удалось отправить жалобу.' };
    }
    return { ok: true, reportId: d.report_id ?? null, deduped: d.deduped ?? false };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Ошибка сети.' };
  }
}
