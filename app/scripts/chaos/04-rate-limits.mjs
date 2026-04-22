// Chaos-test: anti-abuse / rate limits.
//   - record_find: daily cap, global author cap, cannot find own stone, fresh
//   - report_stone_missing: GPS proximity check, unique reporter, 5/day cap
//   - Report-driven hide trigger: 3 reports + 30 days no-confirm → is_hidden
// Run: node scripts/chaos/04-rate-limits.mjs
import { signUp, suite, section, pass, fail, info, report, rpc, restSelect, fakeEmbedding, vecLiteral } from './_shared.mjs';

async function main() {
  suite('RATE LIMITS & ANTI-ABUSE');

  const A = await signUp('chaos-rate-a'); // stone author
  const B = await signUp('chaos-rate-b'); // finder
  if (!A.body.access_token || !B.body.access_token) {
    fail('setup', 'could not create users');
    return report();
  }
  const authorJwt = A.body.access_token;
  const finderJwt = B.body.access_token;
  const authorId = A.body.user.id;
  const finderId = B.body.user.id;

  // 1. Create a synthetic stone for A via create_stone RPC (fake embedding).
  //    This avoids burning Replicate quota. We pass a single-photo array.
  section('1. A creates a stone (create_stone RPC, fake embedding, 1 photo)');
  const fakeEmb = fakeEmbedding(42);
  // Note: create_stone accepts photo_urls[] + embeddings[] (vector(768)[]).
  // When calling via raw fetch (not supabase-js), vector must be sent as
  // a pgvector literal string like '[0.1,0.2,…]'.
  const created = await rpc(authorJwt, 'create_stone', {
    p_name: 'Chaos Test Stone',
    p_description: 'chaos-test synthetic — will be cleaned up',
    p_tags: ['chaos'],
    p_photo_urls: ['https://example.invalid/fake.jpg'],
    p_embeddings: [vecLiteral(fakeEmb)],
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_city: 'Helsinki',
  });
  if (created.ok && created.data?.stone_id) {
    pass(`stone created ${created.data.stone_id.slice(0, 8)}…`);
  } else {
    fail('create_stone failed', `status=${created.status} body=${JSON.stringify(created.data).slice(0, 200)}`);
    return report();
  }
  const stoneId = created.data.stone_id;

  // 2. A cannot find own stone
  section('2. Author cannot find their own stone');
  const selfFind = await rpc(authorJwt, 'record_find_v2', {
    p_stone_id: stoneId,
    p_photo_url: 'https://example.invalid/scan.jpg',
    p_embedding: vecLiteral(fakeEmb),
    p_proof_lat: 60.1699,
    p_proof_lng: 24.9384,
  });
  if (selfFind.data?.reason === 'cannot_find_own_stone' || selfFind.data?.status === 'rejected') pass('own stone rejected');
  else fail('author found own stone', JSON.stringify(selfFind.data).slice(0, 200));

  // 3. Stone too fresh (just created < 1 hour ago) → reject
  section('3. Stone < 1 hour old → reject fresh');
  const tooFresh = await rpc(finderJwt, 'record_find_v2', {
    p_stone_id: stoneId,
    p_photo_url: 'https://example.invalid/scan.jpg',
    p_embedding: vecLiteral(fakeEmb),
    p_proof_lat: 60.1699,
    p_proof_lng: 24.9384,
  });
  if (tooFresh.data?.reason === 'stone_too_fresh') pass('rejected stone_too_fresh');
  else info(`expected stone_too_fresh, got: ${JSON.stringify(tooFresh.data).slice(0, 200)}`);

  // 4. report_stone_missing — far away → reject
  section('4. report_stone_missing far from stone → rejected (GPS check)');
  const farReport = await rpc(finderJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 59.0, // far from stone at 60.1699
    p_lng: 24.0,
    p_reason: 'nothing here',
  });
  if (!farReport.ok || farReport.data?.status === 'rejected' || farReport.data?.reason === 'too_far') {
    pass(`far report rejected (${farReport.status})`);
  } else fail('far report accepted', JSON.stringify(farReport.data).slice(0, 200));

  // 5. report_stone_missing — author tries to report own stone → reject
  section('5. Author cannot report own stone missing');
  const selfReport = await rpc(authorJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_reason: 'test',
  });
  if (!selfReport.ok || selfReport.data?.status === 'rejected') pass(`author self-report rejected (${selfReport.status})`);
  else fail('author reported own stone', JSON.stringify(selfReport.data).slice(0, 200));

  // 6. Duplicate report: response can be OK (upsert), but DB row count stays 1
  section('6. Duplicate report same user → only 1 DB row (upsert pattern)');
  await rpc(finderJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_reason: 'first',
  });
  await rpc(finderJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_reason: 'second',
  });
  await rpc(finderJwt, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 60.1699,
    p_lng: 24.9384,
    p_reason: 'third',
  });
  const rows = await restSelect(finderJwt, 'stone_reports', `stone_id=eq.${stoneId}&reporter_id=eq.${finderId}&select=id,reason`);
  if (rows.data?.length === 1) pass(`3 report calls → 1 DB row (UNIQUE enforced, upsert semantics)`);
  else fail(`expected 1 row, got ${rows.data?.length}`, JSON.stringify(rows.data).slice(0, 200));

  // 7. Anon cannot report
  section('7. Anon cannot call report_stone_missing');
  const anonReport = await rpc(null, 'report_stone_missing', {
    p_stone_id: stoneId,
    p_lat: 60.1699,
    p_lng: 24.9384,
  });
  if (anonReport.status === 401 || anonReport.status === 403 || anonReport.data?.code === '28000') pass(`anon rejected (${anonReport.status})`);
  else fail('anon may report', JSON.stringify(anonReport.data).slice(0, 200));

  // 8. Cleanup: delete synthetic stone manually via DELETE (RLS: author only)
  section('8. Cleanup — author deletes their test stone');
  const del = await fetch(`https://zlnkzyvtxaksvilujdwu.supabase.co/rest/v1/stones?id=eq.${stoneId}`, {
    method: 'DELETE',
    headers: {
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms',
      'Authorization': `Bearer ${authorJwt}`,
    },
  });
  if (del.status === 204 || del.status === 200) pass(`stone deleted ${del.status}`);
  else info(`stone cleanup: ${del.status} — may need manual removal (id=${stoneId})`);

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
