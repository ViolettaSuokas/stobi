// Check TestFlight build availability via ASC API.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = '34579X3PVC';
const ISSUER_ID = '2e09458a-1a1d-4b7c-893d-8dcfbb6ca0ef';
const APP_ID = '6762473869';
const P8_PATH = new URL('../credentials/AuthKey_' + KEY_ID + '.p8', import.meta.url);

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

const token = jwt();

// List builds for this app, newest first
const res = await fetch(
  `https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/builds?limit=5`,
  { headers: { Authorization: `Bearer ${token}` } }
);
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const data = await res.json();

if (data.data.length === 0) {
  console.log('No builds yet. Submission may still be uploading.');
  process.exit(0);
}

console.log(`\n${data.data.length} recent build(s) in App Store Connect:\n`);
for (const build of data.data) {
  const a = build.attributes;
  console.log(`  version: ${a.version} (build ${a.buildNumber || '?'})`);
  console.log(`  uploaded: ${a.uploadedDate}`);
  console.log(`  processing: ${a.processingState}`);
  console.log(`  expired: ${a.expired}`);
  console.log(`  min OS: ${a.minOsVersion}`);
  console.log(`  TestFlight ready: ${a.processingState === 'VALID' ? 'YES' : 'processing…'}`);
  console.log(`  ---`);
}
