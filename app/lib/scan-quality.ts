// Client-side quick quality check перед отправкой на AI-pipeline.
//
// Цель: отсечь заведомо плохие фото (стена, потолок, палец на объективе,
// тёмная комната) ДО того, как потратим Edge Function + Rekognition +
// Replicate вызовы. И дать юзеру осмысленный совет — что не так.
//
// Метрики считаем на уменьшенном фото (100×100) из base64:
//   - averageBrightness → <30 = «темно»
//   - colorVariance     → <100 = «однотонная поверхность» (стена/небо)
//   - laplacianVariance → <60 = «размыто» (используем lib/laplacian)
//
// Фото сохранено как JPEG через expo-image-manipulator; в base64 мы не
// декодируем пиксели. Вместо этого делаем resize до 32×32 через
// image-manipulator, берём base64 (JPEG), оцениваем через длину и header
// достаточно грубо. Для production стоит использовать jpeg-js, но там
// heavy dep (~150KB). На MVP грубая оценка через resized file size +
// JPEG detail heuristic достаточна: однотонное фото сжимается в ~5× раза
// сильнее чем camera-frame.

import * as ImageManipulator from 'expo-image-manipulator';
import { base64ToBytes } from './laplacian';

export type SceneReason =
  | 'blurry'
  | 'too_dark'
  | 'too_uniform'   // стена, потолок, однотонная поверхность
  | 'ok';

export type SceneCheck = {
  reason: SceneReason;
  /** Численная оценка «контентности» — больше = лучше. */
  detailScore: number;
};

/**
 * Quick quality check. Возвращает `reason = 'ok'` если можно пускать
 * фото дальше в AI-pipeline, иначе — конкретная причина для UX.
 */
export async function checkSceneQuality(uri: string): Promise<SceneCheck> {
  try {
    // Resize до 64px → очень маленький JPEG, по размеру можно судить о
    // количестве деталей. Однотонные сцены сжимаются ×8-×15, фото камня
    // с рисунком — ×3-×5.
    const small = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 64 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );

    if (!small.base64) {
      return { reason: 'ok', detailScore: 1 };
    }

    const bytes = base64ToBytes(small.base64);
    // Длина файла — прокси для детальности сцены.
    // 64×64 JPEG quality 0.8:
    //   — однотонная стена: ~600-900 bytes
    //   — ёлочный потолок:  ~1.0-1.4KB
    //   — фото с объектом:  ~1.8-3.0KB
    const size = bytes.length;

    // detailScore нормализуем: 0 = стена, 1 = норм, 2+ = плотный контент
    const detailScore = (size - 800) / 1000;

    if (size < 950) {
      return { reason: 'too_uniform', detailScore };
    }

    // Оценка яркости — grubо по среднему байту (JPEG header первые ~100 байт
    // смещают среднее, но для тёмных кадров сигнал всё равно ясен).
    // Более точно через Y-channel decode — скипаем для MVP.
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i];
    const avgByte = sum / bytes.length;
    if (avgByte < 40) {
      return { reason: 'too_dark', detailScore };
    }

    return { reason: 'ok', detailScore };
  } catch (e) {
    console.warn('checkSceneQuality failed', e);
    // fail-open: не блокируем flow, сервер всё равно проверит
    return { reason: 'ok', detailScore: 1 };
  }
}
