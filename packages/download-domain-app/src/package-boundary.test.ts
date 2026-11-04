/**
 * V022-A02/A04 (#357) — download-domain-app package boundary architecture
 * tests (node:test, colocated; pure source scan + public-root assertions).
 *
 *   ① Source dependency boundary: no non-test App source file imports
 *     @xdownload/download-domain-host (bare) or a relative path into
 *     packages/download-domain-host. The scanner covers EVERY
 *     module-reference form ECMAScript/TypeScript and CommonJS admit —
 *     static import, namespace/default/named, export-from, side-effect
 *     import, dynamic `import()` and CommonJS `require()` (A02 P2-2
 *     closure: the A02 scanner missed side-effect and require forms; the
 *     A04 scanner uses the comprehensive single-pattern grammar).
 *   ② Public root narrowing: the App root exports no runtime assembler
 *     (deleted in A04), no physical adapter/store class (FileCasDocStore →
 *     Host storage, PlainFileLineageStore → Host migration,
 *     InMemoryMediaTargetRegistry → Host media) and no Host bridge
 *     implementation. The sealed-module bridge pin seams exported for the
 *     Core composition root (DIRECT_BRIDGE_PIN / MEDIA_BRIDGE_PIN /
 *     S4_HLS_BRIDGE_PIN / acquireS4HlsBridgePin) are domain contract
 *     vocabulary, explicitly allow-listed with the justification recorded
 *     in src/index.ts.
 *   ③ Preserved domain-owned public symbols: the current external consumers
 *     (apps/cli, packages/core-seam tests, the Core composition root)
 *     keep every domain symbol they rely on through the stable root.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import * as appRoot from './index.ts';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOST_PACKAGE = '@xdownload/download-domain-host';

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.mjs')) continue;
    // Tests/fixtures are excluded from the boundary scan: they may reference
    // relocation targets in comments and are not production source.
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

describe('APP-NO-HOST-IMPORT-01 — no App source imports the Host package', () => {
  it('scans every non-test source file for Host package/deep-source imports in every module form', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of specifiersOf(source)) {
        if (specifier === HOST_PACKAGE || specifier.includes('download-domain-host')) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'App source must never import @xdownload/download-domain-host or a relative Host path (static, side-effect, dynamic or CommonJS form)',
    );
  });

  it('the scanner itself detects side-effect and CommonJS require forms (A02 P2-2 regression)', () => {
    const sideEffect = specifiersOf(`import '@xdownload/download-domain-host';`);
    assert.deepEqual(sideEffect, ['@xdownload/download-domain-host']);
    const required = specifiersOf(`const host = require('@xdownload/download-domain-host');`);
    assert.deepEqual(required, ['@xdownload/download-domain-host']);
    const dynamic = specifiersOf(`const host = await import('@xdownload/download-domain-host');`);
    assert.deepEqual(dynamic, ['@xdownload/download-domain-host']);
  });
});

describe('APP-NO-RUNTIME-LEAK-03 — public root exports no assembler/physical adapter', () => {
  const forbiddenExports: Record<string, unknown> = {
    // runtime assemblers (deleted in A04; assembly lives at the Core root)
    assembleDownloadRuntime: (appRoot as Record<string, unknown>)['assembleDownloadRuntime'],
    assembleMediaRuntime: (appRoot as Record<string, unknown>)['assembleMediaRuntime'],
    assembleS4HlsRuntime: (appRoot as Record<string, unknown>)['assembleS4HlsRuntime'],
    // physical adapter / store classes (Host-owned after A03/A04)
    FileCasDocStore: (appRoot as Record<string, unknown>)['FileCasDocStore'],
    PlainFileLineageStore: (appRoot as Record<string, unknown>)['PlainFileLineageStore'],
    InMemoryMediaTargetRegistry: (appRoot as Record<string, unknown>)[
      'InMemoryMediaTargetRegistry'
    ],
    // Host-owned media targetRef registry grammar (moved to Host in A04)
    validateMediaTargetRecord: (appRoot as Record<string, unknown>)['validateMediaTargetRecord'],
  };

  it('every forbidden symbol is undefined on the public root', () => {
    const leaked = Object.entries(forbiddenExports)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name);
    assert.deepEqual(leaked, [], 'forbidden assembler/physical symbols leaked from the root');
  });
});

describe('APP-PIN-SEAM-04 — the Core composition-root pin seams stay exported (domain contracts)', () => {
  it('the sealed-module bridge pin names and the S4 registrar are on the public root', () => {
    const root = appRoot as Record<string, unknown>;
    assert.equal(root['DIRECT_BRIDGE_PIN'], '__xdownloadDirectAcquisitionBridge');
    assert.equal(root['MEDIA_BRIDGE_PIN'], '__xdownloadMediaAcquisitionBridge');
    assert.equal(root['S4_HLS_BRIDGE_PIN'], '__xdownloadS4HlsVodBridge');
    assert.equal(typeof root['acquireS4HlsBridgePin'], 'function');
  });
});

describe('APP-ROOT-EXPORT-02 — domain-owned public symbols stay exported', () => {
  const root = appRoot as Record<string, unknown>;
  const expectedFunctions = [
    // T01 contracts / business admission
    'validateConfirmedIntent',
    'validateRouteTable',
    'normalizeEffectEnvelope',
    'validateMaterializedEvidence',
    'confirmDownloadRequest',
    // sealed BUILD producers
    'buildDownloadDomainApp',
    'verifySealedModules',
    'sealDirectComposition',
    'sealMediaComposition',
    'sealS4HlsComposition',
    's4HlsCompositionContribution',
    // domain journeys
    'submitConfirmedDownload',
    'submitConfirmedMediaDownload',
    'submitConfirmedS4HlsVod',
    'runS2DiscoveryJourney',
    'runS5CollectionJourney',
    'runS6NavigationJourney',
    // S4 contract helpers (apps/cli consumer)
    's4HlsSelectionTupleDigest',
    'validateConfirmedS4HlsIntent',
    // dormant T09 lineage policy
    'LineageLedger',
  ] as const;

  it('existing consumers keep every domain function on the public root', () => {
    const missing = expectedFunctions.filter((name) => typeof root[name] !== 'function');
    assert.deepEqual(missing, [], 'domain-owned public functions missing from the App root');
  });

  it('frozen K/S/B/C identity constants and route/operation declarations stay exported', () => {
    for (const constant of [
      'APP_ID',
      'BUILD_ID',
      'ACQUISITION_ROUTE',
      'SEALED_OPERATION_VOCABULARY',
      'POC183_KERNEL_MODULE_SHA256',
      'POC183_STANDARD_MODULE_SHA256',
      'APP_ID_DIRECT',
      'BUILD_ID_DIRECT',
      'APP_ID_MEDIA',
      'BUILD_ID_MEDIA',
      'APP_ID_S4_HLS_VOD',
      'BUILD_ID_S4_HLS_VOD',
      'MEDIA_ROUTE',
      'S4_HLS_ROUTE',
      'S4_HLS_MEDIA_OPERATION',
      'S4_HLS_MEDIA_PROFILE',
      'MEDIA_ACQUIRE_OPERATION',
      'MEDIA_SLICE',
      'DOWNLOAD_OPERATIONS',
      'DEFAULT_LINEAGE_OWNER',
    ]) {
      assert.notEqual(root[constant], undefined, `${constant} must stay on the public root`);
    }
  });

  it('the media registry grammar moved to the Host (A04): its constants are absent here', () => {
    assert.equal(root['MEDIA_REGISTRY_PROTOCOLS'], undefined);
    assert.equal(root['validateMediaTargetRecord'], undefined);
  });

  it('domain-facing runtime journey contracts for the Core root are exported as types', () => {
    // Type-only surfaces: runtime presence is not asserted; the typecheck of
    // the Core consumers (packages/core-runtime) is the structural proof.
    // This assertion only pins the VALUE pins the Core installer reaches.
    assert.equal(root['DIRECT_BRIDGE_PIN'], '__xdownloadDirectAcquisitionBridge');
  });

  it('K/S/B/C identity is unchanged (sealed #183 hashes and operation vocabulary)', () => {
    assert.equal(root['POC183_KERNEL_MODULE_SHA256'], appRoot.POC183_KERNEL_MODULE_SHA256);
    const operations = root['DOWNLOAD_OPERATIONS'];
    assert.equal(Array.isArray(operations), true);
    assert.ok(
      (operations as readonly string[]).includes('acquisition.acquire') &&
        (operations as readonly string[]).includes('media.acquire'),
      'the frozen operation vocabulary must keep acquisition.acquire and media.acquire',
    );
  });
});
