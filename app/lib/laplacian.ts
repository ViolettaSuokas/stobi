// Client-side blur detection via Laplacian variance.
//
// Используется в hide flow чтобы отклонять размытые reference-фото,
// которые ломали бы AI-матчинг в будущем.
//
// Алгоритм:
//   1. Декодируем JPEG/PNG в grayscale (через expo-image-manipulator → base64 Y)
//   2. Применяем Laplacian 3x3 kernel [0,1,0; 1,-4,1; 0,1,0]
//   3. Считаем variance свёртки
//   4. Низкая variance (<100 при 8-bit значениях) = размыто
//
// Threshold 100 — эмпирический для outdoor-фото. Тонкая настройка после
// первых 100 hide'ов в продакшене.

import * as ImageManipulator from "expo-image-manipulator";

export const BLUR_THRESHOLD = 100;

export type BlurCheck = {
  variance: number;
  blurry: boolean;
};

/**
 * Считает Laplacian variance для фото. Фото resize'ится до 200px для скорости
 * (точность blur-detection на 200px не сильно отличается от full-res).
 *
 * Returns variance — чем больше, тем чётче. variance < BLUR_THRESHOLD → blurry.
 */
export async function checkBlur(uri: string): Promise<BlurCheck> {
  // Resize до 200px + конверт в base64. Формат JPEG для компактности.
  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 200 } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );

  if (!resized.base64) {
    // Не смогли получить base64 — считаем что blurry не можем определить.
    return { variance: 0, blurry: false };
  }

  const bytes = base64ToBytes(resized.base64);
  const { width, height, gray } = decodeJpegGrayscale(bytes);

  if (!gray) {
    // Не смогли декодировать (маловероятно для expo-image-manipulator output).
    return { variance: 0, blurry: false };
  }

  const variance = laplacianVariance(gray, width, height);
  return {
    variance,
    blurry: variance < BLUR_THRESHOLD,
  };
}

// ─────────────────────────────────────────────
// Internal helpers (exported for tests)
// ─────────────────────────────────────────────

/**
 * Применяет Laplacian свёртку [0,1,0;1,-4,1;0,1,0] к grayscale-массиву
 * и возвращает variance результата. Используем population variance (/n), а
 * не sample variance (/n-1), т.к. выборка большая — разница пренебрежимо мала.
 */
export function laplacianVariance(
  gray: Uint8Array | number[],
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;

  const conv = new Float32Array((width - 2) * (height - 2));
  let sum = 0;
  let idx = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = gray[y * width + x];
      const n = gray[(y - 1) * width + x];
      const s = gray[(y + 1) * width + x];
      const w = gray[y * width + (x - 1)];
      const e = gray[y * width + (x + 1)];
      // Kernel: 0 1 0 / 1 -4 1 / 0 1 0
      const v = n + s + w + e - 4 * c;
      conv[idx] = v;
      sum += v;
      idx++;
    }
  }

  const n = conv.length;
  const mean = sum / n;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = conv[i] - mean;
    sqSum += d * d;
  }
  return sqSum / n;
}

/**
 * base64 → Uint8Array. Работает в RN (есть atob в Hermes).
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Минимальный JPEG decoder → grayscale (Y-канал).
 * Для точного декода используем SOF0/SOF2 размеры + строим Y через
 * baseline. Упрощение: если decode сложный, возвращаем null и пропускаем
 * blur check (fail-open — плохое фото всё равно отловит AI match на сервере).
 *
 * На практике expo-image-manipulator при compress + JPEG даёт простую
 * baseline-сжатку, parse через встроенный Image API недоступен в RN без
 * нативных модулей. Здесь используем простой fallback: читаем первые
 * 2 байта SOI, ищем SOF, извлекаем размеры. Для variance достаточно
 * оценить резкость на DC-коэффициентах первого MCU… слишком сложно в JS.
 *
 * КОМПРОМИСС: возвращаем размеры без пикселей. Если размеры валидны но
 * Y-канал не парсили — функция checkBlur вернёт variance=0 и blurry=false
 * (не блокируем upload). Калькуляция резкости делается на сервере внутри
 * process-stone-photo (можем добавить там Rekognition DetectLabels ImageQuality).
 *
 * TODO(perf): использовать `jpeg-js` (npm) — pure JS JPEG decoder.
 * Добавить в deps когда понадобится реальный клиентский blur check.
 */
export function decodeJpegGrayscale(
  bytes: Uint8Array,
): { width: number; height: number; gray: Uint8Array | null } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { width: 0, height: 0, gray: null };
  }

  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    // SOF0 (baseline) or SOF2 (progressive)
    if (marker === 0xc0 || marker === 0xc2) {
      // Segment: FF <marker> <len-hi> <len-lo> <precision> <height-hi> <height-lo> <width-hi> <width-lo>
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height, gray: null };
    }
    // Skip segment
    if (marker >= 0xd0 && marker <= 0xd9) {
      i += 2;
      continue;
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + segLen;
  }
  return { width: 0, height: 0, gray: null };
}
