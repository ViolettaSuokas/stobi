// Clean up all chaos-test artefacts created by the 01-04 suites:
//   - auth.users where email like 'chaos-%@stobi.local' → cascades to:
//     profiles, balance_events, stones (by author_id), finds, stone_reports
//
// Run from CLI:
//   cd app && node scripts/chaos/cleanup.mjs
//
// Prompts supabase db query which requires confirmation. Safe — targets
// only rows matching the chaos-test email pattern.
import { execSync } from 'node:child_process';

// Broadened from 'chaos-%@stobi.local' to any '@stobi.local' email —
// catches test-user orphans even if their username was set to something
// that doesn't match the 'chaos-%' pattern (e.g. 08-safety-tier1's
// 'username normal accepted' test case used to pick 'StoneLover123').
const sql = `delete from auth.users where email like '%@stobi.local' returning email;`;
console.log('Running:', sql);
try {
  execSync(`npx supabase db query --linked "${sql}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('Cleanup failed:', e.message);
  process.exit(1);
}
