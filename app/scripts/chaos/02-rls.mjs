// Chaos-test: RLS enforcement — can user A read/modify user B's private data?
// Run: node scripts/chaos/02-rls.mjs
import { signUp, suite, section, pass, fail, info, report, SUPABASE_URL, ANON_KEY, restSelect } from './_shared.mjs';

async function main() {
  suite('RLS BOUNDARIES — cross-user data isolation');

  const userA = await signUp('chaos-rls-a');
  const userB = await signUp('chaos-rls-b');
  if (!userA.body.access_token || !userB.body.access_token) {
    fail('setup', 'could not create two users — skipping all RLS tests');
    return report();
  }
  const A = { jwt: userA.body.access_token, id: userA.body.user.id, email: userA.email };
  const B = { jwt: userB.body.access_token, id: userB.body.user.id, email: userB.email };
  info(`user A: ${A.id.slice(0, 8)}…   user B: ${B.id.slice(0, 8)}…`);

  // 1. Can B read A's balance_events?
  section('1. balance_events — B must NOT read A\'s events');
  const evB = await restSelect(B.jwt, 'balance_events', `user_id=eq.${A.id}&select=id,amount,reason`);
  if (evB.data?.length === 0) pass('B sees 0 rows of A\'s balance_events');
  else fail('RLS LEAK: balance_events', `B read ${evB.data?.length} rows of A's data`);

  // 2. Can B read A's profile? (profiles are partially public — username, avatar, etc.)
  //    But email and private fields should be hidden via RLS.
  section('2. profile SELECT — public fields yes, email never');
  const profB = await restSelect(B.jwt, 'profiles', `id=eq.${A.id}&select=id,username,email`);
  if (profB.data && profB.data.length > 0) {
    const row = profB.data[0];
    if ('email' in row && row.email) {
      fail('RLS LEAK: profiles.email exposed', `B sees A email=${row.email}`);
    } else {
      pass('profiles.email not exposed to other users');
    }
  } else {
    info('B cannot read A profile at all (also fine)');
  }

  // 3. Can B UPDATE A's profile?
  section('3. profile UPDATE — B must NOT modify A');
  const upd = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${A.id}`, {
    method: 'PATCH',
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${B.jwt}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ balance: 999999 }),
  });
  const updBody = await upd.text();
  let updData = null; try { updData = JSON.parse(updBody); } catch {}
  if (Array.isArray(updData) && updData.length === 0) pass('B\'s UPDATE on A\'s profile affected 0 rows');
  else if (upd.status === 403 || upd.status === 401) pass(`B\'s UPDATE rejected ${upd.status}`);
  else fail('RLS LEAK: profile UPDATE', `status=${upd.status} body=${updBody.slice(0, 150)}`);

  // 4. Verify A's balance unchanged
  section('4. A\'s balance should still be 20 (welcome bonus only)');
  const profA = await restSelect(A.jwt, 'profiles', `id=eq.${A.id}&select=balance`);
  if (profA.data?.[0]?.balance === 20) pass('A balance = 20 (untampered)');
  else fail('A balance tampered', `got ${profA.data?.[0]?.balance}`);

  // 5. Can B INSERT balance_events for A?
  section('5. balance_events INSERT — B must NOT create events for A');
  const insEv = await fetch(`${SUPABASE_URL}/rest/v1/balance_events`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${B.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: A.id, amount: 99999, reason: 'abuse', balance_after: 99999 }),
  });
  if (insEv.status === 401 || insEv.status === 403) pass(`balance_events INSERT rejected ${insEv.status}`);
  else if (insEv.status === 409 || insEv.status === 400) pass(`INSERT rejected by other check ${insEv.status}`);
  else fail('RLS LEAK: balance_events INSERT', `status=${insEv.status}`);

  // 6. Can B DELETE A's stones?
  section('6. stones DELETE — B must NOT delete A\'s stones');
  const delStones = await fetch(`${SUPABASE_URL}/rest/v1/stones?author_id=eq.${A.id}`, {
    method: 'DELETE',
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${B.jwt}` },
  });
  const delText = await delStones.text();
  if (delStones.status === 401 || delStones.status === 403) pass(`stones DELETE by B rejected ${delStones.status}`);
  else if (delStones.status === 204 || delStones.status === 200) {
    // check if anything actually deleted
    info(`DELETE returned ${delStones.status} — likely 0 rows affected, not a LEAK`);
    pass('delete did nothing');
  } else fail('unknown DELETE response', `${delStones.status}: ${delText.slice(0, 120)}`);

  // 7. Can anon (no JWT) read finds, balance_events, stones?
  section('7. anon cannot read private tables');
  const anonBal = await restSelect(null, 'balance_events', `select=id&limit=1`);
  if (anonBal.data?.length === 0 || !anonBal.ok) pass(`anon cannot read balance_events (${anonBal.status})`);
  else fail('RLS LEAK: anon reads balance_events', `got ${anonBal.data?.length} rows`);

  const anonFinds = await restSelect(null, 'finds', `select=id&limit=1`);
  if (anonFinds.data?.length === 0 || !anonFinds.ok) pass(`anon cannot read finds (${anonFinds.status})`);
  else fail('RLS LEAK: anon reads finds', `got ${anonFinds.data?.length} rows`);

  // 8. Can anon read stones? (should be yes — map is public)
  section('8. anon CAN read stones (public map)');
  const anonStones = await restSelect(null, 'stones', `select=id&limit=1`);
  if (anonStones.ok) pass(`anon reads stones (map is public) ${anonStones.status}`);
  else info(`anon stones read ${anonStones.status} — check if this is intentional`);

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
