import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
  isSupabaseConfigured: () => false,
}));

jest.mock('../lib/auth', () => ({
  getCurrentUser: jest.fn(async () => null),
}));

jest.mock('../lib/analytics', () => ({
  trackEvent: jest.fn(),
}));

import {
  hasFoundStone,
  markStoneFound,
  getFoundStoneIds,
  getFindsToday,
  clearFinds,
  getFindsOfAuthorToday,
  recordAuthorFind,
  isAuthorLimitReached,
} from '../lib/finds';

const STORAGE_KEY = 'stobi:user_finds';
const AUTHOR_KEY = 'stobi:finds_by_author';

describe('finds — hasFoundStone / getFoundStoneIds (local)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('false когда не находили', async () => {
    expect(await hasFoundStone('stone-1')).toBe(false);
  });

  test('true после markStoneFound', async () => {
    await markStoneFound('stone-1', 60.17, 24.94);
    expect(await hasFoundStone('stone-1')).toBe(true);
  });

  test('getFoundStoneIds возвращает все найденные', async () => {
    await markStoneFound('stone-1', 60, 24);
    await markStoneFound('stone-2', 60, 24);
    await markStoneFound('stone-3', 60, 24);
    const ids = await getFoundStoneIds();
    expect(ids.sort()).toEqual(['stone-1', 'stone-2', 'stone-3']);
  });

  test('markStoneFound idempotent — повторная запись не дублирует', async () => {
    await markStoneFound('stone-1', 60, 24);
    await markStoneFound('stone-1', 60, 24);
    const ids = await getFoundStoneIds();
    expect(ids.filter((id) => id === 'stone-1')).toHaveLength(1);
  });
});

describe('finds — markStoneFound', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('возвращает ok=true с reward=1 для нового камня (guest fallback)', async () => {
    const result = await markStoneFound('stone-new', 60, 24);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reward).toBe(1);
      expect(result.alreadyFound).toBe(false);
    }
  });

  test('принимает любые координаты без проверки (local mode)', async () => {
    // Local mode — нет anti-fraud, координаты игнорируются
    const result = await markStoneFound('stone-x', -90, 180);
    expect(result.ok).toBe(true);
  });
});

describe('finds — getFindsToday', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('0 когда ничего не находили', async () => {
    expect(await getFindsToday()).toBe(0);
  });

  test('считает только последние 24 часа', async () => {
    // Симулируем find старше 24ч + find сегодня
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      { stoneId: 'old', foundAt: yesterday },
      { stoneId: 'today', foundAt: Date.now() },
    ]));
    expect(await getFindsToday()).toBe(1);
  });

  test('считает все сегодняшние finds', async () => {
    await markStoneFound('s1', 60, 24);
    await markStoneFound('s2', 60, 24);
    await markStoneFound('s3', 60, 24);
    expect(await getFindsToday()).toBe(3);
  });
});

describe('finds — clearFinds', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('очищает все finds', async () => {
    await markStoneFound('s1', 60, 24);
    await markStoneFound('s2', 60, 24);
    await clearFinds();
    expect(await getFoundStoneIds()).toEqual([]);
  });

  test('не падает на пустом storage', async () => {
    await expect(clearFinds()).resolves.not.toThrow();
  });
});

describe('finds — author anti-fraud', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('getFindsOfAuthorToday = 0 на свежем storage', async () => {
    expect(await getFindsOfAuthorToday('author-1')).toBe(0);
  });

  test('recordAuthorFind увеличивает счётчик', async () => {
    await recordAuthorFind('author-1');
    expect(await getFindsOfAuthorToday('author-1')).toBe(1);
    await recordAuthorFind('author-1');
    expect(await getFindsOfAuthorToday('author-1')).toBe(2);
  });

  test('разные authors не смешиваются', async () => {
    await recordAuthorFind('author-a');
    await recordAuthorFind('author-b');
    expect(await getFindsOfAuthorToday('author-a')).toBe(1);
    expect(await getFindsOfAuthorToday('author-b')).toBe(1);
  });

  test('isAuthorLimitReached срабатывает при >= 2', () => {
    expect(isAuthorLimitReached(0)).toBe(false);
    expect(isAuthorLimitReached(1)).toBe(false);
    expect(isAuthorLimitReached(2)).toBe(true);
    expect(isAuthorLimitReached(5)).toBe(true);
  });

  test('daily rollover — старые дни очищаются при новом record', async () => {
    // Засеем старый день в storage
    const oldDay = '2025-01-01';
    const today = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem(AUTHOR_KEY, JSON.stringify({
      [oldDay]: { 'author-x': 5 },
    }));
    // Запись нового find → cleanup
    await recordAuthorFind('author-y');
    const raw = await AsyncStorage.getItem(AUTHOR_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed[oldDay]).toBeUndefined();
    expect(parsed[today]['author-y']).toBe(1);
  });
});
