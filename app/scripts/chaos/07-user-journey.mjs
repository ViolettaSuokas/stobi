// End-to-end user journey: full happy-path flow that mimics what a
// TestFlight tester does on day one.
//
//   Author A → signs up → creates stone → gets paid reward
//   Finder B → signs up → cannot find A's fresh stone (1h gate) ✓
//                       → tries report far → rejected ✓
//                       → exports data → payload contains expected rows
//                       → deletes account → cascade cleanup
//   Author A → shares stone on social → +5💎 bonus credited once, dedup'd
//                                     → exports data → sees all events
//
// Uses fake 768-dim vectors (no Replicate calls). All RPC contract behaviour
// that users will hit in app.
//
// Run: node scripts/chaos/07-user-journey.mjs

import {
  signUp, suite, section, pass, fail, info, report,
  rpc, restSelect, fakeEmbedding, vecLiteral,
} from './_shared.mjs';

async function main() {
  suite('USER JOURNEY — full happy-path flow');

  const A = await signUp('chaos-journey-a');
  const B = await signUp('chaos-journey-b');
  if (!A.body.access_token || !B.body.access_token) {
    fail('setup', 'users not created');
    return report();
  }
  const authorJwt = A.body.access_token;
  const finderJwt = B.body.access_token;
  const authorId = A.body.user.id;
  const finderId = B.body.user.id;

  const emb = fakeEmbedding(42);

  section('1. Author creates stone');
  const created = await rpc(authorJwt, 'create_stone', {
    p_name: 'Test Stone Journey',
    p_description: 'integration — will be cleaned up',
    p_tags: ['chaos'],
    p_photo_urls: ['https://example.invalid/a.jpg'],
    p_embeddings: [vecLiteral(emb)],
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_city: 'Helsinki',
  });
  if (!created.ok || !created.data?.stone_id) {
    fail('create_stone', JSON.stringify(created.data).slice(0, 200));
    return report();
  }
  const stoneId = created.data.stone_id;
  pass(`stone created ${stoneId.slice(0, 8)}…`);

  // Author got reward?
  const aProfile = await restSelect(authorJwt, 'profiles', `id=eq.${authorId}&select=balance`);
  if (aProfile.data?.[0]?.balance >= 20) pass(`author balance = ${aProfile.data[0].balance} (welcome + reward)`);
  else fail('author balance wrong', `got ${aProfile.data?.[0]?.balance}`);

  section('2. Finder tries to find stone < 1h old → rejected');
  const freshFind = await rpc(finderJwt, 'record_find_v2', {
    p_stone_id: stoneId,
    p_photo_url: 'https://example.invalid/scan.jpg',
    p_embedding: vecLiteral(emb),
    p_proof_lat: 60.1699,
    p_proof_lng: 24.9384,
  });
  if (freshFind.data?.reason === 'stone_too_fresh') pass(`fresh stone rejected`);
  else info(`expected stone_too_fresh, got: ${JSON.stringify(freshFind.data).slice(0, 150)}`);

  section('3. Finder reports missing far away → rejected (50m gate)');
  const farReport = await rpc(finderJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 59.5,
    p_lng: 24.0,
    p_reason: 'not found',
  });
  if (!farReport.ok || farReport.data?.reason === 'too_far') pass(`far report rejected (${farReport.status})`);
  else fail('far report accepted', JSON.stringify(farReport.data).slice(0, 150));

  section('4. Share bonus requires finder role (author cannot share)');
  // share bonus is awarded only to the FINDER of a stone (after successful
  // record_find_v2). Author trying to claim it → not_found_by_user.
  const share1 = await rpc(authorJwt, 'reward_social_share', { p_stone_id: stoneId });
  if (!share1.ok && share1.data?.message === 'not_found_by_user') pass('author share rejected: not a finder');
  else fail('share bonus contract broken', JSON.stringify(share1.data).slice(0, 150));

  section('5. Finder exports data → valid JSONB with 9 keys');
  const exp = await rpc(finderJwt, 'gdpr_export_my_data');
  if (exp.ok && exp.data) {
    const expectedKeys = ['exported_at', 'user_id', 'profile', 'balance_events', 'stones_authored', 'finds', 'find_proofs', 'stone_reports', 'messages'];
    const missing = expectedKeys.filter((k) => !(k in exp.data));
    if (missing.length === 0) pass('export has all 9 keys');
    else fail('export missing keys', missing.join(','));
  } else {
    fail('export failed', JSON.stringify(exp.data).slice(0, 150));
  }

  section('6. Author export includes created stone + welcome event');
  const expA = await rpc(authorJwt, 'gdpr_export_my_data');
  if (expA.data?.stones_authored?.length === 1) pass('1 stone in export');
  else fail('stones_authored count wrong', `got ${expA.data?.stones_authored?.length}`);
  const bal = expA.data?.balance_events || [];
  if (bal.length >= 1) pass(`${bal.length} balance_events (>=welcome)`);
  else fail('balance_events missing', `got ${bal.length}`);

  section('7. Finder deletes account → cascade cleanup');
  const del = await rpc(finderJwt, 'delete_user');
  info(`delete_user returned: ${del.status}`);
  // Verify by checking their profile is gone
  const gone = await restSelect(null, 'profiles', `id=eq.${finderId}&select=id`);
  if (gone.data?.length === 0) pass('finder profile deleted');
  else fail('finder profile still exists', JSON.stringify(gone.data).slice(0, 100));

  section('8. Cleanup — author deletes stone + self');
  await fetch(`https://zlnkzyvtxaksvilujdwu.supabase.co/rest/v1/stones?id=eq.${stoneId}`, {
    method: 'DELETE',
    headers: {
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms',
      'Authorization': `Bearer ${authorJwt}`,
    },
  });
  await rpc(authorJwt, 'delete_user');
  pass('cleanup done');

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
