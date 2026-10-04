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
import {
  createCoreSeamServer,
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

function server() {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
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
    expect(keys).toStrictEqual(['contract', 'lineage', 'schemaIdentity', 'snapshot', 'terminal']);
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
    expect(Object.prototype.hasOwnProperty.call(afterView, 'selectedMemberCount')).toBe(false);
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
    expect(Object.prototype.hasOwnProperty.call(view, 'validatedSuccessCount')).toBe(false);
    expect((view['contract'] as Record<string, unknown>)['requestedScope']).toStrictEqual({
      kind: 'entire_supported_collection',
      collectionIdentity: 'collection/playlist-001',
    });
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
