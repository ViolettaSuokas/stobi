import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
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

// Storage = деньги. Поэтому tier-сжатие по типу использования:
//
// - 'reference' (1600px, q=0.7, ~250 КБ) — hide эталон. Нужно качество для
//   корректного CLIP embedding (AI-fingerprint) — это вектор, который потом
//   будет матчиться годами против любых find-сканов.
// - 'proof' (1024px, q=0.55, ~80 КБ) — find proof. Юзер фоткает камень в
//   руках чтобы засчитать находку. После verified embedding сохранён,
//   само фото нужно только для модерации спорных случаев → можно сильнее
//   сжимать. Экономия ~3х по storage.
// - 'avatar' (512px, q=0.7, ~30 КБ) — аватарка профиля. Маленькая в UI.
const TIERS = {
  reference: { maxDim: 1600, quality: 0.7 },
  proof:     { maxDim: 1024, quality: 0.55 },
  avatar:    { maxDim: 512,  quality: 0.7 },
} as const;
type PhotoTier = keyof typeof TIERS;

export type ProcessedPhoto = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Resizes photo + re-encodes as JPEG, strips EXIF (incl. GPS).
 * Tier выбирается по назначению — см. комментарий к TIERS выше.
 * Default 'reference' для backward compat.
 */
export async function processPhoto(
  uri: string,
  tier: PhotoTier = 'reference',
): Promise<ProcessedPhoto> {
  const cfg = TIERS[tier];
  try {
    const actions: ImageManipulator.Action[] = [
      { resize: { width: cfg.maxDim } },
    ];
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: cfg.quality,
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
    // supabase-js даёт generic "non-2xx" — реальная причина в error.context
    // (Response object). Читаем тело, чтобы увидеть конкретную ошибку
    // edge function (например "Failed to fetch image: 400" или Replicate timeout).
    let serverDetail = '';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.clone().json();
        serverDetail = body?.error ? ` — ${body.error}` : ` — ${JSON.stringify(body).slice(0, 200)}`;
      }
    } catch {/* leave serverDetail empty if response not JSON */}
    console.warn(`[moderateAndEmbedPhoto] ${functionName} failed for url=${photoUrl}`, error.message, serverDetail);
    throw new Error(`Edge function ${functionName} failed: ${error.message}${serverDetail}`);
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

  // RN/Expo на iOS не умеет нормально читать file:// через fetch().blob() —
  // возвращает 0-байтовый blob, файл загружается пустым в Storage, потом
  // Rekognition валится с "image.bytes length must be >= 1". Поэтому читаем
  // через FileSystem как base64 и отдаём supabase-js как ArrayBuffer.
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64 || base64.length === 0) {
    throw new Error('Local photo is empty');
  }
  const bytes = base64ToBytes(base64);

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${user.id}/${kind}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, bytes, {
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
 * Удаляет файл из bucket `photos` по signed-URL'у. Извлекает path из URL
 * формата `https://<project>/storage/v1/object/sign/photos/<path>?token=...`.
 *
 * Используется при удалении камней (cascade-cleanup), а также для уборки
 * "лишних" upload'ов: когда hide/find загружает 2 фото для AI, но в БД
 * хранится только одно — второе нужно удалить чтобы не было orphan'ов.
 *
 * НЕ бросает на failure (race / already-deleted / network) — caller
 * не должен блокировать основной флоу из-за storage-cleanup'а.
 */
export async function deletePhotoByUrl(signedUrl: string | null | undefined): Promise<void> {
  if (!signedUrl || !isSupabaseConfigured()) return;
  try {
    const m = signedUrl.match(/\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/);
    const path = m?.[1];
    if (!path) {
      console.warn('[deletePhotoByUrl] could not extract path from', signedUrl.slice(0, 100));
      return;
    }
    const { error } = await supabase.storage.from('photos').remove([decodeURIComponent(path)]);
    if (error) {
      console.warn('[deletePhotoByUrl] remove failed', error.message, 'path=', path);
    }
  } catch (e) {
    console.warn('[deletePhotoByUrl] exception', e);
  }
}

/**
 * Удаляет несколько файлов разом — оптимально когда нужно убрать массив
 * URL'ов (extra-uploads из hide/find или batch-cleanup).
 */
export async function deletePhotosByUrls(signedUrls: (string | null | undefined)[]): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const paths: string[] = [];
  for (const url of signedUrls) {
    if (!url) continue;
    const m = url.match(/\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/);
    if (m?.[1]) paths.push(decodeURIComponent(m[1]));
  }
  if (paths.length === 0) return;
  try {
    const { error } = await supabase.storage.from('photos').remove(paths);
    if (error) console.warn('[deletePhotosByUrls] remove failed', error.message);
  } catch (e) {
    console.warn('[deletePhotosByUrls] exception', e);
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

// Manual base64 → Uint8Array. atob() есть в RN runtime через core-js polyfill,
// но строит binary string посимвольно — для больших фото (1-2MB base64) это
// медленно. На наших ~300KB JPEG'ах нормально. Альтернативу через Buffer не
// беру чтобы не тащить node polyfill.
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
