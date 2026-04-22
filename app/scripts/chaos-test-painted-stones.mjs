#!/usr/bin/env node
// Chaos-test с реальными painted stones (4 фото от founder'a).
//
// Фото предварительно загружены в Supabase storage `photos/chaos-test/`.
// Скрипт: signs URLs → вызывает prod Edge Functions → считает similarity
// матрицу между всеми парами → проверяет threshold'ы 0.70 / 0.82 на
// РЕАЛЬНЫХ painted stones.
//
// Запуск: cd app && node scripts/chaos-test-painted-stones.mjs

const SUPABASE_URL = 'https://zlnkzyvtxaksvilujdwu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';

const FILES = ['stone_a_zombie', 'stone_b_ladybug', 'stone_c_eggplant', 'stone_d_portrait'];
const DELAY_MS = 12000; // Replicate free tier = 6 req/min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let AUTH_JWT = null;

async function authenticate() {
  // Photos bucket requires authenticated role for SELECT. Create a throwaway
  // user via signup; we'll delete it from the script output afterwards.
  const email = `chaos-${Date.now()}@stobi.local`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ChaosTest_' + Math.random().toString(36).slice(2) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`auth signup failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`no access_token; response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  AUTH_JWT = data.access_token;
  return email;
}

async function signUrl(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/photos/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AUTH_JWT || ANON_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!res.ok) throw new Error(`sign failed ${res.status}: ${await res.text()}`);
  const { signedURL } = await res.json();
  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

async function callEdge(fnName, photoUrl) {
  const t = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ photo_url: photoUrl }),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, raw: text, elapsed: Date.now() - t };
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function mag(v) { let s = 0; for (const x of v) s += x*x; return Math.sqrt(s); }

async function main() {
  console.log('\n=== Stobi Scanner Chaos Test — REAL PAINTED STONES ===\n');

  console.log('[0] Creating throwaway auth session (needed for storage read policy)...');
  const chaosEmail = await authenticate();
  console.log(`    ✓ authenticated as ${chaosEmail}`);

  const embeddings = {};
  console.log(`\n[1] Generating signed URLs + running Edge Functions (${DELAY_MS/1000}s delay per call for rate limit)...`);
  let first = true;
  for (const name of FILES) {
    if (!first) await sleep(DELAY_MS); first = false;
    const url = await signUrl(`chaos-test/${name}.jpg`);
    const r = await callEdge('process-find-photo', url);
    if (r.status !== 200 || !r.data?.embedding) {
      console.log(`  ❌ ${name}: HTTP ${r.status} — ${r.raw.slice(0, 180)}`);
      continue;
    }
    if (r.data.safe === false) {
      console.log(`  ℹ ${name}: NSFW-flagged ${JSON.stringify(r.data.labels)}`);
      continue;
    }
    const e = r.data.embedding;
    const m = mag(e);
    const normOk = Math.abs(m - 1.0) < 0.001;
    console.log(`  ${normOk ? '✅' : '❌'} ${name}: 768-dim, |v|=${m.toFixed(4)}, ${r.elapsed}ms`);
    embeddings[name] = e;
  }

  const names = Object.keys(embeddings);
  if (names.length < 2) {
    console.log('\n⚠ Not enough embeddings to compute similarity matrix. Aborting.');
    process.exit(2);
  }

  // ─── Similarity matrix between every pair ───
  console.log('\n[2] Pairwise similarity matrix:\n');
  const header = '          ' + names.map((n) => n.slice(6, 14).padEnd(10)).join('');
  console.log(header);
  const allPairs = [];
  for (const a of names) {
    const row = [a.slice(6, 14).padEnd(10)];
    for (const b of names) {
      if (a === b) { row.push('   —     '); continue; }
      const sim = cosineSim(embeddings[a], embeddings[b]);
      row.push(sim.toFixed(4).padEnd(9));
      if (names.indexOf(a) < names.indexOf(b)) allPairs.push({ a, b, sim });
    }
    console.log(row.join(' '));
  }

  // ─── Analysis ───
  console.log('\n[3] Analysis — expected behavior for painted stones:');
  console.log('    - different painted stones should give similarity < 0.70 (rejected)');
  console.log('    - 0.70-0.82 would be "pending" (author review) — should be RARE');
  console.log('    - ≥0.82 would auto-verify — should only happen for same stone\n');

  const sims = allPairs.map((p) => p.sim);
  const max = Math.max(...sims);
  const min = Math.min(...sims);
  const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
  console.log(`    Between different painted stones: min=${min.toFixed(4)}  avg=${avg.toFixed(4)}  max=${max.toFixed(4)}`);

  let verdict = [];
  if (max < 0.70) verdict.push('✅ No painted-stone pair crosses 0.70 — threshold is safe');
  else if (max < 0.82) verdict.push(`⚠  Max between-stone similarity = ${max.toFixed(4)} — would show as "pending" requiring author approval`);
  else verdict.push(`❌ Max between-stone similarity = ${max.toFixed(4)} — would FALSE-VERIFY as same stone!`);

  const above070 = allPairs.filter((p) => p.sim >= 0.70);
  if (above070.length > 0) {
    console.log(`\n    Pairs crossing 0.70 (would go to pending):`);
    for (const p of above070) console.log(`      ${p.a} ↔ ${p.b}: ${p.sim.toFixed(4)}`);
  }

  console.log('\n' + verdict.join('\n'));

  // ─── What this means for thresholds ───
  console.log('\n[4] Threshold recommendations:');
  if (max < 0.60) {
    console.log('    CLIP strongly distinguishes painted stones. Could lower pending threshold to 0.70');
    console.log('    (gives more GPS-assist headroom for legitimate finds with lighting variation)');
  } else if (max < 0.70) {
    console.log('    Current threshold 0.70 for pending is correct — just above the noise');
  } else if (max < 0.82) {
    console.log('    Painted stones have non-trivial baseline similarity. Consider raising pending to 0.80');
  } else {
    console.log('    CRITICAL: threshold 0.82 too low for your stone population. Raise to 0.88+');
  }

  console.log('\n=== DONE ===\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
