import { describe, expect, it } from 'vitest';
import {
  decodeDownloadAttemptProjection,
  decodeDownloadErrorProjection,
  decodeDownloadJobProjection,
  decodeDownloadProgressProjection,
  decodeLineageOwnerResolution,
  isDownloadJobTerminalStatus,
  resolveLineageOwner,
  type DomainValidationResult,
} from '../src/index.ts';
import { v02JobProjectionFixture } from './fixtures/v0.2-job-projection.ts';

function expectCode<T>(result: DomainValidationResult<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
  }
}

describe('v0.2.1 canonical download projections', () => {
  it('decodes one shared immutable job/attempt/progress/error fixture', () => {
    const decoded = decodeDownloadJobProjection(v02JobProjectionFixture);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.lineageId).toBe('lineage-001');
    expect(decoded.value.currentAttemptId).toBe('work-item-001#attempt-2');
    expect(decoded.value.attempts[0]?.error?.code).toBe('ETIMEDOUT');
    expect(decoded.value.progress?.totalBytes).toEqual({ kind: 'UNKNOWN' });
    expect(Object.isFrozen(decoded.value)).toBe(true);
    expect(Object.isFrozen(decoded.value.attempts)).toBe(true);
    expect(Object.isFrozen(decoded.value.progress?.totalBytes)).toBe(true);
  });

  it('keeps UNKNOWN totals distinct from zero and rejects invented percentage/ETA fields', () => {
    const unknown = decodeDownloadProgressProjection({
      transferredBytes: 0,
      totalBytes: { kind: 'UNKNOWN' },
    });
    const knownZero = decodeDownloadProgressProjection({
      transferredBytes: 0,
      totalBytes: { kind: 'KNOWN', bytes: 0 },
    });
    expect(unknown.ok).toBe(true);
    expect(knownZero.ok).toBe(true);
    if (unknown.ok && knownZero.ok) {
      expect(unknown.value.totalBytes).not.toEqual(knownZero.value.totalBytes);
    }
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: 12,
        totalBytes: { kind: 'UNKNOWN', bytes: 100 },
      }),
      'UNKNOWN_FIELD',
    );
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: 12,
        totalBytes: { kind: 'KNOWN', bytes: 100 },
        percentage: 12,
        etaSeconds: 30,
      }),
      'UNKNOWN_FIELD',
    );
  });

  it('rejects negative and unsafe byte totals', () => {
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: -1,
        totalBytes: { kind: 'UNKNOWN' },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: 1,
        totalBytes: { kind: 'KNOWN', bytes: Number.MAX_SAFE_INTEGER + 1 },
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects transferred bytes beyond a known total but permits unknown totals', () => {
    expect(
      decodeDownloadProgressProjection({
        transferredBytes: 100,
        totalBytes: { kind: 'KNOWN', bytes: 100 },
      }).ok,
    ).toBe(true);
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: 101,
        totalBytes: { kind: 'KNOWN', bytes: 100 },
      }),
      'INVALID_RESULT_COMBINATION',
    );
    expectCode(
      decodeDownloadProgressProjection({
        transferredBytes: 1,
        totalBytes: { kind: 'KNOWN', bytes: 0 },
      }),
      'INVALID_RESULT_COMBINATION',
    );
    expect(
      decodeDownloadProgressProjection({
        transferredBytes: 101,
        totalBytes: { kind: 'UNKNOWN' },
      }).ok,
    ).toBe(true);
  });

  it('decodes bounded typed errors and rejects unknown fields', () => {
    expect(
      decodeDownloadErrorProjection({
        code: 'ECONNRESET',
        message: 'The connection was reset.',
      }).ok,
    ).toBe(true);
    expectCode(
      decodeDownloadErrorProjection({
        code: 'ECONNRESET',
        message: 'The connection was reset.',
        retryable: true,
      }),
      'UNKNOWN_FIELD',
    );
    expectCode(
      decodeDownloadErrorProjection({ code: '', message: 'Failure' }),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects malformed attempts and keeps sequence ordering explicit', () => {
    expect(
      decodeDownloadAttemptProjection({
        attemptId: 'attempt-001',
        sequence: 1,
        status: 'RUNNING',
      }).ok,
    ).toBe(true);
    expectCode(
      decodeDownloadAttemptProjection({
        attemptId: 'attempt-001',
        sequence: 0,
        status: 'RUNNING',
      }),
      'MALFORMED_REQUIRED_FIELD',
    );
  });

  it('rejects unknown job fields, duplicate attempts and current-attempt misbinding', () => {
    expectCode(
      decodeDownloadJobProjection({
        ...v02JobProjectionFixture,
        debug: true,
      }),
      'UNKNOWN_FIELD',
    );
    expectCode(
      decodeDownloadJobProjection({
        ...v02JobProjectionFixture,
        attempts: [v02JobProjectionFixture.attempts[0], v02JobProjectionFixture.attempts[0]],
      }),
      'DUPLICATE_IDENTITY',
    );
    expectCode(
      decodeDownloadJobProjection({
        ...v02JobProjectionFixture,
        currentAttemptId: 'missing-attempt',
      }),
      'CONTRACT_BINDING_MISMATCH',
    );
  });

  it('binds current job state to the current attempt and progress', () => {
    expectCode(
      decodeDownloadJobProjection({
        ...v02JobProjectionFixture,
        status: 'SUCCEEDED',
      }),
      'INVALID_RESULT_COMBINATION',
    );
    const withoutCurrentAttempt = { ...v02JobProjectionFixture };
    delete withoutCurrentAttempt.currentAttemptId;
    expectCode(
      decodeDownloadJobProjection({
        ...withoutCurrentAttempt,
        status: 'RUNNING',
      }),
      'INVALID_RESULT_COMBINATION',
    );
  });

  it('returns typed owner refusals instead of guessing between writers', () => {
    const ambiguous = resolveLineageOwner({
      oldCore: 'UNKNOWN',
      newK: 'ABSENT',
    });
    const conflict = resolveLineageOwner({
      oldCore: 'REGISTERED',
      newK: 'OWNED',
    });
    const defaultOwner = resolveLineageOwner({
      oldCore: 'UNREGISTERED',
      newK: 'ABSENT',
    });
    expect(ambiguous.ok && ambiguous.value).toEqual({
      status: 'REFUSED',
      reason: 'LINEAGE_OWNER_AMBIGUOUS',
    });
    expect(conflict.ok && conflict.value).toEqual({
      status: 'REFUSED',
      reason: 'LINEAGE_OWNER_CONFLICT',
    });
    expect(defaultOwner.ok && defaultOwner.value).toEqual({
      status: 'RESOLVED',
      owner: 'old-core',
    });
    expect(
      decodeLineageOwnerResolution({
        status: 'REFUSED',
        reason: 'LINEAGE_OWNER_AMBIGUOUS',
      }).ok,
    ).toBe(true);
    expectCode(
      decodeLineageOwnerResolution({
        status: 'REFUSED',
        reason: 'UNKNOWN_REASON',
      }),
      'UNKNOWN_ENUM_VALUE',
    );
  });

  it('treats UNKNOWN as non-terminal and preserves terminal projection semantics', () => {
    expect(isDownloadJobTerminalStatus('QUEUED')).toBe(false);
    expect(isDownloadJobTerminalStatus('RUNNING')).toBe(false);
    expect(isDownloadJobTerminalStatus('UNKNOWN')).toBe(false);
    expect(isDownloadJobTerminalStatus('SUCCEEDED')).toBe(true);
    expect(isDownloadJobTerminalStatus('FAILED')).toBe(true);
    expect(isDownloadJobTerminalStatus('CANCELLED')).toBe(true);
  });
});
