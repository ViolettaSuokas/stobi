import AsyncStorage from '@react-native-async-storage/async-storage';
import { earnPoints, unlockCosmeticById } from './points';
import { getFoundStoneIds } from './finds';
import { getUserStones } from './user-stones';
import { getCurrentUser } from './auth';
import { AchievementUnlocked } from './analytics';
import { getTodayChallenge } from './daily-challenge';

const STORAGE_KEY = 'stobi:achievements';

export type AchievementDef = {
  id: string;
  icon: string;
  labelKey: string;
  reward: number;
  hidden: boolean;
  target: number;
  category: 'find' | 'hide' | 'social' | 'streak' | 'explorer' | 'special';
  /** Cosmetic item ID unlocked on completion (bypasses premium gate). */
  unlockCosmeticId?: string;
};

export type AchievementProgress = {
  unlocked: boolean;
  unlockedAt?: number;
  progress: number;
};

export type AchievementState = Record<string, AchievementProgress>;

export type AchievementStats = {
  totalFinds: number;
  totalHides: number;
  chatMessages: number;
  streakDays: number;
  citiesCount: number;
  foundArtistStone: boolean;
  maxStoneFindCount: number;
};

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // Finding milestones
  { id: 'find-first', icon: 'Sparkle', labelKey: 'achievement.find_first', reward: 5, hidden: false, target: 1, category: 'find' },
  { id: 'find-5', icon: 'MagnifyingGlass', labelKey: 'achievement.find_5', reward: 10, hidden: false, target: 5, category: 'find' },
  { id: 'find-10', icon: 'MagnifyingGlass', labelKey: 'achievement.find_10', reward: 15, hidden: false, target: 10, category: 'find' },
  { id: 'find-25', icon: 'Binoculars', labelKey: 'achievement.find_25', reward: 25, hidden: false, target: 25, category: 'find' },
  { id: 'find-50', icon: 'Trophy', labelKey: 'achievement.find_50', reward: 40, hidden: false, target: 50, category: 'find' },
  { id: 'find-100', icon: 'Crown', labelKey: 'achievement.find_100', reward: 75, hidden: false, target: 100, category: 'find', unlockCosmeticId: 'color-galaxy' },
  // Hiding milestones
  { id: 'hide-first', icon: 'PaintBrush', labelKey: 'achievement.hide_first', reward: 5, hidden: false, target: 1, category: 'hide' },
  { id: 'hide-5', icon: 'PaintBrush', labelKey: 'achievement.hide_5', reward: 15, hidden: false, target: 5, category: 'hide' },
  { id: 'hide-10', icon: 'Star', labelKey: 'achievement.hide_10', reward: 25, hidden: false, target: 10, category: 'hide' },
  { id: 'hide-25', icon: 'Medal', labelKey: 'achievement.hide_25', reward: 50, hidden: false, target: 25, category: 'hide', unlockCosmeticId: 'decor-crown' },
  // Social
  { id: 'social-chat', icon: 'ChatCircle', labelKey: 'achievement.social_chat', reward: 5, hidden: false, target: 1, category: 'social' },
  { id: 'social-popular', icon: 'Heart', labelKey: 'achievement.social_popular', reward: 30, hidden: false, target: 10, category: 'social', unlockCosmeticId: 'eye-heart' },
  // Streak / Explorer / Special
  { id: 'streak-7', icon: 'Fire', labelKey: 'achievement.streak_7', reward: 20, hidden: false, target: 7, category: 'streak', unlockCosmeticId: 'shape-star' },
  { id: 'explorer-3', icon: 'Compass', labelKey: 'achievement.explorer_3', reward: 20, hidden: false, target: 3, category: 'explorer', unlockCosmeticId: 'color-aurora' },
  { id: 'special-artist', icon: 'Lightning', labelKey: 'achievement.special_artist', reward: 15, hidden: true, target: 1, category: 'special', unlockCosmeticId: 'decor-wizard' },
];

function getProgressForAchievement(def: AchievementDef, stats: AchievementStats): number {
  switch (def.id) {
    case 'find-first': case 'find-5': case 'find-10':
    case 'find-25': case 'find-50': case 'find-100':
      return stats.totalFinds;
    case 'hide-first': case 'hide-5': case 'hide-10': case 'hide-25':
      return stats.totalHides;
    case 'social-chat':
      return stats.chatMessages;
    case 'social-popular':
      return stats.maxStoneFindCount;
    case 'streak-7':
      return stats.streakDays;
    case 'explorer-3':
      return stats.citiesCount;
    case 'special-artist':
      return stats.foundArtistStone ? 1 : 0;
    default:
      return 0;
  }
}

export async function getAchievements(): Promise<AchievementState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { console.warn(e);
    return {};
  }
}

export async function checkAchievements(stats: AchievementStats): Promise<string[]> {
  const state = await getAchievements();
  const newlyUnlocked: string[] = [];
  // Server-side источник правды для "уже получил награду": balance_events
  // с reason='achievement:<id>'. Если запись есть — независимо от локального
  // unlocked флага, награду повторно не даём. Если нет — даём (даже если
  // local state.unlocked=true: значит earnPoints в прошлый раз упал и
  // нужно повторить попытку).
  const grantedIds = await getGrantedAchievementIds();

  for (const def of ACHIEVEMENT_DEFS) {
    const progress = getProgressForAchievement(def, stats);
    const current = state[def.id] ?? { unlocked: false, progress: 0 };
    current.progress = progress;

    const eligibleForReward = progress >= def.target && !grantedIds.has(def.id);
    if (eligibleForReward) {
      // Critical fix: грант делаем ПЕРЕД unlocked=true. Если earnPoints
      // упадёт (например, rate-limit, сеть, server) — local state
      // остаётся unlocked=false, и в следующий вызов ачивка переригерится.
      // Раньше: ставили unlocked=true → earnPoints failed → permanent loss.
      let granted = false;
      try {
        const newBalance = await earnPoints(def.reward, `achievement:${def.id}`, def.id);
        granted = typeof newBalance === 'number';
      } catch (e) {
        console.warn(`[achievements] failed to grant ${def.id}, retry next time`, e);
      }
      if (granted) {
        current.unlocked = true;
        current.unlockedAt = Date.now();
        if (def.unlockCosmeticId) {
          await unlockCosmeticById(def.unlockCosmeticId, def.id);
        }
        void AchievementUnlocked(def.id, def.reward);
        newlyUnlocked.push(def.id);
      }
    } else if (progress >= def.target && grantedIds.has(def.id) && !current.unlocked) {
      // Edge case: grant в balance_events есть, но local state потерян
      // (reinstall / переустановка). Reconcile: ставим unlocked=true.
      current.unlocked = true;
      current.unlockedAt = Date.now();
    }

    state[def.id] = current;
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return newlyUnlocked;
}

// Считаем все сообщения юзера прямо через DB (без channel-фильтра).
// Старая версия звала getMessages() с default='global' — но юзер шлёт
// в 'FI'/'global'/etc, и social-chat ачивка не триггерилась.
async function countUserMessagesAcrossChannels(): Promise<number> {
  try {
    const { isSupabaseConfigured, supabase } = await import('./supabase');
    if (!isSupabaseConfigured()) return 0;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', user.id);
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Источник правды для "награда уже выдана": balance_events на сервере.
// Если RPC fails / offline — считаем что nothing granted (better try and
// fail than skip and lose). Возвращаем Set для O(1) lookup.
async function getGrantedAchievementIds(): Promise<Set<string>> {
  const granted = new Set<string>();
  try {
    const { isSupabaseConfigured, supabase } = await import('./supabase');
    if (!isSupabaseConfigured()) return granted;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return granted;
    const { data } = await supabase
      .from('balance_events')
      .select('reason, ref_id')
      .eq('user_id', user.id)
      .like('reason', 'achievement:%');
    if (data) {
      for (const row of data as Array<{ reason: string; ref_id: string | null }>) {
        const id = row.ref_id ?? row.reason.replace(/^achievement:/, '');
        if (id) granted.add(id);
      }
    }
  } catch (e) {
    console.warn('[achievements] getGrantedAchievementIds failed', e);
  }
  return granted;
}

export async function gatherAchievementStats(): Promise<AchievementStats> {
  const [foundIds, userStones, user, challenge, chatMessages] = await Promise.all([
    getFoundStoneIds(),
    getUserStones(),
    getCurrentUser(),
    getTodayChallenge(),
    countUserMessagesAcrossChannels(),
  ]);

  return {
    totalFinds: foundIds.length,
    totalHides: userStones.length,
    chatMessages,
    streakDays: challenge.streakCount,
    citiesCount: 0,
    foundArtistStone: false,
    maxStoneFindCount: 0,
  };
}
