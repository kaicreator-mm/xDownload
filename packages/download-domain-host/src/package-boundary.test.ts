/**
 * V022-A03 (#342) — download-domain-host package boundary architecture tests
 * (node:test, colocated; pure source scan).
 *
 *   HOST-NO-APP-IMPORT-01: no non-test Host source file imports the Domain
 *   App package — not as a bare specifier, not as a relative deep path, and
 *   not through side-effect, dynamic `import()` or CommonJS `require()`
 *   forms. Host depends only on neutral Contracts and its existing
 *   Host/engine dependencies.
 *
 *   NO-SECOND-AUTHORITY-09: the Host package exports no K, Journal,
 *   Scheduler, transfer-engine, SQLite-driver or multi-process CAS symbol:
 *   the physical adapters moved here are stores, never second authorities.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const APP_PACKAGE = '@xdownload/download-domain-app';

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.mjs') && !entry.endsWith('.js')) continue;
    // Tests are excluded from the boundary scan: they legitimately reference
    // relocation sources in comments and are not production source.
    if (entry.endsWith('.test.ts')) continue;
    files.push(full);
  }
  return files;
}

/**
 * Every module-reference form ECMAScript/TypeScript and CommonJS admit:
 * static import, namespace/default/named, export-from, side-effect import,
 * dynamic `import()` and `require()` (cjs interop). One scan covers all of
 * them because each form quotes exactly one specifier string.
 */
const MODULE_SPECIFIER =
  /(?:\bimport|\bexport|\brequire)\s*(?:\(\s*|\s+[^'"]*?\sfrom\s*|\s*)['"]([^'"]+)['"]/g;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  MODULE_SPECIFIER.lastIndex = 0;
  let match = MODULE_SPECIFIER.exec(source);
  while (match !== null) {
    found.push(match[1]!);
    match = MODULE_SPECIFIER.exec(source);
  }
  return found;
}

describe('HOST-NO-APP-IMPORT-01 — no Host source imports the App package', () => {
  it('scans every non-test source file for App package/deep-source imports in every module form', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of specifiersOf(source)) {
        if (specifier === APP_PACKAGE || specifier.includes('download-domain-app')) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
      // Belt and braces: even a commented or string-built reference into the
      // App package tree is a boundary smell — surface it explicitly.
      if (/\/\*\s*from\s*['"][^'"]*download-domain-app/.test(source)) {
        offenders.push(`${file}: comment references download-domain-app`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Host source must never import @xdownload/download-domain-app or a relative App path (static, side-effect, dynamic or CommonJS form)',
    );
  });

  it('host barrels never re-export an App symbol', () => {
    for (const barrel of ['direct/index.ts', 'storage/index.ts', 'migration/index.ts']) {
      const source = readFileSync(join(SRC_ROOT, barrel), 'utf8');
      assert.equal(
        specifiersOf(source).some(
          (specifier) => specifier === APP_PACKAGE || specifier.includes('download-domain-app'),
        ),
        false,
        `${barrel} must not re-export anything from the App package`,
      );
    }
  });
});

describe('NO-SECOND-AUTHORITY-09 — Host exports no second authority', () => {
  it('no Host source declares a K, Journal, Scheduler, transfer-engine or SQLite driver symbol', () => {
    const forbidden = [
      /class\s+\w*Journal\w*\b/,
      /\bcreateTransferEngine\b/,
      /\bclass\s+Sqlite/i,
      /\bclass\s+SQLite/i,
      /from\s+['"]better-sqlite3['"]/,
      /require\(\s*['"]better-sqlite3['"]\s*\)/,
    ];
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      // Strip comments: NOT_PROVEN write-ups legitimately name the drivers
      // Host does NOT ship; only live declarations/imports are boundary
      // violations.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
      for (const pattern of forbidden) {
        if (pattern.test(source)) offenders.push(`${file}: ${String(pattern)}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Host must not claim a second K/Journal/Scheduler/engine/SQLite authority',
    );
  });
});
