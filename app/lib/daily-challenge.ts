import AsyncStorage from '@react-native-async-storage/async-storage';
import { DailyChallengeCompleted } from './analytics';
import { earnPoints } from './points';

const STORAGE_KEY = 'stobi:daily_challenge';
// Награда за выполнение daily challenge — раньше была 0, в UI говорилось
// "получи алмазики за задание" но никаких grant'ов не было.
// 10💎 — middle ground: достойно за 5 находок / 2 хайда, не overpowered.
export const CHALLENGE_REWARD = 10;

export type ChallengeId =
  | 'find-3' | 'hide-1' | 'find-5' | 'social-chat'
  | 'hide-2' | 'walk-find' | 'tag-match' | 'combo';

export type ChallengeDef = {
  id: ChallengeId;
  labelKey: string;
  target: number;
  actions: Array<'find' | 'hide' | 'chat'>;
};

export type ChallengeState = {
  date: string;
  challengeId: ChallengeId;
  progress: number;
  target: number;
  completed: boolean;
  streakCount: number;
};

export const CHALLENGE_DEFS: ChallengeDef[] = [
  { id: 'find-3', labelKey: 'challenge.find_3', target: 3, actions: ['find'] },
  { id: 'hide-1', labelKey: 'challenge.hide_1', target: 1, actions: ['hide'] },
  { id: 'find-5', labelKey: 'challenge.find_5', target: 5, actions: ['find'] },
  { id: 'social-chat', labelKey: 'challenge.social_chat', target: 2, actions: ['chat', 'find'] },
  { id: 'hide-2', labelKey: 'challenge.hide_2', target: 2, actions: ['hide'] },
  { id: 'walk-find', labelKey: 'challenge.walk_find', target: 1, actions: ['find'] },
  { id: 'tag-match', labelKey: 'challenge.tag_match', target: 2, actions: ['find'] },
  { id: 'combo', labelKey: 'challenge.combo', target: 3, actions: ['find', 'hide'] },
];

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDayIndex(): number {
  const days = Math.floor(Date.now() / 86400000);
  return days % CHALLENGE_DEFS.length;
}

export async function getTodayChallenge(): Promise<ChallengeState> {
  const today = getTodayStr();

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const stored: ChallengeState | null = raw ? JSON.parse(raw) : null;

    if (stored && stored.date === today) return stored;

    // New day — pick challenge and update streak
    const def = CHALLENGE_DEFS[getDayIndex()];
    const wasCompletedYesterday = stored?.completed ?? false;
    const prevStreak = stored?.streakCount ?? 0;

    const state: ChallengeState = {
      date: today,
      challengeId: def.id,
      progress: 0,
      target: def.target,
      completed: false,
      streakCount: wasCompletedYesterday ? prevStreak + 1 : 0,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  } catch {
    const def = CHALLENGE_DEFS[getDayIndex()];
    return {
      date: today,
      challengeId: def.id,
      progress: 0,
      target: def.target,
      completed: false,
      streakCount: 0,
    };
  }
}

export async function updateChallengeProgress(
  action: 'find' | 'hide' | 'chat',
): Promise<ChallengeState> {
  const state = await getTodayChallenge();
  if (state.completed) return state;

  const def = CHALLENGE_DEFS.find((d) => d.id === state.challengeId);
  if (!def || !def.actions.includes(action)) return state;

  const wasCompleted = state.completed;
  state.progress = Math.min(state.progress + 1, state.target);
  if (state.progress >= state.target) {
    state.completed = true;
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!wasCompleted && state.completed) {
    void DailyChallengeCompleted(state.challengeId);
    // Награждаем 💎 ровно один раз в день. ref_id = challenge:<id>:<date>
    // используется как dedupe ключ — если юзер каким-то образом call'ает
    // повторно, balance_events уникальность защитит (см. unique constraint
    // или просто overwrite через ref_id check). На клиенте лишний earnPoints
    // безопасен — server rate-limit его придушит.
    try {
      await earnPoints(
        CHALLENGE_REWARD,
        `challenge:${state.challengeId}`,
        `${state.challengeId}:${state.date}`,
      );
    } catch (e) {
      console.warn('[challenge] reward grant failed', e);
    }
  }
  return state;
}
