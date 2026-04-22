// Chaos: sanity-check that uploaded photos in the 'photos' bucket don't
// contain EXIF GPS tags. Picks up a recent object via service-role REST
// and scans the first ~64KB for EXIF markers.
//
// Requires SUPABASE_SERVICE_ROLE to be set (not anon) since we need to
// read arbitrary objects bypassing per-user RLS. Skip silently if unset.

import {
  SUPABASE_URL, ANON_KEY,
  suite, section, pass, fail, info, report,
} from './_shared.mjs';

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

suite('EXIF strip — storage.objects in photos bucket');

if (!SERVICE) {
  info('SUPABASE_SERVICE_ROLE_KEY not set — skipping (run locally only)');
  process.exit(0);
}

// List last 10 objects in photos/*.
const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/photos`, {
  method: 'POST',
  headers: {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ limit: 10, prefix: '', sortBy: { column: 'created_at', order: 'desc' } }),
});
const items = await list.json().catch(() => []);
if (!Array.isArray(items) || items.length === 0) {
  info('no photos found — skipping');
  process.exit(0);
}

section('Scanning recent uploads for EXIF markers');

// EXIF JPEG marker is 0xFFE1 followed by "Exif\0\0" (0x45 0x78 0x69 0x66 0x00 0x00)
// GPS IFD marker inside EXIF is 0x8825.
const EXIF_MAGIC = Buffer.from([0xFF, 0xE1]);
const EXIF_HEADER = Buffer.from('Exif\0\0');
const GPS_IFD = Buffer.from([0x88, 0x25]);

let checked = 0;
let withExif = 0;
let withGps = 0;

for (const item of items.slice(0, 5)) {
  const name = item.name;
  if (!/\.(jpe?g|png|heic)$/i.test(name)) continue;

  // Fetch first 64KB of the object.
  const objRes = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${encodeURIComponent(name)}`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${SERVICE}`,
      'Range': 'bytes=0-65535',
    },
  });
  if (!objRes.ok) {
    info(`skip ${name}: ${objRes.status}`);
    continue;
  }
  const buf = Buffer.from(await objRes.arrayBuffer());
  checked++;

  const hasExif = buf.includes(EXIF_MAGIC) && buf.includes(EXIF_HEADER);
  const hasGps = buf.includes(GPS_IFD);

  if (hasExif) withExif++;
  if (hasGps) withGps++;

  if (hasGps) {
    fail(`${name.slice(-40)} contains GPS IFD`, 'expected EXIF stripped');
  } else if (hasExif) {
    info(`${name.slice(-40)}: EXIF present but no GPS IFD (acceptable, but ideally stripped)`);
  } else {
    pass(`${name.slice(-40)}: clean`);
  }
}

info(`checked=${checked} with_exif=${withExif} with_gps=${withGps}`);

if (withGps > 0) {
  fail('EXIF GPS found on uploaded photos', 'processPhoto should strip before upload');
} else {
  pass('no GPS IFD found on any sampled photo');
}

const ok = report();
process.exit(ok ? 0 : 1);
