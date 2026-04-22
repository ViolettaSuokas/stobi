// Master runner: executes all chaos tests in sequence, aggregates results.
// Run: node scripts/chaos/run-all.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  '01-auth.mjs',
  '02-rls.mjs',
  '03-balance.mjs',
  '04-rate-limits.mjs',
  '05-nsfw-pipeline.mjs',
  '06-gdpr.mjs',
];

async function runOne(file) {
  return new Promise((resolve) => {
    console.log(`\n╔══════════════════════════════════════\n║ RUNNING ${file}\n╚══════════════════════════════════════`);
    const p = spawn('node', [join(__dirname, file)], { stdio: 'inherit' });
    p.on('close', (code) => resolve({ file, code }));
  });
}

const results = [];
for (const s of SUITES) {
  results.push(await runOne(s));
}

console.log('\n\n═════════ FINAL SUMMARY ═════════');
const pass = results.filter((r) => r.code === 0);
const fail = results.filter((r) => r.code !== 0);
for (const r of results) {
  console.log(`  ${r.code === 0 ? '✅' : '❌'} ${r.file} (exit ${r.code})`);
}
console.log(`\n${pass.length}/${results.length} suites passed`);
if (fail.length === 0) console.log('\n🎉 All chaos tests passed.\n');
else console.log(`\n⚠  ${fail.length} suite(s) had failures.\n`);
process.exit(fail.length === 0 ? 0 : 1);
