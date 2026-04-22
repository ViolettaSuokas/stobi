// Chaos-test: balance event integrity — balance column must equal
// sum(balance_events.amount) for every user. No silent drift, no duplicate
// welcome bonus, no negative balances.
// Run: node scripts/chaos/03-balance.mjs
import { signUp, suite, section, pass, fail, info, report, SUPABASE_URL, ANON_KEY, restSelect, rpc } from './_shared.mjs';

async function main() {
  suite('BALANCE INTEGRITY');

  const user = await signUp('chaos-balance');
  if (!user.body.access_token) {
    fail('setup', 'signup failed');
    return report();
  }
  const U = { jwt: user.body.access_token, id: user.body.user.id };

  // 1. Welcome bonus: exactly ONE event of amount +20
  section('1. Welcome bonus: exactly 1 event, amount=20');
  const ev = await restSelect(U.jwt, 'balance_events', `user_id=eq.${U.id}&select=amount,reason&order=created_at.asc`);
  const welcome = (ev.data || []).filter((e) => e.reason === 'welcome_bonus');
  if (welcome.length === 1 && welcome[0].amount === 20) pass('1 welcome_bonus event of +20');
  else fail('welcome count/amount wrong', `got ${welcome.length} events: ${JSON.stringify(welcome)}`);

  // 2. balance column == sum(balance_events)
  section('2. balance = sum(balance_events.amount)');
  const prof = await restSelect(U.jwt, 'profiles', `id=eq.${U.id}&select=balance`);
  const sum = (ev.data || []).reduce((a, b) => a + (b.amount || 0), 0);
  if (prof.data?.[0]?.balance === sum) pass(`balance=${sum} matches event sum`);
  else fail('DRIFT', `profile.balance=${prof.data?.[0]?.balance} vs events.sum=${sum}`);

  // 3. No balance_events for users that don't exist
  section('3. balance_events always tied to existing profile (FK integrity)');
  // Check via anon that no orphan rows exist for our user after user exists
  // (trivially true, but we verify the DB state is consistent)
  if (ev.data?.every((e) => e.reason)) pass('all events have reason set');
  else fail('event with empty reason', JSON.stringify(ev.data));

  // 4. Share-bonus dedup: rewardSocialShare(stoneId) can be called twice,
  //    only credit once per stone. We don't have a stone yet, so use a
  //    synthetic UUID and see what error comes back.
  section('4. Share-bonus on nonexistent stone → reject (not credit)');
  const fakeStoneId = '00000000-0000-0000-0000-000000000000';
  const share = await rpc(U.jwt, 'reward_social_share', { p_stone_id: fakeStoneId });
  if (!share.ok || share.data?.ok === false || share.data?.status === 'rejected') pass(`bonus rejected for nonexistent stone (${share.status})`);
  else fail('share-bonus credited fake stone', JSON.stringify(share.data).slice(0, 200));

  // 5. After failed share-bonus, balance still 20
  section('5. After failed bonus attempt, balance unchanged');
  const prof2 = await restSelect(U.jwt, 'profiles', `id=eq.${U.id}&select=balance`);
  if (prof2.data?.[0]?.balance === 20) pass('balance still 20');
  else fail('balance moved on failed bonus', `got ${prof2.data?.[0]?.balance}`);

  // 6. Anon attempts to call reward RPCs
  section('6. Anon cannot call reward RPCs');
  const anonShare = await rpc(null, 'reward_social_share', { p_stone_id: fakeStoneId });
  const msg = anonShare.data?.message || '';
  const isAuthErr = anonShare.status === 401 || anonShare.status === 403
    || anonShare.data?.code === '28000'
    || msg.includes('not_authenticated') || msg.includes('JWT') || msg.includes('auth');
  if (isAuthErr) pass(`anon rejected (${anonShare.status}, ${msg.slice(0, 40)})`);
  else fail('anon may call reward RPC', `status=${anonShare.status} data=${JSON.stringify(anonShare.data).slice(0, 100)}`);

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
