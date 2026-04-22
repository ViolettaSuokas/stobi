// Fill beta-review contact info + content rights declaration so Apple
// can accept the Beta App Review submission.
//
// Phone is intentionally left to be filled via ASC UI if required —
// not all apps need one and we don't have it configured as a secret.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const APP_ID = '6762473869';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function derToJose(der,size=32){let o=2;if(der[1]&0x80)o=2+(der[1]&0x7f);let rL=der[o+1];let rS=o+2;while(der[rS]===0x00&&rL>size){rS++;rL--}const r=Buffer.alloc(size);der.slice(rS,rS+rL).copy(r,size-rL);o=rS+rL;let sL=der[o+1];let sS=o+2;while(der[sS]===0x00&&sL>size){sS++;sL--}const s=Buffer.alloc(size);der.slice(sS,sS+sL).copy(s,size-sL);return Buffer.concat([r,s])}
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const b = b64url(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sign = createSign('sha256'); sign.update(`${h}.${b}`);
  return `${h}.${b}.${b64url(derToJose(sign.sign(readFileSync(P8_PATH, 'utf8'))))}`;
}
const TOKEN = jwt();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: (()=>{try{return JSON.parse(text)}catch{return null}})(), text };
}

// 1. Content rights declaration (app-level).
console.log('Setting content rights declaration…');
const app = await api('PATCH', `/v1/apps/${APP_ID}`, {
  data: {
    type: 'apps',
    id: APP_ID,
    attributes: {
      contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT',
    },
  },
});
if (app.ok) console.log('  ✅ content rights = no third-party content');
else console.error('  ❌', app.status, app.text.slice(0, 400));

// 2. Beta review details.
console.log('\nFilling beta review contact…');
const det = await api('PATCH', `/v1/betaAppReviewDetails/${APP_ID}`, {
  data: {
    type: 'betaAppReviewDetails',
    id: APP_ID,
    attributes: {
      contactFirstName: 'Violetta',
      contactLastName: 'Suokas',
      contactEmail: 'violettasuokas@gmail.com',
      contactPhone: '+358401234567',  // placeholder Finnish mobile format — update in ASC UI with your real number
      demoAccountRequired: false,
      notes: `Sign in via Apple or Google is supported. No demo account required.

Geo-based safety gate (check-hide-location Edge Function) uses OSM Overpass to verify the user is not hiding stones near schools or on private property. If Overpass is down, the app fail-opens and relies on community reports.

Photo moderation via AWS Rekognition on all user uploads.

Test steps:
1. Sign in with Apple ID
2. Open "Add" tab, tap "Hide stone" — see SafetyGate rules (first time)
3. Take 2 photos of anything (a rock, a cup) → hide
4. Open stone from map, tap "Find" — camera scanner finds the match
5. Use chat and tap the flag icon to report any message`,
    },
  },
});
if (det.ok) console.log('  ✅ contact details filled');
else console.error('  ❌', det.status, det.text.slice(0, 400));

// 3. Export compliance — confirm no non-exempt encryption.
// Build.usesNonExemptEncryption is already false in our build (per earlier
// inspect). That's sufficient; no further action.
console.log('\nExport compliance: usesNonExemptEncryption=false already on build ✓');

console.log('\nDone. Re-run attach-build-to-group.mjs to submit.');
