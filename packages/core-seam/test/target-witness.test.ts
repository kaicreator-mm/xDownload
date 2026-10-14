/**
 * #113 Core-private durable S1 target-resolution witness — seam authority
 * gates. The witness is a trusted Core-runtime fact only: journaled BEFORE
 * terminal authority (even on failed digest/no accepted bytes), identical
 * replays converge, conflicting/foreign/forged witnesses reject, the exact
 * ownership binding is enforced (canonical effect identity of the aggregate's
 * own single-resource contract), and restart replay re-establishes the
 * identical witness while a corrupt one fails the composition closed.
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  type SeamResult,
  type TargetWitnessReceipt,
} from '../src/index.ts';
import {
  EXPECTED_PEER,
  rawCollectionContract,
  rawCommand,
  rawSingleResourceContract,
} from './helpers.ts';

const AGGREGATE = 'contract-single-001';

function witnessOf(overrides: Partial<TargetWitnessReceipt> = {}): TargetWitnessReceipt {
  return {
    snapshotId: 's1snap-001',
    memberId: 's1member-001',
    artifactId: 's1artifact-001',
    effectId: `effect:${AGGREGATE}:s1snap-001:target-file-001`,
    locatorUri: 'http://127.0.0.1:9/file.bin',
    declaredRedirectHosts: ['127.0.0.1:9'],
    observedRedirectHosts: ['127.0.0.1:9'],
    status: 'RESOLVED',
    transferAttempted: true,
    basis: 'REQUESTED_LOCATOR_PROVENANCE',
    certaintyClass: 'PROBATIVE',
    ...overrides,
  };
}

function serverWith(journal?: ReturnType<typeof createInMemorySeamJournal>) {
  const result = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    // The seam test exercises a real accepted S1 command before any trusted
    // witness. Its test beginner never starts a transfer.
    s1DirectAcquisition: { begin: () => {} },
    // The witness is a durable fact: absent an explicit journal, the case
    // harness still composes the in-memory journal so the record path itself
    // is exercised; the journal-less composition has its own case below.
    journal: journal ?? createInMemorySeamJournal(),
  });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function submitSingle(s: ReturnType<typeof serverWith>, aggregateId = AGGREGATE): void {
  const response = s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId,
        payload: rawSingleResourceContract({ contractId: aggregateId }),
      }),
    ),
  );
  expect(response.outcome).toBe('ACCEPTED');
  const execution = s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId,
        expectedRevision: 1,
        payload: {
          snapshotId: 's1snap-001',
          memberId: 's1member-001',
          artifactId: 's1artifact-001',
          delivery: {
            locatorUri: 'http://127.0.0.1:9/file.bin',
            declaredRedirectHosts: ['127.0.0.1:9'],
          },
        },
      }),
    ),
  );
  expect(execution.outcome).toBe('ACCEPTED');
}

function rejectCode(result: SeamResult<unknown>): { code: string; path: string } {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('unreachable');
  }
  const first = result.diagnostics[0]!;
  return { code: first.code, path: first.path };
}

describe('#113 target witness — trusted fact path and exact ownership binding', () => {
  it('records the witness durably before terminal authority and exposes it through the Core read port', () => {
    const journal = createInMemorySeamJournal();
    const s = serverWith(journal);
    submitSingle(s);
    const witness = witnessOf();
    const recorded = s.recordTargetWitness(AGGREGATE, witness);
    expect(recorded.ok).toBe(true);
    if (recorded.ok) {
      expect(recorded.value.converged).toBe(false);
    }
    expect(s.targetWitnessFor(AGGREGATE)).toEqual(witness);
    // The journaled entry exists (durability precedes any terminal handover).
    const entries = journal
      .replayAll()
      .filter((entry) => entry.kind === 'TARGET_WITNESS') as readonly {
      kind: 'TARGET_WITNESS';
      aggregateId: string;
      receipt: TargetWitnessReceipt;
    }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.aggregateId).toBe(AGGREGATE);
    expect(entries[0]!.receipt).toEqual(witness);
    // The read port renders nothing for an aggregate without a witness.
    expect(s.targetWitnessFor('contract-unknown')).toBeUndefined();
  });

  it('converges on an identical re-record and rejects a conflicting changed basis', () => {
    const s = serverWith();
    submitSingle(s);
    expect(s.recordTargetWitness(AGGREGATE, witnessOf()).ok).toBe(true);
    const converged = s.recordTargetWitness(AGGREGATE, witnessOf());
    expect(converged.ok).toBe(true);
    if (converged.ok) {
      expect(converged.value.converged).toBe(true);
    }
    const changed = rejectCode(
      s.recordTargetWitness(
        AGGREGATE,
        witnessOf({
          status: 'PROVENANCE_UNPROVEN',
          basis: undefined,
          certaintyClass: undefined,
          unprovenReason: 'REDIRECT_SCOPE_EXPANSION',
        } as unknown as TargetWitnessReceipt),
      ),
    );
    expect(changed.code).toBe('ADMISSION_REJECTED');
    // The recorded fact was never rewritten.
    expect(s.targetWitnessFor(AGGREGATE)?.status).toBe('RESOLVED');
  });

  it('refuses a foreign/forged witness: unknown aggregate, wrong effect identity, wrong contract kind', () => {
    const s = serverWith();
    submitSingle(s);
    const unknown = rejectCode(s.recordTargetWitness('contract-unknown', witnessOf()));
    expect(unknown.code).toBe('AGGREGATE_NOT_FOUND');

    const wrongEffect = rejectCode(
      s.recordTargetWitness(AGGREGATE, witnessOf({ effectId: 'effect:other:snap:t' })),
    );
    expect(wrongEffect.code).toBe('ADMISSION_REJECTED');

    // The canonical composite effect identity must be the aggregate's own:
    // a different snapshot under the same aggregate produces a different
    // canonical effect identity and cannot bind.
    const wrongSnapshot = rejectCode(
      s.recordTargetWitness(AGGREGATE, witnessOf({ snapshotId: 's1snap-002' })),
    );
    expect(wrongSnapshot.code).toBe('ADMISSION_REJECTED');

    const collection = 'contract-collection-001';
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: collection,
          payload: rawCollectionContract(),
        }),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
    const wrongKind = rejectCode(s.recordTargetWitness(collection, witnessOf()));
    expect(wrongKind.code).toBe('ADMISSION_REJECTED');
  });

  it('rejects a coherent foreign witness that changes the accepted S1 member, artifact, snapshot, locator or delivery hosts', () => {
    const s = serverWith();
    submitSingle(s);
    const cases: readonly TargetWitnessReceipt[] = [
      witnessOf({ memberId: 'foreign-member-001' }),
      witnessOf({ artifactId: 'foreign-artifact-001' }),
      witnessOf({
        snapshotId: 'foreign-snapshot-001',
        effectId: `effect:${AGGREGATE}:foreign-snapshot-001:target-file-001`,
      }),
      witnessOf({ locatorUri: 'http://127.0.0.1:9/different.bin' }),
      witnessOf({ declaredRedirectHosts: ['other.example'] }),
      witnessOf({ transferAttempted: false }),
    ];
    for (const [i, witness] of cases.entries()) {
      const result = s.recordTargetWitness(AGGREGATE, witness);
      expect(result.ok, `case ${i}: a witness cannot redefine accepted S1 intent`).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
    }
    expect(s.targetWitnessFor(AGGREGATE)).toBeUndefined();
    expect(s.recordTargetWitness(AGGREGATE, witnessOf()).ok).toBe(true);
  });

  it('strictly decodes the receipt: closed fields, status-conditional basis pairing, bounded graphs', () => {
    const s = serverWith();
    submitSingle(s);
    const cases: readonly { readonly receipt: TargetWitnessReceipt; readonly path: string }[] = [
      {
        receipt: witnessOf({ extra: true } as unknown as TargetWitnessReceipt),
        path: 'targetWitness.extra',
      },
      {
        receipt: witnessOf({ status: 'SOMETHING_ELSE' } as unknown as TargetWitnessReceipt),
        path: 'targetWitness.status',
      },
      {
        receipt: witnessOf({ basis: undefined } as unknown as TargetWitnessReceipt),
        path: 'targetWitness.basis',
      },
      {
        receipt: witnessOf({ certaintyClass: undefined } as unknown as TargetWitnessReceipt),
        path: 'targetWitness.certaintyClass',
      },
      {
        // C34 pairing: a publisher anchor is DECISIVE, never PROBATIVE.
        receipt: witnessOf({ basis: 'PUBLISHED_SHA256', certaintyClass: 'PROBATIVE' }),
        path: 'targetWitness.certaintyClass',
      },
      {
        receipt: witnessOf({ unprovenReason: 'should not be here' }),
        path: 'targetWitness.unprovenReason',
      },
      {
        receipt: witnessOf({ locatorUri: 'ftp://example/file.bin' }),
        path: 'targetWitness.locatorUri',
      },
      {
        receipt: witnessOf({ declaredRedirectHosts: [] }),
        path: 'targetWitness.declaredRedirectHosts',
      },
      {
        receipt: witnessOf({
          declaredRedirectHosts: Array.from({ length: 9 }, (_, index) => `host-${String(index)}`),
        }),
        path: 'targetWitness.declaredRedirectHosts',
      },
      {
        receipt: witnessOf({ observedRedirectHosts: ['host with spaces'] }),
        path: 'targetWitness.observedRedirectHosts',
      },
      {
        receipt: witnessOf({ transferAttempted: 'yes' } as unknown as TargetWitnessReceipt),
        path: 'targetWitness.transferAttempted',
      },
    ];
    for (const [index, item] of cases.entries()) {
      const rejected = s.recordTargetWitness(AGGREGATE, item.receipt);
      expect(rejected.ok, `case ${String(index)}`).toBe(false);
      if (!rejected.ok) {
        expect(rejected.diagnostics[0]?.path, `case ${String(index)}`).toBe(item.path);
      }
    }
    // An unproven witness carries the failure reason and no identity claim.
    const unproven = s.recordTargetWitness(
      AGGREGATE,
      witnessOf({
        status: 'PROVENANCE_UNPROVEN',
        basis: undefined,
        certaintyClass: undefined,
        unprovenReason: 'REDIRECT_SCOPE_EXPANSION',
      } as unknown as TargetWitnessReceipt),
    );
    expect(unproven.ok).toBe(true);
    const reversed = rejectCode(
      s.recordTargetWitness('contract-single-002', witnessOf({ status: 'PROVENANCE_UNPROVEN' })),
    );
    expect(reversed.code).toBe('AGGREGATE_NOT_FOUND');
  });

  it('restart replay re-establishes the identical witness; a conflicting entry fails composition closed', () => {
    const journal = createInMemorySeamJournal();
    const first = serverWith(journal);
    submitSingle(first);
    expect(first.recordTargetWitness(AGGREGATE, witnessOf()).ok).toBe(true);

    const reopened = serverWith(journal);
    expect(reopened.targetWitnessFor(AGGREGATE)).toEqual(witnessOf());

    // A conflicting witness appended to the journal is durable corruption:
    // replay fails closed instead of rewriting the recorded fact.
    journal.append({
      kind: 'TARGET_WITNESS',
      aggregateId: AGGREGATE,
      receipt: witnessOf({
        status: 'PROVENANCE_UNPROVEN',
        basis: undefined,
        certaintyClass: undefined,
        unprovenReason: 'LOCATOR_SUBSTITUTION',
      } as unknown as TargetWitnessReceipt),
    });
    expect(() => serverWith(journal)).toThrow();
  });

  it('requires a durable journal; no witness is recorded without one', () => {
    const journalless = createCoreSeamServer({
      expectedPeer: EXPECTED_PEER,
      s1DirectAcquisition: { begin: () => {} },
    });
    if (!journalless.ok) {
      throw new Error('server construction failed');
    }
    const s = journalless.value;
    submitSingle(s);
    const rejected = s.recordTargetWitness(AGGREGATE, witnessOf());
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.code).toBe('ADMISSION_REJECTED');
    }
    expect(s.targetWitnessFor(AGGREGATE)).toBeUndefined();
  });
});
