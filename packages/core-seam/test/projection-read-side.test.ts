/**
 * TEST_MATRIX suite `projection-read-side`:
 * - surfaces read Core-owned projections through the seam; no per-surface
 *   status derivation (frozen L2 §6.7);
 * - the read side returns read-only canonical values; no surface-owned
 *   budget/result state is creatable via commands (frozen Task Pack
 *   forbidden scope);
 * - projection responses are subject to the same envelope version/bounds/
 *   authorization rules as commands.
 */

import { describe, expect, it } from 'vitest';
import { createEvidenceLedger, evidenceRecord } from '@xdownload/domain-contracts';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  EXPECTED_PEER,
  foreignPeer,
  peer,
  rawCollectionContract,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  rawSnapshot,
  rawTerminalResult,
  SEAM_MESSAGE_LIMITS,
  COMMAND_TYPES,
  QUERY_TYPES,
  CORE_SEAM_SCHEMA_ID,
} from './helpers.ts';

function server(journal?: ReturnType<typeof createInMemorySeamJournal>) {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, journal });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function submitSingle(s: ReturnType<typeof server>): void {
  const response = s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
      }),
    ),
  );
  expect(response.outcome).toBe('ACCEPTED');
}

describe('Core-owned projections through the seam', () => {
  it('an authorized surface reads the projection and sees Core-owned canonical status', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    expect(response.outcome).toBe('PROJECTION');
    const view = response.projection as Record<string, unknown>;
    expect((view['contract'] as Record<string, unknown>)['contractId']).toBe('contract-single-001');
    expect((view['contract'] as Record<string, unknown>)['status']).toBe('CONFIRMED');
    expect((view['lineage'] as Record<string, unknown>)['status']).toBe('ACTIVE');
  });

  it('two different surfaces reading the same aggregate get the identical projection (no per-surface derivation)', () => {
    const s = server();
    submitSingle(s);
    const cli = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001', asPeer: peer('CLI') })),
    );
    const desktop = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001', asPeer: peer('DESKTOP_UI') })),
    );
    const browser = s.handleFrame(
      JSON.stringify(
        rawQuery({ aggregateId: 'contract-single-001', asPeer: peer('BROWSER_EXTENSION') }),
      ),
    );
    expect(cli.projection).toStrictEqual(desktop.projection);
    expect(desktop.projection).toStrictEqual(browser.projection);
  });

  it('a query for an unknown aggregate rejects with AGGREGATE_NOT_FOUND, not an empty fabrication', () => {
    const s = server();
    const response = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-nope-001' })));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('AGGREGATE_NOT_FOUND');
  });
});

describe('projections are read-only values', () => {
  it('the projection view is deep-frozen and mutating it never affects Core state', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    const view = response.projection as Record<string, unknown>;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view['contract'] as object)).toBe(true);
    expect(Object.isFrozen(view['lineage'] as object)).toBe(true);
    // Mutation attempts do not propagate (frozen) and a fresh read shows the
    // original truth.
    expect(() => {
      (view['lineage'] as { status: string }).status = 'TERMINAL';
    }).toThrow();
    const fresh = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })));
    expect((fresh.projection as Record<string, unknown>)['lineage']).toStrictEqual(view['lineage']);
  });

  it('the projection exposes status only — no mutable budget/result handles exist on it', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    const view = response.projection as Record<string, unknown>;
    const keys = Object.keys(view).sort();
    // Schema identity + contract/snapshot/lineage/terminal facts only. No
    // budget ledger, no mutation handle, no surface-owned result state.
    expect(keys).toStrictEqual([
      'contract',
      'lineage',
      'requestedMemberCount',
      'schemaIdentity',
      'snapshot',
      'terminal',
    ]);
    expect(keys.some((key) => key.toLowerCase().includes('budget'))).toBe(false);
    const before = JSON.stringify(view);
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
        }),
      ),
    );
    const after = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })));
    expect(JSON.stringify(after.projection)).not.toBe(before);
    expect(
      ((after.projection as Record<string, unknown>)['lineage'] as Record<string, unknown>)[
        'status'
      ],
    ).toBe('CANCELLED');
  });
});

describe('no surface-owned budget/result state is creatable via commands', () => {
  it('the wire command vocabulary is closed and contains no budget/result mutation discriminant', () => {
    expect([...COMMAND_TYPES].sort()).toStrictEqual([
      'CANCEL_LINEAGE',
      'CONFIRM_SNAPSHOT',
      'PROJECT_TERMINAL_RESULT',
      'RETRY_FAILED_MEMBERS',
      'SUBMIT_CONTRACT',
    ]);
    expect([...QUERY_TYPES]).toStrictEqual(['READ_PROJECTION']);
    for (const attempted of [
      'MUTATE_BUDGET',
      'RESET_BUDGET',
      'OWN_RESULT_STATE',
      'FORCE_TERMINAL_SUCCESS',
    ]) {
      expect(COMMAND_TYPES).not.toContain(attempted);
    }
  });

  it('a frame smuggling an unknown budget-mutating discriminant rejects as UNKNOWN_COMMAND_TYPE', () => {
    const s = server();
    submitSingle(s);
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'contract-single-001' });
    raw['commandType'] = 'MUTATE_BUDGET';
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
  });

  it('terminal truth enters lineage state only through the gated PROJECT_TERMINAL_RESULT command', () => {
    const s = server();
    submitSingle(s);
    // An invalid terminal result (vacuous COMPLETE for an empty selection is
    // impossible here; single-resource path needs a legal combination) that
    // fails domain combination validation cannot terminate the lineage.
    const illegal = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'PROJECT_TERMINAL_RESULT',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          payload: {
            result: rawTerminalResult({
              contractId: 'contract-single-001',
              coverage: 'VERIFIED_COMPLETE',
            }),
          },
        }),
      ),
    );
    expect(illegal.outcome).toBe('REJECTED');
    expect(s.inspectProjection('contract-single-001')?.lineage.status).toBe('ACTIVE');
  });
});

describe('queries are subject to the same envelope rules as commands', () => {
  it('a query with an unsupported envelope version rejects', () => {
    const s = server();
    submitSingle(s);
    const raw = rawQuery({ aggregateId: 'contract-single-001' });
    raw['schemaIdentity'] = { schema: CORE_SEAM_SCHEMA_ID, version: '9.0.0' };
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');
  });

  it('an oversized query payload region rejects on declared bounds', () => {
    const s = server();
    submitSingle(s);
    const raw = rawQuery({ aggregateId: 'contract-single-001' });
    raw['bloat'] = 'q'.repeat(SEAM_MESSAGE_LIMITS.maxStringFieldLength + 1);
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    const codes = response.diagnostics?.map((d) => d.code) ?? [];
    expect(codes.some((c) => c === 'STRING_TOO_LONG' || c === 'ENVELOPE_MALFORMED')).toBe(true);
  });

  it('an unauthorized query rejects', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001', asPeer: foreignPeer() })),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
  });

  it('a query with an unknown query discriminant rejects', () => {
    const s = server();
    submitSingle(s);
    const raw = rawQuery({ aggregateId: 'contract-single-001' });
    raw['queryType'] = 'DERIVE_MY_OWN_STATUS';
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNKNOWN_QUERY_TYPE');
  });
});

describe('projection reflects snapshot confirmation state', () => {
  it('after CONFIRM_SNAPSHOT the projection carries the confirmed snapshot identity', () => {
    const s = server();
    const submit = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CONFIRM_SNAPSHOT',
          aggregateId: 'contract-collection-001',
          expectedRevision: 1,
          payload: rawSnapshot(),
        }),
      ),
    );
    expect(confirm.outcome).toBe('ACCEPTED');
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-collection-001' })),
    );
    const view = response.projection as Record<string, unknown>;
    expect(((view['snapshot'] as Record<string, unknown>) ?? {})['snapshotId']).toBe(
      'snapshot-001',
    );
  });
});

describe('additive PRD §27 exposure on the read projection', () => {
  it('requested/continuation scope are projected verbatim from the confirmed contract', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    expect(response.outcome).toBe('PROJECTION');
    const contract = (response.projection as Record<string, unknown>)['contract'] as Record<
      string,
      unknown
    >;
    expect(contract['requestedScope']).toStrictEqual({
      kind: 'single_resource',
      targetId: 'target-file-001',
    });
    expect(contract['continuationScope']).toStrictEqual({ kind: 'NONE' });
    // Read-only canonical values: the projected scope is deep-frozen.
    expect(Object.isFrozen(contract['requestedScope'] as object)).toBe(true);
  });

  it('selected/validated counts have explicit presence: the keys are absent while unknown', () => {
    const s = server();
    submitSingle(s);
    const before = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })));
    const beforeView = before.projection as Record<string, unknown>;
    // No snapshot, no terminal: neither §27 count fact exists yet, and the
    // projection must not carry a placeholder (absent, never null/0).
    expect(beforeView['requestedMemberCount']).toBe(1);
    expect((beforeView['lineage'] as Record<string, unknown>)['failedMemberIds']).toStrictEqual([]);
    expect(Object.prototype.hasOwnProperty.call(beforeView, 'needsUserAction')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(beforeView, 'selectedMemberCount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(beforeView, 'validatedSuccessCount')).toBe(false);

    const terminal = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'PROJECT_TERMINAL_RESULT',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          payload: {
            result: rawTerminalResult(),
            selectedValidationOutcomes: [
              { memberId: 'target-file-001', requiredValidationPassed: true },
            ],
          },
        }),
      ),
    );
    expect(terminal.outcome).toBe('ACCEPTED');
    const after = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })));
    const afterView = after.projection as Record<string, unknown>;
    // Terminal truth exists now: the validated success count is exposed;
    // the selected count is still absent (no snapshot was confirmed).
    expect(afterView['validatedSuccessCount']).toBe(1);
    expect(afterView['needsUserAction']).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(afterView, 'selectedMemberCount')).toBe(false);
  });

  it('authoritative authorization stop requires user action without fabricating success', () => {
    const s = server();
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'PROJECT_TERMINAL_RESULT',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          payload: {
            result: rawTerminalResult({
              requestFulfillment: 'UNSATISFIED',
              targetResolution: 'BLOCKED',
              selectionAcquisition: 'NOT_STARTED',
              stopReason: 'AUTH_FAILED',
              validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
            }),
          },
        }),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
    const view = s.inspectProjection('contract-single-001');
    expect(view?.needsUserAction).toBe(true);
    expect(view?.validatedSuccessCount).toBe(0);
  });

  it('after CONFIRM_SNAPSHOT the selected-member count is exposed as the confirmed cardinality', () => {
    const s = server();
    const submit = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CONFIRM_SNAPSHOT',
          aggregateId: 'contract-collection-001',
          expectedRevision: 1,
          payload: rawSnapshot(),
        }),
      ),
    );
    expect(confirm.outcome).toBe('ACCEPTED');
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-collection-001' })),
    );
    const view = response.projection as Record<string, unknown>;
    expect(view['selectedMemberCount']).toBe(3);
    // An entire collection has no proven requested cardinality at this seam.
    expect(Object.prototype.hasOwnProperty.call(view, 'requestedMemberCount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'needsUserAction')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'validatedSuccessCount')).toBe(false);
    expect((view['contract'] as Record<string, unknown>)['requestedScope']).toStrictEqual({
      kind: 'entire_supported_collection',
      collectionIdentity: 'collection/playlist-001',
    });
  });

  it('Core projects exact failure identities, not a count-derived guess', () => {
    const s = server();
    submitSingle(s);
    const recorded = s.recordFailedMembers('contract-single-001', ['member-001']);
    expect(recorded.ok).toBe(true);
    const response = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })),
    );
    const view = response.projection as Record<string, unknown>;
    const lineage = view['lineage'] as Record<string, unknown>;
    expect(lineage['failedMemberCount']).toBe(1);
    expect(lineage['failedMemberIds']).toStrictEqual(['member-001']);
    expect(Object.isFrozen(lineage['failedMemberIds'] as object)).toBe(true);
  });

  it('unknown collection cardinalities remain absent and do not equal selected count', () => {
    const s = server();
    const accepted = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(accepted.outcome).toBe('ACCEPTED');
    const view = s.inspectProjection('contract-collection-001') as unknown as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(view, 'requestedMemberCount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'needsUserAction')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'resolvedMemberCount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'authAccessibleMemberCount')).toBe(false);
  });

  it('additive fields survive the wire round-trip; unknown facts stay absent on the wire', () => {
    const s = server();
    submitSingle(s);
    const bare = s.handleFrame(JSON.stringify(rawQuery({ aggregateId: 'contract-single-001' })));
    const bareWire = JSON.parse(JSON.stringify(bare)) as { projection: Record<string, unknown> };
    // The scope facts ride the wire verbatim...
    expect(
      (bareWire.projection['contract'] as Record<string, unknown>)['requestedScope'],
    ).toStrictEqual({ kind: 'single_resource', targetId: 'target-file-001' });
    // ...while the unknown count facts produce no wire bytes at all.
    expect(bareWire.projection['requestedMemberCount']).toBe(1);
    expect(JSON.stringify(bareWire.projection)).not.toContain('needsUserAction');
    expect(JSON.stringify(bareWire.projection)).not.toContain('selectedMemberCount');
    expect(JSON.stringify(bareWire.projection)).not.toContain('validatedSuccessCount');

    const confirm = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(confirm.outcome).toBe('ACCEPTED');
    const snapshot = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CONFIRM_SNAPSHOT',
          aggregateId: 'contract-collection-001',
          expectedRevision: 1,
          payload: rawSnapshot(),
        }),
      ),
    );
    expect(snapshot.outcome).toBe('ACCEPTED');
    const confirmed = s.handleFrame(
      JSON.stringify(rawQuery({ aggregateId: 'contract-collection-001' })),
    );
    const confirmedWire = JSON.parse(JSON.stringify(confirmed)) as {
      projection: Record<string, unknown>;
    };
    // Wire round-trip: the additive presence facts arrive intact.
    expect(confirmedWire.projection['selectedMemberCount']).toBe(3);
  });
});

describe('unsnapshotted single-resource receipt binding', () => {
  it('rejects identities that are not the immutable contract target', () => {
    const s = server(createInMemorySeamJournal());
    submitSingle(s);
    const accounting = {
      authorizationContextRef: 'authctx/local-001',
      coverageTarget: {
        scopeKind: 'single_resource',
        scopeIdentityKey: 'single_resource:target-file-001',
      },
      requested: ['target-forged-001'],
      authAccessible: ['target-forged-001'],
      authInaccessible: [],
      resolved: ['target-forged-001'],
      selected: ['target-forged-001'],
      validated: ['target-forged-001'],
      accounted: ['target-forged-001'],
      counts: {
        requested: 1,
        accounted: 1,
        authAccessible: 1,
        authInaccessible: 0,
        selected: 1,
        validated: 1,
      },
    };
    const rejected = s.recordCoverageAccounting('contract-single-001', accounting as never);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
    const projection = s.inspectProjection('contract-single-001') as unknown as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(projection, 'resolvedMemberCount')).toBe(false);

    const scoped = server(createInMemorySeamJournal());
    submitSingle(scoped);
    const wrongScope = {
      ...accounting,
      requested: ['target-file-001'],
      authAccessible: ['target-file-001'],
      resolved: ['target-file-001'],
      selected: ['target-file-001'],
      validated: ['target-file-001'],
      accounted: ['target-file-001'],
      coverageTarget: {
        ...accounting.coverageTarget,
        scopeIdentityKey: 'single_resource:target-other-001',
      },
    };
    const scopeRejected = scoped.recordCoverageAccounting(
      'contract-single-001',
      wrongScope as never,
    );
    expect(scopeRejected.ok).toBe(false);
    if (!scopeRejected.ok) expect(scopeRejected.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
  });
});

describe('durable Core CoverageAccounting receipt for PRD §27', () => {
  function accountingFixture() {
    const requested = Array.from(
      { length: 18 },
      (_, index) => `member-${String(index + 1).padStart(3, '0')}`,
    );
    const accessible = requested.slice(0, 16);
    const inaccessible = requested.slice(16);
    const ledger = createEvidenceLedger();
    for (const [index, memberId] of inaccessible.entries()) {
      const admitted = ledger.append(
        evidenceRecord({
          evidenceId: `evidence-auth-${String(index + 1).padStart(3, '0')}` as never,
          claimType: 'AUTHORIZATION',
          claimSubject: { kind: 'MEMBER', ref: memberId },
          sourceType: 'INDEPENDENT_VALIDATOR',
          provenance: {
            sourceIdentity: 'independent-auth-validator-001',
            executionContext: {
              toolsUsed: ['independent-auth-validator'],
              authorizationContextRef: 'authctx/local-001',
              budgetRefs: [],
            },
          },
          independenceFromDiscovery: 'INDEPENDENT',
          scope: {
            domain: 'AUTHORIZATION',
            contractRef: 'contract-collection-001',
            snapshotRef: 'snapshot-001',
          },
          certaintyClass: 'DECISIVE',
        }),
      );
      if (!admitted.ok) throw new Error('invalid independent authorization fixture');
    }
    const coverageTarget = {
      collectionIdentity: 'collection/playlist-001',
      scopeKind: 'entire_supported_collection',
      scopeIdentityKey: 'entire_supported_collection:collection/playlist-001',
      snapshotVersion: 1,
    };
    return {
      requested,
      accessible,
      ledger,
      coverageTarget,
      accounting: {
        coverageTarget,
        authorizationContextRef: 'authctx/local-001',
        requested,
        authAccessible: accessible,
        authInaccessible: inaccessible.map((memberId, index) => ({
          memberId,
          classificationEvidenceId: `evidence-auth-${String(index + 1).padStart(3, '0')}`,
          independentlyAccounted: true,
        })),
        resolved: requested,
        selected: accessible,
        validated: accessible,
        accounted: requested,
        counts: {
          requested: 18,
          accounted: 18,
          authAccessible: 16,
          authInaccessible: 2,
          selected: 16,
          validated: 16,
        },
      },
    };
  }

  function seedAccountingLineage(
    s: ReturnType<typeof server>,
    requested: readonly string[],
    accessible: readonly string[],
    coverageTarget: Record<string, unknown>,
  ): void {
    const submit = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-001',
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(submit.outcome).toBe('ACCEPTED');
    const confirm = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CONFIRM_SNAPSHOT',
          aggregateId: 'contract-collection-001',
          expectedRevision: 1,
          payload: rawSnapshot({
            requestedMemberBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: requested },
            authAccessibleBasis: { kind: 'EXPLICIT_IDENTITIES', memberIds: accessible },
            selectedMemberIds: accessible,
            selectionClaims: [
              {
                kind: 'BATCH',
                confirmationType: 'CONFIRM_SELECTION',
                memberRefs: accessible,
              },
            ],
            coverageTarget,
          }),
        }),
      ),
    );
    expect(confirm.outcome).toBe('ACCEPTED');
  }

  it('publishes 18 requested / 16 accessible / 18 resolved from identity sets, never guessed counts', () => {
    const journal = createInMemorySeamJournal();
    const s = server(journal);
    const fixture = accountingFixture();
    seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);

    const recorded = s.recordCoverageAccounting(
      'contract-collection-001',
      fixture.accounting as never,
      fixture.ledger,
    );
    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.value.converged).toBe(false);

    const view = s.inspectProjection('contract-collection-001') as unknown as Record<
      string,
      unknown
    >;
    expect(view['requestedMemberCount']).toBe(18);
    expect(view['authAccessibleMemberCount']).toBe(16);
    expect(view['resolvedMemberCount']).toBe(18);
    expect(view['selectedMemberCount']).toBe(16);
  });

  it('survives restart on the same Core journal and identical replay converges', () => {
    const journal = createInMemorySeamJournal();
    const fixture = accountingFixture();
    const first = server(journal);
    seedAccountingLineage(first, fixture.requested, fixture.accessible, fixture.coverageTarget);
    const recorded = first.recordCoverageAccounting(
      'contract-collection-001',
      fixture.accounting as never,
      fixture.ledger,
    );
    expect(recorded.ok).toBe(true);

    const restarted = server(journal);
    const view = restarted.inspectProjection('contract-collection-001') as unknown as Record<
      string,
      unknown
    >;
    expect(view['requestedMemberCount']).toBe(18);
    expect(view['authAccessibleMemberCount']).toBe(16);
    expect(view['resolvedMemberCount']).toBe(18);

    const duplicate = restarted.recordCoverageAccounting(
      'contract-collection-001',
      fixture.accounting as never,
      fixture.ledger,
    );
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.value.converged).toBe(true);
  });

  it('fails closed on conflicting, out-of-scope and non-durable accounting publication', () => {
    const fixture = accountingFixture();

    const noJournal = server();
    seedAccountingLineage(noJournal, fixture.requested, fixture.accessible, fixture.coverageTarget);
    const notDurable = noJournal.recordCoverageAccounting(
      'contract-collection-001',
      fixture.accounting as never,
      fixture.ledger,
    );
    expect(notDurable.ok).toBe(false);
    if (!notDurable.ok) {
      expect(notDurable.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
    }

    const journal = createInMemorySeamJournal();
    const s = server(journal);
    seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);
    expect(
      s.recordCoverageAccounting(
        'contract-collection-001',
        fixture.accounting as never,
        fixture.ledger,
      ).ok,
    ).toBe(true);

    const conflict = s.recordCoverageAccounting(
      'contract-collection-001',
      {
        ...fixture.accounting,
        parentCollectionCoverage: {
          collectionIdentity: 'collection/playlist-001',
          status: 'VERIFIED_COMPLETE',
        },
      } as never,
      fixture.ledger,
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.diagnostics[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
    }

    const outside = server(createInMemorySeamJournal());
    seedAccountingLineage(outside, fixture.requested, fixture.accessible, fixture.coverageTarget);
    const escaped = outside.recordCoverageAccounting(
      'contract-collection-001',
      {
        ...fixture.accounting,
        resolved: [...fixture.requested, 'member-999'],
      } as never,
      fixture.ledger,
    );
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.diagnostics[0]?.code).toBe('SCOPE_MUTATION');
  });

  it('rejects unbound or inconsistent coverage accounting receipt claims', () => {
    const fixture = accountingFixture();
    const underAccounted = {
      ...fixture.accounting,
      accounted: fixture.accessible,
      counts: { ...fixture.accounting.counts, accounted: 16 },
    };
    const invalidCases = [
      { ...fixture.accounting, authorizationContextRef: undefined },
      {
        ...fixture.accounting,
        authInaccessible: fixture.accounting.authInaccessible.map((member) => ({
          memberId: member.memberId,
          independentlyAccounted: true,
        })),
      },
      underAccounted,
      { ...fixture.accounting, resolved: fixture.accessible },
    ];
    for (const invalid of invalidCases) {
      const s = server(createInMemorySeamJournal());
      seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);
      const rejected = s.recordCoverageAccounting(
        'contract-collection-001',
        invalid as never,
        fixture.ledger,
      );
      expect(rejected.ok).toBe(false);
      const view = s.inspectProjection('contract-collection-001') as unknown as Record<
        string,
        unknown
      >;
      expect(Object.prototype.hasOwnProperty.call(view, 'resolvedMemberCount')).toBe(false);
    }
  });

  it('returns typed rejection for malformed receipt shapes, not an uncaught exception', () => {
    const fixture = accountingFixture();
    const invalidShapes: readonly unknown[] = [
      null,
      [],
      {},
      { ...fixture.accounting, authInaccessible: null },
      { ...fixture.accounting, authInaccessible: 'not-an-array' },
    ];
    for (const invalid of invalidShapes) {
      const s = server(createInMemorySeamJournal());
      seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);
      expect(() =>
        s.recordCoverageAccounting('contract-collection-001', invalid as never, fixture.ledger),
      ).not.toThrow();
      const rejected = s.recordCoverageAccounting(
        'contract-collection-001',
        invalid as never,
        fixture.ledger,
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('rejects oracle-grade evidence with a mismatched authorization domain or context', () => {
    const fixture = accountingFixture();
    const sourceRecords = fixture.ledger.records();
    const invalidLedgers = [
      {
        ...fixture.ledger,
        records: () =>
          sourceRecords.map((record) => ({
            ...record,
            scope: { ...record.scope, domain: 'COVERAGE' },
          })),
      },
      {
        ...fixture.ledger,
        records: () =>
          sourceRecords.map((record) => ({
            ...record,
            provenance: {
              ...record.provenance,
              executionContext: { authorizationContextRef: 'authctx/foreign-001' },
            },
          })),
      },
    ];
    for (const ledger of invalidLedgers) {
      const s = server(createInMemorySeamJournal());
      seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);
      const rejected = s.recordCoverageAccounting(
        'contract-collection-001',
        fixture.accounting as never,
        ledger as never,
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
      const view = s.inspectProjection('contract-collection-001') as unknown as Record<
        string,
        unknown
      >;
      expect(Object.prototype.hasOwnProperty.call(view, 'resolvedMemberCount')).toBe(false);
    }
  });

  it('does not expose receipt counts if the durable journal append fails', () => {
    const backing = createInMemorySeamJournal();
    const failedJournal = {
      append(entry: Parameters<typeof backing.append>[0]) {
        if (entry.kind === 'COVERAGE_ACCOUNTING') throw new Error('simulated durable write error');
        backing.append(entry);
      },
      replayAll: () => backing.replayAll(),
    };
    const s = server(failedJournal);
    const fixture = accountingFixture();
    seedAccountingLineage(s, fixture.requested, fixture.accessible, fixture.coverageTarget);
    const recorded = s.recordCoverageAccounting(
      'contract-collection-001',
      fixture.accounting as never,
      fixture.ledger,
    );
    expect(recorded.ok).toBe(false);
    const view = s.inspectProjection('contract-collection-001') as unknown as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(view, 'resolvedMemberCount')).toBe(false);
  });
});
