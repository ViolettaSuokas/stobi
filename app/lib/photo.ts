import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

// Обработка фото перед загрузкой:
//   1. Ресайз до 1600 px (длинная сторона) — в 4-6 раз уменьшает вес.
//   2. Компрессия JPEG quality 0.7 — хорошее качество при маленьком весе.
//   3. expo-image-manipulator при сохранении НЕ копирует EXIF → пропадают
//      GPS-координаты съёмки и техинформация. Это важно: иначе при
//      шеринге фото камня утечёт место съёмки (дом автора).
//
// Рекомендация: вызывать processPhoto() после ImagePicker.launchCameraAsync
// и launchImageLibraryAsync, перед любым upload/render.

const MAX_DIMENSION_PX = 1600;

export type ProcessedPhoto = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Resizes photo to max 1600px (long side), re-encodes as JPEG 0.7 quality,
 * and strips EXIF (including GPS). Safe for uploads to Supabase Storage.
 */
export async function processPhoto(uri: string): Promise<ProcessedPhoto> {
  try {
    const actions: ImageManipulator.Action[] = [
      { resize: { width: MAX_DIMENSION_PX } },
    ];
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  } catch (e) {
    console.warn('processPhoto failed, using original', e);
    // Лучше отдать оригинал, чем сломать flow. Сервер всё равно
    // применит лимит размера через Supabase Storage policy.
    return { uri, width: 0, height: 0 };
  }
}

/**
 * Sugar: запустить камеру и сразу обработать результат.
 * Возвращает null если пользователь отменил.
 */
export async function takeAndProcessPhoto(
  options: Parameters<typeof import('expo-image-picker').launchCameraAsync>[0] = {}
): Promise<ProcessedPhoto | null> {
  const ImagePicker = await import('expo-image-picker');
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    quality: 1,  // сжимать будем в processPhoto — сырая картинка качественнее
    ...options,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return processPhoto(result.assets[0].uri);
}

export async function pickAndProcessPhoto(
  options: Parameters<typeof import('expo-image-picker').launchImageLibraryAsync>[0] = {}
): Promise<ProcessedPhoto | null> {
  const ImagePicker = await import('expo-image-picker');
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    quality: 1,
    ...options,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return processPhoto(result.assets[0].uri);
}

// ────────────────────────────────────────────
// V2: NSFW + CLIP embedding pipeline (migrations 017/018)
// ────────────────────────────────────────────

export type ModerationOutcome =
  | { safe: true; embedding: number[] }
  | { safe: false; labels: unknown[] };

/**
 * Sends a photo URL to an Edge Function that runs AWS Rekognition NSFW
 * and Replicate CLIP in one hop. Returns `{safe, embedding}` or `{safe: false, labels}`.
 *
 * Callers should:
 *   - On `safe: false` → drop upload, log a moderation_event (handled internally), show friendly error
 *   - On `safe: true` → pass embedding into create_stone / record_find_v2
 *
 * `kind` decides which Edge Function to hit:
 *   - 'stone' → /process-stone-photo (hide flow)
 *   - 'find'  → /process-find-photo (find flow)
 */
export async function moderateAndEmbedPhoto(
  photoUrl: string,
  kind: 'stone' | 'find',
): Promise<ModerationOutcome> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const functionName = kind === 'stone' ? 'process-stone-photo' : 'process-find-photo';
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { photo_url: photoUrl },
  });

  if (error) {
    throw new Error(`Edge function ${functionName} failed: ${error.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Edge function ${functionName} returned invalid payload`);
  }

  const result = data as { safe?: boolean; embedding?: number[]; labels?: unknown[] };

  if (result.safe === true && Array.isArray(result.embedding) && result.embedding.length === 512) {
    return { safe: true, embedding: result.embedding };
  }

  if (result.safe === false) {
    // Log moderation event so the shadowban trigger can count this.
    await logModerationEvent(photoUrl, result.labels ?? [], kind === 'stone' ? 'stone_reference' : 'find_proof');
    return { safe: false, labels: result.labels ?? [] };
  }

  throw new Error(`Edge function ${functionName} returned unexpected shape`);
}

async function logModerationEvent(
  photoUrl: string,
  labels: unknown[],
  source: 'stone_reference' | 'find_proof' | 'avatar' | 'chat_photo',
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('moderation_events').insert({
      user_id: user.id,
      photo_url: photoUrl,
      labels,
      source,
    });
  } catch (e) {
    console.warn('logModerationEvent failed', e);
  }
}

/**
 * Exposed explicitly for paths that do their own upload (e.g. avatar).
 * Most callers should use `moderateAndEmbedPhoto` which covers the full pipeline.
 */
export async function logAvatarModerationReject(
  photoUrl: string,
  labels: unknown[],
): Promise<void> {
  await logModerationEvent(photoUrl, labels, 'avatar');
}
