// One-shot: delete stale EAS-managed provisioning profile from Apple.
// After deletion, next `eas build --platform ios` triggers EAS to request a
// fresh profile from Apple — which will include the newly-enabled
// Associated Domains + Push Notifications capabilities.
//
// Uses App Store Connect API with the .p8 key already stored locally.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

// ─── JWT sign (ES256) ────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function jwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 15 * 60, // 15 min, max 20 per Apple spec
    aud: 'appstoreconnect-v1',
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const toSign = `${head}.${body}`;
  const pem = readFileSync(P8_PATH, 'utf8');

  // Apple's .p8 returns DER-encoded signature from createSign('sha256'). Need
  // to convert to JWS (R||S concat, 32 bytes each for P-256 / ES256).
  const sign = createSign('sha256');
  sign.update(toSign);
  const der = sign.sign(pem);

  // Parse DER ECDSA signature → raw 64-byte R||S
  function derToJose(der, size = 32) {
    let offset = 2; // skip SEQUENCE tag + length
    if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f); // long-form length
    // r
    if (der[offset] !== 0x02) throw new Error('Expected INTEGER for r');
    let rLen = der[offset + 1];
    let rStart = offset + 2;
    while (der[rStart] === 0x00 && rLen > size) { rStart++; rLen--; }
    const r = Buffer.alloc(size);
    der.slice(rStart, rStart + rLen).copy(r, size - rLen);
    // s
    offset = rStart + rLen;
    if (der[offset] !== 0x02) throw new Error('Expected INTEGER for s');
    let sLen = der[offset + 1];
    let sStart = offset + 2;
    while (der[sStart] === 0x00 && sLen > size) { sStart++; sLen--; }
    const s = Buffer.alloc(size);
    der.slice(sStart, sStart + sLen).copy(s, size - sLen);
    return Buffer.concat([r, s]);
  }

  const sig = derToJose(der);
  return `${toSign}.${b64url(sig)}`;
}

// ─── ASC API calls ────────────────────────────────────────────────
const ASC_BASE = 'https://api.appstoreconnect.apple.com';

async function asc(path, init = {}) {
  const token = jwt();
  const res = await fetch(`${ASC_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function listProfiles() {
  const res = await asc('/v1/profiles?limit=200');
  if (!res.ok) throw new Error(`listProfiles ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data;
}

async function deleteProfile(id) {
  const res = await asc(`/v1/profiles/${id}`, { method: 'DELETE' });
  return res.status;
}

// ─── Main ─────────────────────────────────────────────────────────
const STALE_KEYWORDS = ['[expo]', 'com.stobi.app', 'AdHoc'];

(async () => {
  console.log('Listing provisioning profiles…');
  const profiles = await listProfiles();
  console.log(`Found ${profiles.length} active profiles`);

  const matches = profiles.filter((p) => {
    const name = p.attributes?.name || '';
    return STALE_KEYWORDS.every((k) => name.includes(k));
  });

  if (matches.length === 0) {
    console.log('\n✓ No stale [expo] AdHoc profile for com.stobi.app found.');
    console.log('  Either already deleted, or EAS has not provisioned one for this app+account yet.');
    console.log('  Next `eas build --platform ios` will generate fresh credentials.');
    return;
  }

  console.log(`\nFound ${matches.length} matching profile(s):`);
  for (const p of matches) {
    console.log(`  - ${p.id}: ${p.attributes.name} (expires ${p.attributes.expirationDate})`);
  }

  for (const p of matches) {
    console.log(`\nDeleting ${p.id} (${p.attributes.name})…`);
    const status = await deleteProfile(p.id);
    if (status === 204) console.log(`  ✓ deleted (${status})`);
    else console.log(`  ✗ failed (${status})`);
  }

  console.log('\nDone. Now run: npx eas-cli build --platform ios --profile preview');
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
