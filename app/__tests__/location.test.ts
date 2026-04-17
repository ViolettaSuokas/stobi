import { haversineDistance, formatDistance } from '../lib/location';

describe('haversineDistance', () => {
  test('zero distance for same point', () => {
    const coords = { lat: 60.1699, lng: 24.9384 };
    expect(haversineDistance(coords, coords)).toBeCloseTo(0, 1);
  });

  test('Helsinki → Turku ≈ 150 km (matches server RPC)', () => {
    // Helsinki centre ~ (60.17, 24.94), Turku centre ~ (60.45, 22.27)
    const km = haversineDistance(
      { lat: 60.17, lng: 24.94 },
      { lat: 60.45, lng: 22.27 },
    ) / 1000;
    expect(km).toBeGreaterThan(148);
    expect(km).toBeLessThan(152);
  });

  test('symmetric: a→b = b→a', () => {
    const a = { lat: 60.17, lng: 24.94 };
    const b = { lat: 59.33, lng: 18.07 }; // Stockholm
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 0);
  });

  test('short distance — 100 m moves ≈ 100 m', () => {
    const a = { lat: 60.17, lng: 24.94 };
    // ~0.0009° latitude ≈ 100 m
    const b = { lat: 60.1709, lng: 24.94 };
    const meters = haversineDistance(a, b);
    expect(meters).toBeGreaterThan(90);
    expect(meters).toBeLessThan(110);
  });
});

describe('formatDistance', () => {
  test.each([
    [0, '0м'],
    [250, '250м'],
    [999, '999м'],
    [1000, '1.0км'],
    [1500, '1.5км'],
    [9999, '10.0км'],
    [15000, '15км'],
  ])('formats %s meters as "%s"', (input, expected) => {
    expect(formatDistance(input)).toBe(expected);
  });
});
