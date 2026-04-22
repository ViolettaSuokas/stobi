// Child-safety helpers: validate hide location against a public-POI check,
// show user-friendly reject messages when location is unsafe.

import { supabase, isSupabaseConfigured } from './supabase';

export type LocationSafetyResult =
  | { safe: true; nearestPoi?: string; distanceM?: number }
  | { safe: false; reason: string; message: string };

// Retry config for the Overpass-backed Edge Function. Overpass is a free
// public API and often has 5-20s spikes; we retry twice with backoff
// before giving up. If still failing, FAIL CLOSED — the previous
// "fail-open, surface via community reports" was exploitable: predator
// waits for Overpass flap and hides stones at schools.
const RETRY_BACKOFFS_MS = [0, 2000, 5000];

async function invokeOnce(lat: number, lng: number): Promise<{
  ok: boolean;
  data?: { safe?: boolean; nearest_poi?: string; distance_m?: number; reason?: string; message?: string; warning?: string };
}> {
  try {
    const { data, error } = await supabase.functions.invoke('check-hide-location', {
      body: { lat, lng },
    });
    if (error) return { ok: false };
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

/**
 * Verifies coordinates are in a safe public place for hiding a painted stone.
 * Rejects: too close to schools/kindergartens, inside residential buildings,
 * or not near any public POI.
 *
 * Fail-closed on persistent Edge Function / Overpass errors. Up to 3
 * attempts with exponential backoff. If none succeed, returns
 * safe:false with reason='validation_unavailable' so the user is
 * asked to retry later instead of silently proceeding.
 *
 * Note: the Edge Function itself also fails-open internally with a
 * `warning: 'overpass_unavailable'` flag when Overpass is down; we
 * treat that case as an error too (fail-closed client-side) since
 * that response cannot certify the location.
 */
export async function checkHideLocationSafe(lat: number, lng: number): Promise<LocationSafetyResult> {
  if (!isSupabaseConfigured()) {
    return { safe: true };
  }

  for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
    if (i > 0 && RETRY_BACKOFFS_MS[i] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[i]));
    }
    const { ok, data } = await invokeOnce(lat, lng);
    if (!ok || !data) continue;

    // Edge function's internal fail-open returns {safe:true, nearest_poi:'overpass_unavailable'}.
    // That's not a real "safe" — Overpass was down server-side, we cannot
    // certify the location. Treat it as an error → retry.
    if (data.nearest_poi === 'overpass_unavailable' || data.warning === 'Validation service temporarily unavailable') {
      continue;
    }

    if (data.safe === true) {
      return { safe: true, nearestPoi: data.nearest_poi, distanceM: data.distance_m };
    }
    return {
      safe: false,
      reason: data.reason ?? 'unknown',
      message: data.message ?? 'Выбери другое место.',
    };
  }

  // All retries exhausted — fail closed.
  return {
    safe: false,
    reason: 'validation_unavailable',
    message:
      'Не можем сейчас проверить, безопасно ли это место. Попробуй позже — или выбери другое публичное место (парк, скамейка, библиотека).',
  };
}
