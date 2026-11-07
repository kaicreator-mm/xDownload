/**
 * #351 R1 (Owner-approved via #354) — `EXECUTE_S1_DIRECT_ACQUISITION`
 * surface admission.
 *
 * The Core-executed direct lane admits exactly the CLI and DESKTOP_UI
 * surfaces; every other surface stays rejected at the same fail-closed
 * peer.surface admission. Admitting DESKTOP_UI never weakens the existing
 * per-frame peer authorization, contract/lineage binding, single-resource
 * gate, deduplication or journal ordering — those gates are re-asserted here
 * for the newly admitted surface, and the accepted journal entry preserves
 * the original surface identity (never rewritten to CLI).
 */

import { describe, expect, it } from 'vitest';
import type { AcquisitionContract } from '@xdownload/domain-contracts';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  type S1DirectAcquisitionBeginner,
} from '../src/index.ts';
import {
  EXPECTED_PEER,
  foreignPeer,
  peer,
  rawCollectionContract,
  rawCommand,
  rawSingleResourceContract,
} from './helpers.ts';

interface BeginnerCall {
  readonly aggregateId: string;
  readonly contract: AcquisitionContract;
  readonly payload: unknown;
}

function s1Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 's1snap-surface-001',
    memberId: 's1member-surface-001',
    artifactId: 's1artifact-surface-001',
    delivery: {
      locatorUri: 'http://127.0.0.1:9/file.bin',
      declaredRedirectHosts: ['127.0.0.1:9'],
      expectedSha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

function makeBeginner() {
  const calls: BeginnerCall[] = [];
  const beginner: S1DirectAcquisitionBeginner = {
    begin: (input) => {
      calls.push(input);
    },
  };
  return { beginner, calls };
}

function serverWith(
  options: {
    readonly journal?: ReturnType<typeof createInMemorySeamJournal>;
    readonly beginner?: S1DirectAcquisitionBeginner;
  } = {},
) {
  const result = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.beginner === undefined ? {} : { s1DirectAcquisition: options.beginner }),
  });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

function submitSingle(
  s: ReturnType<typeof serverWith>,
  aggregateId = 'contract-single-surface-001',
  surface: 'CLI' | 'DESKTOP_UI' = 'CLI',
): void {
  const response = s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId,
        payload: rawSingleResourceContract({ contractId: aggregateId }),
        asPeer: peer(surface),
      }),
    ),
  );
  expect(response.outcome).toBe('ACCEPTED');
}

function executeS1(
  s: ReturnType<typeof serverWith>,
  options: {
    readonly aggregateId?: string;
    readonly payload?: unknown;
    readonly expectedRevision?: number;
    readonly surface: 'CLI' | 'DESKTOP_UI' | 'BROWSER_EXTENSION';
  },
) {
  return s.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: options.aggregateId ?? 'contract-single-surface-001',
        payload: options.payload ?? s1Payload(),
        expectedRevision: options.expectedRevision ?? 1,
        asPeer: peer(options.surface),
      }),
    ),
  );
}

describe('EXECUTE_S1_DIRECT_ACQUISITION surface admission (#351 R1)', () => {
  it('admits the DESKTOP_UI surface and preserves the surface identity in the durable journal', () => {
    const journal = createInMemorySeamJournal();
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ journal, beginner });
    submitSingle(s, 'contract-single-surface-001', 'DESKTOP_UI');
    const response = executeS1(s, { surface: 'DESKTOP_UI' });
    expect(response.outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(s.pendingS1Executions()).toHaveLength(1);

    // The accepted journal entry keeps the DESKTOP_UI surface identity; Core
    // never rewrites the Desktop peer to CLI.
    let acceptedSurface: string | undefined;
    for (const entry of journal.replayAll()) {
      if (entry.kind !== 'COMMAND') continue;
      if (entry.envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION') {
        acceptedSurface = entry.envelope.peer.surface;
      }
    }
    expect(acceptedSurface).toBe('DESKTOP_UI');
  });

  it('continues to admit the CLI surface unchanged', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const response = executeS1(s, { surface: 'CLI' });
    expect(response.outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(s.pendingS1Executions()).toHaveLength(1);
  });

  it('rejects every other surface (BROWSER_EXTENSION) at peer.surface before any intent exists', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const response = executeS1(s, { surface: 'BROWSER_EXTENSION' });
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
    expect(response.diagnostics?.[0]?.path).toBe('peer.surface');
    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('rejects a foreign peer for the CLI surface at authorizePeer before any intent exists', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s);
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: 'contract-single-surface-001',
          payload: s1Payload(),
          expectedRevision: 1,
          asPeer: foreignPeer('CLI'),
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('rejects a foreign peer for the DESKTOP_UI surface at authorizePeer before any intent exists', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s, 'contract-single-surface-001', 'DESKTOP_UI');
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: 'contract-single-surface-001',
          payload: s1Payload(),
          expectedRevision: 1,
          asPeer: foreignPeer('DESKTOP_UI'),
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(calls).toHaveLength(0);
    expect(s.pendingS1Executions()).toHaveLength(0);
  });

  it('keeps every existing S1 gate mandatory for the DESKTOP_UI surface', () => {
    const { beginner, calls } = makeBeginner();
    const s = serverWith({ beginner });
    submitSingle(s, 'contract-single-surface-001', 'DESKTOP_UI');

    // The newly admitted surface registers exactly one durable intent and a
    // duplicate registration is still rejected.
    expect(executeS1(s, { surface: 'DESKTOP_UI', expectedRevision: 1 }).outcome).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(s.pendingS1Executions()).toHaveLength(1);
    const duplicate = executeS1(s, { surface: 'DESKTOP_UI', expectedRevision: 2 });
    expect(duplicate.outcome).toBe('REJECTED');
    expect(duplicate.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');

    // Single-resource gate: a COLLECTION contract is still rejected.
    const collectionSubmit = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-collection-surface-001',
          payload: rawCollectionContract({ contractId: 'contract-collection-surface-001' }),
          asPeer: peer('DESKTOP_UI'),
        }),
      ),
    );
    expect(collectionSubmit.outcome).toBe('ACCEPTED');
    const collectionExecute = executeS1(s, {
      aggregateId: 'contract-collection-surface-001',
      expectedRevision: 1,
      surface: 'DESKTOP_UI',
    });
    expect(collectionExecute.outcome).toBe('REJECTED');
    expect(collectionExecute.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');

    expect(calls).toHaveLength(1);
    expect(s.pendingS1Executions()).toHaveLength(1);
  });
});
