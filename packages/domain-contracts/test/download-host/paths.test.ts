/**
 * TEST_MATRIX PATH-CONTAINMENT-01 — output-root traversal and artifact escape
 * are rejected before any I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  validateArtifactPath,
  validateDirectHostAcquisitionRequest,
  validateOutputRoot,
} from '../../src/index.ts';
import { expectCode } from '../helpers.ts';
import { rawDirectRequest } from './fixtures.ts';

describe('PATH-CONTAINMENT-01: output root grammar', () => {
  it('accepts absolute POSIX and Windows roots without traversal', () => {
    for (const root of ['/var/out/root', 'C:\\\\out\\\\root', 'D:/data']) {
      const result = validateOutputRoot(root);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects relative roots, empty/oversized roots and traversal segments', () => {
    for (const bad of [
      'var/out',
      './out',
      'out',
      '',
      'x'.repeat(513),
      '/var/../etc',
      'C:\\\\..\\\\out',
      '/var/./../out',
    ]) {
      const result = validateOutputRoot(bad);
      expect(result.ok).toBe(false);
    }
    expectCode(validateOutputRoot('/var/../etc'), 'OUTPUT_ROOT_ESCAPED');
  });

  it('rejects traversal roots on the direct request DTO', () => {
    expectCode(
      validateDirectHostAcquisitionRequest({
        ...rawDirectRequest(),
        outputRootScope: '/var/../etc',
      }),
      'OUTPUT_ROOT_ESCAPED',
    );
    expectCode(
      validateDirectHostAcquisitionRequest({
        ...rawDirectRequest(),
        outputRootScope: 'relative/out',
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
  });
});

describe('PATH-CONTAINMENT-01: artifact containment', () => {
  const root = '/var/out/root';

  it('accepts artifact paths strictly inside the root', () => {
    for (const path of ['/var/out/root/file.bin', '/var/out/root/sub/dir/file.bin']) {
      const result = validateArtifactPath(root, path);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects artifact escape via prefix spoofing (sibling directory)', () => {
    // '/var/out/root-evil' starts with the root string but is a sibling.
    expectCode(validateArtifactPath(root, '/var/out/root-evil/file.bin'), 'OUTPUT_ROOT_ESCAPED');
  });

  it('rejects artifact escape via .. traversal', () => {
    for (const path of [
      '/var/out/root/../escape.bin',
      '/var/out/root/sub/../../escape.bin',
      '/var/out/../root/file.bin',
    ]) {
      expectCode(validateArtifactPath(root, path), 'OUTPUT_ROOT_ESCAPED');
    }
  });

  it('rejects the root itself and paths outside the root', () => {
    expectCode(validateArtifactPath(root, root), 'OUTPUT_ROOT_ESCAPED');
    expectCode(validateArtifactPath(root, '/var/other/file.bin'), 'OUTPUT_ROOT_ESCAPED');
    expectCode(validateArtifactPath(root, ''), 'MALFORMED_REQUIRED_FIELD');
    expectCode(validateArtifactPath(root, 'x'.repeat(769)), 'MALFORMED_REQUIRED_FIELD');
  });
});
