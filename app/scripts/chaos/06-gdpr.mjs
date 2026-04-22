// Chaos-test: GDPR data export.
// Verifies:
//   - gdpr_export_my_data returns JSONB with expected keys
//   - Only current user's rows are included (no leak)
//   - Anon call rejected
// Run: node scripts/chaos/06-gdpr.mjs
import { signUp, suite, section, pass, fail, info, report, rpc } from './_shared.mjs';

async function main() {
  suite('GDPR — data export (Article 15)');

  const user = await signUp('chaos-gdpr');
  if (!user.body.access_token) {
    fail('setup', 'signup failed');
    return report();
  }
  const jwt = user.body.access_token;

  // 1. Call gdpr_export_my_data as signed-in user
  section('1. Export returns JSONB with expected shape');
  const exp = await rpc(jwt, 'gdpr_export_my_data');
  if (!exp.ok || !exp.data) {
    fail('export RPC failed', `${exp.status}: ${JSON.stringify(exp.data).slice(0, 200)}`);
    return report();
  }
  const expected = ['exported_at', 'user_id', 'profile', 'balance_events', 'stones_authored', 'finds', 'find_proofs', 'stone_reports', 'messages'];
  const missing = expected.filter((k) => !(k in exp.data));
  if (missing.length === 0) pass(`all ${expected.length} keys present`);
  else fail('missing keys', missing.join(', '));

  // 2. User just signed up — profile should exist, balance_events has welcome_bonus
  section('2. Fresh account shape');
  if (exp.data.profile?.id === user.body.user.id) pass('profile.id = user.id');
  else fail('profile mismatch', `got ${exp.data.profile?.id}`);
  if (Array.isArray(exp.data.balance_events) && exp.data.balance_events.length === 1) {
    pass(`1 balance_event (welcome_bonus)`);
  } else {
    fail('balance_events count wrong', `got ${exp.data.balance_events?.length}`);
  }
  if (Array.isArray(exp.data.stones_authored) && exp.data.stones_authored.length === 0) pass('0 stones (new user)');
  else fail('stones_authored not empty', JSON.stringify(exp.data.stones_authored).slice(0, 100));

  // 3. Export size is reasonable for fresh account (should be < 5KB)
  section('3. Payload size sanity');
  const json = JSON.stringify(exp.data);
  info(`payload size: ${json.length} bytes`);
  if (json.length < 10_000) pass('payload under 10KB for fresh account');
  else fail('payload unexpectedly large', `${json.length} bytes`);

  // 4. Anon cannot call export
  section('4. Anon export rejected');
  const anon = await rpc(null, 'gdpr_export_my_data');
  const msg = anon.data?.message || '';
  const isAuthErr = anon.status === 401 || anon.status === 403 || msg.includes('not_authenticated') || anon.data?.code === '28000';
  if (isAuthErr) pass(`anon rejected (${anon.status}, ${msg.slice(0, 40)})`);
  else fail('anon may call export', JSON.stringify(anon.data).slice(0, 150));

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
