/**
 * TEST_MATRIX suite `result-legal-combinations` — multidimensional terminal
 * truth, canonical §17/§18 tuples and forbidden-combination rejection.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeTerminalResult,
  validateTerminalResult,
  type TerminalResultContext,
} from '../src/index.ts';
import { decodeOk, decodedTerminalResult, expectCode, mid, rawTerminalResult } from './helpers.ts';

const EIGHTEEN_IDENTITIES = Array.from(
  { length: 18 },
  (_, i) => `member-${String(i + 1).padStart(3, '0')}`,
);

const SUFFICIENT_LIST = {
  kind: 'SUFFICIENT',
  basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: EIGHTEEN_IDENTITIES },
} as const;

function context(overrides: Partial<TerminalResultContext> = {}): TerminalResultContext {
  return {
    intentType: 'COLLECTION',
    scopeKind: 'entire_supported_collection',
    selectedMemberCount: 3,
    selectedValidationOutcomes: [mid('member-001'), mid('member-002'), mid('member-003')].map(
      (memberId) => ({ memberId, requiredValidationPassed: true }),
    ),
    coverageEvidence: SUFFICIENT_LIST,
    ...overrides,
  };
}

describe('result-legal-combinations: multidimensional terminal truth', () => {
  it('every terminal result exposes the six required dimensions; no single success boolean', () => {
    const result = decodedTerminalResult();
    expect(result.requestFulfillment).toBe('COMPLETE');
    expect(result.targetResolution).toBe('RESOLVED');
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.coverage).toBe('NOT_APPLICABLE');
    expect(result.stopReason).toBe('NONE');
    expect(result.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 1,
      failedCount: 0,
    });
    // a single authoritative success boolean is not representable
    expectCode(decodeTerminalResult(rawTerminalResult({ success: true })), 'UNKNOWN_FIELD');
  });

  it('rejects unknown enum values in any dimension and missing dimensions', () => {
    expectCode(
      decodeTerminalResult(rawTerminalResult({ requestFulfillment: 'MOSTLY_YES' })),
      'UNKNOWN_ENUM_VALUE',
    );
    const missing = rawTerminalResult();
    delete missing['coverage'];
    expectCode(decodeTerminalResult(missing), 'UNKNOWN_ENUM_VALUE');
  });
});

describe('result-legal-combinations: canonical legal tuples (PRD §17/§18)', () => {
  const legal: readonly {
    readonly name: string;
    readonly raw: Record<string, unknown>;
    readonly ctx: TerminalResultContext;
  }[] = [
    {
      name: '§18.1 direct resource success',
      raw: rawTerminalResult(),
      ctx: {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
        selectedValidationOutcomes: [
          { memberId: mid('member-001'), requiredValidationPassed: true },
        ],
      },
    },
    {
      name: '§18.2 requested bounded scope fully acquired',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'USER_SCOPE_REACHED',
      }),
      ctx: context({
        scopeKind: 'collection_page_range',
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: ['member-001', 'member-002', 'member-003'],
          },
        },
      }),
    },
    {
      name: '§18.3 whole collection requested, discovery truncated after frozen targets succeed',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'TRUNCATED',
        stopReason: 'DISCOVERY_BUDGET_EXHAUSTED',
      }),
      ctx: context({ coverageEvidence: { kind: 'INSUFFICIENT', basis: 'BUDGET_EXHAUSTED' } }),
    },
    {
      name: '§18.4 auth failure before any target is resolved',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'BLOCKED',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'UNKNOWN',
        stopReason: 'AUTH_FAILED',
        validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
      }),
      ctx: context({
        selectedMemberCount: 0,
        selectedValidationOutcomes: [],
        coverageEvidence: undefined,
      }),
    },
    {
      name: '§18.5 independently verified empty requested collection',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'COMPLETE',
        targetResolution: 'EMPTY_CONFIRMED',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'NATURAL_COLLECTION_END',
        validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
      }),
      ctx: context({
        selectedMemberCount: 0,
        selectedValidationOutcomes: [],
        coverageEvidence: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: [] },
        },
      }),
    },
    {
      name: '§18.6 empty but not proven empty',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'UNKNOWN',
        targetResolution: 'EMPTY_UNKNOWN',
        selectionAcquisition: 'NOT_STARTED',
        coverage: 'UNKNOWN',
        stopReason: 'NO_PROGRESS',
        validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
      }),
      ctx: context({
        selectedMemberCount: 0,
        selectedValidationOutcomes: [],
        coverageEvidence: undefined,
      }),
    },
    {
      name: '§17.2 authorization-limited but fully enumerated request (16/18)',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'COMPLETE',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'AUTH_REQUIRED',
      }),
      ctx: context({
        selectedMemberCount: 16,
        selectedValidationOutcomes: Array.from({ length: 16 }, (_, i) => ({
          memberId: mid(`member-${String(i + 1).padStart(3, '0')}`),
          requiredValidationPassed: true,
        })),
        coverageEvidence: SUFFICIENT_LIST,
        knownAuthInaccessibleRequestedCount: 2,
      }),
    },
    {
      name: 'C14 selection may complete while request stays partial/unknown and coverage is not verified',
      raw: rawTerminalResult({
        contractId: 'contract-collection-001',
        requestFulfillment: 'PARTIAL',
        targetResolution: 'PARTIAL',
        selectionAcquisition: 'COMPLETE',
        coverage: 'UNKNOWN',
        stopReason: 'NO_PROGRESS',
      }),
      ctx: context({ coverageEvidence: undefined }),
    },
  ];

  for (const entry of legal) {
    it(`accepts ${entry.name}`, () => {
      const result = decodeOk(decodeTerminalResult(entry.raw));
      expect(decodeOk(validateTerminalResult(result, entry.ctx))).toBeUndefined();
    });
  }
});

describe('result-legal-combinations: forbidden combinations (PRD §18.8)', () => {
  it('rejects TargetResolution PARTIAL + Coverage VERIFIED_COMPLETE', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      targetResolution: 'PARTIAL',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(result, context()),
      'INVALID_RESULT_COMBINATION',
      'PRD-§18.8',
    );
  });

  it('rejects SelectionAcquisition COMPLETE when required selected targets failed validation (C27)', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
      validationSummary: { status: 'PARTIAL', passedCount: 2, failedCount: 1 },
    });
    expectCode(
      validateTerminalResult(
        result,
        context({
          selectedValidationOutcomes: [
            { memberId: mid('member-001'), requiredValidationPassed: true },
            { memberId: mid('member-002'), requiredValidationPassed: true },
            { memberId: mid('member-003'), requiredValidationPassed: false },
          ],
        }),
      ),
      'INVALID_RESULT_COMBINATION',
      'C27',
    );
  });

  it('rejects EMPTY_UNKNOWN resolution + COMPLETE fulfillment', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      targetResolution: 'EMPTY_UNKNOWN',
      selectionAcquisition: 'NOT_STARTED',
      coverage: 'UNKNOWN',
      validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
    });
    expectCode(
      validateTerminalResult(
        result,
        context({ selectedMemberCount: 0, selectedValidationOutcomes: [] }),
      ),
      'INVALID_RESULT_COMBINATION',
    );
  });

  it('rejects VERIFIED_COMPLETE from count equality, limits, timeout, budget, failed next page or loops', () => {
    for (const basis of [
      'COUNT_EQUALITY',
      'MAX_ITEMS_REACHED',
      'PAGE_LIMIT_REACHED',
      'TIMEOUT',
      'BUDGET_EXHAUSTED',
      'FAILED_NEXT_PAGE',
      'PAGINATION_LOOP',
      'NO_MORE_FOUND_WITHOUT_CLOSURE',
    ] as const) {
      const result = decodedTerminalResult({
        contractId: 'contract-collection-001',
        coverage: 'VERIFIED_COMPLETE',
        stopReason: 'USER_SCOPE_REACHED',
      });
      expectCode(
        validateTerminalResult(
          result,
          context({ coverageEvidence: { kind: 'INSUFFICIENT', basis } }),
        ),
        'COVERAGE_EVIDENCE_INSUFFICIENT',
        'PRD-§19',
      );
    }
  });

  it('rejects VERIFIED_COMPLETE from declared-total evidence without identity correspondence (C01 shape)', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(
        result,
        context({
          coverageEvidence: {
            kind: 'SUFFICIENT',
            basis: {
              basis: 'DECLARED_TOTAL_WITH_CLOSURE',
              declaredTotal: 18,
              accountedIdentityCount: 17,
              closure: 'CONTINUATION_CLOSED',
            },
          },
        }),
      ),
      'COVERAGE_EVIDENCE_INSUFFICIENT',
    );
  });

  it('rejects direct single-resource coverage other than NOT_APPLICABLE', () => {
    const result = decodedTerminalResult({
      coverage: 'VERIFIED_COMPLETE',
      validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    });
    expectCode(
      validateTerminalResult(result, {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
        selectedValidationOutcomes: [
          { memberId: mid('member-001'), requiredValidationPassed: true },
        ],
        coverageEvidence: SUFFICIENT_LIST,
      }),
      'INVALID_RESULT_COMBINATION',
    );
  });

  it('rejects whole-collection COMPLETE while known requested members are auth-inaccessible (C10)', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'COMPLETE',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(
        result,
        context({
          selectedMemberCount: 16,
          selectedValidationOutcomes: Array.from({ length: 16 }, (_, i) => ({
            memberId: mid(`member-${String(i + 1).padStart(3, '0')}`),
            requiredValidationPassed: true,
          })),
          knownAuthInaccessibleRequestedCount: 2,
        }),
      ),
      'INVALID_RESULT_COMBINATION',
      'C10/PRD-§18.7',
    );
  });

  it('rejects empty selected set treated as vacuous acquisition success', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
    });
    expectCode(
      validateTerminalResult(
        result,
        context({ selectedMemberCount: 0, selectedValidationOutcomes: [] }),
      ),
      'INVALID_RESULT_COMBINATION',
      'PRD-§16.3',
    );
  });

  it('rejects selection COMPLETE on insufficient-evidence validation summary (C22)', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      coverage: 'VERIFIED_COMPLETE',
      stopReason: 'USER_SCOPE_REACHED',
      validationSummary: { status: 'INSUFFICIENT_EVIDENCE', passedCount: 0, failedCount: 0 },
    });
    expectCode(validateTerminalResult(result, context()), 'INVALID_RESULT_COMBINATION', 'C22');
  });

  it('rejects transfer-budget exhaustion alongside acquisition completion', () => {
    const result = decodedTerminalResult({
      contractId: 'contract-collection-001',
      requestFulfillment: 'PARTIAL',
      targetResolution: 'PARTIAL',
      selectionAcquisition: 'COMPLETE',
      coverage: 'UNKNOWN',
      stopReason: 'TRANSFER_BUDGET_EXHAUSTED',
    });
    expectCode(
      validateTerminalResult(result, context({ coverageEvidence: undefined })),
      'INVALID_RESULT_COMBINATION',
    );
  });
});
