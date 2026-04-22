// Fill in the Beta App Localization (description + feedback email) so
// builds can be submitted for Beta App Review.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const APP_ID = '6762473869';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

const META = {
  feedbackEmail: 'violettasuokas@gmail.com',
  marketingUrl: 'https://stobi.app',
  privacyPolicyUrl: 'https://stobi.app/privacy',
  description: `Stobi — find and hide painted stones around Helsinki. Paint a rock, hide it in a public place (park, library, bench), and share its photo. Other players find stones using the camera scanner and earn rewards. Designed for families and kids.

Please test:
- Hide a stone (you'll see the safety rules once on first hide)
- Find a stone near you using the camera scanner
- Chat with other players
- Tap the Flag icon to report inappropriate content
- Tap block on a user to hide all their content

Report any crashes or confusing flows via TestFlight feedback or email above.`,
  whatsNew: `First TestFlight: child-safety gates, universal Report button, block users, improved stone scanner.`,
};

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

// ─── 1. betaAppLocalizations — description, feedback email, urls ───
console.log('Checking beta app localizations…');
const loc = await api('GET', `/v1/apps/${APP_ID}/betaAppLocalizations?limit=10`);
if (!loc.ok) { console.error('list loc failed:', loc.text); process.exit(1); }

const existing = loc.data.data.find((l) => l.attributes.locale === 'en-US');
if (existing) {
  console.log(`  → updating en-US (id ${existing.id})`);
  const upd = await api('PATCH', `/v1/betaAppLocalizations/${existing.id}`, {
    data: {
      type: 'betaAppLocalizations',
      id: existing.id,
      attributes: {
        feedbackEmail: META.feedbackEmail,
        marketingUrl: META.marketingUrl,
        privacyPolicyUrl: META.privacyPolicyUrl,
        description: META.description,
      },
    },
  });
  if (upd.ok) console.log('  ✅ localization updated');
  else console.error('  ❌', upd.status, upd.text.slice(0, 400));
} else {
  console.log('  → creating en-US localization');
  // betaAppLocalizations do NOT accept whatsNew — that belongs on the
  // build-level localization (betaBuildLocalizations). Strip it here.
  const { whatsNew: _drop, ...appAttrs } = META;
  const cre = await api('POST', '/v1/betaAppLocalizations', {
    data: {
      type: 'betaAppLocalizations',
      attributes: { locale: 'en-US', ...appAttrs },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  });
  if (cre.ok) console.log('  ✅ localization created');
  else console.error('  ❌', cre.status, cre.text.slice(0, 400));
}

// ─── 2. betaBuildLocalization for the latest build — what's new ───
console.log('\nAdding "what to test" to latest build…');
const builds = await api('GET', `/v1/apps/${APP_ID}/builds?limit=10`);
const build = builds.data.data.find((b) => b.attributes.processingState === 'VALID');
if (!build) { console.error('no valid build'); process.exit(1); }

const bb = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations?limit=10`);
const bbEn = bb.data?.data?.find((l) => l.attributes.locale === 'en-US');
if (bbEn) {
  const upd = await api('PATCH', `/v1/betaBuildLocalizations/${bbEn.id}`, {
    data: { type: 'betaBuildLocalizations', id: bbEn.id, attributes: { whatsNew: META.whatsNew } },
  });
  if (upd.ok) console.log('  ✅ whatsNew updated');
  else console.error('  ❌', upd.text.slice(0, 300));
} else {
  const cre = await api('POST', '/v1/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: 'en-US', whatsNew: META.whatsNew },
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  if (cre.ok) console.log('  ✅ whatsNew created');
  else console.error('  ❌', cre.text.slice(0, 300));
}

console.log('\nDone. Now re-run attach-build-to-group.mjs to submit for Beta App Review.');
