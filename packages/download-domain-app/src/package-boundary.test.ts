/**
 * V022-A02 (#341) — download-domain-app package boundary architecture tests
 * (node:test, colocated; pure source scan + public-root assertions).
 *
 *   ① Source dependency boundary: no non-test App source file imports
 *     @xdownload/download-domain-host (bare) or a relative path into
 *     packages/download-domain-host.
 *   ② Public root narrowing: the App root exports no runtime assembler, no
 *     Host bridge pin/implementation, no Host pin registry and no physical
 *     adapter/store class.
 *   ③ Preserved domain-owned public symbols: the current external consumers
 *     (apps/cli, packages/core-seam tests, deep-path Core consumers) keep
 *     every domain symbol they rely on.
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
    if (entry === 'slice-journey-testkit.ts') continue;
    files.push(full);
  }
  return files;
}

/** Static import/export specifiers plus dynamic import() specifiers. */
const IMPORT_SPECIFIER = /(?:import|export)\s[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [IMPORT_SPECIFIER, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      found.push(match[1]!);
      match = pattern.exec(source);
    }
  }
  return found;
}

describe('APP-NO-HOST-IMPORT-01 — no App source imports the Host package', () => {
  it('scans every non-test source file for Host package/deep-source imports', () => {
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
      'App source must never import @xdownload/download-domain-host or a relative Host path',
    );
  });
});

describe('APP-NO-RUNTIME-LEAK-03 — public root exports no runtime/bridge/physical adapter', () => {
  const forbiddenExports: Record<string, unknown> = {
    // runtime assemblers (removed or relocated in A02)
    assembleDownloadRuntime: (appRoot as Record<string, unknown>)['assembleDownloadRuntime'],
    assembleMediaRuntime: (appRoot as Record<string, unknown>)['assembleMediaRuntime'],
    assembleS4HlsRuntime: (appRoot as Record<string, unknown>)['assembleS4HlsRuntime'],
    // Host bridge pins and pin registries
    MEDIA_BRIDGE_PIN: (appRoot as Record<string, unknown>)['MEDIA_BRIDGE_PIN'],
    DIRECT_BRIDGE_PIN: (appRoot as Record<string, unknown>)['DIRECT_BRIDGE_PIN'],
    S4_HLS_BRIDGE_PIN: (appRoot as Record<string, unknown>)['S4_HLS_BRIDGE_PIN'],
    acquireS4HlsBridgePin: (appRoot as Record<string, unknown>)['acquireS4HlsBridgePin'],
    InMemoryMediaTargetRegistry: (appRoot as Record<string, unknown>)[
      'InMemoryMediaTargetRegistry'
    ],
    // physical adapter / store classes
    FileCasDocStore: (appRoot as Record<string, unknown>)['FileCasDocStore'],
    PlainFileLineageStore: (appRoot as Record<string, unknown>)['PlainFileLineageStore'],
  };

  it('every forbidden symbol is undefined on the public root', () => {
    const leaked = Object.entries(forbiddenExports)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name);
    assert.deepEqual(leaked, [], 'forbidden runtime/bridge/physical symbols leaked from the root');
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
    // media registry grammar
    'validateMediaTargetRecord',
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
      'MEDIA_REGISTRY_PROTOCOLS',
      'DOWNLOAD_OPERATIONS',
      'DEFAULT_LINEAGE_OWNER',
    ]) {
      assert.notEqual(root[constant], undefined, `${constant} must stay on the public root`);
    }
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
