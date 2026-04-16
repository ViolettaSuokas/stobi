// Shared stone avatar styles for each seed user — used in chat, feed, etc.
// Keeps identity consistent across all screens.

import type {
  MascotVariant,
  MascotShape,
  MascotDecor,
} from '../components/StoneMascot';
import {
  getEquippedIds,
  COLOR_ITEMS,
  EYE_ITEMS,
  SHAPE_ITEMS,
  DECOR_ITEMS,
} from './points';

export type UserStoneStyle = {
  color: string;
  shape: MascotShape;
  variant: MascotVariant;
  decor: MascotDecor;
};

export const USER_STONES: Record<string, UserStoneStyle> = {
  'seed-aleksi': { color: '#C4B5FD', shape: 'pebble', variant: 'happy', decor: 'none' },
  'seed-anna':   { color: '#F0ABFC', shape: 'egg', variant: 'wink', decor: 'flower' },
  'seed-mika':   { color: '#86EFAC', shape: 'round', variant: 'happy', decor: 'leaf' },
  'seed-sari':   { color: '#A5B4FC', shape: 'long', variant: 'sparkle', decor: 'none' },
  'seed-julia':  { color: '#FCA5A5', shape: 'bumpy', variant: 'happy', decor: 'crown' },
  'seed-petri':  { color: '#FCD34D', shape: 'tall', variant: 'sleeping', decor: 'none' },
  'seed-kirsi':  { color: '#7DD3FC', shape: 'pebble', variant: 'wink', decor: 'glasses' },
  'seed-pekka':  { color: '#FDBA74', shape: 'round', variant: 'happy', decor: 'cat-ears' },
};

const DEFAULT_STONE: UserStoneStyle = {
  color: '#C4B5FD', shape: 'pebble', variant: 'happy', decor: 'none',
};

export function getUserStoneStyle(userId: string): UserStoneStyle {
  return USER_STONES[userId] ?? DEFAULT_STONE;
}

/**
 * Async — reads the current user's equipped cosmetics from AsyncStorage.
 * Returns their customized style (or the default if nothing is equipped).
 */
export async function getMyStyle(): Promise<UserStoneStyle> {
  const equipped = await getEquippedIds();

  const color = (equipped.color
    ? COLOR_ITEMS.find((c) => c.id === equipped.color)?.color
    : undefined) ?? DEFAULT_STONE.color;

  const variant = (equipped.eye
    ? EYE_ITEMS.find((e) => e.id === equipped.eye)?.variant
    : undefined) ?? DEFAULT_STONE.variant;

  const shape = (equipped.shape
    ? SHAPE_ITEMS.find((s) => s.id === equipped.shape)?.shape
    : undefined) ?? DEFAULT_STONE.shape;

  const decor = (equipped.decor
    ? DECOR_ITEMS.find((d) => d.id === equipped.decor)?.decor
    : undefined) ?? DEFAULT_STONE.decor;

  return { color, variant: variant as MascotVariant, shape: shape as MascotShape, decor: decor as MascotDecor };
}
