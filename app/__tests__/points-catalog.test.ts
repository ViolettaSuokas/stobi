import { ALL_ITEMS, COLOR_ITEMS, EYE_ITEMS, SHAPE_ITEMS, DECOR_ITEMS } from '../lib/points';

describe('points — cosmetics catalog', () => {
  test('catalog has expected count (mirrors server items table)', () => {
    // 15 colors + 8 eyes + 7 shapes + 10 decors = 40
    expect(ALL_ITEMS.length).toBe(40);
  });

  test('every category has at least one free default', () => {
    for (const [name, list] of [
      ['color', COLOR_ITEMS],
      ['eye', EYE_ITEMS],
      ['shape', SHAPE_ITEMS],
      ['decor', DECOR_ITEMS],
    ] as const) {
      const freeCount = list.filter((i) => i.freeByDefault).length;
      expect(freeCount).toBeGreaterThan(0);
    }
  });

  test('free-by-default items have price 0', () => {
    for (const item of ALL_ITEMS.filter((i) => i.freeByDefault)) {
      expect(item.price).toBe(0);
    }
  });

  test('paid items have price > 0', () => {
    for (const item of ALL_ITEMS.filter((i) => !i.freeByDefault)) {
      expect(item.price).toBeGreaterThan(0);
    }
  });

  test('premium-only items are never free-by-default', () => {
    for (const item of ALL_ITEMS.filter((i) => i.premiumOnly)) {
      expect(item.freeByDefault).toBe(false);
    }
  });

  test('prices are multiples of 5 (design contract)', () => {
    for (const item of ALL_ITEMS) {
      expect(item.price % 5).toBe(0);
    }
  });

  test('no duplicate IDs', () => {
    const ids = ALL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('color items have color hex', () => {
    for (const item of COLOR_ITEMS) {
      expect(item.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
