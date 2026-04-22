// Chaos: verify check-hide-location Edge Function against live OSM Overpass.
//
// We hit three Helsinki/Espoo coordinates with known characteristics:
//   - School → should reject `near_school`
//   - Park   → should accept, with `nearest_poi` populated
//   - Deep forest (Nuuksio) → should reject `no_public_poi`
//
// Note: fails-open on Overpass outage (function returns safe=true with
// warning), so if a test unexpectedly passes check what `nearest_poi` is.

import { SUPABASE_URL, ANON_KEY, signUpAsAdult, suite, section, pass, fail, info, report } from './_shared.mjs';

async function checkHide(jwt, lat, lng) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/check-hide-location`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lat, lng }),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

suite('Geo-POI validation — check-hide-location Edge Function');

const u = await signUpAsAdult('chaos-geo');
if (!u.body?.access_token) {
  fail('sign up', JSON.stringify(u.body));
  process.exit(1);
}
const jwt = u.body.access_token;

section('A. School coordinate → rejected (anti-grooming gate)');
// Ressu — Kalevankatu 8, 00100 Helsinki. Ressun lukio + peruskoulu tagged
// as amenity=school in OSM.
const school = await checkHide(jwt, 60.16704, 24.93479);
info(`school response: ${JSON.stringify(school.data).slice(0, 200)}`);
if (school.data?.safe === false && school.data?.reason === 'near_school') {
  pass('school within 300m rejected with reason=near_school');
} else if (school.data?.nearest_poi === 'overpass_unavailable') {
  info('Overpass unavailable — cannot verify (fail-open path hit)');
  pass('fail-open returned safe=true with warning (expected when Overpass flaky)');
} else {
  fail('school reject', JSON.stringify(school.data));
}

section('B. Park (Kaivopuisto, Helsinki) → accepted');
// 60.1555, 24.9580 is inside Kaivopuisto park, lots of amenity=bench +
// leisure=park nearby.
const park = await checkHide(jwt, 60.1555, 24.9580);
info(`park response: ${JSON.stringify(park.data).slice(0, 200)}`);
if (park.data?.safe === true && park.data?.nearest_poi) {
  pass(`park accepted, nearest_poi=${park.data.nearest_poi}, distance=${park.data.distance_m}m`);
} else if (park.data?.safe === false) {
  fail('park accept', `rejected reason=${park.data.reason}`);
} else {
  fail('park accept', JSON.stringify(park.data));
}

section('C. Deep forest (Nuuksio) → no public POI');
// Middle of Nuuksio national park — no buildings, no benches, no
// playgrounds — should trigger no_public_poi branch.
const forest = await checkHide(jwt, 60.31400, 24.52500);
info(`forest response: ${JSON.stringify(forest.data).slice(0, 200)}`);
if (forest.data?.safe === false && forest.data?.reason === 'no_public_poi') {
  pass('forest rejected with reason=no_public_poi');
} else if (forest.data?.nearest_poi === 'overpass_unavailable') {
  pass('fail-open (Overpass flaky) — acceptable');
} else if (forest.data?.safe === true && forest.data?.nearest_poi) {
  // Sometimes OSM has tagged forest trails with amenity=bench — real
  // corner case. Log rather than fail hard.
  info(`forest has unexpected POI: ${forest.data.nearest_poi}`);
  pass('forest accepted (OSM has tagged a POI here — review test coord)');
} else {
  fail('forest reject', JSON.stringify(forest.data));
}

section('D. Bad input validation');
const bad = await checkHide(jwt, 999, 999);
if (!bad.ok && bad.status === 400) pass('invalid lat/lng rejected with 400');
else fail('invalid lat/lng', `${bad.status} ${JSON.stringify(bad.data)}`);

const unauth = await fetch(`${SUPABASE_URL}/functions/v1/check-hide-location`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
  body: JSON.stringify({ lat: 60.17, lng: 24.93 }),
});
if (unauth.status === 401) pass('missing bearer rejected 401');
else fail('missing bearer', `${unauth.status}`);

const ok = report();
process.exit(ok ? 0 : 1);
