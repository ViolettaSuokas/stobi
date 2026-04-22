// Add external TestFlight testers via App Store Connect API.
// Creates a "Launch testers" beta group if none exists, then adds
// the emails to it. Apple sends each tester an invite email → tap
// "Start Testing" in the mail → TestFlight opens with Stobi ready
// to install. No code required.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const APP_ID = '6762473869';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

const TESTERS = [
  { email: 'violettasuokas@gmail.com', firstName: 'Violetta', lastName: 'Suokas' },
  { email: 'saoirsekotik@gmail.com',   firstName: 'Saoirse',  lastName: 'Kotik'  },
];
const GROUP_NAME = 'Launch testers';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function derToJose(der, size = 32) {
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  let rLen = der[offset + 1]; let rStart = offset + 2;
  while (der[rStart] === 0x00 && rLen > size) { rStart++; rLen--; }
  const r = Buffer.alloc(size); der.slice(rStart, rStart + rLen).copy(r, size - rLen);
  offset = rStart + rLen;
  let sLen = der[offset + 1]; let sStart = offset + 2;
  while (der[sStart] === 0x00 && sLen > size) { sStart++; sLen--; }
  const s = Buffer.alloc(size); der.slice(sStart, sStart + sLen).copy(s, size - sLen);
  return Buffer.concat([r, s]);
}
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const toSign = `${head}.${body}`;
  const sign = createSign('sha256');
  sign.update(toSign);
  return `${toSign}.${b64url(derToJose(sign.sign(readFileSync(P8_PATH, 'utf8'))))}`;
}

const TOKEN = jwt();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

// 1. Find or create the beta group.
console.log('Checking beta groups…');
const list = await api('GET', `/v1/apps/${APP_ID}/betaGroups?limit=50`);
if (!list.ok) { console.error('list groups failed:', list.status, list.text); process.exit(1); }

let group = list.data.data.find((g) => g.attributes.name === GROUP_NAME);

if (!group) {
  console.log(`Creating beta group "${GROUP_NAME}"…`);
  const created = await api('POST', '/v1/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: {
        name: GROUP_NAME,
        publicLinkEnabled: false,
        publicLinkLimitEnabled: false,
      },
      relationships: {
        app: { data: { type: 'apps', id: APP_ID } },
      },
    },
  });
  if (!created.ok) { console.error('create group failed:', created.status, created.text); process.exit(1); }
  group = created.data.data;
  console.log(`  → group id ${group.id}`);
} else {
  console.log(`  → reusing existing group ${group.id}`);
}

// 2. For each tester: create betaTester and associate with group.
for (const tester of TESTERS) {
  console.log(`\nAdding ${tester.email}…`);
  const created = await api('POST', '/v1/betaTesters', {
    data: {
      type: 'betaTesters',
      attributes: tester,
      relationships: {
        betaGroups: { data: [{ type: 'betaGroups', id: group.id }] },
      },
    },
  });

  if (created.ok) {
    console.log(`  ✅ invited — apple will email ${tester.email} shortly`);
    continue;
  }

  // If already exists, add to the group.
  const exists = /already exists/i.test(created.text) || created.status === 409
    || /EMAIL_ADDRESS_INVALID|UNIQUE_VIOLATION/i.test(created.text);
  if (!exists) {
    console.error(`  ❌ ${created.status} ${created.text.slice(0, 400)}`);
    continue;
  }

  // Find existing tester by email to attach to group.
  const find = await api('GET', `/v1/betaTesters?filter[email]=${encodeURIComponent(tester.email)}`);
  const row = find.data?.data?.[0];
  if (!row) {
    console.error(`  ❌ already exists but cannot find by email: ${created.text.slice(0, 200)}`);
    continue;
  }
  const attach = await api('POST', `/v1/betaGroups/${group.id}/relationships/betaTesters`, {
    data: [{ type: 'betaTesters', id: row.id }],
  });
  if (attach.ok) console.log(`  ✅ already registered — attached to group`);
  else console.error(`  ❌ attach failed: ${attach.status} ${attach.text.slice(0, 200)}`);
}

console.log('\nDone. Check inbox of each email for the TestFlight invite (subject "You\'re invited to test…").');
console.log(`Group: https://appstoreconnect.apple.com/apps/${APP_ID}/testflight/groups/${group.id}`);
