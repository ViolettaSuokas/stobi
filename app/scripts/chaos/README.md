# Stobi Chaos Test Suite

Integration tests that exercise **production** Supabase RPCs, storage, and
auth against **deployed** Edge Functions. Unlike unit tests that pass on
mocked data, these hit the real stack the way a TestFlight tester will.

Found and fixed two live-prod bugs on the first run (2026-04-22):
1. Signup 500 for every new user (birth_year trigger + welcome_bonus conflict)
2. Similarity threshold 0.60 below CLIP noise floor (now 0.70)

## Running

```bash
cd app
node scripts/chaos/run-all.mjs       # all 4 core suites (no Replicate quota)
node scripts/chaos/01-auth.mjs       # auth edge cases
node scripts/chaos/02-rls.mjs        # cross-user RLS enforcement
node scripts/chaos/03-balance.mjs    # balance/event integrity
node scripts/chaos/04-rate-limits.mjs # anti-abuse: find/report limits

node scripts/chaos-test-painted-stones.mjs   # scanner accuracy (uses Replicate quota)
```

## Cleanup

Each test creates throwaway users with pattern `chaos-<ts>-<rand>@stobi.local`.
Run periodically to delete:

```bash
node scripts/chaos/cleanup.mjs
# Or directly:
npx supabase db query --linked "delete from auth.users where email like 'chaos-%@stobi.local' returning email;"
```

Cascade-deletes profiles, balance_events, stones (authored), finds,
stone_reports, find_proofs.

## Adding a new suite

1. Create `scripts/chaos/NN-area.mjs` following the pattern of existing files
2. Import shared utilities from `_shared.mjs` (signUp, rpc, restSelect, vecLiteral)
3. Name throwaway users with prefix that includes the area (e.g. `chaos-rls-a`)
4. Use `pass()` / `fail()` / `info()` / `section()` / `suite()` helpers
5. End with `return report()` → exit code 0 on all pass
6. Add filename to `SUITES` in `run-all.mjs`

## What's tested vs what's manual

**Automated (this suite):**
- Auth: signup, login, duplicate email, weak password, SQL injection
- RLS: balance_events, profiles, stones, finds — cross-user isolation
- Balance: welcome_bonus, balance column = sum(events), share reward dedup
- Rate limits: author-can't-find-own, stone-too-fresh, duplicate reports, 50m GPS check

**Requires manual testing (UI flows, camera):**
- Hide flow 3-angle capture + Laplacian blur check
- Scan camera AI match celebration UI
- Find-anywhere top-3 picker UX
- Push notifications delivery
- Apple/Google Sign-In
- RevenueCat IAP flow
- Deep links (Universal Links + App Links)

**Separate:**
- `chaos-test-painted-stones.mjs` — scanner similarity on real painted stones
  (uses Replicate quota, ~60s to run)
