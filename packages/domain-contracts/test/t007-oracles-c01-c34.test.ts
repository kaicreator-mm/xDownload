/**
 * TEST_MATRIX counterexample_oracles C01–C34 (frozen PRD §35) at the T007
 * projection/behavior level: the ledger/validator/accounting/projector layer
 * computes the required outcomes and rejects the false-success paths. Fixture
 * identities are distinct from both the T002 representability oracles and the
 * suite-level tests (member-oracle-* / evidence-oracle-t007-*).
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateConfirmationOutcomes,
  buildCoverageAccounting,
  createEvidenceLedger,
  createTerminalResultStore,
  createValidationRegistry,
  decodeRequestedScope,
  projectResult,
  requiredValidationOutcomes,
  unwrapOrThrow,
  type ProjectionFacts,
} from '../src/index.ts';
import {
  T007_COLLECTION,
  T007_RECORDED_AT,
  accountingOf,
  appendMemberEvidence,
  evidenceRaw,
  members,
  t007CollectionId,
  t007Contract,
  t007CoverageTarget,
  t007Snapshot,
} from './t007-helpers.ts';
import { expectCode, mid } from './helpers.ts';

const unique = (counterexample: string, index: number): string =>
  `member-oracle-${counterexample}-${String(index).padStart(2, '0')}`;

function validationRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    validationId: 'validation-oracle-001',
    layer: 'transfer',
    subject: { kind: 'MEMBER', ref: 'member-oracle-001' },
    outcome: 'PASS',
    evidenceRefs: ['evidence-oracle-t007-001'],
    validatorIdentity: 'validator/oracle-t007',
    recordedAt: T007_RECORDED_AT,
    ...overrides,
  };
}

/** Registry where every member passes every listed layer through real records. */
function passingRegistry(
  memberRefs: readonly string[],
  layers: readonly ('transfer' | 'format' | 'media' | 'target' | 'membership' | 'coverage')[],
  prefix: string,
) {
  const ledger = createEvidenceLedger();
  const registry = createValidationRegistry(ledger);
  memberRefs.forEach((memberRef, memberIndex) => {
    layers.forEach((layer, _layerIndex) => {
      const evidenceId = `evidence-oracle-t007-${prefix}-${memberIndex + 1}-${layer}`;
      appendMemberEvidence(ledger, {
        evidenceId,
        claimType:
          layer === 'transfer'
            ? 'TRANSFER'
            : layer === 'format'
              ? 'FORMAT'
              : layer === 'media'
                ? 'MEDIA'
                : layer === 'target'
                  ? 'RESOURCE_IDENTITY'
                  : layer === 'membership'
                    ? 'MEMBERSHIP'
                    : 'COVERAGE',
        memberRef,
        sourceIdentity: `validator/${prefix}/${layer}/${memberIndex + 1}`,
      });
      unwrapOrThrow(
        registry.register(
          validationRaw({
            validationId: `validation-oracle-${prefix}-${memberIndex + 1}-${layer}`,
            layer,
            subject: { kind: 'MEMBER', ref: memberRef },
            evidenceRefs: [evidenceId],
            validatorIdentity: `validator/${prefix}/${layer}`,
          }),
        ),
      );
    });
  });
  return { ledger, registry };
}

function collectionFacts(overrides: Partial<ProjectionFacts> = {}): ProjectionFacts {
  const requested = overrides.requestedMemberIds ?? members('member-oracle-base', 3);
  return {
    contractId: t007Contract('contract-oracle-t007'),
    snapshotId: t007Snapshot('snapshot-oracle-t007-1'),
    intentType: 'COLLECTION',
    scopeKind: 'entire_supported_collection',
    recordedAt: T007_RECORDED_AT,
    requestedMemberIds: requested,
    acceptedSelectedMemberIds: requested,
    accounting: accountingOf({ requestedMemberIds: requested }),
    coverageBasis: {
      kind: 'SUFFICIENT',
      basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: requested },
    },
    memberValidation: requested.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
    enumeration: { kind: 'NATURAL_END_VALIDATED' },
    ...overrides,
  };
}

function expectProjected(
  facts: ProjectionFacts,
): Extract<Awaited<ReturnType<typeof projectResult>>, { ok: true }>['value'] {
  const projected = projectResult(facts);
  expect(projected.ok, JSON.stringify(projected.ok ? [] : projected.diagnostics)).toBe(true);
  if (!projected.ok) {
    throw new Error('unreachable');
  }
  return projected.value;
}

describe('T007 counterexample oracles C01–C09 (projection/behavior level)', () => {
  it('C01 duplicate-replaces-missing with equal counts never emits VERIFIED_COMPLETE', () => {
    const original = members(unique('c01-req', 3), 3);
    const drifted = [original[0]!, original[1]!, mid('member-oracle-c01-intruder')];
    const rejected = projectResult(
      collectionFacts({
        requestedMemberIds: drifted,
        accounting: accountingOf({ requestedMemberIds: drifted }),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: original },
        },
      }),
    );
    // accounting demands identity correspondence with the requested reference
    // set, never count equality: the substituted basis is rejected outright
    expectCode(rejected, 'COVERAGE_EVIDENCE_INSUFFICIENT', 'C01/PRD-§19');
  });

  it('C02 requested-150 safety-cap-stops-100 projects PARTIAL/PARTIAL/TRUNCATED, never COMPLETE', () => {
    const requested = members(unique('c02', 150), 150);
    const capped = requested.slice(0, 100);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c02'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: capped,
          validatedMemberIds: capped,
          resolvedMemberIds: capped,
          authAccessibleMemberIds: capped,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: capped,
        memberValidation: capped.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        enumeration: { kind: 'TRUNCATED', by: 'SAFETY_CAP' },
      }),
    ).result;
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('PARTIAL');
    expect(result.coverage).toBe('TRUNCATED');
    expect(result.stopReason).toBe('GLOBAL_SAFETY_LIMIT');
    expect(
      result.requestFulfillment === 'COMPLETE' && result.coverage === 'VERIFIED_COMPLETE',
    ).toBe(false);
  });

  it('C03 next-page fails / missing control / loop is never a natural end', () => {
    for (const reason of ['FAILED_NEXT_PAGE', 'MISSING_NEXT_CONTROL', 'PAGINATION_LOOP'] as const) {
      const requested = members(unique('c03', 8), 8);
      const got = requested.slice(0, 5);
      const result = expectProjected(
        collectionFacts({
          contractId: t007Contract('contract-oracle-c03'),
          requestedMemberIds: requested,
          accounting: accountingOf({
            requestedMemberIds: requested,
            selectedMemberIds: got,
            validatedMemberIds: got,
            resolvedMemberIds: got,
            authAccessibleMemberIds: got,
          }),
          coverageBasis: undefined,
          acceptedSelectedMemberIds: got,
          memberValidation: got.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
          enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason },
        }),
      ).result;
      expect(result.coverage === 'UNKNOWN' || result.coverage === 'TRUNCATED').toBe(true);
      expect(result.coverage).not.toBe('VERIFIED_COMPLETE');
      expect(result.stopReason).not.toBe('NATURAL_COLLECTION_END');
      expect(result.stopReason).not.toBe('USER_SCOPE_REACHED');
    }
  });

  it('C04 finite collection with independently validated natural end reaches VERIFIED_COMPLETE only with closure evidence', () => {
    const requested = members(unique('c04', 5), 5);
    const withClosure = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c04a'),
        requestedMemberIds: requested,
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'DECLARED_TOTAL_WITH_CLOSURE',
            declaredTotal: 5,
            accountedIdentityCount: 5,
            closure: 'NATURAL_END_VALIDATED',
          },
        },
      }),
    ).result;
    expect(withClosure.coverage).toBe('VERIFIED_COMPLETE');
    expect(withClosure.requestFulfillment).toBe('COMPLETE');
    // the same accounting without closure evidence never reaches VERIFIED_COMPLETE
    const withoutClosure = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c04b'),
        requestedMemberIds: requested,
        coverageBasis: undefined,
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
      }),
    ).result;
    expect(withoutClosure.coverage).not.toBe('VERIFIED_COMPLETE');
  });

  it('C05 explicit 5-of-larger selection projects the exact tuple for the selected scope only', () => {
    const selected = members(unique('c05', 5), 5);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c05'),
        scopeKind: 'selected_collection_members',
        requestedMemberIds: selected,
        accounting: accountingOf({
          requestedMemberIds: selected,
          coverageTarget: t007CoverageTarget(
            'selected_collection_members:collection/t007-gallery-001',
          ),
          parentCollectionCoverage: {
            collectionIdentity: t007CollectionId(T007_COLLECTION),
            status: 'UNKNOWN',
          },
        }),
      }),
    );
    expect(result.result.requestFulfillment).toBe('COMPLETE');
    expect(result.result.targetResolution).toBe('RESOLVED');
    expect(result.result.selectionAcquisition).toBe('COMPLETE');
    expect(result.result.coverage).toBe('VERIFIED_COMPLETE');
    expect(result.result.stopReason).toBe('USER_SELECTION_COMPLETE');
    // parent-completeness is not implied: the parent view stays UNKNOWN
    expect(result.result.coverage).toBe('VERIFIED_COMPLETE');
    expect(result.accounting?.parentCollectionCoverage?.status).toBe('UNKNOWN');
  });

  it('C06 arbitrary-frontier requests are rejected upstream; no accounting, no projection', () => {
    // the frontier scope is not expressible in the frozen scope grammar at all
    expect(
      decodeRequestedScope({ kind: 'first_1000_pages_under_domain', domain: 'example' }).ok,
    ).toBe(false);
    // with no accounting there is nothing to project — the T007 layer cannot
    // be reached with coverage accounting for an unadmitted collection
    expectCode(
      projectResult(collectionFacts({ accounting: undefined, coverageBasis: undefined })),
      'MISSING_REQUIRED_FIELD',
      'PRD-§17',
    );
  });

  it('C07 detail-page/CDN chains keep provenance and stable logical member identity', () => {
    const ledger = createEvidenceLedger();
    const memberRef = 'member-oracle-c07-01';
    const detail = unwrapOrThrow(
      ledger.append(
        evidenceRaw({
          evidenceId: 'evidence-oracle-c07-detail',
          claimType: 'RESOURCE_IDENTITY',
          claimSubject: { kind: 'MEMBER', ref: memberRef },
          sourceType: 'SUPPORTED_TEMPLATE',
          provenance: { sourceIdentity: 'template/gallery-v1/detail-page' },
        }),
      ),
    );
    const cdn = unwrapOrThrow(
      ledger.append(
        evidenceRaw({
          evidenceId: 'evidence-oracle-c07-cdn',
          claimType: 'TRANSFER',
          claimSubject: { kind: 'MEMBER', ref: memberRef },
          provenance: {
            sourceIdentity: 'cdn/media-delivery',
            executionContext: {
              toolsUsed: ['locator-transition:detail-page->cdn'],
              budgetRefs: [],
            },
          },
        }),
      ),
    );
    const { registry } = passingRegistry([memberRef], ['transfer'], 'c07');
    // queries by subject return exactly the provenance-bound chain
    expect(ledger.query({ subject: { kind: 'MEMBER', ref: memberRef } })).toHaveLength(2);
    expect(detail.claimSubject.ref).toBe(memberRef);
    expect(cdn.provenance.sourceIdentity).toBe('cdn/media-delivery');
    // projection validates the logical member identity, not a locator
    const outcomes = requiredValidationOutcomes([mid(memberRef)], registry, ['transfer']);
    expect(outcomes[0]?.result).toBe('VALIDATED');
  });

  it('C08 page-range 1..3 closes on the requested scope; later load-more needs a successor identity', () => {
    const requested = members(unique('c08', 3), 3);
    const facts = collectionFacts({
      contractId: t007Contract('contract-oracle-c08'),
      scopeKind: 'collection_page_range',
      requestedMemberIds: requested,
      snapshotId: t007Snapshot('snapshot-oracle-c08-pages-1-3'),
      enumeration: { kind: 'USER_SCOPE_REACHED' },
    });
    const store = createTerminalResultStore();
    const first = store.project(facts);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.result.requestFulfillment).toBe('COMPLETE');
      expect(first.value.result.coverage).toBe('VERIFIED_COMPLETE');
      expect(first.value.result.stopReason).toBe('USER_SCOPE_REACHED');
    }
    // a later load-more expansion against the SAME snapshot cannot rewrite
    // terminal truth — a successor snapshot identity is required
    const lateExpansion = store.project({
      ...facts,
      requestedMemberIds: members(unique('c08-more', 5), 5),
    });
    expect(lateExpansion.ok).toBe(true);
    if (lateExpansion.ok) {
      expect(lateExpansion.value.result).toEqual(first.ok ? first.value.result : undefined);
    }
    // with a successor snapshot the new scope is a new lineage
    const successorMembers = members(unique('c08-succ', 5), 5);
    const successor = store.project({
      ...facts,
      snapshotId: t007Snapshot('snapshot-oracle-c08-pages-1-5'),
      requestedMemberIds: successorMembers,
      accounting: accountingOf({ requestedMemberIds: successorMembers }),
      coverageBasis: {
        kind: 'SUFFICIENT',
        basis: {
          basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
          identities: successorMembers,
        },
      },
      acceptedSelectedMemberIds: successorMembers,
      memberValidation: successorMembers.map((memberId) => ({
        memberId,
        result: 'VALIDATED' as const,
      })),
    });
    expect(successor.ok).toBe(true);
  });

  it('C09 original-vs-thumbnail both technically valid: no semantic PASS without typed evidence', () => {
    const { ledger, registry } = passingRegistry(
      ['member-oracle-c09-original', 'member-oracle-c09-thumbnail'],
      ['transfer', 'format', 'media'],
      'c09',
    );
    // the user's quality choice cannot type the original claim as verified
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c09-confirm',
      claimType: 'SELECTION',
      memberRef: 'member-oracle-c09-original',
      sourceType: 'USER_CONFIRMATION',
      certaintyClass: 'PROBATIVE',
    });
    const qualityClaim = registry.register(
      validationRaw({
        validationId: 'validation-oracle-c09-quality',
        layer: 'media',
        claimType: 'QUALITY',
        confirmationType: 'CONFIRM_QUALITY_CHOICE',
        evidenceRefs: ['evidence-oracle-c09-confirm'],
      }),
    );
    expect(qualityClaim.ok).toBe(false);
    // both files pass technical layers, but no QUALITY PASS exists anywhere
    const qualitySatisfied = registry.satisfies({
      layer: 'media',
      subject: { kind: 'MEMBER', ref: 'member-oracle-c09-original' },
    });
    // media PASS exists only from the independent validator, never from the
    // user's quality choice
    expect(qualitySatisfied.ok).toBe(true);
    expect(qualitySatisfied.ok ? qualitySatisfied.value.claimType : undefined).not.toBe('QUALITY');
  });
});

describe('T007 counterexample oracles C10–C18 (projection/behavior level)', () => {
  it('C10 whole-collection 18/auth-16 projects the exact §17.2 tuple with 16/18 accounting', () => {
    const ledger = createEvidenceLedger();
    const requested = members(unique('c10', 18), 18);
    const accessible = requested.slice(0, 16);
    const inaccessible = requested.slice(16);
    inaccessible.forEach((memberRef, index) => {
      appendMemberEvidence(ledger, {
        evidenceId: `evidence-oracle-c10-inacc-${index + 1}`,
        claimType: 'AUTHORIZATION',
        memberRef,
        sourceIdentity: `auth-broker/c10-classification-${index + 1}`,
      });
    });
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c10'),
        requestedMemberIds: requested,
        accounting: accountingOf(
          {
            requestedMemberIds: requested,
            resolvedMemberIds: requested,
            authAccessibleMemberIds: accessible,
            authInaccessibleMembers: inaccessible.map((memberId, index) => ({
              memberId,
              classificationEvidenceId: `evidence-oracle-c10-inacc-${index + 1}`,
            })),
            selectedMemberIds: accessible,
            validatedMemberIds: accessible,
          },
          ledger,
        ),
        acceptedSelectedMemberIds: accessible,
        memberValidation: accessible.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        authorizationLimited: true,
        stopFacts: { authRequired: true },
      }),
    );
    expect(result.result.requestFulfillment).toBe('PARTIAL');
    expect(result.result.targetResolution).toBe('RESOLVED');
    expect(result.result.selectionAcquisition).toBe('COMPLETE');
    expect(result.result.coverage).toBe('VERIFIED_COMPLETE');
    expect(result.result.stopReason).toBe('AUTH_REQUIRED');
    expect(result.accounting?.counts).toEqual({
      requested: 18,
      accounted: 18,
      authAccessible: 16,
      authInaccessible: 2,
      selected: 16,
      validated: 16,
    });
    expect(result.explanation).toContain('16 of 18 requested members were acquired and validated');
  });

  it('C11 accounting against a changed collection fails closed without a successor snapshot', () => {
    const ledger = createEvidenceLedger();
    const previewed = members(unique('c11-preview', 3), 3);
    const changed = [previewed[0]!, previewed[1]!, mid('member-oracle-c11-newcomer')];
    // accounting against the changed members under the previewed reference set
    const rejected = buildCoverageAccounting(
      {
        coverageTarget: t007CoverageTarget(
          'entire_supported_collection:collection/t007-gallery-001',
        ),
        requestedMemberIds: previewed,
        resolvedMemberIds: changed,
        authAccessibleMemberIds: changed,
        authInaccessibleMembers: [],
        selectedMemberIds: changed,
        validatedMemberIds: changed,
      },
      ledger,
    );
    // the newcomer is outside the immutable previewed requested scope
    expect(rejected.ok).toBe(false);
    // a successor snapshot identity admits the refreshed membership as a new lineage
    const successor = accountingOf({
      requestedMemberIds: changed,
      coverageTarget: t007CoverageTarget(
        'entire_supported_collection:collection/t007-gallery-001',
        2,
      ),
    });
    expect(successor.coverageTarget.snapshotVersion).toBe(2);
  });

  it('C12 retry operates only on original failed member identities; replacements reject', () => {
    const ledger = createEvidenceLedger();
    const requested = members(unique('c12', 3), 3);
    const outsider = mid('member-oracle-c12-replacement');
    const rejected = buildCoverageAccounting(
      {
        coverageTarget: t007CoverageTarget('explicit_member_set:collection/t007-gallery-001'),
        requestedMemberIds: requested,
        resolvedMemberIds: requested,
        authAccessibleMemberIds: requested,
        authInaccessibleMembers: [],
        selectedMemberIds: [...requested, outsider],
        validatedMemberIds: [...requested, outsider],
      },
      ledger,
    );
    // a retry cannot introduce a new/replacement member into accounting
    expectCode(rejected, 'SCOPE_MUTATION');
  });

  it('C13 budget-stop facts project budget stop reasons; nothing can project replenishment', () => {
    const requested = members(unique('c13', 4), 4);
    const done = requested.slice(0, 2);
    const facts = collectionFacts({
      contractId: t007Contract('contract-oracle-c13'),
      requestedMemberIds: requested,
      accounting: accountingOf({
        requestedMemberIds: requested,
        selectedMemberIds: requested,
        validatedMemberIds: done,
        resolvedMemberIds: done,
        authAccessibleMemberIds: done,
      }),
      coverageBasis: undefined,
      acceptedSelectedMemberIds: done,
      memberValidation: [
        ...done.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        ...requested.slice(2).map((memberId) => ({ memberId, result: 'NOT_VALIDATED' as const })),
      ],
      enumeration: { kind: 'TRUNCATED', by: 'TRANSFER_BUDGET' },
    });
    const first = expectProjected(facts).result;
    expect(first.stopReason).toBe('TRANSFER_BUDGET_EXHAUSTED');
    expect(first.selectionAcquisition).toBe('PARTIAL');
    expect(first.requestFulfillment).not.toBe('COMPLETE');
    // deterministic re-projection: no restart path changes the truth
    expect(expectProjected(facts).result).toEqual(first);
  });

  it('C14 all discovered targets succeed while enumeration unfinished: Request PARTIAL, Coverage never VERIFIED_COMPLETE', () => {
    const requested = members(unique('c14', 10), 10);
    const discovered = requested.slice(0, 4);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c14'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: discovered,
          validatedMemberIds: discovered,
          resolvedMemberIds: discovered,
          authAccessibleMemberIds: discovered,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: discovered,
        memberValidation: discovered.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
      }),
    ).result;
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.requestFulfillment === 'PARTIAL' || result.requestFulfillment === 'UNKNOWN').toBe(
      true,
    );
    expect(result.coverage).not.toBe('VERIFIED_COMPLETE');
  });

  it('C15 DASH/separate-A-V needing unsupported mux emits UNSUPPORTED/FAILED, never video-only success', () => {
    const target = mid('member-oracle-c15-video-only');
    const result = expectProjected({
      contractId: t007Contract('contract-oracle-c15'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [target],
      acceptedSelectedMemberIds: [target],
      memberValidation: [{ memberId: target, result: 'VALIDATION_FAILED' as const }],
      enumeration: { kind: 'NOT_APPLICABLE' },
      stopFacts: { unsupported: true },
    }).result;
    expect(result.stopReason).toBe('UNSUPPORTED');
    expect(
      result.selectionAcquisition === 'FAILED' || result.selectionAcquisition === 'NOT_STARTED',
    ).toBe(true);
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });

  it('C16 direct single-resource projection needs no collection accounting; coverage NOT_APPLICABLE', () => {
    const target = mid('member-oracle-c16-simple');
    const result = expectProjected({
      contractId: t007Contract('contract-oracle-c16'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [target],
      acceptedSelectedMemberIds: [target],
      memberValidation: [{ memberId: target, result: 'VALIDATED' as const }],
      enumeration: { kind: 'NOT_APPLICABLE' },
    }).result;
    expect(result.coverage).toBe('NOT_APPLICABLE');
    expect(result.requestFulfillment).toBe('COMPLETE');
    expect(result.stopReason).toBe('NONE');
  });

  it('C17 batch succeeds but untested pagination stays unproven in the ValidationSummary', () => {
    const requested = members(unique('c17', 6), 6);
    const batch = requested.slice(0, 3);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c17'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: batch,
          validatedMemberIds: batch,
          resolvedMemberIds: batch,
          authAccessibleMemberIds: batch,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: batch,
        memberValidation: batch.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
      }),
    ).result;
    // the accounted batch is a verified subset; the continuation is unproven
    expect(result.coverage).toBe('VERIFIED_SUBSET');
    expect(result.coverage).not.toBe('VERIFIED_COMPLETE');
    expect(result.validationSummary.passedCount).toBe(3);
    expect(result.requestFulfillment).not.toBe('COMPLETE');
  });

  it('C18 identical bytes/names never collapse distinct members', () => {
    const chapterOne = mid('member-oracle-c18-chapter-1');
    const chapterTwo = mid('member-oracle-c18-chapter-2');
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c18'),
        requestedMemberIds: [chapterOne, chapterTwo],
        accounting: accountingOf({
          requestedMemberIds: [chapterOne, chapterTwo],
          selectedMemberIds: [chapterOne, chapterTwo],
          validatedMemberIds: [chapterOne, chapterTwo],
        }),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: [chapterOne, chapterTwo],
          },
        },
        memberValidation: [
          { memberId: chapterOne, result: 'VALIDATED' as const },
          { memberId: chapterTwo, result: 'VALIDATED' as const },
        ],
      }),
    ).result;
    expect(result.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 2,
      failedCount: 0,
    });
    expect(result.requestFulfillment).toBe('COMPLETE');
  });
});

describe('T007 counterexample oracles C19–C27 (projection/behavior level)', () => {
  it('C19 AI and non-AI evidence face identical independence rules', () => {
    for (const toolsUsed of [['model/llm-agent'], undefined]) {
      const ledger = createEvidenceLedger();
      const registry = createValidationRegistry(ledger);
      const raw = evidenceRaw({
        evidenceId:
          toolsUsed === undefined ? 'evidence-oracle-c19-nonai' : 'evidence-oracle-c19-ai',
        claimType: 'RESOURCE_IDENTITY',
        claimSubject: { kind: 'MEMBER', ref: 'member-oracle-c19-01' },
        sourceType: 'DISCOVERY_INFERENCE',
        independenceFromDiscovery: 'DISCOVERY_DERIVED',
        certaintyClass: 'DECISIVE',
        provenance: {
          sourceIdentity: 'discovery/agent-c19',
          executionContext: toolsUsed === undefined ? undefined : { toolsUsed, budgetRefs: [] },
        },
      });
      unwrapOrThrow(ledger.append(raw));
      // regardless of AI or non-AI execution context, discovery-derived
      // evidence can never be the validation oracle for its own claim
      const rejected = registry.register(
        validationRaw({
          validationId:
            toolsUsed === undefined ? 'validation-oracle-c19-nonai' : 'validation-oracle-c19-ai',
          layer: 'target',
          claimType: 'RESOURCE_IDENTITY',
          subject: { kind: 'MEMBER', ref: 'member-oracle-c19-01' },
          evidenceRefs: [
            toolsUsed === undefined ? 'evidence-oracle-c19-nonai' : 'evidence-oracle-c19-ai',
          ],
        }),
      );
      expect(rejected.ok).toBe(false);
    }
  });

  it('C20 reusable knowledge cannot satisfy current-scope claims without current validated binding', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c20-recipe',
      claimType: 'MEMBERSHIP',
      memberRef: 'member-oracle-c20-01',
      snapshotRef: 'snapshot-oracle-c20-old',
      sourceIdentity: 'recipe/promoted-gallery-v1',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c20-old-binding',
          layer: 'membership',
          subject: { kind: 'MEMBER', ref: 'member-oracle-c20-01' },
          snapshotRef: 'snapshot-oracle-c20-old',
          evidenceRefs: ['evidence-oracle-c20-recipe'],
          validatorIdentity: 'validator/recipe-c20',
        }),
      ),
    );
    // the same record cannot satisfy the CURRENT page's membership claim
    const current = registry.satisfies({
      layer: 'membership',
      subject: { kind: 'MEMBER', ref: 'member-oracle-c20-01' },
      snapshotRef: 'snapshot-oracle-c20-current',
    });
    expectCode(current, 'VALIDATION_CLAIM_BINDING_MISMATCH');
  });

  it('C21 no raw credential/private data enters evidence records; opaque refs only', () => {
    const ledger = createEvidenceLedger();
    const rejected = ledger.append(
      evidenceRaw({
        provenance: {
          sourceIdentity: 'broker/c21',
          executionContext: { authorizationContextRef: 'authctx/oracle-c21' },
          cookie: 'session=must-not-enter',
        },
      }),
    );
    expect(rejected.ok).toBe(false);
    const admitted = unwrapOrThrow(
      ledger.append(
        evidenceRaw({
          evidenceId: 'evidence-oracle-c21-clean',
          provenance: {
            sourceIdentity: 'broker/c21',
            executionContext: {
              toolsUsed: [],
              budgetRefs: [],
              authorizationContextRef: 'authctx/oracle-c21',
            },
          },
        }),
      ),
    );
    const serialized = JSON.stringify(admitted);
    expect(serialized.includes('session=')).toBe(false);
    expect(serialized).toContain('authctx/oracle-c21');
  });

  it('C22 insufficient evidence projects INSUFFICIENT_EVIDENCE with no post-hoc conversion', () => {
    const requested = members(unique('c22', 2), 2);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c22'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: requested,
          validatedMemberIds: [requested[0]!],
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: [requested[0]!],
        memberValidation: [
          { memberId: requested[0]!, result: 'VALIDATED' as const },
          { memberId: requested[1]!, result: 'NOT_VALIDATED' as const },
        ],
      }),
    ).result;
    expect(result.validationSummary.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.selectionAcquisition).not.toBe('COMPLETE');
  });

  it('C23 page-3 undiscovered due discovery budget projects the exact truncated tuple', () => {
    const requested = members(unique('c23', 18), 18);
    const got = requested.slice(0, 12);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c23'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: got,
          validatedMemberIds: got,
          resolvedMemberIds: got,
          authAccessibleMemberIds: got,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: got,
        memberValidation: got.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        enumeration: { kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' },
      }),
    ).result;
    expect(result.requestFulfillment).toBe('PARTIAL');
    expect(result.targetResolution).toBe('PARTIAL');
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.coverage).toBe('TRUNCATED');
    expect(result.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
  });

  it('C24 auth failure yielding no targets projects the exact blocked tuple', () => {
    for (const reason of ['AUTH_REQUIRED', 'AUTH_FAILED'] as const) {
      const requested = members(unique('c24', 5), 5);
      const result = expectProjected(
        collectionFacts({
          contractId: t007Contract('contract-oracle-c24'),
          requestedMemberIds: requested,
          accounting: undefined,
          coverageBasis: undefined,
          acceptedSelectedMemberIds: [],
          memberValidation: [],
          enumeration: { kind: 'INCOMPLETE_UNKNOWN', reason: 'NOT_EXERCISED' },
          resolution: { blockedBeforeAnyResolution: { reason } },
        }),
      ).result;
      expect(result.requestFulfillment).toBe('UNSATISFIED');
      expect(result.targetResolution).toBe('BLOCKED');
      expect(result.selectionAcquisition).toBe('NOT_STARTED');
      expect(result.coverage).toBe('UNKNOWN');
      expect(result.stopReason).toBe(reason);
    }
  });

  it('C25 requested pages 1-3 verify complete for the requested scope only; parent claim impossible', () => {
    const pagesOneToThree = members(unique('c25-pages', 9), 9);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c25'),
        scopeKind: 'collection_page_range',
        requestedMemberIds: pagesOneToThree,
        accounting: accountingOf({
          requestedMemberIds: pagesOneToThree,
          parentCollectionCoverage: {
            collectionIdentity: t007CollectionId(T007_COLLECTION),
            status: 'VERIFIED_SUBSET',
          },
        }),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: {
            basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST',
            identities: pagesOneToThree,
          },
        },
        memberValidation: pagesOneToThree.map((memberId) => ({
          memberId,
          result: 'VALIDATED' as const,
        })),
        enumeration: { kind: 'USER_SCOPE_REACHED' },
      }),
    );
    expect(result.result.coverage).toBe('VERIFIED_COMPLETE');
    expect(result.result.requestFulfillment).toBe('COMPLETE');
    expect(result.result.stopReason).toBe('USER_SCOPE_REACHED');
    // the parent's remaining members are outside the reference set entirely
    expect(result.accounting?.requested).toHaveLength(9);
    expect(result.accounting?.requested).toEqual([...pagesOneToThree].sort());
  });

  it('C26 confirmation proves the shown claim only; QUALITY stays independently unverified', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c26-confirm',
      claimType: 'SELECTION',
      memberRef: 'member-oracle-c26-01',
      sourceType: 'USER_CONFIRMATION',
      certaintyClass: 'PROBATIVE',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c26-selection',
          layer: 'target',
          claimType: 'RESOURCE_IDENTITY',
          subject: { kind: 'MEMBER', ref: 'member-oracle-c26-01' },
          evidenceRefs: ['evidence-oracle-c26-confirm'],
          validatorIdentity: 'user/confirmation-c26',
        }),
      ),
    );
    // what did the confirmation prove? selection/identity only — never QUALITY
    const required = requiredValidationOutcomes([mid('member-oracle-c26-01')], registry, [
      'target',
      'transfer',
      'format',
      'media',
    ]);
    const transferOutcome = required.find((outcome) => outcome.memberId === 'member-oracle-c26-01');
    // missing transfer/format/media layers -> the member is not validated
    expect(transferOutcome?.result).not.toBe('VALIDATED');
  });

  it('C27 confirmed candidate with truncated transfer cannot reach acquisition COMPLETE', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    const memberRef = 'member-oracle-c27-01';
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c27-confirm',
      claimType: 'RESOURCE_IDENTITY',
      memberRef,
      sourceType: 'USER_CONFIRMATION',
      certaintyClass: 'PROBATIVE',
      sourceIdentity: 'user/confirm-c27',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c27-target',
          layer: 'target',
          claimType: 'RESOURCE_IDENTITY',
          subject: { kind: 'MEMBER', ref: memberRef },
          evidenceRefs: ['evidence-oracle-c27-confirm'],
          validatorIdentity: 'user/confirm-c27',
        }),
      ),
    );
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c27-truncated',
      claimType: 'TRANSFER',
      memberRef,
      sourceIdentity: 'validator/transfer-c27',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c27-transfer-fail',
          layer: 'transfer',
          outcome: 'FAIL',
          subject: { kind: 'MEMBER', ref: memberRef },
          evidenceRefs: ['evidence-oracle-c27-truncated'],
          validatorIdentity: 'validator/transfer-c27',
        }),
      ),
    );
    const outcomes = requiredValidationOutcomes([mid(memberRef)], registry, ['target', 'transfer']);
    expect(outcomes[0]?.result).toBe('VALIDATION_FAILED');
    const result = expectProjected({
      contractId: t007Contract('contract-oracle-c27'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [mid(memberRef)],
      acceptedSelectedMemberIds: [mid(memberRef)],
      memberValidation: outcomes,
      enumeration: { kind: 'NOT_APPLICABLE' },
    }).result;
    expect(result.selectionAcquisition).toBe('FAILED');
    expect(result.stopReason).toBe('VALIDATION_FAILED');
    expect(result.selectionAcquisition).not.toBe('COMPLETE');
  });
});

describe('T007 counterexample oracles C28–C34 (projection/behavior level)', () => {
  it('C28 discovery-budget exhaustion does not block the frozen HLS target while transfer budgets remain', () => {
    const requested = members(unique('c28', 6), 6);
    const frozen = requested.slice(0, 2);
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c28'),
        requestedMemberIds: requested,
        accounting: accountingOf({
          requestedMemberIds: requested,
          selectedMemberIds: frozen,
          validatedMemberIds: frozen,
          resolvedMemberIds: frozen,
          authAccessibleMemberIds: frozen,
        }),
        coverageBasis: undefined,
        acceptedSelectedMemberIds: frozen,
        memberValidation: frozen.map((memberId) => ({ memberId, result: 'VALIDATED' as const })),
        enumeration: { kind: 'TRUNCATED', by: 'DISCOVERY_BUDGET' },
      }),
    ).result;
    // discovery stopped; the frozen selected targets still completed
    expect(result.stopReason).toBe('DISCOVERY_BUDGET_EXHAUSTED');
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.coverage).toBe('TRUNCATED');
    expect(result.requestFulfillment).toBe('PARTIAL');
  });

  it('C29 declared-CDN redirect keeps the logical target; unrelated redirect fails target validation', () => {
    const memberRef = 'member-oracle-c29-01';
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c29-page',
      claimType: 'RESOURCE_IDENTITY',
      memberRef,
      sourceIdentity: 'page/current-attachment',
    });
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c29-cdn',
      claimType: 'TRANSFER',
      memberRef,
      sourceIdentity: 'cdn/declared-delivery',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c29-target',
          layer: 'target',
          claimType: 'RESOURCE_IDENTITY',
          subject: { kind: 'MEMBER', ref: memberRef },
          evidenceRefs: ['evidence-oracle-c29-page', 'evidence-oracle-c29-cdn'],
          validatorIdentity: 'validator/c29',
        }),
      ),
    );
    // provenance-bound chain satisfies the logical target claim
    expect(
      registry.satisfies({ layer: 'target', subject: { kind: 'MEMBER', ref: memberRef } }).ok,
    ).toBe(true);
    // the same evidence cannot validate a DIFFERENT (unrelated) target
    expectCode(
      registry.satisfies({
        layer: 'target',
        subject: { kind: 'MEMBER', ref: 'member-oracle-c29-unrelated' },
      }),
      'INSUFFICIENT_EVIDENCE',
    );
  });

  it('C30 batch selection binds the whole selected set; no per-item authority objects required', () => {
    const ledger = createEvidenceLedger();
    const selected = members(unique('c30', 3), 3);
    // ONE batch selection claim for the whole selected set
    unwrapOrThrow(
      ledger.append(
        evidenceRaw({
          evidenceId: 'evidence-oracle-c30-batch-selection',
          claimType: 'SELECTION',
          claimSubject: { kind: 'MEMBER', ref: selected[0] as string },
          sourceType: 'USER_CONFIRMATION',
          certaintyClass: 'PROBATIVE',
          provenance: { sourceIdentity: 'user/batch-selection-c30' },
        }),
      ),
    );
    const { registry } = passingRegistry([...selected], ['transfer', 'format'], 'c30');
    const outcomes = requiredValidationOutcomes(selected, registry, ['transfer', 'format']);
    expect(outcomes.every((outcome) => outcome.result === 'VALIDATED')).toBe(true);
    // projection derives member outcomes from required-layer records only —
    // no per-item authority objects exist or are needed
    const result = expectProjected(
      collectionFacts({
        contractId: t007Contract('contract-oracle-c30'),
        scopeKind: 'selected_collection_members',
        snapshotId: undefined,
        requestedMemberIds: selected,
        accounting: accountingOf({ requestedMemberIds: selected }),
        coverageBasis: {
          kind: 'SUFFICIENT',
          basis: { basis: 'AUTHORITATIVE_MEMBER_IDENTITY_LIST', identities: selected },
        },
        validationRegistry: registry,
        requiredLayers: ['transfer', 'format'],
        memberValidation: undefined,
        enumeration: { kind: 'USER_SELECTION_COMPLETE' },
      }),
    ).result;
    expect(result.selectionAcquisition).toBe('COMPLETE');
    expect(result.validationSummary).toEqual({
      status: 'ALL_PASSED',
      passedCount: 3,
      failedCount: 0,
    });
  });

  it('C31 task-local selection evidence cannot satisfy membership claims on another task', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c31-task-selection',
      claimType: 'MEMBERSHIP',
      memberRef: 'member-oracle-c31-01',
      contractRef: 'contract-oracle-c31-task-a',
      sourceIdentity: 'user/task-a-selection',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c31-membership',
          layer: 'membership',
          subject: { kind: 'MEMBER', ref: 'member-oracle-c31-01' },
          contractRef: 'contract-oracle-c31-task-a',
          evidenceRefs: ['evidence-oracle-c31-task-selection'],
          validatorIdentity: 'user/task-a',
        }),
      ),
    );
    // reuse on a different task/contract rejects
    expectCode(
      registry.satisfies({
        layer: 'membership',
        subject: { kind: 'MEMBER', ref: 'member-oracle-c31-01' },
        contractRef: 'contract-oracle-c31-task-b',
      }),
      'VALIDATION_CLAIM_BINDING_MISMATCH',
    );
  });

  it('C32 FAILED/ABANDONED/UNKNOWN/OUT_OF_SCOPE keep distinct classifications — no success collapse', () => {
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'CONFIRMED'])).toBe('CONFIRMED');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'FAILED'])).toBe('FAILED');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'ABANDONED'])).toBe('ABANDONED');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(aggregateConfirmationOutcomes(['CONFIRMED', 'OUT_OF_SCOPE'])).toBe('OUT_OF_SCOPE');
    // and a FAILED member outcome can never project acquisition success
    const target = mid('member-oracle-c32-failed');
    const result = expectProjected({
      contractId: t007Contract('contract-oracle-c32'),
      intentType: 'SINGLE_RESOURCE',
      scopeKind: 'single_resource',
      recordedAt: T007_RECORDED_AT,
      requestedMemberIds: [target],
      acceptedSelectedMemberIds: [target],
      memberValidation: [{ memberId: target, result: 'VALIDATION_FAILED' as const }],
      enumeration: { kind: 'NOT_APPLICABLE' },
    }).result;
    expect(result.selectionAcquisition).toBe('FAILED');
    expect(result.validationSummary.status).toBe('FAILED');
  });

  it('C33 baseline/protocol change invalidates prior evidence binding before projection', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c33',
      claimType: 'TRANSFER',
      memberRef: 'member-oracle-c33-01',
    });
    unwrapOrThrow(
      registry.register(
        validationRaw({
          validationId: 'validation-oracle-c33-v1',
          subject: { kind: 'MEMBER', ref: 'member-oracle-c33-01' },
          evidenceRefs: ['evidence-oracle-c33'],
          baselineRef: { baselineId: 'baseline-oracle-c33', version: 1 },
        }),
      ),
    );
    const claim = {
      layer: 'transfer' as const,
      subject: { kind: 'MEMBER' as const, ref: 'member-oracle-c33-01' },
    };
    // the baseline-bound record never satisfies an unbound claim
    expect(registry.satisfies(claim).ok).toBe(false);
    expect(
      registry.satisfies({
        ...claim,
        baselineRef: { baselineId: 'baseline-oracle-c33', version: 1 },
      }).ok,
    ).toBe(true);
    // changed baseline: the prior run is invalid; a new independent run is required
    const invalidated = registry.satisfies({
      ...claim,
      baselineRef: { baselineId: 'baseline-oracle-c33', version: 2 },
    });
    expectCode(invalidated, 'BASELINE_IDENTITY_CHANGED', 'C33');
  });

  it('C34 UI suggestion typed as ground truth is rejected as the sole oracle', () => {
    const ledger = createEvidenceLedger();
    const registry = createValidationRegistry(ledger);
    // typing a suggestion as independent truth fails at ledger admission
    expect(
      ledger.append(
        evidenceRaw({
          evidenceId: 'evidence-oracle-c34-suggestion',
          claimType: 'RESOURCE_IDENTITY',
          claimSubject: { kind: 'MEMBER', ref: 'member-oracle-c34-01' },
          sourceType: 'UI_SUGGESTION',
          independenceFromDiscovery: 'INDEPENDENT',
        }),
      ).ok,
    ).toBe(false);
    // and suggestion provenance can never oracle a required validation layer
    appendMemberEvidence(ledger, {
      evidenceId: 'evidence-oracle-c34-typed',
      claimType: 'RESOURCE_IDENTITY',
      memberRef: 'member-oracle-c34-01',
      sourceType: 'UI_SUGGESTION',
      independence: 'DISCOVERY_DERIVED',
    });
    const rejected = registry.register(
      validationRaw({
        validationId: 'validation-oracle-c34',
        layer: 'target',
        claimType: 'RESOURCE_IDENTITY',
        subject: { kind: 'MEMBER', ref: 'member-oracle-c34-01' },
        evidenceRefs: ['evidence-oracle-c34-typed'],
      }),
    );
    expect(rejected.ok).toBe(false);
  });
});
