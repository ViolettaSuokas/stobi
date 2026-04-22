// Chaos: block_user / unblock_user RPCs + user_blocks RLS.

import {
  SUPABASE_URL, ANON_KEY,
  suite, section, pass, fail, info, report,
  signUpAsAdult, rpc, restSelect,
} from './_shared.mjs';

suite('Block user — RPCs + RLS');

const userA = await signUpAsAdult('chaos-block-A');
const userB = await signUpAsAdult('chaos-block-B');
if (!userA.body?.access_token || !userB.body?.access_token) {
  fail('sign up A/B', 'auth failed');
  process.exit(1);
}
const jwtA = userA.body.access_token;
const jwtB = userB.body.access_token;
const idA = userA.body.user.id;
const idB = userB.body.user.id;

section('1. Validation');

// Cannot block self
const rSelf = await rpc(jwtA, 'block_user', { p_target_id: idA });
if (!rSelf.ok && rSelf.text.includes('cannot_block_self')) pass('self-block rejected');
else fail('self-block rejected', `${rSelf.status} ${rSelf.text.slice(0, 200)}`);

// Unknown target rejected
const rBogus = await rpc(jwtA, 'block_user', { p_target_id: '00000000-0000-0000-0000-000000000000' });
if (!rBogus.ok && rBogus.text.includes('target_not_found')) pass('bogus target rejected');
else fail('bogus target rejected', `${rBogus.status} ${rBogus.text.slice(0, 200)}`);

// Anon rejected
const rAnon = await rpc(null, 'block_user', { p_target_id: idB });
if (!rAnon.ok && (rAnon.text.includes('auth_required') || rAnon.status === 401 || rAnon.status === 403)) {
  pass('anon block rejected');
} else fail('anon block rejected', `${rAnon.status} ${rAnon.text.slice(0, 200)}`);

section('2. Block + read');

// A blocks B
const rOk = await rpc(jwtA, 'block_user', { p_target_id: idB });
if (rOk.ok) pass('A blocks B');
else fail('A blocks B', `${rOk.status} ${rOk.text.slice(0, 200)}`);

// A sees the block
const readA = await restSelect(jwtA, 'user_blocks', `select=*&blocker_id=eq.${idA}`);
const sawBlock = Array.isArray(readA.data) && readA.data.some((r) => r.blocked_id === idB);
if (sawBlock) pass('A sees own block row');
else fail('A sees own block row', JSON.stringify(readA.data));

// B cannot see A's blocks (RLS)
const readB = await restSelect(jwtB, 'user_blocks', `select=*&blocker_id=eq.${idA}`);
if (Array.isArray(readB.data) && readB.data.length === 0) pass("B cannot read A's block list (RLS)");
else fail("B read A's blocks", JSON.stringify(readB.data));

// Double-block is idempotent (no conflict error)
const rAgain = await rpc(jwtA, 'block_user', { p_target_id: idB });
if (rAgain.ok) pass('double-block idempotent');
else fail('double-block idempotent', rAgain.text.slice(0, 200));

section('3. Unblock');

const rUn = await rpc(jwtA, 'unblock_user', { p_target_id: idB });
if (rUn.ok) pass('A unblocks B');
else fail('A unblocks B', rUn.text.slice(0, 200));

const readA2 = await restSelect(jwtA, 'user_blocks', `select=*&blocker_id=eq.${idA}&blocked_id=eq.${idB}`);
if (Array.isArray(readA2.data) && readA2.data.length === 0) pass('block row removed after unblock');
else fail('block row removed', JSON.stringify(readA2.data));

// Unblocking non-existent is OK (idempotent)
const rUn2 = await rpc(jwtA, 'unblock_user', { p_target_id: idB });
if (rUn2.ok) pass('unblock of non-existent is idempotent');
else fail('unblock idempotent', rUn2.text.slice(0, 200));

const ok = report();
process.exit(ok ? 0 : 1);
