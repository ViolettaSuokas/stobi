import * as Location from 'expo-location';

export type Coords = {
  lat: number;
  lng: number;
};

export type LocationInfo = {
  coords: Coords;
  city: string | null;
  region: string | null;
  country?: string | null;
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
  /** Last successful find / author-confirm (migration 017). ISO string. */
  lastConfirmedAt?: string | null;
  /** URL фото камня (signed Supabase URL). Раньше не пробрасывалось → детальная
   *  страница падала на серый-каменный fallback. */
  photoUri?: string | null;
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

/**
 * Проверить текущий статус разрешения без OS-prompt.
 * Используется чтобы решить показывать ли rationale-модал перед
 * первым запросом. Возвращает:
 *   'granted'      — разрешено, можно сразу использовать location
 *   'denied'       — уже отказано, OS больше не покажет prompt
 *   'undetermined' — ещё не спрашивали, можно показать rationale + prompt
 */
export async function getLocationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'undetermined' || canAskAgain) return 'undetermined';
    return 'denied';
  } catch {
    return 'undetermined';
  }
}

let cachedLocation: { info: LocationInfo; timestamp: number } | null = null;
const LOCATION_CACHE_MS = 5 * 60 * 1000;

export async function getCurrentLocation(): Promise<LocationInfo | null> {
  if (cachedLocation && Date.now() - cachedLocation.timestamp < LOCATION_CACHE_MS) {
    return cachedLocation.info;
  }

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
    const info: LocationInfo = {
      coords,
      city: reverse?.city ?? null,
      region: reverse?.region ?? null,
      country: reverse?.country ?? null,
    };
    cachedLocation = { info, timestamp: Date.now() };
    return info;
  } catch {
    return null;
  }
}

/**
 * Forward-geocode a free-form query (city, address, country) → coords.
 * Returns first result or null if not found / permission missing on iOS.
 *
 * iOS использует CoreLocation (CLGeocoder) под капотом — для него нужен
 * permission на location services (foreground). Если юзер не дал permission,
 * geocodeAsync молча возвращает []. Поэтому в map.tsx мы сначала зовём
 * requestForegroundPermission'ом fallback.
 */
export async function geocodeQuery(query: string): Promise<Coords | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const results = await Location.geocodeAsync(q);
    if (!results || results.length === 0) return null;
    const r = results[0];
    return { lat: r.latitude, lng: r.longitude };
  } catch {
    return null;
  }
}

export async function reverseGeocode(
  coords: Coords,
): Promise<{ city: string | null; region: string | null; country: string | null } | null> {
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
      country: place.isoCountryCode ?? null,
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


/**
 * Returns stones across Finland with REAL distances calculated from
 * the user's actual GPS position via haversine. Stones within
 * FREE_RADIUS_M are marked as isPremium (locked for free users).
 *
 * Also merges in any user-created stones from local storage.
 */
/**
 * Загружает один камень по id, независимо от статуса find/hidden.
 * Нужен для stone-detail экрана: туда заходят даже на уже-найденные
 * камни (из notification "Твой камень нашли", из истории профайла,
 * из feed). getNearbyStones фильтрует found-stones — для карты ОК,
 * для detail-экрана нет.
 */
export async function getStoneById(stoneId: string, userCoords?: Coords): Promise<NearbyStone | null> {
  const { isSupabaseConfigured, supabase } = await import('./supabase');
  if (!isSupabaseConfigured()) return null;
  try {
    const { data: s, error } = await supabase
      .from('stones')
      .select('*')
      .eq('id', stoneId)
      .maybeSingle();
    if (error || !s) return null;
    const stoneCoords = { lat: (s as any).lat, lng: (s as any).lng };
    const refCoords = userCoords ?? { lat: 60.1699, lng: 24.9384 };
    const realMeters = haversineDistance(refCoords, stoneCoords);
    const shape = getStoneShape(s.id, 1);
    return {
      id: s.id,
      emoji: (s as any).emoji ?? '🪨',
      name: (s as any).name,
      distance: formatDistance(realMeters),
      distanceMeters: realMeters,
      coords: stoneCoords,
      visual: coordsToFinlandView(stoneCoords),
      colors: getCityColor((s as any).city),
      shape,
      rotation: 0,
      isPremium: realMeters > FREE_RADIUS_M,
      city: (s as any).city ?? null,
      authorId: (s as any).author_id ?? null,
      createdAt: (s as any).created_at ?? null,
      lastConfirmedAt: (s as any).last_confirmed_at ?? null,
      photoUri: (s as any).photo_url ?? null,
    };
  } catch (e) {
    console.warn('getStoneById failed', e);
    return null;
  }
}

export async function getNearbyStones(
  userCoords: Coords,
  _radiusMeters = 1_000_000,
): Promise<NearbyStone[]> {
  // Real stones from Supabase. No fake/demo fallback — на пустой карте
  // юзер должен увидеть "Be the first to hide a stone", а не 46 фейков
  // которых он никогда не найдёт физически.
  const { isSupabaseConfigured } = await import('./supabase');
  if (isSupabaseConfigured()) {
    try {
      const { supabase } = await import('./supabase');
      // Параллельно: все non-hidden камни + список stone_id'ов которые
      // уже verified-found. Камни с подтверждённой находкой исключаем
      // у ВСЕХ юзеров (раньше фильтровались только локально через
      // foundIds = "мои находки", автор продолжал видеть свой камень
      // на карте после того как его кто-то нашёл).
      const [stonesRes, findsRes] = await Promise.all([
        supabase
          .from('stones')
          .select('*')
          .or('is_hidden.is.null,is_hidden.eq.false'),
        supabase
          .from('finds')
          .select('stone_id'),
      ]);
      const dbStones = stonesRes.data;
      const foundStoneIds = new Set<string>(
        (findsRes.data ?? []).map((f: any) => f.stone_id).filter(Boolean),
      );

      if (dbStones) {
        return dbStones
          .filter((s: Record<string, any>) => !foundStoneIds.has(s.id))
          .map((s: Record<string, any>): NearbyStone => {
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
            lastConfirmedAt: s.last_confirmed_at ?? null,
            photoUri: s.photo_url ?? null,
          };
        });
      }
    } catch (e) {
      console.warn('getNearbyStones: Supabase fetch failed', e);
    }
  }

  // Offline / local-only режим — только юзерские камни из AsyncStorage.
  // Никаких demo-данных.
  const { getUserStones, toNearbyStone } = await import('./user-stones');
  const userStones = await getUserStones();
  return userStones.map((s) => toNearbyStone(s, userCoords, coordsToFinlandView));
}
