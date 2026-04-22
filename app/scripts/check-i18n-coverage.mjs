// Localization QA: make sure every key defined in en.ts has translations
// in fi.ts and ru.ts. Missing keys fall back to English in the UI, which
// is fine but ideally caught before Finnish beta testers see it.

import { readFileSync } from 'node:fs';

const LANGS = ['en', 'fi', 'ru'];
const files = {};
for (const lang of LANGS) {
  files[lang] = readFileSync(`./lib/i18n/strings/${lang}.ts`, 'utf8');
}

function extractKeys(source, prefix = '') {
  // Pull every "key.path": "value" pair at the leaf level. We approximate by
  // matching string literals — good enough for flat or nested object shapes
  // written with quoted property names.
  const pattern = /['"]([a-z0-9_]+(?:\.[a-z0-9_]+)*)['"]\s*:\s*['"`]/gi;
  const out = new Set();
  for (const m of source.matchAll(pattern)) {
    out.add(m[1]);
  }
  return out;
}

const keys = {};
for (const lang of LANGS) keys[lang] = extractKeys(files[lang]);

console.log('\n=== i18n coverage ===\n');
for (const lang of LANGS) console.log(`  ${lang}.ts: ${keys[lang].size} keys`);

let issues = 0;

for (const lang of LANGS) {
  if (lang === 'en') continue;
  const missingInLang = [...keys.en].filter((k) => !keys[lang].has(k));
  const extraInLang = [...keys[lang]].filter((k) => !keys.en.has(k));
  if (missingInLang.length > 0) {
    console.log(`\n  ❌ ${lang}: missing ${missingInLang.length} keys that exist in en:`);
    for (const k of missingInLang.slice(0, 30)) console.log(`     - ${k}`);
    if (missingInLang.length > 30) console.log(`     … and ${missingInLang.length - 30} more`);
    issues += missingInLang.length;
  } else {
    console.log(`\n  ✅ ${lang}: no missing keys vs en`);
  }
  if (extraInLang.length > 0) {
    console.log(`\n  ℹ  ${lang}: ${extraInLang.length} keys exist in ${lang} but not en:`);
    for (const k of extraInLang.slice(0, 10)) console.log(`     - ${k}`);
  }
}

console.log(`\n${issues === 0 ? '✅ All languages in sync' : `⚠  ${issues} translations missing across languages`}\n`);
process.exit(issues === 0 ? 0 : 1);
