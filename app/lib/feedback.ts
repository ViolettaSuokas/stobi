import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, isSupabaseConfigured } from './supabase';
import { useI18n } from './i18n';

export type FeedbackCategory = 'bug' | 'idea' | 'praise' | 'other';

export type FeedbackPayload = {
  category: FeedbackCategory;
  message: string;
  contactEmail?: string;
};

/** Отправка feedback в Supabase. Silent fallback если не настроен. */
export async function submitFeedback(payload: FeedbackPayload): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;

    const { error } = await supabase.from('feedback').insert({
      user_id: userId,
      category: payload.category,
      message: payload.message.trim(),
      contact_email: payload.contactEmail?.trim() || userRes?.user?.email || null,
      app_version: Constants.expoConfig?.version ?? '1.0.0',
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      locale: Intl?.DateTimeFormat?.().resolvedOptions?.().locale ?? 'unknown',
      device_info: {
        deviceName: Constants.deviceName ?? null,
        systemVersion: Platform.Version,
      },
    });
    if (error) {
      console.warn('feedback insert error', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('submitFeedback exception', e);
    return false;
  }
}
