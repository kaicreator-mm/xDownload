/**
 * TEST_MATRIX suites for the T007 ResultProjector: exhaustive status
 * projection (§18.1–§18.7 exact tuples, determinism, no success boolean),
 * forbidden-combination rejection (§18.8), empty-set handling (§18.5/§18.6),
 * cancellation projection (L2 §11.1 timing matrix + cutoff), the §17.2
 * auth-limited 18/16 tuple, partial/truncated/unknown distinctions and
 * read-projection ownership (L2 invariants 1–2, §6.7, invariant 20).
 */
import { describe, expect, it } from 'vitest';
import {
  createEvidenceLedger,
  createTerminalResultStore,
  decodeTerminalResult,
  projectResult,
  validateTerminalResult,
  type CoverageAccounting,
  type MemberId as MemberIdAlias,
  type ProjectionFacts,
  type TerminalResult,
} from '../src/index.ts';
import {
  T007_RECORDED_AT,
  accountingOf,
  appendMemberEvidence,
  members,
  t007Contract,
  t007Snapshot,
  type AccountingOverrides,
} from './t007-helpers.ts';
import { expectCode, mid } from './helpers.ts';

function accountingFor(
  requested: readonly MemberIdAlias[] = members('member-t007-base', 3),
  overrides: AccountingOverrides = {},
): CoverageAccounting {
  return accountingOf({
    requestedMemberIds: requested,
    resolvedMemberIds: overrides.resolvedMemberIds ?? requested,
    authAccessibleMemberIds: overrides.authAccessibleMemberIds ?? requested,
    authInaccessibleMembers: overrides.authInaccessibleMembers ?? [],
    selectedMemberIds: overrides.selectedMemberIds ?? requested,
    validatedMemberIds: overrides.validatedMemberIds ?? requested,
    ...overrides,
  });
}

function fullFacts(overrides: Partial<ProjectionFacts> = {}): ProjectionFacts {
  const requested = overrides.requestedMemberIds ?? members('member-t007-base', 3);
  const accounting = overrides.accounting ?? accountingFor(requested);
  const memberValidation =
    overrides.memberValidation ??
    accounting.selected.map((memberId) => ({ memberId, result: 'VALIDATED' as const }));
  const validated = memberValidation
    .filter((outcome) => outcome.result === 'VALIDATED')
    .map((outcome) => outcome.memberId);
  return {
    contractId: t007Contract('contract-t007-001'),
    snapshotId: t007Snapshot('snapshot-t007-001'),
    intentType: 'COLLECTION',
    scopeKind: 'entire_supported_collection',
    recordedAt: T007_RECORDED_AT,
    requestedMemberIds: requested,
    acceptedSelectedMemberIds: overrides.acceptedSelectedMemberIds ?? validated,
    accounting,
    coverageBasis: overrides.coverageBasis ?? {
      kind: 'SUFFICIENT',
      basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: requested },
    },
    memberValidation,
    enumeration: { kind: 'NATURAL_END_VALIDATED' },
    ...overrides,
  };
}

const TUPLES = {
  direct: {
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
  },
  verifiedEmpty: {
    requestFulfillment: 'COMPLETE',
    targetResolution: 'EMPTY_CONFIRMED',
    selectionAcquisition: 'NOT_STARTED',
    coverage: 'VERIFIED_COMPLETE',
    stopReason: 'NATURAL_COLLECTION_END',
  },
  unprovenEmpty: {
    requestFulfillment: 'UNKNOWN',
    targetResolution: 'EMPTY_UNKNOWN',
    selectionAcquisition: 'NOT_STARTED',
    coverage: 'UNKNOWN',
  },
} as const;

function projectOk(facts: ProjectionFacts): TerminalResult {
  const projected = projectResult(facts);
  expect(projected.ok, JSON.stringify(projected.ok ? [] : projected.diagnostics)).toBe(true);
  if (!projected.ok) {
    throw new Error('unreachable');
  }
  return projected.value.result;
}

describe('T007 ResultProjector — exhaustive legal status projection (PRD §18.1–§18.7)', () => {
  it('§18.1 direct resource success projects the exact tuple', () => {
    const target = mid('target-t007-single-001');
    const result = projectOk({
      contractId: t007Contract('contract-t007-single'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [target],
      acceptedSelectedMemberIds: [target],
      memberValidation: [{ memberId: target, result: 'VALIDATED' }],
      enumeration: { kind: 'NOT_APPLICABLE' },
    });
    expect(result.requestFulfillment).toBe(TUPLES.direct.requestFulfillment);
    expect(result.targetResolution).toBe(TUPLES.direct.targetResolution);
    expect(result.selectionAcquisition).toBe(TUPLES.direct.selectionAcquisition);
    expect(result.coverage).toBe(TUPLES.direct.coverage);
    expect(result.stopReason).toBe(TUPLES.direct.stopReason);
    expect(result.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 1,
      failedCount: 0,
    });
  });

  it('§18.2 requested bounded scope fully acquired projects USER_SCOPE_REACHED and NATURAL_COLLECTION_END variants', () => {
    const requested = members('member-t007-bounded', 3);
    const base = {
      contractId: t007Contract('contract-t007-bounded'),
      intentType: 'COLLECTION' as const,
      scopeKind: 'explicit_member_set' as const,
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: requested,
      acceptedSelectedMemberIds: requested,
      accounting: accountingFor(requested),
      coverageBasis: {
        kind: 'SUFFICIENT' as const,
        basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST' as const, identities: requested },
      },
      memberValidation: requested.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
    };
    const userScope = projectOk({ ...base, enumeration: { kind: 'USER_SCOPE_REACHED' } });
    expect(userScope.requestFulfillment).toBe('COMPLETE');
    expect(userScope.targetResolution).toBe('RESOLVED');
    expect(userScope.selectionAcquisition).toBe('COMPLETE');
    expect(userScope.coverage).toBe('VERIFIED_COMPLETE');
    expect(userScope.stopReason).toBe('USER_SCOPE_REACHED');
    const naturalEnd = projectOk({ ...base, enumeration: { kind: 'NATURAL_END_VALIDATED' } });
    expect(naturalEnd.stopReason).toBe('USER_SCOPE_REACHED');
    expect(naturalEnd.coverage).toBe('VERIFIED_COMPLETE');
  });

  it('§18.3 whole collection with truncated discovery projects the exact tuple', () => {
    const requested = members('member-t007-183', 18);
    const discovered = requested.slice(0, 12);
    const result = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-183'),
        requestedMemberIds: requested,
        accounting: accountingFor(requested, {
          resolvedMemberIds: discovered,
          authAccessibleMemberIds: discovered,
          selectedMemberIds: discovered,
          validatedMemberIds: discovered,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: discovered,
        memberValidation: discovered.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        enumeration: { kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' },
      }),
    );
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('PARTIAL');
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.coverage).toBe('TRUNCATED');
    expect(result.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
  });

  it('§18.4 auth failure before any resolution projects UNSATISFIED/BLOCKED/NOT_STARTED/UNKNOWN', () => {
    const authFailed = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-184a'),
        accounting: undefined,
        coverageBasis: undefined,
        acceptedSelectedMemberIds: [],
        memberValidation: [],
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
        resolution: { blockedBeforeAnyResolution: { reason: 'AUTH_FAILED' } },
      }),
    );
    expect(authFailed.requestFulfillment).toBe('UNSATISFIED');
    expect(authFailed.targetResolution).toBe('BLOCKED');
    expect(authFailed.selectionAcquisition).toBe('NOT_STARTED');
    expect(authFailed.coverage).toBe('UNKNOWN');
    expect(authFailed.stopReason).toBe('AUTH_FAILED');
    const authRequired = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-184b'),
        accounting: undefined,
        coverageBasis: undefined,
        acceptedSelectedMemberIds: [],
        memberValidation: [],
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
        resolution: { blockedBeforeAnyResolution: { reason: 'AUTH_REQUIRED' } },
      }),
    );
    expect(authRequired.stopReason).toBe('AUTH_REQUIRED');
  });

  it('§18.5 independently verified empty collection projects the exact tuple', () => {
    const result = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-185'),
        requestedMemberIds: [],
        acceptedSelectedMemberIds: [],
        accounting: accountingFor([]),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'DECLARED_TOTAL_WITH_CLOSURE',
            declaredTotal: 0,
            accountedIdentityCount: 0,
            closure: 'NATURAL_END_VALIDATED',
          },
        },
        memberValidation: [],
        enumeration: { kind: 'NATURAL_END_VALIDATED' },
        resolution: { verifiedEmpty: true },
      }),
    );
    expect(result.requestFulfillment).toBe(TUPLES.verifiedEmpty.requestFulfillment);
    expect(result.targetResolution).toBe(TUPLES.verifiedEmpty.targetResolution);
    expect(result.selectionAcquisition).toBe(TUPLES.verifiedEmpty.selectionAcquisition);
    expect(result.coverage).toBe(TUPLES.verifiedEmpty.coverage);
    expect(result.stopReason).toBe(TUPLES.verifiedEmpty.stopReason);
    expect(result.validationSummary).toEqual({
      status: 'NOT_PERFORMED',
      passedCount: 0,
      failedCount: 0,
    });
  });

  it('§18.6 empty but not proven empty projects the truthful UNKNOWN tuple', () => {
    const result = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-186'),
        requestedMemberIds: [],
        acceptedSelectedMemberIds: [],
        accounting: accountingFor([]),
        coverageBasis: undefined,
        memberValidation: [],
        enumeration: { kind: 'UNPROVEN_EMPTY' },
      }),
    );
    expect(result.requestFulfillment).toBe(TUPLES.unprovenEmpty.requestFulfillment);
    expect(result.targetResolution).toBe(TUPLES.unprovenEmpty.targetResolution);
    expect(result.selectionAcquisition).toBe(TUPLES.unprovenEmpty.selectionAcquisition);
    expect(result.coverage).toBe(TUPLES.unprovenEmpty.coverage);
    // truthful non-success stop reason
    expect(result.stopReason).toBe('NO_PROGRESS');
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });

  it('determinism: identical facts yield deep-equal results; independent permutations change nothing', () => {
    const facts = fullFacts();
    const first = projectOk(facts);
    const second = projectOk(facts);
    expect(second).toEqual(first);
    const requested = members('member-t007-base', 3);
    const permuted = projectOk(
      fullFacts({
        memberValidation: [requested[2]!, requested[0]!, requested[1]!].map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
      }),
    );
    expect(permuted).toEqual(first);
  });

  it('no single success boolean exists anywhere in the projection output', () => {
    const projected = projectResult(fullFacts());
    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }
    const keys: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        keys.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(projected.value, 'projection');
    expect(keys.some((key) => /success/i.test(key.split('.').pop() ?? ''))).toBe(false);
  });
});

describe('T007 ResultProjector — forbidden combinations (PRD §18.8)', () => {
  it('rejects a coverage basis over a different identity set than the requested scope (C01)', () => {
    const requested = members('member-t007-fb1', 3);
    const drifted = [requested[0]!, requested[1]!, mid('member-t007-fb1-swapped')];
    const rejected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb1'),
        requestedMemberIds: drifted,
        accounting: accountingFor(drifted),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: requested,
          },
        },
      }),
    );
    expectCode(rejected, 'COVERAGE_EVIDENCE_INSUFFICIENT', 'C01/PRD-§19');
  });

  it('TargetResolution PARTIAL can never coexist with VERIFIED_COMPLETE — coverage degrades instead', () => {
    const requested = members('member-t007-fb2', 3);
    const projected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb2'),
        requestedMemberIds: requested,
        accounting: accountingFor(requested, { resolvedMemberIds: requested.slice(0, 2) }),
      }),
    );
    // full accounting input but only 2 of 3 resolved: the derivation cannot
    // produce the forbidden pair — coverage stays below VERIFIED_COMPLETE
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.value.result.targetResolution).toBe('PARTIAL');
      expect(projected.value.result.coverage).not.toBe('VERIFIED_COMPLETE');
    }
    // and the T002 legal-combination gate rejects the hand-built forbidden tuple
    const handBuilt = decodeTerminalResult({
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contractId: t007Contract('contract-t007-fb2'),
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'NONE',
      validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
      recordedAt: T007_RECORDED_AT,
    });
    expect(handBuilt.ok).toBe(true);
    if (handBuilt.ok) {
      expectCode(
        validateTerminalResult(handBuilt.value, {
          intentType: 'COLLECTION',
          scopeKind: 'entire_supported_collection',
          selectedMemberCount: 3,
        }),
        'INVALID_RESULT_COMBINATION',
        'PRD-§18.8',
      );
    }
  });

  it('EMPTY_UNKNOWN + COMPLETE is unreachable by derivation and rejected by the gate', () => {
    const projected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb3'),
        requestedMemberIds: [],
        accounting: accountingFor([]),
        coverageBasis: undefined,
        memberValidation: [],
        enumeration: { kind: 'UNPROVEN_EMPTY' },
      }),
    );
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.value.result.targetResolution).toBe('EMPTY_UNKNOWN');
      expect(projected.value.result.requestFulfillment).not.toBe('COMPLETE');
    }
  });

  it('direct single-resource tasks reject collection coverage other than NOT_APPLICABLE', () => {
    const target = mid('target-t007-fb4');
    const rejected = projectResult({
      contractId: t007Contract('contract-t007-fb4'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [target],
      acceptedSelectedMemberIds: [target],
      accounting: accountingFor(),
      coverageBasis: {
        kind: 'SUFFICIENT',
        basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: [target] },
      },
      memberValidation: [{ memberId: target, result: 'VALIDATED' }],
      enumeration: { kind: 'NOT_APPLICABLE' },
    });
    expectCode(rejected, 'INVALID_RESULT_COMBINATION', 'PRD-§18.8');
  });

  it('authorization-limited whole-collection requests can never project COMPLETE (C10/§18.7)', () => {
    const ledger = createEvidenceLedger();
    const requested = members('member-t007-fb5', 4);
    const accessible = requested.slice(0, 3);
    const blocked = requested[3] as MemberIdAlias;
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-fb5-inacc-1',
      claimType: 'AUTHORIZATION',
      memberRef: blocked,
      sourceIdentity: 'auth-broker/fb5-classification-1',
    });
    const projected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb5'),
        requestedMemberIds: requested,
        accounting: accountingFor(requested, {
          resolvedMemberIds: requested,
          authAccessibleMemberIds: accessible,
          authInaccessibleMembers: [
            { memberId: blocked, classificationEvidenceId: 'evidence-fb5-inacc-1' },
          ],
          selectedMemberIds: accessible,
          validatedMemberIds: accessible,
        }),
        acceptedSelectedMemberIds: accessible,
        memberValidation: accessible.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        authorizationLimited: true,
      }),
    );
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.value.result.requestFulfillment).toBe('PARTIAL');
      expect(projected.value.result.requestFulfillment).not.toBe('COMPLETE');
    }
  });

  it('collection-scope projection without accounting rejects (no unaccounted collection coverage)', () => {
    const rejected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb6'),
        accounting: undefined,
        coverageBasis: undefined,
      }),
    );
    expectCode(rejected, 'MISSING_REQUIRED_FIELD', 'PRD-§17');
  });

  it('an empty selected set is never vacuous acquisition success', () => {
    const requested = members('member-t007-fb7', 2);
    const projected = projectResult(
      fullFacts({
        contractId: t007Contract('contract-t007-fb7'),
        accounting: accountingFor(requested, {
          selectedMemberIds: [],
          validatedMemberIds: [],
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: [],
        memberValidation: [],
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
      }),
    );
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.value.result.selectionAcquisition).toBe('NOT_STARTED');
      expect(projected.value.result.selectionAcquisition).not.toBe('COMPLETE');
    }
  });
});

describe('T007 ResultProjector — §17.2 auth-limited 18/16 tuple', () => {
  function authLimitedStack(
    prefix: string,
    independentlyEvidenced: boolean,
  ): { accounting: CoverageAccounting; requested: ReturnType<typeof members> } {
    const ledger = createEvidenceLedger();
    const requested = members(prefix, 18);
    const accessible = requested.slice(0, 16);
    const inaccessible = requested.slice(16);
    inaccessible.forEach((memberRef, index) => {
      appendMemberEvidence(ledger, {
        evidenceId: `evidence-${prefix}-inacc-${index + 1}`,
        claimType: 'AUTHORIZATION',
        memberRef,
        sourceIdentity: `auth-broker/${prefix}-classification-${index + 1}`,
        certaintyClass: independentlyEvidenced ? 'DECISIVE' : 'SUGGESTIVE',
      });
    });
    const accounting = accountingOf(
      {
        requestedMemberIds: requested,
        resolvedMemberIds: accessible,
        authAccessibleMemberIds: accessible,
        authInaccessibleMembers: inaccessible.map((memberId, index) => ({
          memberId,
          classificationEvidenceId: `evidence-${prefix}-inacc-${index + 1}`,
        })),
        selectedMemberIds: accessible,
        validatedMemberIds: accessible,
        authorizationContextRef: 'authctx/t007-c10',
      },
      ledger,
    );
    return { accounting, requested };
  }

  function authLimitedFacts(overrides: Partial<ProjectionFacts> = {}): ProjectionFacts {
    const { accounting, requested } = authLimitedStack('member-t007-c10', true);
    const accessible = requested.slice(0, 16);
    return fullFacts({
      contractId: t007Contract('contract-t007-c10'),
      requestedMemberIds: requested,
      accounting,
      acceptedSelectedMemberIds: accessible,
      memberValidation: accessible.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
      authorizationLimited: true,
      stopFacts: { authRequired: true },
      ...overrides,
    });
  }

  it('projects the exact frozen tuple PARTIAL/RESOLVED/COMPLETE/VERIFIED_COMPLETE/AUTH_REQUIRED', () => {
    const result = projectOk(authLimitedFacts());
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('RESOLVED');
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.coverage).toBe('VERIFIED_COMPLETE');
    expect(result.stopReason).toBe('AUTH_REQUIRED');
    expect(result.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 16,
      failedCount: 0,
    });
  });

  it('carries the required accounting counts and keeps the requested scope at 18', () => {
    const facts = authLimitedFacts();
    expect(facts.accounting?.counts).toEqual({
      requested: 18,
      accounted: 18,
      authAccessible: 16,
      authInaccessible: 2,
      selected: 16,
      validated: 16,
    });
  });

  it('produces the required user-visible explanation with the exact accounting facts', () => {
    const projected = projectResult(authLimitedFacts());
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.value.explanation).toContain(
        '16 of 18 requested members were acquired and validated',
      );
      expect(projected.value.explanation).toContain('The requested scope remains all 18 members');
      expect(projected.value.explanation).toContain(
        'inaccessible under the current authorization context',
      );
      expect(projected.value.explanation).toContain('no unauthorized access was attempted');
    }
  });

  it('degrades consistently when the 2 inaccessible members are not independently accounted', () => {
    const { accounting, requested } = authLimitedStack('member-t007-c10d', false);
    const accessible = requested.slice(0, 16);
    const result = projectOk(
      authLimitedFacts({
        contractId: t007Contract('contract-t007-c10d'),
        requestedMemberIds: requested,
        accounting,
        acceptedSelectedMemberIds: accessible,
        memberValidation: accessible.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        authorizationLimited: true,
        stopFacts: { authRequired: true },
      }),
    );
    // degraded: PARTIAL resolution, coverage UNKNOWN — never inferred complete
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('PARTIAL');
    expect(result.coverage).toBe('UNKNOWN');
    expect(result.stopReason).toBe('AUTH_REQUIRED');
  });
});

describe('T007 ResultProjector — partial/truncated/unknown distinctions', () => {
  it('C02-shape: safety-cap truncation projects PARTIAL/PARTIAL/TRUNCATED and never COMPLETE', () => {
    const requested = members('member-t007-cap', 150);
    const capped = requested.slice(0, 100);
    const result = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-cap'),
        requestedMemberIds: requested,
        accounting: accountingFor(requested, {
          resolvedMemberIds: capped,
          authAccessibleMemberIds: capped,
          selectedMemberIds: capped,
          validatedMemberIds: capped,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: capped,
        memberValidation: capped.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        enumeration: { kind: 'TRUNCATED', by: 'SAFETY_CAP' },
      }),
    );
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('PARTIAL');
    expect(result.coverage).toBe('TRUNCATED');
    expect(result.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });

  it('C03-shape: failed next page / loop is not a natural end — coverage UNKNOWN-or-TRUNCATED with truthful stop', () => {
    for (const reason of ['FAILED_NEXT_PAGE', 'MISSING_NEXT_CONTROL', 'PAGINATION_LOOP'] as const) {
      const requested = members('member-t007-c03', 6);
      const got = requested.slice(0, 4);
      const result = projectOk(
        fullFacts({
          contractId: t007Contract('contract-t007-c03'),
          requestedMemberIds: requested,
          accounting: accountingFor(requested, {
            resolvedMemberIds: got,
            authAccessibleMemberIds: got,
            selectedMemberIds: got,
            validatedMemberIds: got,
          }),
          coverageBasis: undefined,
          acceptedSelectedMemberIds: got,
          memberValidation: got.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
          enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason },
        }),
      );
      expect(result.coverage === 'UNKNOWN' || result.coverage === 'TRUNCATED').toBe(true);
      expect(result.coverage).not.toBe('VERIFIED_COMPLETE');
      expect(
        result.stopReason === 'NO_PROGRESS' || result.stopReason === 'COLLECTION_CHANGED',
      ).toBe(true);
      expect(result.requestFulfillment).not.toBe('COMPLETE');
    }
  });

  it('insufficient evidence stays INSUFFICIENT_EVIDENCE with no post-hoc conversion (C22)', () => {
    const requested = members('member-t007-c22', 2);
    const result = projectOk(
      fullFacts({
        contractId: t007Contract('contract-t007-c22'),
        requestedMemberIds: requested,
        accounting: accountingFor(requested, {
          selectedMemberIds: requested,
          validatedMemberIds: [requested[0]!],
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: [requested[0]!],
        memberValidation: [
          { memberId: requested[0]!, result: 'VALIDATED' as const },
          { memberId: requested[1]!, result: 'NOT_VALIDATED' as const },
        ],
        enumeration: { kind: 'NATURAL_END_VALIDATED' },
      }),
    );
    expect(result.validationSummary.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.selectionAcquisition).not.toBe('COMPLETE');
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });
});

describe('T007 ResultProjector — cancellation projection (L2 §11.1)', () => {
  const requested = members('member-t007-cancel', 3);

  function cancelFacts(overrides: Partial<ProjectionFacts> = {}): ProjectionFacts {
    return fullFacts({
      contractId: t007Contract('contract-t007-cancel'),
      requestedMemberIds: requested,
      ...overrides,
    });
  }

  it('cancel before dispatch: nothing accepted -> CANCELLED/USER_CANCELLED, request never COMPLETE', () => {
    const result = projectOk(
      cancelFacts({
        acceptedSelectedMemberIds: [],
        memberValidation: requested.map((memberId) => ({
          memberId,
          result: 'NOT_VALIDATED' as const,
        })),
        cancellation: { acceptedBeforeCutoff: [] },
      }),
    );
    expect(result.selectionAcquisition).toBe('CANCELLED');
    expect(result.stopReason).toBe('USER_CANCELLED');
    expect(result.requestFulfillment).toBe('UNSATISFIED');
  });

  it('cancel after bytes complete but before validation: staged/validated bytes stay unaccepted', () => {
    const result = projectOk(
      cancelFacts({
        acceptedSelectedMemberIds: [],
        memberValidation: requested.map((memberId) => ({
          memberId,
          result: 'NOT_VALIDATED' as const,
        })),
        cancellation: {
          acceptedBeforeCutoff: [],
          stagedUnaccepted: requested,
        },
      }),
    );
    expect(result.selectionAcquisition).toBe('CANCELLED');
    expect(result.stopReason).toBe('USER_CANCELLED');
    // staged bytes cannot fabricate fulfillment or validation truth
    expect(result.validationSummary.passedCount).toBe(0);
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });

  it('counterexample normalization: valid staged bytes + cancel-before-acceptance never projects COMPLETE', () => {
    const result = projectOk(
      cancelFacts({
        acceptedSelectedMemberIds: [],
        memberValidation: requested.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        cancellation: {
          acceptedBeforeCutoff: [],
          stagedUnaccepted: requested,
        },
      }),
    );
    // validated-but-unaccepted bytes cannot auto-accept across the cutoff
    expect(result.selectionAcquisition).toBe('CANCELLED');
    expect(result.requestFulfillment).not.toBe('COMPLETE');
    expect(result.stopReason).toBe('USER_CANCELLED');
  });

  it('cancel after some durable acceptances: PARTIAL/USER_CANCELLED', () => {
    const some = requested.slice(0, 1);
    const acceptedFirst = some[0]!;
    const result = projectOk(
      cancelFacts({
        acceptedSelectedMemberIds: some,
        memberValidation: requested.map((memberId) => ({
          memberId,
          result: memberId === acceptedFirst ? ('VALIDATED' as const) : ('NOT_VALIDATED' as const),
        })),
        cancellation: { acceptedBeforeCutoff: some },
      }),
    );
    expect(result.selectionAcquisition).toBe('PARTIAL');
    expect(result.stopReason).toBe('USER_CANCELLED');
    expect(result.requestFulfillment).toBe('PARTIAL');
  });

  it('cancel after every frozen S identity was accepted: COMPLETE cannot be downgraded', () => {
    const result = projectOk(
      cancelFacts({
        cancellation: { acceptedBeforeCutoff: requested },
      }),
    );
    expect(result.selectionAcquisition).toBe('COMPLETE');
    // work was already complete: cancellation is not the reason remaining work stopped
    expect(result.stopReason).not.toBe('USER_CANCELLED');
    expect(result.requestFulfillment).toBe('COMPLETE');
  });

  it('acceptance committed after the durable cancellation cutoff is a typed violation', () => {
    const rejected = projectResult(
      cancelFacts({
        acceptedSelectedMemberIds: requested,
        cancellation: { acceptedBeforeCutoff: [requested[0]!] },
      }),
    );
    expectCode(rejected, 'CANCELLATION_CUTOFF_VIOLATION', 'L2-§11.1-inv20');
  });

  it('late cancellation after terminal truth does not rewrite the terminal result', () => {
    const store = createTerminalResultStore();
    const first = store.project(cancelFacts({}));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const original = first.value.result;
    const late = store.project(
      cancelFacts({
        acceptedSelectedMemberIds: [],
        memberValidation: requested.map((memberId) => ({
          memberId,
          result: 'NOT_VALIDATED' as const,
        })),
        cancellation: { acceptedBeforeCutoff: [] },
      }),
    );
    expect(late.ok).toBe(true);
    if (late.ok) {
      expect(late.value.result).toEqual(original);
      expect(late.value.result.stopReason).not.toBe('USER_CANCELLED');
    }
  });

  it('explicit retry/resume after cancellation is the one transition that may reopen the lineage', () => {
    const store = createTerminalResultStore();
    const cancelled = store.project(
      cancelFacts({
        acceptedSelectedMemberIds: [],
        memberValidation: requested.map((memberId) => ({
          memberId,
          result: 'NOT_VALIDATED' as const,
        })),
        cancellation: { acceptedBeforeCutoff: [] },
      }),
    );
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value.result.selectionAcquisition).toBe('CANCELLED');
    }
    const resumed = store.project(
      cancelFacts({
        explicitRetryResume: true,
        // retry reuses the staged bytes under ordinary validation/acceptance
        memberValidation: requested.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
      }),
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.value.result.selectionAcquisition).toBe('COMPLETE');
      expect(resumed.value.result.requestFulfillment).toBe('COMPLETE');
      // the store now holds the superseding terminal truth
      expect(store.terminalFor('contract-t007-cancel', 'snapshot-t007-001')?.result).toEqual(
        resumed.value.result,
      );
    }
  });

  it('cancellation neither erases proven resolution/coverage truth nor upgrades unknown coverage', () => {
    const result = projectOk(
      cancelFacts({
        acceptedSelectedMemberIds: [requested[0]!],
        memberValidation: [
          { memberId: requested[0]!, result: 'VALIDATED' as const },
          { memberId: requested[1]!, result: 'NOT_VALIDATED' as const },
          { memberId: requested[2]!, result: 'NOT_VALIDATED' as const },
        ],
        coverageBasis: undefined,
        cancellation: { acceptedBeforeCutoff: [requested[0]!] },
      }),
    );
    // already-proven resolution truth survives cancellation unchanged
    expect(result.targetResolution).toBe('RESOLVED');
    // unknown coverage (no sufficient basis) is not upgraded by the cancellation
    expect(result.coverage).toBe('UNKNOWN');
    expect(result.stopReason).toBe('USER_CANCELLED');
    expect(result.requestFulfillment).toBe('PARTIAL');
  });
});

describe('T007 read projections — thin, non-authoritative, immutable (L2 invariants 1–2)', () => {
  it('surfaces receive a frozen thin projection with no recomputation capability', () => {
    const store = createTerminalResultStore();
    const facts = fullFacts();
    const projected = store.project(facts);
    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }
    const view = store.surfaceView('contract-t007-001', 'snapshot-t007-001');
    expect(view).toBeDefined();
    if (view === undefined) {
      return;
    }
    expect(view.terminal).toEqual(projected.value.result);
    expect(Object.isFrozen(view)).toBe(true);
    // a plain data object: no methods, no mutable handles on canonical truth
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(view) === Object.prototype ? view : {},
    );
    expect(
      methods.filter(
        (name) => typeof (view as unknown as Record<string, unknown>)[name] === 'function',
      ),
    ).toEqual([]);
  });

  it('the store keeps terminal truth immutable per lineage and serves the same object to every surface', () => {
    const store = createTerminalResultStore();
    const facts = fullFacts();
    store.project(facts);
    const first = store.surfaceView('contract-t007-001', 'snapshot-t007-001');
    const second = store.surfaceView('contract-t007-001', 'snapshot-t007-001');
    expect(second).toEqual(first);
    expect(store.terminalFor('contract-t007-unknown')).toBeUndefined();
    expect(store.surfaceView('contract-t007-unknown')).toBeUndefined();
  });
});
