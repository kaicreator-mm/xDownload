/**
 * T10 runner — explicit Node execution for the tests/domain-app harness.
 *
 * The root vitest config deliberately excludes tests/** from its include
 * list, so this lane runs on the plain Node24 toolchain with TypeScript type
 * stripping: `node --experimental-transform-types --test <all *.test.ts>`.
 *
 * Real-exit discipline: the process exit code is the test runner's exit
 * code, printed as `HARNESS_EXIT=<n>` and never coerced. No synthetic
 * acceptance, no fake gates.
 */

import process from 'node:process';
import console from 'node:console';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(here, name));

if (testFiles.length === 0) {
  console.error('tests/domain-app/run.mjs: no *.test.ts files found');
  process.exit(1);
}

console.log(`tests/domain-app harness: ${String(testFiles.length)} test file(s)`);
for (const file of testFiles) {
  console.log(`  - ${file}`);
}
console.log(`node ${process.version}`);

const result = spawnSync(
  process.execPath,
  ['--experimental-transform-types', '--test', ...testFiles],
  { stdio: 'inherit' },
);

if (result.error !== undefined) {
  console.error(`runner spawn failed: ${String(result.error)}`);
  process.exit(1);
}

const exitCode = result.status ?? 1;
console.log(`HARNESS_EXIT=${String(exitCode)}`);
process.exit(exitCode);
