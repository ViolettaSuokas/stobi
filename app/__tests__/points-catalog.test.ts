import { ALL_ITEMS, COLOR_ITEMS, EYE_ITEMS, SHAPE_ITEMS, DECOR_ITEMS } from '../lib/points';

describe('points — cosmetics catalog', () => {
  test('catalog has expected count (mirrors server items table)', () => {
    // 15 colors + 8 eyes + 6 shapes + 9 decors = 38
    // eye-heart возвращён с variant='heart' (настоящие глаза-сердечки).
    // shape-star и decor-wizard остаются удалёнными.
    expect(ALL_ITEMS.length).toBe(38);
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

  // Guard против бага как shape-star (id уникальный, но shape === другой).
  // Юзер получает визуально одинаковые варианты под разными названиями.
  test('shapes: no two items share the same underlying shape', () => {
    const shapes = SHAPE_ITEMS.map((i) => i.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test('eye items: no two share the same underlying variant', () => {
    const variants = EYE_ITEMS.map((i) => i.variant);
    expect(new Set(variants).size).toBe(variants.length);
  });

  test('decor items: no two share the same underlying decor', () => {
    const decors = DECOR_ITEMS.map((i) => i.decor);
    expect(new Set(decors).size).toBe(decors.length);
  });

  test('colors: no two share the same hex value', () => {
    const hexes = COLOR_ITEMS.map((i) => i.color);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
