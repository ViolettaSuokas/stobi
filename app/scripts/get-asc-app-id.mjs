// List all apps in App Store Connect and find Stobi's numeric ID.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function derToJose(der, size = 32) {
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  if (der[offset] !== 0x02) throw new Error('r');
  let rLen = der[offset + 1];
  let rStart = offset + 2;
  while (der[rStart] === 0x00 && rLen > size) { rStart++; rLen--; }
  const r = Buffer.alloc(size);
  der.slice(rStart, rStart + rLen).copy(r, size - rLen);
  offset = rStart + rLen;
  if (der[offset] !== 0x02) throw new Error('s');
  let sLen = der[offset + 1];
  let sStart = offset + 2;
  while (der[sStart] === 0x00 && sLen > size) { sStart++; sLen--; }
  const s = Buffer.alloc(size);
  der.slice(sStart, sStart + sLen).copy(s, size - sLen);
  return Buffer.concat([r, s]);
}

function jwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const toSign = `${head}.${body}`;
  const pem = readFileSync(P8_PATH, 'utf8');
  const sign = createSign('sha256');
  sign.update(toSign);
  return `${toSign}.${b64url(derToJose(sign.sign(pem)))}`;
}

const token = jwt();
const res = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=200', {
  headers: { 'Authorization': `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const data = await res.json();
console.log(`\nFound ${data.data.length} apps in App Store Connect:\n`);
for (const app of data.data) {
  const a = app.attributes;
  console.log(`  id=${app.id}`);
  console.log(`  bundleId=${a.bundleId}`);
  console.log(`  name=${a.name}`);
  console.log(`  sku=${a.sku}`);
  console.log(`  ---`);
}
