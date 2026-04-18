import { toNearbyStone, toActivity, type UserStone } from '../lib/user-stones';

function makeStone(overrides: Partial<UserStone> = {}): UserStone {
  return {
    id: 'stone-abc-123',
    name: 'Test Stone',
    emoji: '🪨',
    description: 'test',
    tags: [],
    coords: { lat: 60.17, lng: 24.94 },
    city: 'Helsinki',
    createdAt: Date.UTC(2026, 3, 17),
    authorUserId: 'user-1',
    authorName: 'Violetta',
    authorAvatar: '🦋',
    isArtist: false,
    ...overrides,
  };
}

describe('user-stones — toNearbyStone', () => {
  const fakeView = (c: { lat: number; lng: number }) => ({ x: c.lat, y: c.lng });

  test('derives id / name / emoji', () => {
    const s = makeStone({ id: 'x', name: 'Rocky', emoji: '🐺' });
    const near = toNearbyStone(s, { lat: 60.17, lng: 24.94 }, fakeView);
    expect(near.id).toBe('x');
    expect(near.name).toBe('Rocky');
    expect(near.emoji).toBe('🐺');
  });

  test('distance 0 когда userCoords совпадают с stone.coords', () => {
    const s = makeStone({ coords: { lat: 60.17, lng: 24.94 } });
    const near = toNearbyStone(s, { lat: 60.17, lng: 24.94 }, fakeView);
    expect(near.distanceMeters).toBeLessThan(1);
  });

  test('никогда не помечает own stone как premium', () => {
    const s = makeStone();
    const near = toNearbyStone(s, { lat: 0, lng: 0 }, fakeView);
    expect(near.isPremium).toBe(false);
  });

  test('authorId прокидывается из authorUserId', () => {
    const s = makeStone({ authorUserId: 'author-42' });
    const near = toNearbyStone(s, { lat: 60, lng: 24 }, fakeView);
    expect(near.authorId).toBe('author-42');
  });

  test('createdAt конвертится в ISO string', () => {
    const ts = Date.UTC(2026, 3, 17, 12, 0, 0);
    const s = makeStone({ createdAt: ts });
    const near = toNearbyStone(s, { lat: 60, lng: 24 }, fakeView);
    expect(near.createdAt).toBe(new Date(ts).toISOString());
  });

  test('colors и shape детерминистичны по id (одинаковый id → одинаковый стиль)', () => {
    const s1 = makeStone({ id: 'same-id' });
    const s2 = makeStone({ id: 'same-id', name: 'different name' });
    const n1 = toNearbyStone(s1, { lat: 0, lng: 0 }, fakeView);
    const n2 = toNearbyStone(s2, { lat: 0, lng: 0 }, fakeView);
    expect(n1.colors).toEqual(n2.colors);
    expect(n1.shape).toEqual(n2.shape);
  });

  test('rotation в диапазоне [-10, 10]', () => {
    for (let i = 0; i < 20; i++) {
      const near = toNearbyStone(makeStone({ id: `s-${i}` }), { lat: 0, lng: 0 }, fakeView);
      expect(near.rotation).toBeGreaterThanOrEqual(-10);
      expect(near.rotation).toBeLessThanOrEqual(10);
    }
  });
});

describe('user-stones — toActivity', () => {
  test('converts to hide activity', () => {
    const s = makeStone({ id: 's1', name: 'My Stone' });
    const a = toActivity(s);
    expect(a.type).toBe('hide');
    expect(a.stoneId).toBe('s1');
    expect(a.stoneName).toBe('My Stone');
    expect(a.id).toBe('act-s1');
  });

  test('author metadata передаётся правильно', () => {
    const s = makeStone({
      authorUserId: 'u1',
      authorName: 'Anna',
      authorAvatar: '🎨',
      isArtist: true,
    });
    const a = toActivity(s);
    expect(a.userId).toBe('u1');
    expect(a.userName).toBe('Anna');
    expect(a.userAvatar).toBe('🎨');
    expect(a.isArtist).toBe(true);
  });

  test('colors deterministic по id (та же логика что в toNearbyStone)', () => {
    const a1 = toActivity(makeStone({ id: 'abc' }));
    const a2 = toActivity(makeStone({ id: 'abc', name: 'other' }));
    expect(a1.stoneColors).toEqual(a2.stoneColors);
  });
});
