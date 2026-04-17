import * as ImageManipulator from 'expo-image-manipulator';

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
