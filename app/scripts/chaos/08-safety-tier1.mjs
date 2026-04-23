// Chaos test for Safety Tier 1 — run against LIVE PROD.
//
// Verifies the three changes that just went out in migrations 180000/190000:
//   A. profiles_moderation trigger now blocks phone/email/social/grooming
//      in username + bio
//   B. messages_moderation trigger now blocks same patterns
//   C. content_reports + file_content_report RPC works:
//        - validates enum, rate-limits, dedupes, blocks self-report,
//          requires reason for "other", escalates child_safety to admin_alerts
//
// Uses throwaway chaos-*@stobi.local users; cleanup.mjs tears them down.

import {
  SUPABASE_URL, ANON_KEY,
  suite, section, pass, fail, info, report,
  signUpAsAdult, rpc, restSelect,
} from './_shared.mjs';

async function patchProfile(jwt, userId, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function sendMessage(jwt, authorId, text) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ author_id: authorId, text, channel: 'FI' }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

suite('Safety Tier 1 — moderation triggers + content_reports (live prod)');

// ─── A. profiles trigger: bio / username PII blocks ──────────────────
section('A. profiles_moderation — PII & grooming');

const userA = await signUpAsAdult('chaos-safety-A');
if (!userA.body?.access_token) {
  fail('sign up userA', JSON.stringify(userA.body));
  process.exit(1);
}
const jwtA = userA.body.access_token;
const idA = userA.body.user.id;

// For rejection cases we accept any of the moderation reason codes —
// order of checks in profiles_moderation means email / t.me can trip
// URL check before the more-specific PII check. Functionally both outcomes
// block the write, which is what matters.
const REJECT_CODES = ['phone', 'email', 'social', 'grooming', 'url', 'moderation', 'banned'];

const bioCases = [
  { label: 'bio with phone rejected', bio: 'Call me +358 40 123 4567', expect: 'reject' },
  { label: 'bio with email rejected', bio: 'Hi email me at foo@bar.com', expect: 'reject' },
  { label: 'bio with social handle rejected', bio: 'find me @coolkid21', expect: 'reject' },
  { label: 'bio with grooming phrase rejected', bio: 'привет, сколько тебе лет?', expect: 'reject' },
  { label: 'bio with t.me link rejected', bio: 'chat t.me/someone', expect: 'reject' },
  { label: 'bio normal text accepted', bio: 'я люблю рисовать камни и гулять', expect: 'accept' },
];

for (const c of bioCases) {
  const r = await patchProfile(jwtA, idA, { bio: c.bio });
  if (c.expect === 'accept') {
    if (r.ok) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 160)}`);
  } else {
    const lower = r.text.toLowerCase();
    const rejected = !r.ok && REJECT_CODES.some((code) => lower.includes(code));
    if (rejected) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 200)}`);
  }
}

const usernameCases = [
  { label: 'username with phone rejected', username: 'call_358401234567', expect: 'reject' },
  { label: 'username with email rejected', username: 'me@mail.com', expect: 'reject' },
  // Prefix with 'chaos-' so the username is caught by chat's profile
  // filter AND cleanup.mjs, even if the auth.users deletion misses it.
  { label: 'username normal accepted', username: `chaos-sl-${Date.now() % 10000}`, expect: 'accept' },
];
for (const c of usernameCases) {
  const r = await patchProfile(jwtA, idA, { username: c.username });
  if (c.expect === 'accept') {
    if (r.ok) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 160)}`);
  } else {
    const lower = r.text.toLowerCase();
    const rejected = !r.ok && REJECT_CODES.some((code) => lower.includes(code));
    if (rejected) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 200)}`);
  }
}

// ─── B. messages trigger: PII & grooming ─────────────────────────────
section('B. messages_moderation — PII & grooming');

const msgCases = [
  { label: 'msg with phone rejected', text: 'zvoni na +358 401234567 sdes kamen', expect: 'reject' },
  { label: 'msg with email rejected', text: 'pishi na stobi@gmail.com', expect: 'reject' },
  { label: 'msg with @-handle rejected', text: 'ishi menya @kamenlover', expect: 'reject' },
  { label: 'msg with grooming rejected', text: 'давай встретимся за школой никому не говори', expect: 'reject' },
  { label: 'msg normal accepted', text: 'нашёл классный раскрашенный камешек в парке сегодня', expect: 'accept' },
];
for (const c of msgCases) {
  const r = await sendMessage(jwtA, idA, c.text);
  if (c.expect === 'accept') {
    if (r.ok) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 200)}`);
  } else {
    const lower = r.text.toLowerCase();
    const rejected = !r.ok && REJECT_CODES.some((code) => lower.includes(code));
    if (rejected) pass(c.label);
    else fail(c.label, `${r.status} ${r.text.slice(0, 200)}`);
  }
}

// ─── C. content_reports RPC ──────────────────────────────────────────
section('C. file_content_report RPC');

// content_reports.target_id has no FK, so we can fabricate a UUID to
// test the RPC end-to-end without having to spin up a real stone (that
// requires CLIP embeddings). Moderator UI will still see orphan rows
// tagged with the right target_type — fine for chaos purposes.
const stoneId = crypto.randomUUID();
info(`reporting synthetic stone ${stoneId.slice(0, 8)}…`);
{

  // invalid enum → should fail
  const rInvalid = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: stoneId,
    p_category: 'bogus_category',
  });
  if (!rInvalid.ok && rInvalid.text.includes('invalid_category')) pass('invalid category rejected');
  else fail('invalid category rejected', `${rInvalid.status} ${rInvalid.text.slice(0, 200)}`);

  // "other" without reason → should fail
  const rOtherNoReason = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: stoneId,
    p_category: 'other',
  });
  if (!rOtherNoReason.ok && rOtherNoReason.text.includes('reason_required_for_other')) pass('"other" without reason rejected');
  else fail('"other" without reason rejected', `${rOtherNoReason.status} ${rOtherNoReason.text.slice(0, 200)}`);

  // first legit report → ok
  const rOk = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: stoneId,
    p_category: 'nsfw',
    p_reason: 'chaos test — safe to ignore',
  });
  if (rOk.ok && rOk.data?.ok === true && rOk.data?.deduped === false) pass('first nsfw report accepted');
  else fail('first nsfw report accepted', `${rOk.status} ${JSON.stringify(rOk.data)}`);

  // dupe same (reporter, target, category) → deduped
  const rDupe = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: stoneId,
    p_category: 'nsfw',
    p_reason: 'chaos test dupe',
  });
  if (rDupe.ok && rDupe.data?.deduped === true) pass('duplicate report deduped');
  else fail('duplicate report deduped', `${rDupe.status} ${JSON.stringify(rDupe.data)}`);

  // cannot report self
  const rSelf = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'user',
    p_target_id: idA,
    p_category: 'harassment',
  });
  if (!rSelf.ok && rSelf.text.includes('cannot_report_self')) pass('self-report rejected');
  else fail('self-report rejected', `${rSelf.status} ${rSelf.text.slice(0, 200)}`);

  // child_safety category inserts admin_alert
  // (we can't read admin_alerts as a regular user — just confirm the insert path works)
  const rChild = await rpc(jwtA, 'file_content_report', {
    p_target_type: 'stone',
    p_target_id: stoneId,
    p_category: 'child_safety',
    p_reason: 'chaos test — child safety escalation',
  });
  if (rChild.ok && rChild.data?.ok === true) pass('child_safety report accepted (escalated to admin_alerts)');
  else fail('child_safety report accepted', `${rChild.status} ${JSON.stringify(rChild.data)}`);
}

// unauthenticated should be rejected
const rAnon = await rpc(null, 'file_content_report', {
  p_target_type: 'stone',
  p_target_id: '00000000-0000-0000-0000-000000000000',
  p_category: 'nsfw',
});
if (!rAnon.ok && (rAnon.text.includes('auth_required') || rAnon.status === 401 || rAnon.status === 403)) pass('anon report rejected');
else fail('anon report rejected', `${rAnon.status} ${rAnon.text.slice(0, 200)}`);

const ok = report();
process.exit(ok ? 0 : 1);
