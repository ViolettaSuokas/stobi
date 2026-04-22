// Manage Google Cloud API key restrictions for Stobi.
//
// Authenticates via service account JSON key and applies:
//   - Android app restriction (com.stobi.app + SHA-1)
//   - API restriction to the minimum set of services Stobi uses
//
// Usage:
//   node scripts/gcp-restrict-api-key.mjs [--sha1 <fingerprint>] [--dry-run]
//
// Credentials never printed to stdout — only used in-memory for JWT signing.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SA_KEY_PATH = process.env.GCP_SA_KEY ?? '/Users/violettasuokas/Downloads/stobi-ee201-266ff06cd889.json';
const PROJECT_ID = 'stobi-ee201';
const TARGET_KEY_STRING = 'AIzaSyC9umUe-9DnV0ExVioM9b0SjXFTeKxBijk';
const PACKAGE_NAME = 'com.stobi.app';

// Minimum APIs Stobi uses through this Firebase key:
//   - FCM:    push notifications delivery (inbound token registration + delivery)
//   - Firebase Installations: required by FCM to mint instance IDs
//   - Identity Toolkit: Google Sign-In via @react-native-google-signin
const ALLOWED_APIS = [
  'fcm.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sha1Idx = args.indexOf('--sha1');
const sha1Override = sha1Idx >= 0 ? args[sha1Idx + 1] : null;

function b64url(b) {
  return Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function loadSA() {
  const raw = readFileSync(SA_KEY_PATH, 'utf8');
  const sa = JSON.parse(raw);
  return {
    client_email: sa.client_email,
    private_key: sa.private_key,
    project_id: sa.project_id,
  };
}

async function getAccessToken() {
  const sa = loadSA();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const toSign = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(sa.private_key);
  const jwt = `${toSign}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

async function listKeys(token) {
  const res = await fetch(
    `https://apikeys.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/keys`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`list keys ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.keys || [];
}

async function getKeyString(token, keyName) {
  const res = await fetch(
    `https://apikeys.googleapis.com/v2/${keyName}/keyString`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`getKeyString ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.keyString;
}

async function patchKey(token, keyName, updateMask, body) {
  const res = await fetch(
    `https://apikeys.googleapis.com/v2/${keyName}?updateMask=${updateMask}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
  return res.json();
}

async function enableApi(token, api) {
  const res = await fetch(
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/${api}:enable`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
  );
  if (!res.ok) throw new Error(`enable ${api}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`[gcp-restrict] project=${PROJECT_ID}`);
  const token = await getAccessToken();
  console.log('[gcp-restrict] auth OK');

  // Ensure API Keys API is enabled on the project (service account needs
  // serviceusage.services.enable — bundled in Service Usage Admin role).
  try {
    await enableApi(token, 'apikeys.googleapis.com');
    console.log('[gcp-restrict] apikeys.googleapis.com enabled (or already was)');
  } catch (e) {
    console.warn('[gcp-restrict] enable API returned:', e.message);
  }

  const keys = await listKeys(token);
  console.log(`[gcp-restrict] found ${keys.length} API keys`);

  // Find key matching TARGET_KEY_STRING by fetching each keyString.
  let target = null;
  for (const k of keys) {
    const ks = await getKeyString(token, k.name);
    const last8 = ks.slice(-8);
    console.log(`  - ${k.displayName} …${last8}`);
    if (ks === TARGET_KEY_STRING) target = k;
  }

  if (!target) {
    console.error(`\n[gcp-restrict] target key not found. Target ends with ${TARGET_KEY_STRING.slice(-8)}`);
    process.exit(1);
  }

  console.log(`\n[gcp-restrict] target: ${target.displayName} (${target.name})`);
  console.log(`  current restrictions: ${JSON.stringify(target.restrictions || {}, null, 2)}`);

  // Determine SHA-1
  let sha1 = sha1Override;
  const existingAllowed = target.restrictions?.androidKeyRestrictions?.allowedApplications || [];
  if (!sha1 && existingAllowed.length > 0) {
    sha1 = existingAllowed[0].sha1Fingerprint;
    console.log(`[gcp-restrict] reusing existing SHA-1 from key: ${sha1}`);
  }
  if (!sha1) {
    console.error('\n[gcp-restrict] NO SHA-1 available. Pass --sha1 <fingerprint> (colon-separated hex).');
    console.error('  Get it from: npx eas-cli credentials --platform android (interactive) → Show credentials');
    process.exit(1);
  }

  const desiredRestrictions = {
    androidKeyRestrictions: {
      allowedApplications: [{
        packageName: PACKAGE_NAME,
        sha1Fingerprint: sha1,
      }],
    },
    apiTargets: ALLOWED_APIS.map((service) => ({ service })),
  };

  console.log(`\n[gcp-restrict] desired restrictions:\n${JSON.stringify(desiredRestrictions, null, 2)}`);

  if (dryRun) {
    console.log('\n[gcp-restrict] --dry-run — skipping PATCH');
    return;
  }

  const updated = await patchKey(token, target.name, 'restrictions', { restrictions: desiredRestrictions });
  console.log(`\n[gcp-restrict] ✓ restrictions applied. Key ${target.displayName} now locked to ${PACKAGE_NAME} + FCM/Installations/IdentityToolkit.`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
