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
  console.info('[moderateAndEmbedPhoto] invoking', functionName, 'photo_url:', photoUrl.slice(0, 120));

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { photo_url: photoUrl },
  });

  if (error) {
    console.warn('[moderateAndEmbedPhoto] edge function error:', error);
    // supabase-js даёт FunctionsHttpError с body; попробуем достать детали
    const details = (error as any)?.context?.body
      ?? (error as any)?.context
      ?? (error as any)?.message
      ?? String(error);
    console.warn('[moderateAndEmbedPhoto] error details:', JSON.stringify(details).slice(0, 400));
    throw new Error(`Edge function ${functionName} failed: ${error.message}`);
  }

  console.info('[moderateAndEmbedPhoto] response keys:', data ? Object.keys(data as any) : 'null');

  if (!data || typeof data !== 'object') {
    throw new Error(`Edge function ${functionName} returned invalid payload`);
  }

  const result = data as { safe?: boolean; embedding?: number[]; labels?: unknown[] };

  if (result.safe === true && Array.isArray(result.embedding) && result.embedding.length === 768) {
    return { safe: true, embedding: result.embedding };
  }

  if (result.safe === false) {
    await logModerationEvent(photoUrl, result.labels ?? [], kind === 'stone' ? 'stone_reference' : 'find_proof');
    return { safe: false, labels: result.labels ?? [] };
  }

  console.warn('[moderateAndEmbedPhoto] unexpected shape:', JSON.stringify(data).slice(0, 300));
  throw new Error(`Edge function ${functionName} returned unexpected shape`);
}

/**
 * Uploads a local file:// photo to Supabase Storage bucket `photos`
 * under `<user_id>/<kind>/<uuid>.jpg` and returns both the storage path
 * and a short-lived signed URL (for Edge Function to fetch).
 *
 * Signed URL expires in 10 minutes — long enough for the edge function
 * pipeline (NSFW + CLIP) but short enough to avoid leaking references.
 */
export async function uploadPhotoToStorage(
  localUri: string,
  kind: 'stone' | 'find' | 'avatar',
): Promise<{ path: string; signedUrl: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  // Read local file as blob via fetch (RN-safe).
  const resp = await fetch(localUri);
  if (!resp.ok) {
    throw new Error(`Failed to read local photo: ${resp.status}`);
  }
  const blob = await resp.blob();

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${user.id}/${kind}/${filename}`;

  console.info('[uploadPhotoToStorage] uploading blob size=', blob.size, 'path=', path);
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    console.warn('[uploadPhotoToStorage] upload failed:', uploadError);
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // 7 дней expiry — чтобы pending-approval фото оставались доступны
  // автору когда он зайдёт на экран через часы/дни.
  // 10 минут (как было) ломало flow: юзер отсканил → загрузил → embed →
  // через 20 мин автор открывает pending-approvals → signed URL протух → 403.
  const { data: signed, error: signError } = await supabase.storage
    .from('photos')
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signError || !signed?.signedUrl) {
    console.warn('[uploadPhotoToStorage] sign failed:', signError);
    throw new Error(`Signed URL failed: ${signError?.message ?? 'unknown'}`);
  }

  console.info('[uploadPhotoToStorage] OK, signed URL host:', new URL(signed.signedUrl).host);
  return { path, signedUrl: signed.signedUrl };
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
