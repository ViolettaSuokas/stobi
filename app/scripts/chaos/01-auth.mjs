// Chaos-test: auth edge cases.
// Run: node scripts/chaos/01-auth.mjs
import { signUp, signIn, suite, section, pass, fail, info, report, SUPABASE_URL, ANON_KEY } from './_shared.mjs';

async function main() {
  suite('AUTH EDGE CASES');

  // 1. Happy path signup
  section('1. Happy path signup → returns session + profile trigger fires');
  const s1 = await signUp('chaos-auth');
  if (s1.res.ok && s1.body.access_token) pass(`signup succeeds, email=${s1.email}`);
  else fail('signup failed', `status=${s1.res.status} body=${JSON.stringify(s1.body).slice(0, 200)}`);

  // 2. Welcome bonus profile + balance
  if (s1.body.access_token) {
    section('2. Welcome bonus fires on signup (balance=20, 1 balance_event)');
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${s1.body.user.id}&select=id,balance`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${s1.body.access_token}` },
    });
    const profile = (await profileRes.json())[0];
    if (profile?.balance === 20) pass('profile.balance = 20');
    else fail('wrong welcome balance', `expected 20, got ${profile?.balance}`);

    const eventRes = await fetch(`${SUPABASE_URL}/rest/v1/balance_events?user_id=eq.${s1.body.user.id}&select=amount,reason`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${s1.body.access_token}` },
    });
    const events = await eventRes.json();
    const welcome = events.find((e) => e.reason === 'welcome_bonus');
    if (welcome && welcome.amount === 20) pass(`welcome_bonus event exists, amount=${welcome.amount}`);
    else fail('welcome_bonus event missing', JSON.stringify(events).slice(0, 200));
  }

  // 3. Duplicate email should 4xx (not 500)
  section('3. Duplicate email → 4xx (not 500 crash)');
  const dup = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: s1.email, password: 'AnotherPass123!' }),
  });
  const dupBody = await dup.json();
  if (dup.status >= 400 && dup.status < 500) pass(`duplicate email rejected ${dup.status}`);
  else if (dup.status === 200 && dupBody.user && !dupBody.access_token) pass('duplicate email → needs confirmation (safe)');
  else fail('duplicate email bad response', `status=${dup.status} body=${JSON.stringify(dupBody).slice(0, 150)}`);

  // 4. Weak password
  section('4. Weak password → 4xx');
  const weak = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `chaos-weak-${Date.now()}@stobi.local`, password: '1' }),
  });
  if (weak.status >= 400 && weak.status < 500) pass(`weak password rejected ${weak.status}`);
  else fail('weak password accepted', `status=${weak.status}`);

  // 5. Invalid email format
  section('5. Invalid email format → 4xx');
  const bad = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'ValidPass123!' }),
  });
  if (bad.status >= 400 && bad.status < 500) pass(`invalid email rejected ${bad.status}`);
  else fail('invalid email accepted', `status=${bad.status}`);

  // 6. Login with wrong password
  if (s1.res.ok) {
    section('6. Login wrong password → 400 (not 500)');
    const wrong = await signIn(s1.email, 'wrong-password');
    if (wrong.res.status >= 400 && wrong.res.status < 500) pass(`wrong password rejected ${wrong.res.status}`);
    else fail('wrong password bad response', `status=${wrong.res.status}`);
  }

  // 7. Login with right password
  if (s1.res.ok) {
    section('7. Login correct password → valid session');
    const login = await signIn(s1.email, s1.password);
    if (login.body.access_token) pass('login returns access_token');
    else fail('login no token', JSON.stringify(login.body).slice(0, 150));
  }

  // 8. SQL injection attempt in email field
  section('8. SQL injection in email → no unexpected crash');
  const inj = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: "a'; drop table users; --@stobi.local", password: 'ValidPass123!' }),
  });
  if (inj.status !== 500) pass(`injection attempt handled ${inj.status}`);
  else fail('injection caused 500', await inj.text());

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
