import AsyncStorage from '@react-native-async-storage/async-storage';
import { earnPoints, unlockCosmeticById } from './points';
import { getFoundStoneIds } from './finds';
import { getUserStones } from './user-stones';
import { getMessages } from './chat';
import { getCurrentUser } from './auth';

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

  for (const def of ACHIEVEMENT_DEFS) {
    const progress = getProgressForAchievement(def, stats);
    const current = state[def.id] ?? { unlocked: false, progress: 0 };

    current.progress = progress;

    if (!current.unlocked && progress >= def.target) {
      current.unlocked = true;
      current.unlockedAt = Date.now();
      await earnPoints(def.reward);
      if (def.unlockCosmeticId) {
        await unlockCosmeticById(def.unlockCosmeticId);
      }
      newlyUnlocked.push(def.id);
    }

    state[def.id] = current;
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return newlyUnlocked;
}

export async function gatherAchievementStats(): Promise<AchievementStats> {
  const [foundIds, userStones, messages, user] = await Promise.all([
    getFoundStoneIds(),
    getUserStones(),
    getMessages(),
    getCurrentUser(),
  ]);

  const chatMessages = user
    ? messages.filter((m) => m.authorId === user.id).length
    : 0;

  return {
    totalFinds: foundIds.length,
    totalHides: userStones.length,
    chatMessages,
    streakDays: 0,
    citiesCount: 0,
    foundArtistStone: false,
    maxStoneFindCount: 0,
  };
}
