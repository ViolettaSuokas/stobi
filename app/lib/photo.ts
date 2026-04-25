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
    // Fail closed — previously returned the original URI so the flow
    // kept working, but the original often carries EXIF (GPS of user's
    // home from camera roll). For TestFlight / production we'd rather
    // block the upload than leak location metadata. Caller must handle
    // this throw and ask the user to retry / pick a different image.
    console.warn('processPhoto failed — rejecting upload rather than leaking EXIF', e);
    throw new Error('photo_processing_failed');
  }
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

  // Hard timeout 45s. The Edge Function itself caps at 60s but Replicate
  // poll-loops can stall longer than that on cold-start; without a client-
  // side cap the spinner just hangs forever and the user has no way to
  // recover. 45s lets a slow-but-still-progressing call finish, but kills
  // genuinely stuck ones so the caller can show a retry option.
  const timeoutMs = 45000;
  const invokePromise = supabase.functions.invoke(functionName, {
    body: { photo_url: photoUrl },
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('moderation_timeout')), timeoutMs),
  );

  const { data, error } = (await Promise.race([invokePromise, timeoutPromise])) as Awaited<typeof invokePromise>;

  if (error) {
    throw new Error(`Edge function ${functionName} failed: ${error.message}`);
  }

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

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // 24h expiry — balances two constraints:
  //   - pending-approval screens need the URL to still resolve when the author
  //     checks them hours later (was 10 min, too short — author saw 403)
  //   - a leaked URL shouldn't give a week-long window to enumerate photos
  // 7 days was flagged in audit 2026-04-22 as too permissive.
  const { data: signed, error: signError } = await supabase.storage
    .from('photos')
    .createSignedUrl(path, 60 * 60 * 24);
  if (signError || !signed?.signedUrl) {
    throw new Error(`Signed URL failed: ${signError?.message ?? 'unknown'}`);
  }

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
