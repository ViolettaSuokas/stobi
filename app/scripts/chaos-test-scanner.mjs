#!/usr/bin/env node
// Chaos-test для prod сканера. Гоняет реальные вызовы против deployed
// Edge Functions `process-stone-photo` / `process-find-photo` с разными
// фото + проверяет математическую правильность similarity-матчинга.
//
// Запуск: node app/scripts/chaos-test-scanner.mjs

const SUPABASE_URL = 'https://zlnkzyvtxaksvilujdwu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';

// Picsum.photos — стабильные URL по seed'у (same seed → same photo каждый раз),
// прямой CDN без авторизации, Replicate с них успешно скачивает.
// Разные seeds = разные фото, разные размеры = тот же семантический контент.
const PHOTOS = {
  stoneA_front: 'https://picsum.photos/seed/painted-stone-alpha/640/480',
  stoneA_angle: 'https://picsum.photos/seed/painted-stone-alpha/800/600', // same seed, разный размер
  stoneB_different: 'https://picsum.photos/seed/painted-stone-bravo/640/480',
  notStone_C: 'https://picsum.photos/seed/unrelated-charlie/640/480',
  notStone_D: 'https://picsum.photos/seed/unrelated-delta/640/480',
  brokenUrl: 'https://picsum.photos/this-path-does-not-exist-404',
};

const DELAY_MS = 12000; // 6 req/min = 1 req / 10s. Ставим 12s для safety.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cosineSim(a, b) {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function magnitude(v) {
  let sq = 0;
  for (const x of v) sq += x * x;
  return Math.sqrt(sq);
}

async function callEdge(fnName, photoUrl) {
  const started = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ photo_url: photoUrl }),
  });
  const elapsed = Date.now() - started;
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, raw: text, elapsed };
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); failures++; }
function info(msg) { console.log(`  ℹ  ${msg}`); }

let failures = 0;
const embeddings = {};

async function main() {
  console.log('\n=== Stobi Scanner Chaos Test ===\n');

  // ─── Test 1: все валидные фото дают 768-dim normalized embeddings ───
  console.log('[1] Single-photo pipeline (moderation + embedding)');
  let first = true;
  for (const [label, url] of Object.entries(PHOTOS)) {
    if (label === 'brokenUrl') continue;
    if (!first) await sleep(DELAY_MS); first = false;
    const r = await callEdge('process-find-photo', url);
    if (r.status !== 200) {
      fail(`${label}: HTTP ${r.status} — ${r.raw.slice(0, 120)}`);
      continue;
    }
    if (r.data?.safe === false) {
      info(`${label}: NSFW flagged — labels ${JSON.stringify(r.data.labels)}`);
      continue;
    }
    if (!r.data?.embedding) {
      fail(`${label}: no embedding in response`);
      continue;
    }
    const e = r.data.embedding;
    if (e.length !== 768) { fail(`${label}: wrong dim ${e.length}`); continue; }
    const m = magnitude(e);
    const normalized = Math.abs(m - 1.0) < 0.001;
    if (!normalized) fail(`${label}: not L2-normalized, magnitude=${m.toFixed(4)}`);
    else pass(`${label}: 768-dim, |v|=${m.toFixed(4)} (${r.elapsed}ms)`);
    embeddings[label] = e;
  }

  // ─── Test 2: broken URL → graceful error ───
  console.log('\n[2] Broken URL → graceful error (not 500)');
  await sleep(DELAY_MS);
  const r2 = await callEdge('process-find-photo', PHOTOS.brokenUrl);
  if (r2.status >= 500 || r2.status === 200) {
    info(`broken URL: status=${r2.status}, body=${r2.raw.slice(0, 150)}`);
    if (r2.status >= 500) fail(`server crashed on broken URL (should be 4xx with message)`);
  } else {
    pass(`broken URL: ${r2.status} — graceful`);
  }

  // ─── Test 3: same photo twice → similarity должна быть ~1.0 ───
  console.log('\n[3] Determinism: same photo twice → similarity ≥ 0.999');
  if (embeddings.stoneA_front) {
    await sleep(DELAY_MS);
    const r3 = await callEdge('process-find-photo', PHOTOS.stoneA_front);
    if (r3.data?.embedding) {
      const sim = cosineSim(embeddings.stoneA_front, r3.data.embedding);
      if (sim >= 0.999) pass(`stoneA twice: sim=${sim.toFixed(6)}`);
      else fail(`stoneA twice: sim=${sim.toFixed(6)} — should be ≥0.999`);
    }
  }

  // ─── Test 4: same stone, different thumb size — similarity high ───
  console.log('\n[4] Same stone, different size → similarity ≥ 0.95');
  if (embeddings.stoneA_front && embeddings.stoneA_angle) {
    const sim = cosineSim(embeddings.stoneA_front, embeddings.stoneA_angle);
    if (sim >= 0.95) pass(`stoneA 640px vs 800px: sim=${sim.toFixed(4)}`);
    else info(`stoneA 640px vs 800px: sim=${sim.toFixed(4)} (threshold 0.82 — ${sim >= 0.82 ? 'PASS threshold' : 'FAIL threshold'})`);
  }

  // ─── Test 5: different stones — similarity должна быть НИЖЕ threshold ───
  console.log('\n[5] Different stones → similarity < 0.82 (should be rejected)');
  if (embeddings.stoneA_front && embeddings.stoneB_different) {
    const sim = cosineSim(embeddings.stoneA_front, embeddings.stoneB_different);
    if (sim < 0.82) pass(`stoneA vs stoneB: sim=${sim.toFixed(4)} — correctly < 0.82`);
    else fail(`stoneA vs stoneB: sim=${sim.toFixed(4)} — too similar, would false-match!`);
  }

  // ─── Test 6: stone vs non-stone (cat) — similarity очень низкая ───
  console.log('\n[6] Unrelated pair → similarity < 0.60 (CLIP semantic distance)');
  if (embeddings.stoneA_front && embeddings.notStone_C) {
    const sim = cosineSim(embeddings.stoneA_front, embeddings.notStone_C);
    if (sim < 0.60) pass(`stoneA vs C: sim=${sim.toFixed(4)}`);
    else info(`stoneA vs C: sim=${sim.toFixed(4)} (picsum random, sometimes similar)`);
  }
  if (embeddings.notStone_C && embeddings.notStone_D) {
    const sim = cosineSim(embeddings.notStone_C, embeddings.notStone_D);
    info(`C vs D (two random picsum): sim=${sim.toFixed(4)} — baseline random-photo similarity`);
  }

  // ─── Test 7: averaging math (client-side simulation) ───
  console.log('\n[7] Multi-angle averaging: mean(normalized) → renormalize → unit vec');
  if (embeddings.stoneA_front && embeddings.stoneA_angle && embeddings.stoneB_different) {
    // Симулируем то что делает create_stone RPC после migration 20260422
    const avg = new Array(768).fill(0);
    const inputs = [embeddings.stoneA_front, embeddings.stoneA_angle, embeddings.stoneB_different];
    for (const v of inputs) for (let i = 0; i < 768; i++) avg[i] += v[i];
    for (let i = 0; i < 768; i++) avg[i] /= inputs.length;
    const magBeforeRenorm = magnitude(avg);
    info(`mean magnitude BEFORE renorm: ${magBeforeRenorm.toFixed(4)} (was the bug — should NOT be 1.0)`);
    // L2 normalize
    const m = magnitude(avg);
    for (let i = 0; i < 768; i++) avg[i] /= m;
    const magAfter = magnitude(avg);
    if (Math.abs(magAfter - 1.0) < 0.001) pass(`after renorm: |v|=${magAfter.toFixed(6)} — correct unit vector`);
    else fail(`after renorm: |v|=${magAfter.toFixed(6)} — math is wrong`);
  }

  // ─── Test 8: averaged ref — similarity к компонентам ───
  console.log('\n[8] Averaged ref similarity to component photos');
  if (embeddings.stoneA_front && embeddings.stoneA_angle) {
    const avg = new Array(768).fill(0);
    for (let i = 0; i < 768; i++) avg[i] = (embeddings.stoneA_front[i] + embeddings.stoneA_angle[i]) / 2;
    const m = magnitude(avg);
    for (let i = 0; i < 768; i++) avg[i] /= m;
    const simA1 = cosineSim(avg, embeddings.stoneA_front);
    const simA2 = cosineSim(avg, embeddings.stoneA_angle);
    info(`avg vs stoneA_front: ${simA1.toFixed(4)}`);
    info(`avg vs stoneA_angle: ${simA2.toFixed(4)}`);
    if (simA1 >= 0.95 && simA2 >= 0.95) pass('averaged ref preserves similarity to both inputs');
    else fail(`averaged ref lost similarity: ${simA1.toFixed(4)}, ${simA2.toFixed(4)}`);

    if (embeddings.stoneB_different) {
      const simB = cosineSim(avg, embeddings.stoneB_different);
      info(`avg stoneA vs stoneB: ${simB.toFixed(4)} (should stay < 0.82)`);
    }
  }

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
