// Scan-quality heuristics.
// Тестируем через мокнутый expo-image-manipulator — чтобы не зависеть от
// реального image processing. Мы верифицируем что разные «размеры»
// base64-выхода приводят к ожидаемым reason кодам.

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

const ImageManipulator = require('expo-image-manipulator');

import { checkSceneQuality } from '../lib/scan-quality';

// Helper: build a base64 string of N bytes with a given avg byte value.
function fakeJpegBase64(length: number, avgByte = 128): string {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = avgByte;
  let binary = '';
  for (let i = 0; i < length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe('checkSceneQuality', () => {
  beforeEach(() => {
    ImageManipulator.manipulateAsync.mockReset();
  });

  test('too_uniform: маленький byte count = однотонная поверхность', async () => {
    ImageManipulator.manipulateAsync.mockResolvedValue({
      base64: fakeJpegBase64(600, 100), // меньше threshold 950
      uri: 'file:///fake.jpg',
    });
    const r = await checkSceneQuality('file:///in.jpg');
    expect(r.reason).toBe('too_uniform');
  });

  test('too_dark: высокий byte count но тёмное среднее', async () => {
    // Above 950 size threshold, but avg byte < 40
    ImageManipulator.manipulateAsync.mockResolvedValue({
      base64: fakeJpegBase64(2000, 20),
      uri: 'file:///fake.jpg',
    });
    const r = await checkSceneQuality('file:///in.jpg');
    expect(r.reason).toBe('too_dark');
  });

  test('ok: нормальный объём и яркость', async () => {
    ImageManipulator.manipulateAsync.mockResolvedValue({
      base64: fakeJpegBase64(2500, 128),
      uri: 'file:///fake.jpg',
    });
    const r = await checkSceneQuality('file:///in.jpg');
    expect(r.reason).toBe('ok');
    expect(r.detailScore).toBeGreaterThan(0);
  });

  test('fail-open: если manipulateAsync падает, не блокируем flow', async () => {
    ImageManipulator.manipulateAsync.mockRejectedValue(new Error('native bridge error'));
    const r = await checkSceneQuality('file:///in.jpg');
    expect(r.reason).toBe('ok');
  });

  test('fail-open: если base64 не возвращается', async () => {
    ImageManipulator.manipulateAsync.mockResolvedValue({
      base64: undefined,
      uri: 'file:///fake.jpg',
    });
    const r = await checkSceneQuality('file:///in.jpg');
    expect(r.reason).toBe('ok');
  });
});
