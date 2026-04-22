// Shared utilities for chaos-test suite. Provides auth, RPC, REST helpers
// that target the **prod** Supabase of the linked project. Every test creates
// throwaway users (email pattern `chaos-*@stobi.local`) and relies on the
// `cleanup` helper (or a separate CLI step) to cascade-delete them after.

export const SUPABASE_URL = 'https://zlnkzyvtxaksvilujdwu.supabase.co';
export const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';

export const CHAOS_EMAIL_DOMAIN = '@stobi.local';

const STATS = { pass: 0, fail: 0, skip: 0, failures: [] };

export function pass(label) { STATS.pass++; console.log(`  ✅ ${label}`); }
export function fail(label, detail) { STATS.fail++; STATS.failures.push(`${label}: ${detail || ''}`); console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
export function skip(label, why) { STATS.skip++; console.log(`  ⏭  ${label} (skipped: ${why})`); }
export function info(msg) { console.log(`  ℹ  ${msg}`); }
export function section(title) { console.log(`\n▸ ${title}`); }
export function suite(title) { console.log(`\n═══ ${title} ═══`); }
export function report() {
  console.log(`\n──────────────────\n pass=${STATS.pass}  fail=${STATS.fail}  skip=${STATS.skip}`);
  if (STATS.failures.length) {
    console.log('\nFailures:');
    for (const f of STATS.failures) console.log(`  - ${f}`);
  }
  return STATS.fail === 0;
}
export function resetStats() { STATS.pass = STATS.fail = STATS.skip = 0; STATS.failures.length = 0; }

// ─── Auth ─────────────────────────────────────────────────────────
export async function signUp(emailPrefix = 'chaos') {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${CHAOS_EMAIL_DOMAIN}`;
  const password = 'ChaosTest_' + Math.random().toString(36).slice(2);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { res, body, email, password };
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { res, body };
}

// ─── RPC & REST ───────────────────────────────────────────────────
export async function rpc(jwt, fnName, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt || ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

export async function restSelect(jwt, table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt || ANON_KEY}`,
    },
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

// ─── Misc ─────────────────────────────────────────────────────────
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pgvector literal — PostgREST doesn't auto-serialize number[] to vector type,
// server expects '[0.1,0.2,...]' string. Use this when passing embeddings via
// RPC from raw fetch (supabase-js handles it automatically, so app code is OK).
export function vecLiteral(arr) {
  return '[' + arr.join(',') + ']';
}

export function fakeEmbedding(seed = 0) {
  // Deterministic pseudo-random 768-dim unit vector for tests that need
  // SOME embedding but don't care about semantic content (e.g. testing
  // rate limits, RLS, not similarity).
  let s = seed + 1;
  const out = new Array(768);
  let sq = 0;
  for (let i = 0; i < 768; i++) {
    s = (s * 9301 + 49297) % 233280;
    const v = (s / 233280) - 0.5;
    out[i] = v;
    sq += v * v;
  }
  const norm = Math.sqrt(sq);
  for (let i = 0; i < 768; i++) out[i] /= norm;
  return out;
}
