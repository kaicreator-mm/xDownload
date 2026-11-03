/**
 * TEST_MATRIX TARGETREF-OPAQUE-01 — the opaque targetRef grammar is bounded
 * and raw URL/path locators are rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  isRawLocatorShape,
  validateDirectHostAcquisitionRequest,
  validateOpaqueTargetRef,
} from '../../src/index.ts';
import { expectCode } from '../helpers.ts';
import { rawDirectRequest } from './fixtures.ts';

describe('TARGETREF-OPAQUE-01: opaque handle grammar', () => {
  it('accepts bounded opaque registry-handle tokens', () => {
    for (const good of ['target-001', 'target.001', 'T001:x/y-z_9', 'a'.repeat(128)]) {
      const result = validateOpaqueTargetRef(good);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(good);
    }
  });

  it('rejects raw URL locators as targetRef', () => {
    for (const raw of [
      'https://example.com/file.bin',
      'http://127.0.0.1/x',
      'ftp://example.com/x',
      'file:///etc/passwd',
    ]) {
      expect(isRawLocatorShape(raw)).toBe(true);
      expectCode(validateOpaqueTargetRef(raw), 'LOCATOR_SUBSTITUTION_REJECTED');
      expectCode(
        validateDirectHostAcquisitionRequest({ ...rawDirectRequest(), targetRef: raw }),
        'LOCATOR_SUBSTITUTION_REJECTED',
      );
    }
  });

  it('rejects raw filesystem paths as targetRef (POSIX and Windows)', () => {
    for (const raw of [
      '/etc/passwd',
      '/var/out/file.bin',
      '\\server\\share\\file',
      'C:\\downloads\\file.bin',
      'c:/downloads/file.bin',
      'C:/downloads/file.bin',
    ]) {
      expect(isRawLocatorShape(raw)).toBe(true);
      expectCode(validateOpaqueTargetRef(raw), 'LOCATOR_SUBSTITUTION_REJECTED');
    }
  });

  it('rejects non-string and out-of-grammar handles', () => {
    for (const bad of [null, 42, {}, ['target-001'], '', '-lead', 'x'.repeat(129)]) {
      expectCode(validateOpaqueTargetRef(bad), 'MALFORMED_REQUIRED_FIELD');
    }
  });

  it('isRawLocatorShape never treats opaque handles as locators', () => {
    for (const good of ['target-001', 'handle:x/y', 'C0FFEE42']) {
      expect(isRawLocatorShape(good)).toBe(false);
    }
  });
});
