// Child-safety helpers: validate hide location against a public-POI check,
// show user-friendly reject messages when location is unsafe.

import { supabase, isSupabaseConfigured } from './supabase';

export type LocationSafetyResult =
  | { safe: true; nearestPoi?: string; distanceM?: number }
  | { safe: false; reason: string; message: string };

/**
 * Verifies coordinates are in a safe public place for hiding a painted stone.
 * Rejects: too close to schools/kindergartens, inside residential buildings,
 * or not near any public POI.
 *
 * On edge-function failure (Overpass unavailable, network out) → returns safe=true
 * with a warning, rather than blocking legitimate hides. Community reports act
 * as a backstop.
 */
export async function checkHideLocationSafe(lat: number, lng: number): Promise<LocationSafetyResult> {
  if (!isSupabaseConfigured()) {
    return { safe: true };
  }
  try {
    const { data, error } = await supabase.functions.invoke('check-hide-location', {
      body: { lat, lng },
    });
    if (error) {
      console.warn('[safety] check-hide-location error:', error);
      return { safe: true }; // fail-open, surface via community reports
    }
    if (data?.safe === true) {
      return { safe: true, nearestPoi: data.nearest_poi, distanceM: data.distance_m };
    }
    return {
      safe: false,
      reason: data?.reason ?? 'unknown',
      message: data?.message ?? 'Выбери другое место.',
    };
  } catch (e) {
    console.warn('[safety] check-hide-location exception:', e);
    return { safe: true };
  }
}
