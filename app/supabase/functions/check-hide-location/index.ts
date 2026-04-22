// Edge Function: check-hide-location
//
// Verifies that a lat/lng is safe to hide a painted stone for public play:
//   - Near a public POI (park, playground, cafe, library, plaza, bench, bus stop)
//     within 150m
//   - Far enough from schools / kindergartens (at least 300m, anti-grooming
//     pattern of targeting stones around children's institutions)
//   - Not inside a residential building polygon
//
// Uses OpenStreetMap Overpass API (free, rate-limited, fair-use). Caches
// nothing — one request per hide. A hide is a rare event so traffic is fine.
//
// Returns:
//   { safe: true,  nearest_poi: "...", distance_m: 45 }
//   { safe: false, reason: "no_public_poi" | "near_school" | "in_residential", message: "..." }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OVERPASS = "https://overpass-api.de/api/interpreter";

// Search radii (meters)
const POI_RADIUS = 150;
const SCHOOL_EXCLUSION_RADIUS = 300;
const RESIDENTIAL_CHECK_RADIUS = 20;

// POI tags that count as "safe public place"
const SAFE_POI_TAGS = [
  'leisure=park',
  'leisure=playground',
  'leisure=garden',
  'leisure=pitch',
  'leisure=common',
  'amenity=library',
  'amenity=cafe',
  'amenity=restaurant',
  'amenity=marketplace',
  'amenity=bench',
  'amenity=bus_station',
  'public_transport=stop_position',
  'public_transport=platform',
  'highway=bus_stop',
  'place=square',
  'tourism=attraction',
  'tourism=viewpoint',
  'shop=mall',
];

// Places where hiding is NOT safe — pattern of predators targeting kids
const EXCLUSION_TAGS = [
  'amenity=school',
  'amenity=kindergarten',
  'amenity=childcare',
];

type Result =
  | { safe: true; nearest_poi: string; distance_m: number }
  | { safe: false; reason: string; message: string };

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const lat = body.lat;
  const lng = body.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return json({ error: "lat/lng required and valid" }, 400);
  }

  try {
    const result = await validate(lat, lng);
    return json(result, 200);
  } catch (e: any) {
    // Fail-open on Overpass failure — we don't want to block legitimate hides
    // due to upstream outage. Log for monitoring; rely on community reporting
    // as backstop. A hide in a bad spot gets taken down via reports anyway.
    console.error('check-hide-location overpass error:', e);
    return json({
      safe: true,
      nearest_poi: 'overpass_unavailable',
      distance_m: 0,
      warning: 'Validation service temporarily unavailable',
    }, 200);
  }
});

async function validate(lat: number, lng: number): Promise<Result> {
  // 1. Check exclusion zones first — schools / kindergartens within 300m = hard reject.
  const exclusionQuery = buildExclusionQuery(lat, lng, SCHOOL_EXCLUSION_RADIUS);
  const exclusionData = await overpass(exclusionQuery);
  if (exclusionData.elements && exclusionData.elements.length > 0) {
    const el = exclusionData.elements[0];
    return {
      safe: false,
      reason: 'near_school',
      message: `Стоп — это слишком близко к школе/детскому саду (${el.tags?.name ?? 'образовательное учреждение'}). Чтобы защитить детей, Stobi не разрешает прятать камни в таких местах. Выбери парк, площадь или кафе.`,
    };
  }

  // 2. Check if inside a residential building polygon (private property).
  const resQuery = buildResidentialQuery(lat, lng, RESIDENTIAL_CHECK_RADIUS);
  const resData = await overpass(resQuery);
  if (resData.elements && resData.elements.length > 0) {
    return {
      safe: false,
      reason: 'in_residential',
      message: 'Похоже это частная территория или жилое здание. Прячь только в общественных местах: парки, площади, библиотеки, остановки.',
    };
  }

  // 3. Must be near a safe public POI.
  const poiQuery = buildPoiQuery(lat, lng, POI_RADIUS);
  const poiData = await overpass(poiQuery);
  if (!poiData.elements || poiData.elements.length === 0) {
    return {
      safe: false,
      reason: 'no_public_poi',
      message: 'В этом месте нет общественных объектов поблизости. Прячь в парке, у скамейки, возле кафе или библиотеки — там где проходит много людей.',
    };
  }

  // Nearest POI details for success response.
  const nearest = poiData.elements[0];
  const nearestDistance = haversineM(lat, lng, nearest.lat ?? lat, nearest.lon ?? lng);
  const poiName = nearest.tags?.name ?? nearest.tags?.amenity ?? nearest.tags?.leisure ?? 'public place';

  return {
    safe: true,
    nearest_poi: poiName,
    distance_m: Math.round(nearestDistance),
  };
}

function buildExclusionQuery(lat: number, lng: number, radius: number): string {
  const clauses = EXCLUSION_TAGS.map((t) => {
    const [k, v] = t.split('=');
    return `node["${k}"="${v}"](around:${radius},${lat},${lng});way["${k}"="${v}"](around:${radius},${lat},${lng});`;
  }).join('');
  return `[out:json][timeout:10];(${clauses});out center 5;`;
}

function buildResidentialQuery(lat: number, lng: number, radius: number): string {
  return `[out:json][timeout:10];(way["building"="residential"](around:${radius},${lat},${lng});way["building"="apartments"](around:${radius},${lat},${lng});way["building"="house"](around:${radius},${lat},${lng}););out center 1;`;
}

function buildPoiQuery(lat: number, lng: number, radius: number): string {
  const clauses = SAFE_POI_TAGS.map((t) => {
    const [k, v] = t.split('=');
    return `node["${k}"="${v}"](around:${radius},${lat},${lng});way["${k}"="${v}"](around:${radius},${lat},${lng});`;
  }).join('');
  return `[out:json][timeout:10];(${clauses});out center 3;`;
}

async function overpass(query: string): Promise<any> {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`overpass ${res.status}: ${await res.text()}`);
  return res.json();
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
