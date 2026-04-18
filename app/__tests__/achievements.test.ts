import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACHIEVEMENT_DEFS, checkAchievements, getAchievements, type AchievementStats } from '../lib/achievements';

// Mock dependencies — achievements.ts вызывает earnPoints & unlockCosmeticById
jest.mock('../lib/points', () => ({
  earnPoints: jest.fn(async () => 0),
  unlockCosmeticById: jest.fn(async () => {}),
}));

const baseStats = (): AchievementStats => ({
  totalFinds: 0,
  totalHides: 0,
  chatMessages: 0,
  streakDays: 0,
  citiesCount: 0,
  foundArtistStone: false,
  maxStoneFindCount: 0,
});

describe('achievements — catalog sanity', () => {
  test('15 definitions total', () => {
    expect(ACHIEVEMENT_DEFS.length).toBe(15);
  });

  test('all definitions have positive target + reward', () => {
    for (const def of ACHIEVEMENT_DEFS) {
      expect(def.target).toBeGreaterThanOrEqual(1);
      expect(def.reward).toBeGreaterThan(0);
    }
  });

  test('unique IDs', () => {
    const ids = ACHIEVEMENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('find milestones escalate', () => {
    const findMilestones = [1, 5, 10, 25, 50, 100];
    for (const target of findMilestones) {
      const def = ACHIEVEMENT_DEFS.find((d) => d.category === 'find' && d.target === target);
      expect(def).toBeDefined();
    }
  });

  test('premium cosmetics гарантированно unlock через achievements', () => {
    // Важный инвариант: player может получить premium-only косметику через grind,
    // не обязательно купить подписку. Должен быть как минимум 1 такой achievement.
    const withPremium = ACHIEVEMENT_DEFS.filter((d) => d.unlockCosmeticId);
    expect(withPremium.length).toBeGreaterThan(0);
  });
});

describe('achievements — checkAchievements', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('no unlocks when no progress', async () => {
    const unlocked = await checkAchievements(baseStats());
    expect(unlocked).toEqual([]);
  });

  test('find-first unlocks at 1 find', async () => {
    const stats = { ...baseStats(), totalFinds: 1 };
    const unlocked = await checkAchievements(stats);
    expect(unlocked).toContain('find-first');
  });

  test('find-5 unlocks at 5 finds (в том числе вместе с find-first)', async () => {
    const stats = { ...baseStats(), totalFinds: 5 };
    const unlocked = await checkAchievements(stats);
    // За один вызов может unlock несколько ачивок одновременно (догоняющий)
    expect(unlocked).toContain('find-first');
    expect(unlocked).toContain('find-5');
  });

  test('идемпотентность — повторный вызов не unlocks повторно', async () => {
    const stats = { ...baseStats(), totalFinds: 5 };
    const first = await checkAchievements(stats);
    expect(first).toContain('find-first');

    const second = await checkAchievements(stats);
    expect(second).toEqual([]); // ничего нового
  });

  test('прогресс записывается даже без unlock', async () => {
    const stats = { ...baseStats(), totalFinds: 3 };
    await checkAchievements(stats);
    const state = await getAchievements();
    expect(state['find-5'].unlocked).toBe(false);
    expect(state['find-5'].progress).toBe(3);
  });

  test('hide-first unlocks от totalHides, не totalFinds', async () => {
    const statsFinds = { ...baseStats(), totalFinds: 10 };
    const unlockedByFinds = await checkAchievements(statsFinds);
    expect(unlockedByFinds).not.toContain('hide-first');

    await AsyncStorage.clear();
    const statsHides = { ...baseStats(), totalHides: 1 };
    const unlockedByHides = await checkAchievements(statsHides);
    expect(unlockedByHides).toContain('hide-first');
  });

  test('social-chat отслеживает chatMessages', async () => {
    const unlocked = await checkAchievements({ ...baseStats(), chatMessages: 1 });
    expect(unlocked).toContain('social-chat');
  });

  test('streak-7 unlocks на 7 дней подряд', async () => {
    const unlocked = await checkAchievements({ ...baseStats(), streakDays: 7 });
    expect(unlocked).toContain('streak-7');
  });

  test('explorer-3 unlocks на 3 городах', async () => {
    const unlocked = await checkAchievements({ ...baseStats(), citiesCount: 3 });
    expect(unlocked).toContain('explorer-3');
  });

  test('special-artist unlocks только при foundArtistStone=true', async () => {
    const noArtist = await checkAchievements({ ...baseStats(), foundArtistStone: false });
    expect(noArtist).not.toContain('special-artist');

    await AsyncStorage.clear();
    const withArtist = await checkAchievements({ ...baseStats(), foundArtistStone: true });
    expect(withArtist).toContain('special-artist');
  });

  test('unlockedAt timestamp устанавливается', async () => {
    const before = Date.now();
    await checkAchievements({ ...baseStats(), totalFinds: 1 });
    const after = Date.now();
    const state = await getAchievements();
    expect(state['find-first'].unlockedAt).toBeGreaterThanOrEqual(before);
    expect(state['find-first'].unlockedAt).toBeLessThanOrEqual(after);
  });
});
