import * as Location from 'expo-location';

export type Coords = {
  lat: number;
  lng: number;
};

export type LocationInfo = {
  coords: Coords;
  city: string | null;
  region: string | null;
};

export type NearbyStone = {
  id: string;
  emoji: string;
  name: string;
  /** Distance from user, e.g. "320м", "1.2км" */
  distance: string;
  /** Distance in meters — used to decide if stone is in premium-locked range */
  distanceMeters: number;
  /** Real coordinates of the stone */
  coords: Coords;
  /** Visual placement on the stylized fake map (0..1) */
  visual: { x: number; y: number };
  colors: readonly [string, string];
  shape: {
    width: number;
    height: number;
    borderTopLeftRadius: number;
    borderTopRightRadius: number;
    borderBottomLeftRadius: number;
    borderBottomRightRadius: number;
  };
  rotation: number;
  /**
   * True when the stone is inside the close-range premium zone.
   * Free users see that the stone exists but not its precise location.
   * True for stones beyond FREE_RADIUS_M (2km). Premium unlocks all.
   */
  isPremium: boolean;
  /** City name where the stone is hidden (for grouping by city) */
  city?: string | null;
  /** Supabase user ID of the stone's author (hider). Null for demo/seeded stones. */
  authorId?: string | null;
  /** When the stone was hidden (ISO string or epoch). Null for demo/seeded stones. */
  createdAt?: string | null;
};

/** Free users see stones within this radius. Beyond = Premium only */
export const FREE_RADIUS_M = 2000;

/** City-based color palette for stone markers on the map */
const CITY_COLORS: Record<string, readonly [string, string]> = {
  Vantaa: ['#C4B5FD', '#7C3AED'],     // лавандовый/фиолет
  Helsinki: ['#7DD3FC', '#0284C7'],   // голубой
  Espoo: ['#86EFAC', '#16A34A'],      // зелёный
  Tampere: ['#FDBA74', '#EA580C'],    // оранжевый
  Turku: ['#F0ABFC', '#C026D3'],      // розово-фиолетовый
  Oulu: ['#FCD34D', '#D97706'],       // янтарный
  Rovaniemi: ['#E0E7FF', '#6366F1'],  // ледяной/индиго
  Lahti: ['#A5F3FC', '#0891B2'],      // циан
  Jyväskylä: ['#BBF7D0', '#15803D'],  // мятный
  Kuopio: ['#FECACA', '#DC2626'],     // коралловый
  Vaasa: ['#DDD6FE', '#7C3AED'],      // светло-фиолетовый
  Pori: ['#FED7AA', '#F97316'],       // персиковый
  Joensuu: ['#A7F3D0', '#059669'],    // изумрудный
  Mikkeli: ['#DDD6FE', '#5B4FF0'],    // фиолетовый
  Lappeenranta: ['#FBCFE8', '#DB2777'], // розовый
};

const DEFAULT_COLORS = ['#C4B5FD', '#A78BFA'] as const;

export function getCityColor(city: string | null | undefined): readonly [string, string] {
  if (!city) return DEFAULT_COLORS;
  return CITY_COLORS[city] ?? DEFAULT_COLORS;
}

// ────────────────────────────────────────────
// GPS → stylized Finland viewBox conversion
// ────────────────────────────────────────────
//
// The Finland silhouette uses a 200×320 viewBox. We linearly interpolate
// real lat/lng into that viewBox, calibrated against two anchor cities:
//   - Helsinki (60.17°, 24.94°) → (115, 295)
//   - Vaasa     (63.10°, 21.62°) → (50, 200)
// This gives an approximate but recognizable placement.
//
export function coordsToFinlandView(coords: Coords): { x: number; y: number } {
  const viewX = 19.58 * coords.lng - 373.4;
  const viewY = -32.42 * coords.lat + 2245.7;
  return {
    x: Math.max(20, Math.min(180, viewX)),
    y: Math.max(20, Math.min(310, viewY)),
  };
}

// Great-circle distance between two GPS points, in meters
export function haversineDistance(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}м`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)}км`;
  return `${Math.round(meters / 1000)}км`;
}

// ────────────────────────────────────────────
// Permissions & device location
// ────────────────────────────────────────────

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function getCurrentLocation(): Promise<LocationInfo | null> {
  const granted = await requestLocationPermission();
  if (!granted) return null;

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords: Coords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };

    const reverse = await reverseGeocode(coords);
    return {
      coords,
      city: reverse?.city ?? null,
      region: reverse?.region ?? null,
    };
  } catch {
    return null;
  }
}

export async function reverseGeocode(
  coords: Coords,
): Promise<{ city: string | null; region: string | null } | null> {
  try {
    const result = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    if (result.length === 0) return null;
    const place = result[0];
    return {
      city: place.city ?? place.subregion ?? null,
      region: place.region ?? null,
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────
// Stones near user (mock — Anton swaps for backend)
// ────────────────────────────────────────────

// Stone shape variations — 8 distinct organic forms.
// Base scale is ~50px wide. Use getStoneShape(id, scale) to get scaled style.
export const SHAPES = [
  // 0 — wide flat pebble (skipping stone)
  { width: 56, height: 40, borderTopLeftRadius: 28, borderTopRightRadius: 36, borderBottomLeftRadius: 32, borderBottomRightRadius: 22, rotation: -6 },
  // 1 — bumpy asymmetric
  { width: 46, height: 44, borderTopLeftRadius: 36, borderTopRightRadius: 22, borderBottomLeftRadius: 26, borderBottomRightRadius: 38, rotation: 8 },
  // 2 — long curved
  { width: 58, height: 38, borderTopLeftRadius: 28, borderTopRightRadius: 42, borderBottomLeftRadius: 34, borderBottomRightRadius: 26, rotation: -3 },
  // 3 — tilted egg
  { width: 42, height: 46, borderTopLeftRadius: 38, borderTopRightRadius: 26, borderBottomLeftRadius: 22, borderBottomRightRadius: 36, rotation: 6 },
  // 4 — almost round chunky
  { width: 48, height: 46, borderTopLeftRadius: 28, borderTopRightRadius: 30, borderBottomLeftRadius: 26, borderBottomRightRadius: 28, rotation: -10 },
  // 5 — flat pancake
  { width: 60, height: 34, borderTopLeftRadius: 22, borderTopRightRadius: 30, borderBottomLeftRadius: 18, borderBottomRightRadius: 26, rotation: 4 },
  // 6 — triangle-ish (one corner sharper)
  { width: 50, height: 44, borderTopLeftRadius: 16, borderTopRightRadius: 36, borderBottomLeftRadius: 34, borderBottomRightRadius: 30, rotation: -7 },
  // 7 — tall stone
  { width: 40, height: 50, borderTopLeftRadius: 32, borderTopRightRadius: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 20, rotation: 9 },
];

/** Stable hash of a stone id → shape index. Same id always picks same shape. */
function hashStoneId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Get a render-ready style object for a stone shape.
 * `scale` lets callers fit the shape into different contexts:
 *   1.0 — base size (~50px wide), good for large pins on map
 *   0.7 — medium icons in feed cards
 *   0.6 — small icons in profile/timeline rows
 *
 * Returns width, height, all four border radii, AND rotation transform.
 */
export function getStoneShape(stoneId: string, scale: number = 1) {
  const variant = SHAPES[hashStoneId(stoneId) % SHAPES.length];
  return {
    width: variant.width * scale,
    height: variant.height * scale,
    borderTopLeftRadius: variant.borderTopLeftRadius * scale,
    borderTopRightRadius: variant.borderTopRightRadius * scale,
    borderBottomLeftRadius: variant.borderBottomLeftRadius * scale,
    borderBottomRightRadius: variant.borderBottomRightRadius * scale,
    rotation: variant.rotation,
  };
}

const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#F5D0FE', '#A855F7'], // pink → purple
  ['#BFDBFE', '#2563EB'], // sky → blue
  ['#BBF7D0', '#15803D'], // mint → green
  ['#FDE68A', '#D97706'], // yellow → amber
  ['#FCA5A5', '#DC2626'], // coral → red
  ['#DDD6FE', '#7C3AED'], // lavender → violet
  ['#A7F3D0', '#059669'], // teal → emerald
  ['#FED7AA', '#EA580C'], // peach → orange
];

// Stones distributed across Finnish cities
// visual.x/y are normalized to FinlandSilhouette viewBox (0..1 of 200x320)
const FINLAND_STONES: Omit<NearbyStone, 'isPremium'>[] = [
  // ─── Helsinki area (capital, where most users start) ───
  {
    id: 'h1',
    emoji: '🌸',
    name: 'Весенняя сакура',
    distance: '320м',
    distanceMeters: 320,
    coords: { lat: 60.1699, lng: 24.9384 },
    visual: { x: 117 / 200, y: 295 / 320 },
    colors: PALETTES[0],
    shape: SHAPES[0],
    rotation: -8,
  },
  {
    id: 'h2',
    emoji: '🦋',
    name: 'Синяя бабочка',
    distance: '480м',
    distanceMeters: 480,
    coords: { lat: 60.171, lng: 24.94 },
    visual: { x: 113 / 200, y: 297 / 320 },
    colors: PALETTES[1],
    shape: SHAPES[1],
    rotation: 12,
  },
  {
    id: 'h3',
    emoji: '🌊',
    name: 'Морской закат',
    distance: '1.2км',
    distanceMeters: 1200,
    coords: { lat: 60.165, lng: 24.95 },
    visual: { x: 119 / 200, y: 298 / 320 },
    colors: PALETTES[2],
    shape: SHAPES[2],
    rotation: -3,
  },
  // ─── Espoo (next to Helsinki) ───
  {
    id: 'e1',
    emoji: '🔮',
    name: 'Магический шар',
    distance: '8км',
    distanceMeters: 8000,
    coords: { lat: 60.205, lng: 24.655 },
    visual: { x: 100 / 200, y: 296 / 320 },
    colors: PALETTES[3],
    shape: SHAPES[3],
    rotation: 6,
  },
  // ─── Vantaa ───
  {
    id: 'v1',
    emoji: '🐉',
    name: 'Дракон удачи',
    distance: '12км',
    distanceMeters: 12000,
    coords: { lat: 60.293, lng: 25.038 },
    visual: { x: 122 / 200, y: 290 / 320 },
    colors: PALETTES[4],
    shape: SHAPES[0],
    rotation: -10,
  },
  // ─── Turku (SW) ───
  {
    id: 't1',
    emoji: '⛵',
    name: 'Парусник',
    distance: '160км',
    distanceMeters: 160000,
    coords: { lat: 60.4518, lng: 22.2666 },
    visual: { x: 75 / 200, y: 285 / 320 },
    colors: PALETTES[1],
    shape: SHAPES[1],
    rotation: 5,
  },
  {
    id: 't2',
    emoji: '🏰',
    name: 'Старый замок',
    distance: '162км',
    distanceMeters: 162000,
    coords: { lat: 60.4358, lng: 22.232 },
    visual: { x: 78 / 200, y: 287 / 320 },
    colors: PALETTES[5],
    shape: SHAPES[2],
    rotation: -7,
  },
  // ─── Tampere (south central) ───
  {
    id: 'tm1',
    emoji: '🌲',
    name: 'Лесная сова',
    distance: '170км',
    distanceMeters: 170000,
    coords: { lat: 61.4978, lng: 23.7609 },
    visual: { x: 95 / 200, y: 248 / 320 },
    colors: PALETTES[2],
    shape: SHAPES[3],
    rotation: 4,
  },
  {
    id: 'tm2',
    emoji: '🌿',
    name: 'Лесные травы',
    distance: '172км',
    distanceMeters: 172000,
    coords: { lat: 61.5, lng: 23.77 },
    visual: { x: 92 / 200, y: 252 / 320 },
    colors: PALETTES[7],
    shape: SHAPES[0],
    rotation: -5,
  },
  // ─── Lahti ───
  {
    id: 'l1',
    emoji: '🏔️',
    name: 'Горный пейзаж',
    distance: '100км',
    distanceMeters: 100000,
    coords: { lat: 60.9827, lng: 25.6612 },
    visual: { x: 115 / 200, y: 270 / 320 },
    colors: PALETTES[5],
    shape: SHAPES[1],
    rotation: 8,
  },
  // ─── Jyväskylä ───
  {
    id: 'j1',
    emoji: '🌊',
    name: 'Озеро Päijänne',
    distance: '270км',
    distanceMeters: 270000,
    coords: { lat: 62.2426, lng: 25.7473 },
    visual: { x: 105 / 200, y: 200 / 320 },
    colors: PALETTES[1],
    shape: SHAPES[2],
    rotation: -4,
  },
  // ─── Kuopio ───
  {
    id: 'k1',
    emoji: '🐟',
    name: 'Рыбка Saimaa',
    distance: '385км',
    distanceMeters: 385000,
    coords: { lat: 62.8924, lng: 27.677 },
    visual: { x: 130 / 200, y: 175 / 320 },
    colors: PALETTES[6],
    shape: SHAPES[3],
    rotation: 9,
  },
  // ─── Vaasa (west coast) ───
  {
    id: 'va1',
    emoji: '🌅',
    name: 'Закат Bothnia',
    distance: '380км',
    distanceMeters: 380000,
    coords: { lat: 63.096, lng: 21.6158 },
    visual: { x: 50 / 200, y: 200 / 320 },
    colors: PALETTES[7],
    shape: SHAPES[0],
    rotation: -6,
  },
  // ─── Oulu ───
  {
    id: 'o1',
    emoji: '❄️',
    name: 'Снежинка севера',
    distance: '600км',
    distanceMeters: 600000,
    coords: { lat: 65.0121, lng: 25.4651 },
    visual: { x: 70 / 200, y: 130 / 320 },
    colors: PALETTES[1],
    shape: SHAPES[1],
    rotation: 11,
  },
  {
    id: 'o2',
    emoji: '🦉',
    name: 'Полярная сова',
    distance: '602км',
    distanceMeters: 602000,
    coords: { lat: 65.014, lng: 25.47 },
    visual: { x: 73 / 200, y: 133 / 320 },
    colors: PALETTES[5],
    shape: SHAPES[2],
    rotation: -2,
  },
  // ─── Joensuu (east) ───
  {
    id: 'jo1',
    emoji: '🌲',
    name: 'Карельская ель',
    distance: '440км',
    distanceMeters: 440000,
    coords: { lat: 62.6, lng: 29.7667 },
    visual: { x: 155 / 200, y: 175 / 320 },
    colors: PALETTES[2],
    shape: SHAPES[3],
    rotation: 7,
  },
  // ─── Rovaniemi (Lapland) ───
  {
    id: 'r1',
    emoji: '🎅',
    name: 'Дом Деда Мороза',
    distance: '830км',
    distanceMeters: 830000,
    coords: { lat: 66.5039, lng: 25.7294 },
    visual: { x: 90 / 200, y: 75 / 320 },
    colors: PALETTES[4],
    shape: SHAPES[0],
    rotation: -8,
  },
  {
    id: 'r2',
    emoji: '🌌',
    name: 'Aurora Borealis',
    distance: '835км',
    distanceMeters: 835000,
    coords: { lat: 66.51, lng: 25.74 },
    visual: { x: 93 / 200, y: 78 / 320 },
    colors: PALETTES[5],
    shape: SHAPES[1],
    rotation: 5,
  },
];

/**
 * Returns stones across Finland with REAL distances calculated from
 * the user's actual GPS position via haversine. Stones within
 * FREE_RADIUS_M are marked as isPremium (locked for free users).
 *
 * Also merges in any user-created stones from local storage.
 */
export async function getNearbyStones(
  userCoords: Coords,
  _radiusMeters = 1_000_000,
): Promise<NearbyStone[]> {
  const mockStones = FINLAND_STONES.map((s) => {
    const realMeters = haversineDistance(userCoords, s.coords);
    return {
      ...s,
      distanceMeters: realMeters,
      distance: formatDistance(realMeters),
      isPremium: realMeters > FREE_RADIUS_M,
    };
  });

  // Load stones from Supabase (all users' stones) if configured
  const { isSupabaseConfigured } = await import('./supabase');
  if (isSupabaseConfigured()) {
    try {
      const { supabase } = await import('./supabase');
      const { data: dbStones } = await supabase
        .from('stones')
        .select('*');

      if (dbStones && dbStones.length > 0) {
        const supabaseStones: NearbyStone[] = dbStones.map((s: any) => {
          const stoneCoords = { lat: s.lat, lng: s.lng };
          const realMeters = haversineDistance(userCoords, stoneCoords);
          const shape = getStoneShape(s.id, 1);
          return {
            id: s.id,
            emoji: s.emoji ?? '🪨',
            name: s.name,
            distance: formatDistance(realMeters),
            distanceMeters: realMeters,
            coords: stoneCoords,
            visual: coordsToFinlandView(stoneCoords),
            colors: getCityColor(s.city),
            shape,
            rotation: 0,
            isPremium: realMeters > FREE_RADIUS_M,
            city: s.city ?? null,
            authorId: s.author_id ?? null,
            createdAt: s.created_at ?? null,
          };
        });
        return supabaseStones;
      }
    } catch {
      // Fall through to mock stones
    }
  }

  // Fallback: mock stones + local user stones
  const { getUserStones, toNearbyStone } = await import('./user-stones');
  const userStones = await getUserStones();
  const userAsNearby = userStones.map((s) =>
    toNearbyStone(s, userCoords, coordsToFinlandView),
  );

  return [...mockStones, ...userAsNearby];
}
