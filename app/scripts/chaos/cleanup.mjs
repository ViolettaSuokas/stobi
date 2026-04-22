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

const sql = `delete from auth.users where email like 'chaos-%@stobi.local' returning email;`;
console.log('Running:', sql);
try {
  execSync(`npx supabase db query --linked "${sql}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('Cleanup failed:', e.message);
  process.exit(1);
}
