/**
 * T14 validation-core probe — the physical SQLite CAS leg's real state on the
 * exact candidate (documented NOT_PROVEN in T09/T13 decision files).
 *
 * Expected (and asserted) outcome: better-sqlite3 (^12) is NOT installed
 * anywhere in this workspace, so the SDK's `openSqliteCasStore` must fail
 * CLOSED with the typed code `HOST_STORE_DRIVER_UNAVAILABLE` when the store
 * is actually used. The probe prints the observation and exits 0 only when
 * the fail-closed behavior was observed as expected; any other outcome is a
 * non-zero exit.
 */
import process from 'node:process';

try {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const repoRequire = createRequire(process.cwd() + '/package.json');
  try {
    repoRequire.resolve('better-sqlite3');
    console.error('UNEXPECTED: better-sqlite3 IS resolvable — NOT_PROVEN record is stale, investigate');
    process.exit(3);
  } catch (resolveError) {
    console.log(`better-sqlite3 resolve: NOT resolvable (${String(resolveError.code)})`);
  }

  // The SDK host-node package is installed under
  // packages/download-domain-host/node_modules (pnpm layout); resolve its
  // real entry by file URL — the same bytes the candidate consumes.
  const hostPkgJson = join(
    process.cwd(),
    'packages',
    'download-domain-host',
    'node_modules',
    '@kaicreator',
    'domain-harness-host-node',
    'package.json',
  );
  if (!existsSync(hostPkgJson)) {
    console.error('UNEXPECTED: SDK host-node package not installed at its documented site');
    process.exit(7);
  }
  const hostPkg = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(hostPkgJson, 'utf8')));
  const entry = new URL('.', pathToFileURL(hostPkgJson));
  const mod = await import(new URL(hostPkg.main.replace(/^\.\//, ''), entry).href);
  const hostNode = mod;
  try {
    const store = hostNode.openSqliteCasStore(process.cwd() + '/probe-unused.sqlite');
    // Some builds return a lazy handle; force one real operation to surface
    // the driver failure.
    const maybeOpen = store && typeof store.open === 'function' ? store.open() : store;
    await (maybeOpen && typeof maybeOpen.then === 'function' ? maybeOpen : Promise.resolve(maybeOpen));
    console.error('UNEXPECTED: openSqliteCasStore produced a working store — investigate');
    process.exit(4);
  } catch (openError) {
    const code = openError && typeof openError === 'object' && 'code' in openError ? String(openError.code) : 'NO_CODE';
    console.log(`openSqliteCasStore fail-closed: code=${code}`);
    console.log(`message=${String(openError instanceof Error ? openError.message : openError).slice(0, 400)}`);
    if (code !== 'HOST_STORE_DRIVER_UNAVAILABLE') {
      console.error(`UNEXPECTED fail-closed code: ${code}`);
      process.exit(5);
    }
    console.log('OBSERVED_AS_EXPECTED: the physical SQLite CAS leg is unavailable and fails closed');
    process.exit(0);
  }
} catch (importError) {
  console.error('probe import failed:', importError instanceof Error ? importError.message : String(importError));
  process.exit(6);
}
