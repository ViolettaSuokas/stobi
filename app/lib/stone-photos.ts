// User-generated stone photos. In production these come from Supabase Storage
// (or wherever images live), but during the mock phase they ship as bundled
// assets so the app feels real without a backend.
//
// To add a new photo:
//   1. drop the JPG into app/assets/stones/
//   2. add an entry below
//   3. assign the key to one or more Activity events in lib/activity.ts

import type { ImageSourcePropType } from 'react-native';

export const STONE_PHOTOS = {
  mouse: require('../assets/stones/mouse.jpg'),
  ghostCupcake: require('../assets/stones/ghost-cupcake.jpg'),
  pinkOwl: require('../assets/stones/pink-owl.jpg'),
  blueSwirls: require('../assets/stones/blue-swirls.jpg'),
  greenDaisies: require('../assets/stones/green-daisies.jpg'),
  heartFlowers: require('../assets/stones/heart-flowers.jpg'),
  owlHeart: require('../assets/stones/owl-heart.jpg'),
  pinkFlower: require('../assets/stones/pink-flower.jpg'),
  oceanView: require('../assets/stones/ocean-view.jpg'),
  marioSet: require('../assets/stones/mario-set.jpg'),
} as const;

export type StonePhotoKey = keyof typeof STONE_PHOTOS;

export function getStonePhoto(key: StonePhotoKey): ImageSourcePropType {
  return STONE_PHOTOS[key];
}
