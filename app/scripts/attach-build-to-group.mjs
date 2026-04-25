// Attach the latest processed build to the "Launch testers" beta group
// and submit it for Beta App Review (external testers require review).
//
// Without this, invited testers get the "You're invited" email but see
// no build to install yet.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const APP_ID = '6762473869';
const GROUP_NAME = 'Launch testers';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function derToJose(der, size = 32) {
  let o = 2; if (der[1] & 0x80) o = 2 + (der[1] & 0x7f);
  let rL = der[o + 1]; let rS = o + 2;
  while (der[rS] === 0x00 && rL > size) { rS++; rL--; }
  const r = Buffer.alloc(size); der.slice(rS, rS + rL).copy(r, size - rL);
  o = rS + rL; let sL = der[o + 1]; let sS = o + 2;
  while (der[sS] === 0x00 && sL > size) { sS++; sL--; }
  const s = Buffer.alloc(size); der.slice(sS, sS + sL).copy(s, size - sL);
  return Buffer.concat([r, s]);
}
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const toSign = `${head}.${body}`;
  const sign = createSign('sha256'); sign.update(toSign);
  return `${toSign}.${b64url(derToJose(sign.sign(readFileSync(P8_PATH, 'utf8'))))}`;
}

const TOKEN = jwt();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

// 1. Find the build (newest VALID).
console.log('Finding latest build…');
const builds = await api('GET', `/v1/apps/${APP_ID}/builds?limit=10`);
if (!builds.ok) { console.error('list builds failed:', builds.text); process.exit(1); }
// Pick the NEWEST VALID build by uploadedDate — otherwise we'd act on
// an already-approved older build and skip the real new one.
const valid = builds.data.data
  .filter((b) => b.attributes.processingState === 'VALID')
  .sort((a, b) => new Date(b.attributes.uploadedDate) - new Date(a.attributes.uploadedDate));
const build = valid[0];
if (!build) { console.error('no processed build found'); process.exit(1); }
console.log(`  → build ${build.id}, version ${build.attributes.version}, uploaded ${build.attributes.uploadedDate}`);

// 2. Find the group.
const groups = await api('GET', `/v1/apps/${APP_ID}/betaGroups?limit=50`);
const group = groups.data.data.find((g) => g.attributes.name === GROUP_NAME);
if (!group) { console.error(`group "${GROUP_NAME}" not found`); process.exit(1); }
console.log(`  → group ${group.id}`);

// 3. Attach build to group.
console.log('\nAttaching build to group…');
const attach = await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, {
  data: [{ type: 'builds', id: build.id }],
});
if (attach.ok) console.log('  ✅ build attached');
else if (/already exists|UNIQUE/i.test(attach.text)) console.log('  ℹ  already attached');
else console.error('  ❌', attach.status, attach.text.slice(0, 400));

// 4. Check beta app review state.
console.log('\nChecking beta review state…');
const review = await api('GET', `/v1/builds/${build.id}/betaAppReviewSubmission`);
if (review.status === 404 || (review.ok && !review.data?.data)) {
  console.log('  → no review submission yet, creating…');
  const sub = await api('POST', '/v1/betaAppReviewSubmissions', {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  if (sub.ok) console.log('  ✅ submitted for Beta App Review — Apple reviews 24-48h');
  else if (/BETA_APP_REVIEW_REQUIRED|Missing|missingMetadata/i.test(sub.text)) {
    console.log('  ⚠  Beta App Review metadata missing (description, contact info, etc).');
    console.log('  ⚠  Fill in App Store Connect → TestFlight → App Info first.');
    console.log('     ' + sub.text.slice(0, 400));
  } else {
    console.error('  ❌', sub.status, sub.text.slice(0, 400));
  }
} else if (review.ok) {
  console.log(`  ℹ  review already submitted: ${review.data.data?.attributes?.betaReviewState ?? 'unknown'}`);
} else {
  console.error('  ❌ review check failed:', review.status, review.text.slice(0, 200));
}

console.log('\nDone.');
console.log(`Group dashboard: https://appstoreconnect.apple.com/apps/${APP_ID}/testflight/groups/${group.id}`);
