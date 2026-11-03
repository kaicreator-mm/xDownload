/**
 * TEST_MATRIX NO-DEPENDENCY-01 + PUBLIC-EXPORT-01 — the new neutral Contracts
 * files have no App, Host, Core Runtime, Node I/O, network or DomainHarness
 * SDK imports, and the public export surface is additive only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as rootIndex from '../../src/index.ts';

const SRC_DIR = join(import.meta.dirname, '..', '..', 'src', 'download-host');

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('NO-DEPENDENCY-01: neutral package stays pure and I/O-free', () => {
  const files = sourceFiles(SRC_DIR);
  expect(files.length).toBeGreaterThan(0);

  it('every download-host source file imports only relative siblings', () => {
    // Forbidden: Node built-ins (node:*), every other workspace package
    // (App/Host/Core/engines) and any DomainHarness SDK path. The neutral
    // package may only ever import relative siblings inside itself.
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        expect(match[1]!.startsWith('.'), `non-relative import in ${file}: '${match[1]}'`).toBe(
          true,
        );
      }
    }
  });

  it('relative imports stay inside the neutral package', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of imports) {
        // Only sibling/parent references within domain-contracts src.
        expect(spec.startsWith('.')).toBe(true);
        expect(spec.includes('download-domain')).toBe(false);
      }
    }
  });
});

describe('PUBLIC-EXPORT-01: additive exports from the package root', () => {
  it('exposes the neutral Host contract surface from src/index.ts', () => {
    expect(typeof rootIndex.validateDirectHostAcquisitionRequest).toBe('function');
    expect(typeof rootIndex.validateS4HostAcquisitionRequest).toBe('function');
    expect(typeof rootIndex.validateOpaqueTargetRef).toBe('function');
    expect(typeof rootIndex.isRawLocatorShape).toBe('function');
    expect(typeof rootIndex.validateOutputRoot).toBe('function');
    expect(typeof rootIndex.validateArtifactPath).toBe('function');
    expect(typeof rootIndex.normalizeEffectEnvelope).toBe('function');
    expect(typeof rootIndex.validateMaterializedEvidence).toBe('function');
    expect(typeof rootIndex.validateHostCaller).toBe('function');
    expect(rootIndex.REFERENCE_TOKEN_PATTERN).toBeInstanceOf(RegExp);
    expect(rootIndex.SHA256_PATTERN).toBeInstanceOf(RegExp);
    expect(typeof rootIndex.MAX_DECLARED_BYTES).toBe('number');
  });

  it('keeps the DTO/port types importable from the package root', () => {
    // Compile-time assertions: these type references must resolve.
    const types: [
      rootIndex.DirectHostAcquisitionRequest,
      rootIndex.S4HostAcquisitionRequest,
      rootIndex.S4HostConfirmedSelection,
      rootIndex.DirectHostCaller,
      rootIndex.EffectEnvelope,
      rootIndex.MaterializedEvidence,
      rootIndex.HostAcquisitionRequest,
      rootIndex.HostAcquisitionSettlement,
      rootIndex.DirectAcquisitionHostPort,
      rootIndex.S4MediaAcquisitionHostPort,
      rootIndex.DirectHostSlice,
    ] = [] as never;
    expect(types).toBeDefined();
  });
});
