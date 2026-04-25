// Community activity feed — hides and finds across all of Finland.
// Pure mock data on module-import (no AsyncStorage). Replace internals with
// backend calls when we ship the real API.

import type { StonePhotoKey } from './stone-photos';
import { getCached, setCached } from './cache';

export type ActivityType = 'hide' | 'find';

export type Activity = {
  id: string;
  type: ActivityType;
  userId: string;
  userName: string;
  /** Эмодзи (всегда есть, fallback). */
  userAvatar: string;
  /** Фото-аватарка из профиля если юзер её загрузил — приоритет над эмодзи. */
  userPhotoUrl?: string;
  isArtist?: boolean;
  stoneId: string;
  stoneEmoji: string;
  stoneName: string;
  /** Gradient pair, matches NearbyStone.colors shape */
  stoneColors: readonly [string, string];
  city: string;
  /** Milliseconds since epoch */
  createdAt: number;
  /**
   * Optional bundled photo key (for seed data).
   * Lookup the image source via STONE_PHOTOS[photo] in stone-photos.ts.
   */
  photo?: StonePhotoKey;
  /** Real photo URI from camera/gallery (for user-created stones) */
  photoUri?: string;
};

export type DayStats = {
  hiddenToday: number;
  foundToday: number;
  hiddenWeek: number;
  foundWeek: number;
};

export type LeaderboardKind = 'hide' | 'find';
export type LeaderboardPeriod = 'today' | 'week' | 'all';

export type LeaderEntry = {
  rank: number;
  userId: string;
  userName: string;
  userAvatar: string;
  userPhotoUrl?: string;
  isArtist?: boolean;
  count: number;
};

// ────────────────────────────────────────────
// Seed users — match chat.ts authors so identity is consistent everywhere
// ────────────────────────────────────────────

type SeedUser = {
  id: string;
  name: string;
  avatar: string;
  isArtist?: boolean;
};

const USERS: Record<string, SeedUser> = {
  aleksi: { id: 'seed-aleksi', name: 'Aleksi K.', avatar: '🦋' },
  anna: { id: 'seed-anna', name: 'Anna V.', avatar: '🎨', isArtist: true },
  mika: { id: 'seed-mika', name: 'Mika L.', avatar: '🌲' },
  sari: { id: 'seed-sari', name: 'Sari M.', avatar: '🌿' },
  julia: { id: 'seed-julia', name: 'Юлия И.', avatar: '🌸' },
  petri: { id: 'seed-petri', name: 'Petri N.', avatar: '🔥' },
  kirsi: { id: 'seed-kirsi', name: 'Kirsi T.', avatar: '🌊' },
  pekka: { id: 'seed-pekka', name: 'Pekka R.', avatar: '🦉', isArtist: true },
};

// ────────────────────────────────────────────
// Stone palette references — keep in sync with location.ts gradients
// ────────────────────────────────────────────

const C = {
  pink: ['#F5D0FE', '#A855F7'] as const,
  blue: ['#BFDBFE', '#2563EB'] as const,
  green: ['#BBF7D0', '#15803D'] as const,
  amber: ['#FDE68A', '#D97706'] as const,
  coral: ['#FCA5A5', '#DC2626'] as const,
  violet: ['#DDD6FE', '#7C3AED'] as const,
  teal: ['#A7F3D0', '#059669'] as const,
  peach: ['#FED7AA', '#EA580C'] as const,
};

// ────────────────────────────────────────────
// Seed activities — calculated relative to NOW so timestamps stay fresh
// ────────────────────────────────────────────

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type SeedDef = {
  type: ActivityType;
  user: keyof typeof USERS;
  stoneId: string;
  stoneEmoji: string;
  stoneName: string;
  stoneColors: readonly [string, string];
  city: string;
  ago: number; // ms in the past
  photo?: StonePhotoKey;
};

// Empty by default — only real user activity is shown
const SEED: SeedDef[] = [];

const _UNUSED_SEED: SeedDef[] = [
  // ─── TODAY (within 24h) ─── 10 events
  { type: 'find', user: 'aleksi', stoneId: 'h1', stoneEmoji: '🌸', stoneName: 'Весенняя сакура', stoneColors: C.pink, city: 'Helsinki', ago: 6 * MIN, photo: 'pinkFlower' },
  { type: 'hide', user: 'anna', stoneId: 'h2', stoneEmoji: '🦋', stoneName: 'Синяя бабочка', stoneColors: C.blue, city: 'Helsinki', ago: 18 * MIN, photo: 'blueSwirls' },
  { type: 'find', user: 'mika', stoneId: 'tm1', stoneEmoji: '🌲', stoneName: 'Лесная сова', stoneColors: C.green, city: 'Tampere', ago: 42 * MIN, photo: 'greenDaisies' },
  { type: 'find', user: 'sari', stoneId: 't1', stoneEmoji: '⛵', stoneName: 'Парусник', stoneColors: C.blue, city: 'Turku', ago: 1 * HOUR + 15 * MIN, photo: 'oceanView' },
  { type: 'hide', user: 'aleksi', stoneId: 'l1', stoneEmoji: '🏔️', stoneName: 'Горный пейзаж', stoneColors: C.violet, city: 'Lahti', ago: 2 * HOUR + 5 * MIN },
  { type: 'find', user: 'julia', stoneId: 'h3', stoneEmoji: '🌊', stoneName: 'Морской закат', stoneColors: C.green, city: 'Helsinki', ago: 3 * HOUR + 20 * MIN, photo: 'heartFlowers' },
  { type: 'find', user: 'anna', stoneId: 'tm2', stoneEmoji: '🌿', stoneName: 'Лесные травы', stoneColors: C.peach, city: 'Tampere', ago: 4 * HOUR },
  { type: 'hide', user: 'petri', stoneId: 'va1', stoneEmoji: '🌅', stoneName: 'Закат Bothnia', stoneColors: C.peach, city: 'Vaasa', ago: 5 * HOUR + 30 * MIN, photo: 'oceanView' },
  { type: 'find', user: 'aleksi', stoneId: 't2', stoneEmoji: '🏰', stoneName: 'Старый замок', stoneColors: C.violet, city: 'Turku', ago: 8 * HOUR, photo: 'ghostCupcake' },
  { type: 'hide', user: 'mika', stoneId: 'k1', stoneEmoji: '🐟', stoneName: 'Рыбка Saimaa', stoneColors: C.teal, city: 'Kuopio', ago: 14 * HOUR, photo: 'mouse' },

  // ─── THIS WEEK (1-6 days ago) ─── 12 events
  { type: 'find', user: 'aleksi', stoneId: 'h2', stoneEmoji: '🦋', stoneName: 'Синяя бабочка', stoneColors: C.blue, city: 'Helsinki', ago: 1 * DAY + 2 * HOUR, photo: 'pinkOwl' },
  { type: 'hide', user: 'anna', stoneId: 'h1', stoneEmoji: '🌸', stoneName: 'Весенняя сакура', stoneColors: C.pink, city: 'Helsinki', ago: 1 * DAY + 5 * HOUR },
  { type: 'find', user: 'sari', stoneId: 'jo1', stoneEmoji: '🌲', stoneName: 'Карельская ель', stoneColors: C.green, city: 'Joensuu', ago: 2 * DAY, photo: 'owlHeart' },
  { type: 'find', user: 'kirsi', stoneId: 'o1', stoneEmoji: '❄️', stoneName: 'Снежинка севера', stoneColors: C.blue, city: 'Oulu', ago: 2 * DAY + 4 * HOUR },
  { type: 'hide', user: 'pekka', stoneId: 'r1', stoneEmoji: '🎅', stoneName: 'Дом Деда Мороза', stoneColors: C.coral, city: 'Rovaniemi', ago: 3 * DAY, photo: 'marioSet' },
  { type: 'find', user: 'mika', stoneId: 'j1', stoneEmoji: '🌊', stoneName: 'Озеро Päijänne', stoneColors: C.blue, city: 'Jyväskylä', ago: 3 * DAY + 6 * HOUR },
  { type: 'find', user: 'julia', stoneId: 'e1', stoneEmoji: '🔮', stoneName: 'Магический шар', stoneColors: C.amber, city: 'Espoo', ago: 4 * DAY },
  { type: 'hide', user: 'anna', stoneId: 'v1', stoneEmoji: '🐉', stoneName: 'Дракон удачи', stoneColors: C.coral, city: 'Vantaa', ago: 4 * DAY + 8 * HOUR },
  { type: 'find', user: 'aleksi', stoneId: 'r2', stoneEmoji: '🌌', stoneName: 'Aurora Borealis', stoneColors: C.violet, city: 'Rovaniemi', ago: 5 * DAY },
  { type: 'find', user: 'petri', stoneId: 'o2', stoneEmoji: '🦉', stoneName: 'Полярная сова', stoneColors: C.violet, city: 'Oulu', ago: 5 * DAY + 4 * HOUR, photo: 'owlHeart' },
  { type: 'hide', user: 'kirsi', stoneId: 'tm1', stoneEmoji: '🌲', stoneName: 'Лесная сова', stoneColors: C.green, city: 'Tampere', ago: 6 * DAY },
  { type: 'find', user: 'sari', stoneId: 'h3', stoneEmoji: '🌊', stoneName: 'Морской закат', stoneColors: C.green, city: 'Helsinki', ago: 6 * DAY + 12 * HOUR },

  // ─── ALL TIME (8-30 days ago) ─── 8 events
  { type: 'find', user: 'aleksi', stoneId: 'h1', stoneEmoji: '🌸', stoneName: 'Весенняя сакура', stoneColors: C.pink, city: 'Helsinki', ago: 9 * DAY },
  { type: 'hide', user: 'pekka', stoneId: 'jo1', stoneEmoji: '🌲', stoneName: 'Карельская ель', stoneColors: C.green, city: 'Joensuu', ago: 12 * DAY },
  { type: 'find', user: 'anna', stoneId: 'va1', stoneEmoji: '🌅', stoneName: 'Закат Bothnia', stoneColors: C.peach, city: 'Vaasa', ago: 14 * DAY },
  { type: 'find', user: 'mika', stoneId: 'k1', stoneEmoji: '🐟', stoneName: 'Рыбка Saimaa', stoneColors: C.teal, city: 'Kuopio', ago: 16 * DAY },
  { type: 'hide', user: 'aleksi', stoneId: 'l1', stoneEmoji: '🏔️', stoneName: 'Горный пейзаж', stoneColors: C.violet, city: 'Lahti', ago: 19 * DAY },
  { type: 'find', user: 'julia', stoneId: 'tm2', stoneEmoji: '🌿', stoneName: 'Лесные травы', stoneColors: C.peach, city: 'Tampere', ago: 22 * DAY },
  { type: 'find', user: 'sari', stoneId: 't1', stoneEmoji: '⛵', stoneName: 'Парусник', stoneColors: C.blue, city: 'Turku', ago: 26 * DAY },
  { type: 'hide', user: 'anna', stoneId: 'r2', stoneEmoji: '🌌', stoneName: 'Aurora Borealis', stoneColors: C.violet, city: 'Rovaniemi', ago: 29 * DAY },
];

const ACTIVITIES: Activity[] = SEED.map((s, i) => {
  const u = USERS[s.user];
  return {
    id: `act-${i + 1}`,
    type: s.type,
    userId: u.id,
    userName: u.name,
    userAvatar: u.avatar,
    isArtist: u.isArtist,
    stoneId: s.stoneId,
    stoneEmoji: s.stoneEmoji,
    stoneName: s.stoneName,
    stoneColors: s.stoneColors,
    city: s.city,
    createdAt: NOW - s.ago,
    photo: s.photo,
  };
}).sort((a, b) => b.createdAt - a.createdAt); // newest first

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

async function loadAllActivities(): Promise<Activity[]> {
  // Server-backed activity: загружаем последние hides/finds из БД.
  // Раньше было: seed + локальные хайды → юзеры не видели хайды друг
  // друга в общей ленте, журнал камня показывал только seed-историю.
  const { isSupabaseConfigured, supabase } = await import('./supabase');
  if (!isSupabaseConfigured()) {
    // Offline / not signed in — fallback на локальные.
    const { getUserStones, toActivity } = await import('./user-stones');
    const userStones = await getUserStones();
    return userStones.map(toActivity).sort((a, b) => b.createdAt - a.createdAt);
  }

  const FETCH_LIMIT = 50;

  try {
    const [hidesRes, findsRes] = await Promise.all([
      supabase
        .from('stones')
        .select('id, name, emoji, city, photo_url, created_at, author_id, profiles!stones_author_id_fkey(id, username, avatar, is_artist, photo_url)')
        .or('is_hidden.is.null,is_hidden.eq.false')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT),
      supabase
        .from('finds')
        .select('id, found_at, user_id, stone_id, profiles!finds_user_id_fkey(id, username, avatar, is_artist, photo_url), stones!inner(name, emoji, city, photo_url)')
        .order('found_at', { ascending: false })
        .limit(FETCH_LIMIT),
    ]);

    const hides: Activity[] = (hidesRes.data ?? []).map((row: Record<string, any>) => ({
      id: `hide-${row.id}`,
      type: 'hide' as ActivityType,
      userId: row.author_id ?? 'deleted',
      userName: row.profiles?.username ?? 'Удалённый юзер',
      userAvatar: row.profiles?.avatar ?? '🪨',
      userPhotoUrl: row.profiles?.photo_url ?? undefined,
      isArtist: row.profiles?.is_artist ?? false,
      stoneId: row.id,
      stoneEmoji: row.emoji ?? '🪨',
      stoneName: row.name ?? 'Камень',
      stoneColors: ['#C4B5FD', '#7C3AED'] as const,
      city: row.city ?? '',
      createdAt: new Date(row.created_at).getTime(),
      photoUri: row.photo_url ?? undefined,
    }));

    const finds: Activity[] = (findsRes.data ?? []).map((row: Record<string, any>) => ({
      id: `find-${row.id}`,
      type: 'find' as ActivityType,
      userId: row.user_id ?? 'deleted',
      userName: row.profiles?.username ?? 'Удалённый юзер',
      userAvatar: row.profiles?.avatar ?? '🪨',
      userPhotoUrl: row.profiles?.photo_url ?? undefined,
      isArtist: row.profiles?.is_artist ?? false,
      stoneId: row.stone_id,
      stoneEmoji: row.stones?.emoji ?? '🪨',
      stoneName: row.stones?.name ?? 'Камень',
      stoneColors: ['#86EFAC', '#16A34A'] as const,
      city: row.stones?.city ?? '',
      createdAt: new Date(row.found_at).getTime(),
      // Превью находки — берём фото самого камня (то что видел autor при
      // hide). Раньше было undefined → в ленте показывался серый-каменный
      // fallback вместо реальной картинки.
      photoUri: row.stones?.photo_url ?? undefined,
    }));

    return [...hides, ...finds].sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.warn('[activity] DB load failed, fallback to local stones', e);
    const { getUserStones, toActivity } = await import('./user-stones');
    const userStones = await getUserStones();
    return userStones.map(toActivity).sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** Returns activities sorted newest-first, optionally limited. */
export async function getActivityFeed(limit?: number): Promise<Activity[]> {
  const cacheKey = `activityFeed:${limit ?? 'all'}`;
  const cached = getCached<Activity[]>(cacheKey);
  if (cached) return cached;
  const all = await loadAllActivities();
  const result = limit ? all.slice(0, limit) : all;
  // 15 сек — компромисс между UX-fresh и нагрузкой на БД. На find/hide
  // вызовы invalidateActivityFeed() убирают cache мгновенно для актора.
  setCached(cacheKey, result, 15_000);
  return result;
}

/** Эарly-инвалидация — вызывать после действий, которые меняют ленту:
 *  hide камня, approve pending find, reject. Нет смысла ждать 15с TTL
 *  если юзер только что что-то сделал. */
export async function invalidateActivityFeed(): Promise<void> {
  const { invalidate } = await import('./cache');
  invalidate('activityFeed:all');
  for (const limit of [10, 20, 30, 50, 100]) {
    invalidate(`activityFeed:${limit}`);
  }
}

/** Counts of hides/finds today and this week (rolling). */
export async function getDayStats(): Promise<DayStats> {
  const all = await loadAllActivities();
  const now = Date.now();
  const dayCutoff = now - DAY;
  const weekCutoff = now - 7 * DAY;
  let hiddenToday = 0;
  let foundToday = 0;
  let hiddenWeek = 0;
  let foundWeek = 0;
  for (const a of all) {
    if (a.createdAt >= dayCutoff) {
      if (a.type === 'hide') hiddenToday++;
      else foundToday++;
    }
    if (a.createdAt >= weekCutoff) {
      if (a.type === 'hide') hiddenWeek++;
      else foundWeek++;
    }
  }
  return { hiddenToday, foundToday, hiddenWeek, foundWeek };
}

/** Newest hidden stones — только те что ещё **никем не найдены**.
 *  Карусель "свежие камни" — для discovery, не должна показывать
 *  уже найденный камень (он уже не для всех "свежий"). */
export async function getRecentlyHidden(limit = 8): Promise<Activity[]> {
  const all = await loadAllActivities();
  // Собираем set stoneId которые уже нашли (есть find activity)
  const foundIds = new Set(all.filter((a) => a.type === 'find').map((a) => a.stoneId));
  return all
    .filter((a) => a.type === 'hide' && !foundIds.has(a.stoneId))
    .slice(0, limit);
}

/**
 * Activities by a specific user (their own profile feed).
 * Optionally filter by type. Newest first.
 */
export async function getUserActivities(
  userId: string,
  type?: ActivityType,
  limit?: number,
): Promise<Activity[]> {
  const all = await loadAllActivities();
  const filtered = all.filter(
    (a) => a.userId === userId && (type === undefined || a.type === type),
  );
  return limit ? filtered.slice(0, limit) : filtered;
}

/**
 * Map of demo account emails → seed user IDs in this mock activity store.
 * Lets the logged-in demo user see "their" activities in the profile.
 * When the real backend ships, user.id will match activity.userId directly
 * and this lookup will be removed.
 */
export const DEMO_SEED_USER_MAP: Record<string, string> = {
  'demo@stobi.app': 'seed-aleksi',
  'anna@stobi.app': 'seed-anna',
};

/** Top users by hides or finds, scoped to a time window. Returns top 5. */
export async function getLeaderboard(
  kind: LeaderboardKind,
  period: LeaderboardPeriod,
): Promise<LeaderEntry[]> {
  const now = Date.now();
  const cutoff =
    period === 'today' ? now - DAY : period === 'week' ? now - 7 * DAY : 0;

  const all = await loadAllActivities();
  const counts = new Map<string, { user: { id: string; name: string; avatar: string; photoUrl?: string; isArtist?: boolean }; count: number }>();
  for (const a of all) {
    if (a.type !== kind) continue;
    if (a.createdAt < cutoff) continue;
    const existing = counts.get(a.userId);
    if (existing) {
      existing.count++;
    } else {
      counts.set(a.userId, {
        user: { id: a.userId, name: a.userName, avatar: a.userAvatar, photoUrl: a.userPhotoUrl, isArtist: a.isArtist },
        count: 1,
      });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((e, i) => ({
      rank: i + 1,
      userId: e.user.id,
      userName: e.user.name,
      userAvatar: e.user.avatar,
      userPhotoUrl: e.user.photoUrl,
      isArtist: e.user.isArtist,
      count: e.count,
    }));
}

// ────────────────────────────────────────────
// Time formatting — shared helper
// ────────────────────────────────────────────

export function formatActivityTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / MIN);
  if (diffMin < 1) return 'сейчас';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч назад`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} ${pluralizeRu(diffDay, 'день', 'дня', 'дней')} назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
