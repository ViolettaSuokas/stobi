import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { ItemPurchased } from './analytics';

// "Камешки" — the soft currency of Stobi. Earn by finding/hiding stones,
// spend on mascot cosmetics and map boosts.

const STORAGE_KEY = 'stobi:points';

/** Reward for finding a stone */
export const REWARD_FIND = 1;
/** Reward for hiding a stone */
export const REWARD_HIDE = 3;
/** Bonus for the author when their hidden stone is found by someone else */
export const REWARD_AUTHOR_ON_FIND = 2;
const STARTING_BALANCE = 0;

export type ItemCategory = 'color' | 'eye' | 'smile' | 'shape' | 'decor' | 'boost';

export type CosmeticItem = {
  id: string;
  category: ItemCategory;
  /** Display label */
  label: string;
  /** Price in камешки. 0 = free / unlocked by default */
  price: number;
  /** Free items are owned by every user from start */
  freeByDefault: boolean;
  /** Hex color (for color category) */
  color?: string;
  /** Mascot face variant the eye/smile maps to */
  variant?: 'happy' | 'sleeping' | 'wink' | 'sparkle';
  /** Mascot body shape (for shape category) */
  shape?: 'pebble' | 'round' | 'egg' | 'long' | 'bumpy' | 'tall';
  /** Mascot decoration (for decor category) */
  decor?: 'none' | 'flower' | 'leaf' | 'cat-ears' | 'glasses' | 'crown';
  /** If true, only Premium subscribers can purchase */
  premiumOnly?: boolean;
};

// ────────────────────────────────────────────
// Catalog — single source of truth for cosmetics
// ────────────────────────────────────────────

export const COLOR_ITEMS: CosmeticItem[] = [
  { id: 'color-lavender', category: 'color', label: 'Лавандовый', color: '#C4B5FD', price: 0, freeByDefault: true },
  { id: 'color-periwinkle', category: 'color', label: 'Барвинок', color: '#A5B4FC', price: 0, freeByDefault: true },
  { id: 'color-pink', category: 'color', label: 'Розовый', color: '#F0ABFC', price: 0, freeByDefault: true },
  { id: 'color-coral', category: 'color', label: 'Коралл', color: '#FCA5A5', price: 0, freeByDefault: true },
  { id: 'color-amber', category: 'color', label: 'Янтарный', color: '#FCD34D', price: 0, freeByDefault: true },
  { id: 'color-mint', category: 'color', label: 'Мятный', color: '#86EFAC', price: 20, freeByDefault: false },
  { id: 'color-sky', category: 'color', label: 'Небесный', color: '#7DD3FC', price: 20, freeByDefault: false },
  { id: 'color-peach', category: 'color', label: 'Персик', color: '#FDBA74', price: 20, freeByDefault: false },
  { id: 'color-galaxy', category: 'color', label: 'Galaxy', color: '#6D28D9', price: 45, freeByDefault: false, premiumOnly: true },
  { id: 'color-aurora', category: 'color', label: 'Aurora', color: '#059669', price: 45, freeByDefault: false, premiumOnly: true },
];

export const EYE_ITEMS: CosmeticItem[] = [
  { id: 'eye-happy', category: 'eye', label: 'Радостные', variant: 'happy', price: 0, freeByDefault: true },
  { id: 'eye-sleeping', category: 'eye', label: 'Сонные', variant: 'sleeping', price: 0, freeByDefault: true },
  { id: 'eye-wink', category: 'eye', label: 'Подмигивает', variant: 'wink', price: 15, freeByDefault: false },
  { id: 'eye-sparkle', category: 'eye', label: 'Со звёздочками', variant: 'sparkle', price: 15, freeByDefault: false },
  { id: 'eye-heart', category: 'eye', label: 'Heart Eyes', variant: 'sparkle', price: 40, freeByDefault: false, premiumOnly: true },
];

export const SHAPE_ITEMS: CosmeticItem[] = [
  { id: 'shape-pebble', category: 'shape', label: 'Галька', shape: 'pebble', price: 0, freeByDefault: true },
  { id: 'shape-round', category: 'shape', label: 'Круглый', shape: 'round', price: 0, freeByDefault: true },
  { id: 'shape-egg', category: 'shape', label: 'Яйцо', shape: 'egg', price: 20, freeByDefault: false },
  { id: 'shape-long', category: 'shape', label: 'Длинный', shape: 'long', price: 20, freeByDefault: false },
  { id: 'shape-bumpy', category: 'shape', label: 'Бугристый', shape: 'bumpy', price: 25, freeByDefault: false },
  { id: 'shape-tall', category: 'shape', label: 'Высокий', shape: 'tall', price: 25, freeByDefault: false },
  { id: 'shape-star', category: 'shape', label: 'Star', shape: 'bumpy', price: 50, freeByDefault: false, premiumOnly: true },
];

export const DECOR_ITEMS: CosmeticItem[] = [
  { id: 'decor-none', category: 'decor', label: 'Без украшений', decor: 'none', price: 0, freeByDefault: true },
  { id: 'decor-flower', category: 'decor', label: 'Цветок 🌸', decor: 'flower', price: 0, freeByDefault: true },
  { id: 'decor-leaf', category: 'decor', label: 'Листик 🍃', decor: 'leaf', price: 0, freeByDefault: true },
  { id: 'decor-cat-ears', category: 'decor', label: 'Ушки котика', decor: 'cat-ears', price: 40, freeByDefault: false, premiumOnly: true },
  { id: 'decor-glasses', category: 'decor', label: 'Очки', decor: 'glasses', price: 40, freeByDefault: false, premiumOnly: true },
  { id: 'decor-crown', category: 'decor', label: 'Корона 👑', decor: 'crown', price: 50, freeByDefault: false, premiumOnly: true },
  { id: 'decor-wizard', category: 'decor', label: 'Wizard Hat', decor: 'crown', price: 50, freeByDefault: false, premiumOnly: true },
];

export const ALL_ITEMS: CosmeticItem[] = [
  ...COLOR_ITEMS,
  ...EYE_ITEMS,
  ...SHAPE_ITEMS,
  ...DECOR_ITEMS,
];

// ────────────────────────────────────────────
// Storage shape
// ────────────────────────────────────────────

type StoredState = {
  balance: number;
  ownedItemIds: string[];
  /** Currently equipped cosmetic IDs (one per category) */
  equippedIds?: {
    color?: string;
    eye?: string;
    shape?: string;
    decor?: string;
  };
};

async function readFromSupabase(): Promise<StoredState | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('balance, owned_items, equipped_items')
      .eq('id', user.id)
      .single();

    if (error || !profile) return null;

    const ownedFromDb: string[] = profile.owned_items ?? [];
    const merged = new Set([...ownedFromDb, ...freeItemIds()]);

    return {
      balance: profile.balance ?? STARTING_BALANCE,
      ownedItemIds: [...merged],
      equippedIds: profile.equipped_items ?? undefined,
    };
  } catch (e) { console.warn(e);
    return null;
  }
}

async function readLocal(): Promise<StoredState> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  if (json) {
    try {
      const parsed = JSON.parse(json) as StoredState;
      // Always include free-by-default items in case catalog grew since last save
      const merged = new Set([...parsed.ownedItemIds, ...freeItemIds()]);
      return { balance: parsed.balance, ownedItemIds: [...merged] };
    } catch (e) { console.warn(e);
      // fall through to defaults
    }
  }
  return {
    balance: STARTING_BALANCE,
    ownedItemIds: freeItemIds(),
  };
}

async function read(): Promise<StoredState> {
  if (isSupabaseConfigured()) {
    const supabaseState = await readFromSupabase();
    if (supabaseState) return supabaseState;
  }
  return readLocal();
}

async function writeLocal(state: StoredState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function write(state: StoredState): Promise<void> {
  await writeLocal(state);
}

function freeItemIds(): string[] {
  return ALL_ITEMS.filter((i) => i.freeByDefault).map((i) => i.id);
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

export async function getPoints(): Promise<number> {
  const state = await read();
  return state.balance;
}

export async function getOwnedItemIds(): Promise<string[]> {
  const state = await read();
  return state.ownedItemIds;
}

export async function getState(): Promise<StoredState> {
  return read();
}

export async function isOwned(itemId: string): Promise<boolean> {
  const state = await read();
  return state.ownedItemIds.includes(itemId);
}

/** Spend points (e.g. reveal a stone).
 *
 * Uses server RPC `spend_points` (migration 003) for atomic, audited spend.
 * Returns false if insufficient balance or RPC rejects. */
export async function spendPoints(
  amount: number,
  reason: string = 'manual',
  refId?: string
): Promise<boolean> {
  if (amount <= 0) return true;

  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.rpc('spend_points', {
          p_amount: amount,
          p_reason: reason,
          p_ref_id: refId ?? null,
        });
        if (!error) return true;
        // RPC signalled insufficient / invalid. Don't fall back to local.
        if (error.message?.includes('insufficient')) return false;
        console.warn('spend_points rpc error', error.message);
      }
    } catch (e) {
      console.warn('spend_points exception', e);
      // Fall through to AsyncStorage (guest mode)
    }
  }

  const state = await readLocal();
  if (state.balance < amount) return false;
  state.balance -= amount;
  await writeLocal(state);
  return true;
}

/** Grant points via server RPC `earn_points` (migration 002).
 *
 * Atomic, rate-limited (20 earns/min/user), audited via balance_events.
 * Guest mode (no Supabase user) falls back to AsyncStorage. */
export async function earnPoints(
  amount: number,
  reason: string = 'manual',
  refId?: string
): Promise<number> {
  if (amount <= 0) return getPoints();

  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase.rpc('earn_points', {
          p_amount: amount,
          p_reason: reason,
          p_ref_id: refId ?? null,
        });
        if (!error && typeof data === 'number') return data;
        console.warn('earn_points rpc error', error?.message);
      }
    } catch (e) {
      console.warn('earn_points exception', e);
      // Fall through to AsyncStorage
    }
  }

  const state = await readLocal();
  state.balance += amount;
  await writeLocal(state);
  return state.balance;
}

export type SpendResult =
  | { ok: true; balance: number; ownedItemIds: string[] }
  | { ok: false; reason: 'insufficient' | 'already-owned' | 'unknown-item' | 'premium_required' };

/**
 * Purchases a cosmetic item via server RPC `spend_item` (migration 003).
 *
 * The server is the source of truth for:
 *   - item price
 *   - premium-only flag
 *   - current balance & owned_items
 *   - premium status (from RevenueCat webhook)
 *
 * Client catalog ALL_ITEMS is used only for display. Server can reject
 * with: unknown_item | already_owned | premium_required | insufficient.
 */
export async function buyItem(itemId: string): Promise<SpendResult> {
  const item = ALL_ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'unknown-item' };

  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase.rpc('spend_item', {
          p_item_id: itemId,
        });
        if (!error && data) {
          const result = data as { balance: number; owned_items: string[] };
          const merged = new Set([...result.owned_items, ...freeItemIds()]);
          void ItemPurchased(itemId, item.price);
          return { ok: true, balance: result.balance, ownedItemIds: [...merged] };
        }
        const msg = error?.message ?? '';
        if (msg.includes('already_owned')) return { ok: false, reason: 'already-owned' };
        if (msg.includes('premium_required')) return { ok: false, reason: 'premium_required' };
        if (msg.includes('insufficient')) return { ok: false, reason: 'insufficient' };
        if (msg.includes('unknown_item')) return { ok: false, reason: 'unknown-item' };
        console.warn('spend_item rpc error', msg);
        // Unexpected error — fall through to local (guest fallback)
      }
    } catch (e) {
      console.warn('spend_item exception', e);
    }
  }

  // Guest / offline fallback: local wallet (client-side premium gate)
  if (item.premiumOnly) {
    const { getTrialInfo } = await import('./premium-trial');
    const trial = await getTrialInfo();
    if (!trial.active) return { ok: false, reason: 'premium_required' };
  }
  const state = await readLocal();
  if (state.ownedItemIds.includes(itemId)) {
    return { ok: false, reason: 'already-owned' };
  }
  if (state.balance < item.price) {
    return { ok: false, reason: 'insufficient' };
  }
  state.balance -= item.price;
  state.ownedItemIds.push(itemId);
  await writeLocal(state);
  return { ok: true, balance: state.balance, ownedItemIds: state.ownedItemIds };
}

/**
 * Grants a cosmetic item via `grant_item` RPC — used by achievement unlocks.
 * Idempotent: already-owned → no-op. The server requires reason to start
 * with "achievement:" to prevent client from granting arbitrary items.
 */
export async function unlockCosmeticById(
  itemId: string,
  achievementId: string = 'unknown'
): Promise<void> {
  const item = ALL_ITEMS.find((i) => i.id === itemId);
  if (!item) return;

  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.rpc('grant_item', {
          p_item_id: itemId,
          p_reason: `achievement:${achievementId}`,
        });
        if (!error) return;
        console.warn('grant_item rpc error', error.message);
      }
    } catch (e) {
      console.warn('grant_item exception', e);
      // Fall through to AsyncStorage (guest)
    }
  }

  const state = await readLocal();
  if (state.ownedItemIds.includes(itemId)) return;
  state.ownedItemIds.push(itemId);
  await writeLocal(state);
}

/** Get currently equipped cosmetic IDs */
export async function getEquippedIds(): Promise<NonNullable<StoredState['equippedIds']>> {
  const state = await read();
  return state.equippedIds ?? {};
}

/** Save currently equipped cosmetic IDs (one per category) */
export async function setEquippedIds(equipped: NonNullable<StoredState['equippedIds']>): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('equipped_items')
          .eq('id', user.id)
          .single();

        const current = profile?.equipped_items ?? {};
        const merged = { ...current, ...equipped };
        await supabase
          .from('profiles')
          .update({ equipped_items: merged })
          .eq('id', user.id);
        return;
      }
    } catch (e) { console.warn(e);
      // Fall through to AsyncStorage
    }
  }

  const state = await readLocal();
  state.equippedIds = { ...state.equippedIds, ...equipped };
  await writeLocal(state);
}

/** Reset to initial state — useful for the dev "view onboarding" reset flow. */
export async function resetPoints(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
