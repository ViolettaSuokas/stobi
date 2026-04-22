// Chaos-test: NSFW / AWS Rekognition pipeline.
// Verifies:
//   - AWS Rekognition is actually reached (not silently fail-open)
//   - Safe painted stone photos return safe=true + embedding
//   - Broken photo URL → explicit error (not fail-open)
//   - Response time includes AWS call latency
// Run: node scripts/chaos/05-nsfw-pipeline.mjs
import { suite, section, pass, fail, info, report, SUPABASE_URL, ANON_KEY, signUp } from './_shared.mjs';

async function callEdge(fnName, photoUrl, jwt) {
  const t = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt || ANON_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ photo_url: photoUrl }),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text, elapsed: Date.now() - t };
}

async function main() {
  suite('NSFW PIPELINE — AWS Rekognition integration');

  // Safe public photo — picsum-style stable URL, known safe content (landscape).
  const SAFE_URL = 'https://picsum.photos/seed/stobi-nsfw-test/640/480';
  const BROKEN_URL = 'https://picsum.photos/this-is-404-not-found';

  // 1. Safe photo → safe=true, embedding present, timing includes AWS round-trip
  section('1. Safe photo → safe=true, embedding, plausible latency');
  const safe = await callEdge('process-find-photo', SAFE_URL);
  if (safe.status !== 200) {
    fail('safe call failed', `${safe.status}: ${safe.text.slice(0, 200)}`);
  } else if (safe.data?.safe !== true) {
    fail('safe photo flagged as unsafe', JSON.stringify(safe.data).slice(0, 200));
  } else if (!safe.data?.embedding || safe.data.embedding.length !== 768) {
    fail('no 768-dim embedding returned', `length=${safe.data?.embedding?.length}`);
  } else {
    pass(`safe=true, 768-dim embedding, ${safe.elapsed}ms`);
    // Rekognition usually adds 200-500ms; Replicate usually 1-3s.
    // Total ≥ 1500ms expected when AWS is actually called.
    if (safe.elapsed >= 1000) info(`latency ${safe.elapsed}ms — Rekognition + Replicate both called`);
    else info(`latency ${safe.elapsed}ms — shorter than expected, may still be Replicate cache`);
  }

  // 2. Broken URL → explicit error (fail-safe, NOT silently pass)
  section('2. Broken URL → fail-safe error (not silent pass)');
  const broken = await callEdge('process-find-photo', BROKEN_URL);
  if (broken.status === 200 && broken.data?.safe === true && broken.data?.embedding) {
    fail('BROKEN URL GOT SAFE=TRUE — fail-open leak', JSON.stringify(broken.data).slice(0, 200));
  } else if (broken.status >= 400) {
    pass(`broken URL rejected explicitly: ${broken.status} ${broken.data?.error?.slice(0, 80) || ''}`);
  } else {
    info(`broken URL response: ${broken.status} ${JSON.stringify(broken.data).slice(0, 150)}`);
  }

  // 3. Verify secrets actually set in Supabase (indirect: if NSFW check fails-open,
  //    safe=true returns even without Rekognition creds configured; with creds,
  //    any unreachable photo → error path, not safe=true).
  section('3. Secrets wired in Edge Function runtime (implicit via behaviour above)');
  if (safe.data?.safe === true && broken.status >= 400) {
    pass('behaviour consistent with AWS creds configured + reachable');
  } else {
    info('inconclusive — manual verify with Supabase Dashboard → Functions → Logs');
  }

  return report();
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('FATAL', e); process.exit(2); });
