import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTodayChallenge,
  updateChallengeProgress,
  CHALLENGE_DEFS,
  type ChallengeState,
} from '../lib/daily-challenge';

const STORAGE_KEY = 'stobi:daily_challenge';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

describe('daily-challenge — streak', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('streak 0 when no history', async () => {
    const state = await getTodayChallenge();
    expect(state.streakCount).toBe(0);
    expect(state.date).toBe(today());
    expect(state.progress).toBe(0);
    expect(state.completed).toBe(false);
  });

  test('streak increments when yesterday was completed', async () => {
    // Seed yesterday's completed state
    const yesterday: ChallengeState = {
      date: daysAgo(1),
      challengeId: 'find-3',
      progress: 3,
      target: 3,
      completed: true,
      streakCount: 4,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(yesterday));

    const state = await getTodayChallenge();
    // New day → streak should bump from 4 to 5
    expect(state.streakCount).toBe(5);
    expect(state.date).toBe(today());
    expect(state.progress).toBe(0);
  });

  test('streak resets to 0 when yesterday was incomplete', async () => {
    const yesterday: ChallengeState = {
      date: daysAgo(1),
      challengeId: 'find-3',
      progress: 1,
      target: 3,
      completed: false,
      streakCount: 7,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(yesterday));

    const state = await getTodayChallenge();
    expect(state.streakCount).toBe(0);
  });

  test('same-day call is idempotent — returns persisted state', async () => {
    const first = await getTodayChallenge();
    first.progress = 2;  // simulate external mutation stored
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(first));

    const second = await getTodayChallenge();
    expect(second.progress).toBe(2);
    expect(second.date).toBe(first.date);
    expect(second.challengeId).toBe(first.challengeId);
  });
});

describe('daily-challenge — progress', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('increments progress for matching action', async () => {
    // force challenge "find-3"
    const state: ChallengeState = {
      date: today(),
      challengeId: 'find-3',
      progress: 0,
      target: 3,
      completed: false,
      streakCount: 0,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    let updated = await updateChallengeProgress('find');
    expect(updated.progress).toBe(1);
    updated = await updateChallengeProgress('find');
    expect(updated.progress).toBe(2);
    updated = await updateChallengeProgress('find');
    expect(updated.progress).toBe(3);
    expect(updated.completed).toBe(true);
  });

  test('ignores non-matching actions', async () => {
    const state: ChallengeState = {
      date: today(),
      challengeId: 'find-3',
      progress: 0,
      target: 3,
      completed: false,
      streakCount: 0,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    const after = await updateChallengeProgress('hide');
    expect(after.progress).toBe(0);
    const after2 = await updateChallengeProgress('chat');
    expect(after2.progress).toBe(0);
  });

  test('does not over-increment past target', async () => {
    const state: ChallengeState = {
      date: today(),
      challengeId: 'find-3',
      progress: 2,
      target: 3,
      completed: false,
      streakCount: 0,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    let updated = await updateChallengeProgress('find');
    expect(updated.progress).toBe(3);
    expect(updated.completed).toBe(true);

    // Extra finds after completion → no-op
    updated = await updateChallengeProgress('find');
    expect(updated.progress).toBe(3);
  });
});

describe('daily-challenge — catalog sanity', () => {
  test('all definitions have target ≥ 1', () => {
    for (const def of CHALLENGE_DEFS) {
      expect(def.target).toBeGreaterThanOrEqual(1);
      expect(def.actions.length).toBeGreaterThan(0);
    }
  });

  test('8 definitions total', () => {
    expect(CHALLENGE_DEFS.length).toBe(8);
  });
});
