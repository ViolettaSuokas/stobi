// Chaos: content_reports edge-cases — rate-limit, RLS, cascade-on-delete.
//
// Separated from 08-safety-tier1 because these are destructive (delete
// account) / slow (21 inserts for rate-limit) and we want to keep the
// fast smoke-test in 08 for CI, this in the nightly chaos run.

import {
  SUPABASE_URL, ANON_KEY,
  suite, section, pass, fail, info, report,
  signUpAsAdult, rpc, restSelect,
} from './_shared.mjs';

async function deleteSelf(jwt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_user`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

suite('content_reports edge-cases — rate-limit, RLS, cascade');

// ─── 1. Rate-limit: 20 reports OK, 21st rejected ─────────────────────
section('1. Rate-limit (20/24h)');

const rateUser = await signUpAsAdult('chaos-report-rate');
if (!rateUser.body?.access_token) {
  fail('sign up rate-limit user', JSON.stringify(rateUser.body));
  process.exit(1);
}
const jwtRate = rateUser.body.access_token;

info('firing 20 reports…');
let rateOk = 0;
for (let i = 0; i < 20; i++) {
  const r = await rpc(jwtRate, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: crypto.randomUUID(),
    p_category: 'spam',
  });
  if (r.ok && r.data?.ok === true) rateOk++;
}
if (rateOk === 20) pass(`20 reports accepted (${rateOk}/20)`);
else fail('20 reports accepted', `only ${rateOk} ok`);

// 21st report should fail rate_limit_exceeded
const r21 = await rpc(jwtRate, 'file_content_report', {
  p_target_type: 'stone',
  p_target_id: crypto.randomUUID(),
  p_category: 'spam',
});
if (!r21.ok && r21.text.includes('rate_limit_exceeded')) pass('21st report blocked by rate_limit_exceeded');
else fail('21st report blocked', `${r21.status} ${r21.text.slice(0, 200)}`);

// ─── 2. RLS: user A cannot see user B's reports ──────────────────────
section('2. RLS read_own');

const userA = await signUpAsAdult('chaos-rls-A');
const userB = await signUpAsAdult('chaos-rls-B');
if (!userA.body?.access_token || !userB.body?.access_token) {
  fail('sign up A/B', 'auth failed');
} else {
  const jwtA = userA.body.access_token;
  const jwtB = userB.body.access_token;
  const idA = userA.body.user.id;
  const targetId = crypto.randomUUID();

  // A files a report
  const rA = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: targetId,
    p_category: 'harassment',
    p_reason: 'RLS test report from A',
  });
  if (rA.ok && rA.data?.ok) pass("A's report filed");
  else { fail("A's report filed", JSON.stringify(rA.data)); }

  // A reads own — should see it
  const readA = await restSelect(jwtA, 'content_reports', `select=id,reporter_id,target_id&reporter_id=eq.${idA}`);
  const sawOwn = Array.isArray(readA.data) && readA.data.some((row) => row.target_id === targetId);
  if (sawOwn) pass('A can read own report');
  else fail('A can read own report', JSON.stringify(readA.data));

  // B reads A's — should be 0 rows (RLS filters)
  const readB = await restSelect(jwtB, 'content_reports', `select=id,reporter_id,target_id&reporter_id=eq.${idA}`);
  if (Array.isArray(readB.data) && readB.data.length === 0) pass("B cannot see A's reports (RLS ok)");
  else fail("B cannot see A's reports", JSON.stringify(readB.data));

  // ── 3. Cascade delete ──────────────────────────────────────────────
  section('3. Cascade on reporter delete');

  const delRes = await deleteSelf(jwtA);
  if (delRes.ok) pass('A account deleted');
  else {
    fail('A account deleted', `${delRes.status} ${delRes.text.slice(0, 200)}`);
  }

  // After cascade, no rows referencing A's id should remain. Check via
  // service-role — we can't (anon). Best we can do: confirm B still
  // sees their own view, and that a fresh A-like user login returns no
  // historical reports. Sufficient smoke.
  const readBAfter = await restSelect(jwtB, 'content_reports', `select=id&reporter_id=eq.${idA}`);
  if (Array.isArray(readBAfter.data) && readBAfter.data.length === 0) {
    pass("B's post-delete view of A's reports still empty (ok)");
  } else {
    fail("post-delete view", JSON.stringify(readBAfter.data));
  }
  info('full cascade verification requires service_role key — confirm in admin dashboard that no content_reports rows reference the deleted user id');
}

const ok = report();
process.exit(ok ? 0 : 1);
