import { laplacianVariance, decodeJpegGrayscale, base64ToBytes } from '../lib/laplacian';

describe('laplacian — variance', () => {
  test('flat image (all same pixel) → variance 0', () => {
    const size = 10;
    const gray = new Uint8Array(size * size).fill(128);
    const v = laplacianVariance(gray, size, size);
    expect(v).toBe(0);
  });

  test('checkerboard-like sharp image → high variance', () => {
    const size = 10;
    const gray = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        gray[y * size + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }
    const v = laplacianVariance(gray, size, size);
    // Контрастная шашечка → variance должна быть очень большой
    expect(v).toBeGreaterThan(10000);
  });

  test('gradient (smooth) → low variance', () => {
    const size = 10;
    const gray = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        gray[y * size + x] = Math.min(255, x * 25);
      }
    }
    const v = laplacianVariance(gray, size, size);
    // Плавный градиент → Laplacian почти нуль → низкая variance
    expect(v).toBeLessThan(100);
  });

  test('too small image → returns 0 (no kernel fits)', () => {
    const gray = new Uint8Array(4).fill(100);
    expect(laplacianVariance(gray, 2, 2)).toBe(0);
  });

  test('array input (number[]) works too', () => {
    // 5x5 с яркой точкой в (2,2) — чтобы получить 3x3 результат свёртки,
    // и у этого результата была ненулевая variance.
    const arr = [
      0,   0,   0,   0,   0,
      0,   0,   0,   0,   0,
      0,   0,   255, 0,   0,
      0,   0,   0,   0,   0,
      0,   0,   0,   0,   0,
    ];
    const v = laplacianVariance(arr, 5, 5);
    expect(v).toBeGreaterThan(0);
  });
});

describe('laplacian — JPEG header parsing', () => {
  test('non-JPEG bytes → returns {0, 0, null}', () => {
    const bogus = new Uint8Array([1, 2, 3, 4, 5]);
    const result = decodeJpegGrayscale(bogus);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.gray).toBe(null);
  });

  test('JPEG SOI+SOF0 header → parses width/height', () => {
    // Minimal synthetic JPEG-ish bytes with SOF0 segment
    // FF D8    — SOI
    // FF C0    — SOF0
    // 00 11    — segment length (17 bytes)
    // 08       — precision
    // 00 A0    — height (160)
    // 00 C8    — width (200)
    // ... оставшиеся байты (components) не нужны для нашего парсера
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0,
      0x00, 0x11,
      0x08,
      0x00, 0xa0,
      0x00, 0xc8,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const result = decodeJpegGrayscale(bytes);
    expect(result.width).toBe(200);
    expect(result.height).toBe(160);
  });
});

describe('laplacian — base64 utility', () => {
  test('decodes a known base64 string', () => {
    // "Hello" → "SGVsbG8="
    const bytes = base64ToBytes('SGVsbG8=');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  test('empty string → empty array', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});
