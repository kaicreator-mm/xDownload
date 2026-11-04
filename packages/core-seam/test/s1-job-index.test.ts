import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  EXPECTED_PEER,
  foreignPeer,
  peer,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  S1_JOB_INDEX_SUBJECT,
  type AcceptedCommandJournalEntry,
  type CoreSeamServer,
  type S1DirectAcquisitionBeginner,
  type S1JobIndexProjection,
  type SeamJournal,
  type SeamJournalEntry,
} from './helpers.ts';

function s1Payload(): Record<string, unknown> {
  return {
    snapshotId: 's1snap-001',
    memberId: 's1member-001',
    artifactId: 's1artifact-001',
    delivery: {
      locatorUri: 'http://127.0.0.1:9/file.bin',
      declaredRedirectHosts: ['127.0.0.1:9'],
      expectedSha256: 'a'.repeat(64),
    },
  };
}

function isS1Entry(entry: SeamJournalEntry): entry is AcceptedCommandJournalEntry {
  return (
    (entry.kind === undefined || entry.kind === 'COMMAND') &&
    entry.envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION'
  );
}

function controllableJournal() {
  const backing = createInMemorySeamJournal();
  let overriddenEntries: readonly SeamJournalEntry[] | undefined;
  let replayCount = 0;
  return {
    append(entry: Parameters<typeof backing.append>[0]) {
      return backing.append(entry);
    },
    replayAll() {
      replayCount += 1;
      return overriddenEntries ?? backing.replayAll();
    },
    entries(): readonly SeamJournalEntry[] {
      return backing.replayAll();
    },
    overrideEntries(entries: readonly SeamJournalEntry[]): void {
      overriddenEntries = entries;
    },
    replayCount(): number {
      return replayCount;
    },
  };
}

function serverWith(
  journal?: SeamJournal,
  beginner: S1DirectAcquisitionBeginner = { begin() {} },
): CoreSeamServer {
  const result = createCoreSeamServer({
    expectedPeer: EXPECTED_PEER,
    ...(journal === undefined ? {} : { journal }),
    s1DirectAcquisition: beginner,
  });
  if (!result.ok)
    throw new Error(`server construction failed: ${JSON.stringify(result.diagnostics)}`);
  return result.value;
}

function seedS1(
  server: CoreSeamServer,
  aggregateId: string,
  issuedAt = '2026-10-04T01:00:00Z',
): void {
  const submitted = server.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId,
        payload: rawSingleResourceContract({ contractId: aggregateId }),
      }),
    ),
  );
  expect(submitted.outcome).toBe('ACCEPTED');
  const executed = server.handleFrame(
    JSON.stringify(
      rawCommand({
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId,
        expectedRevision: 1,
        payload: s1Payload(),
        issuedAt,
      }),
    ),
  );
  expect(executed.outcome).toBe('ACCEPTED');
}

function rawS1JobIndexQuery(asPeer = peer()): Record<string, unknown> {
  const raw = rawQuery({ aggregateId: S1_JOB_INDEX_SUBJECT, asPeer });
  raw['queryType'] = 'LIST_S1_JOB_PROJECTIONS';
  return raw;
}

function listResponse(server: CoreSeamServer, asPeer = peer()) {
  return server.handleFrame(JSON.stringify(rawS1JobIndexQuery(asPeer)));
}

function readIndex(server: CoreSeamServer, asPeer = peer()): S1JobIndexProjection {
  const response = listResponse(server, asPeer);
  expect(response.outcome).toBe('PROJECTION');
  return response.projection as S1JobIndexProjection;
}

function contractIds(index: S1JobIndexProjection): readonly string[] {
  return index.items.map((item) => item.contract.contractId);
}

describe('LIST_S1_JOB_PROJECTIONS durable read-only index', () => {
  it('returns an empty frozen projection without appending or mutating authority', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    const beforeEntries = journal.entries();
    const beforeAccepted = server.acceptedCommandCount;

    const index = readIndex(server);
    expect(index.items).toStrictEqual([]);
    expect(index.totalCount).toBe(0);
    expect(index.truncated).toBe(false);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.items)).toBe(true);
    expect(journal.entries()).toStrictEqual(beforeEntries);
    expect(server.acceptedCommandCount).toBe(beforeAccepted);
  });

  it('rejects subject, schema and peer mismatches before journal access', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    const beforeReplay = journal.replayCount();

    const wrongSubject = rawS1JobIndexQuery();
    wrongSubject['aggregateId'] = 'contract-single-001';
    const subjectResponse = server.handleFrame(JSON.stringify(wrongSubject));
    expect(subjectResponse.outcome).toBe('REJECTED');
    expect(subjectResponse.diagnostics?.[0]?.code).toBe('QUERY_REJECTED');

    const oldSchema = rawS1JobIndexQuery();
    oldSchema['schemaIdentity'] = { schema: 'xdownload.core-seam', version: '1.3.0' };
    const schemaResponse = server.handleFrame(JSON.stringify(oldSchema));
    expect(schemaResponse.outcome).toBe('REJECTED');
    expect(schemaResponse.diagnostics?.[0]?.code).toBe('UNSUPPORTED_ENVELOPE_VERSION');

    const peerResponse = listResponse(server, foreignPeer());
    expect(peerResponse.outcome).toBe('REJECTED');
    expect(peerResponse.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(journal.replayCount()).toBe(beforeReplay);
  });

  it('rejects installId-only and userId-only peer mismatches independently before journal access', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    seedS1(server, 'contract-local-001');
    const beforeReplay = journal.replayCount();

    const installOnlyMismatch = { ...peer(), installId: 'install-999' };
    const installResponse = listResponse(server, installOnlyMismatch);
    expect(installResponse.outcome).toBe('REJECTED');
    expect(installResponse.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(installResponse.projection).toBeUndefined();

    const userOnlyMismatch = { ...peer(), userId: 'user-999' };
    const userResponse = listResponse(server, userOnlyMismatch);
    expect(userResponse.outcome).toBe('REJECTED');
    expect(userResponse.diagnostics?.[0]?.code).toBe('PEER_IDENTITY_REJECTED');
    expect(userResponse.projection).toBeUndefined();

    expect(journal.replayCount()).toBe(beforeReplay);
    expect(contractIds(readIndex(server))).toStrictEqual(['contract-local-001']);
  });

  it('fails closed when no durable journal is installed', () => {
    const response = listResponse(serverWith());
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_UNAVAILABLE');
    expect(response.diagnostics?.[0]?.path).toBe('journal');
  });

  it('serves the same peer scope across CLI, Desktop and Browser while excluding foreign entries', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    seedS1(server, 'contract-local-001');

    const cli = readIndex(server, peer('CLI'));
    expect(contractIds(cli)).toStrictEqual(['contract-local-001']);
    expect(readIndex(server, peer('DESKTOP_UI'))).toStrictEqual(cli);
    expect(readIndex(server, peer('BROWSER_EXTENSION'))).toStrictEqual(cli);

    const source = journal.entries().find(isS1Entry);
    if (source === undefined) throw new Error('missing seeded S1 journal entry');
    const foreignEntry: AcceptedCommandJournalEntry = {
      ...source,
      envelope: {
        ...source.envelope,
        aggregateId: 'contract-foreign-001',
        peer: foreignPeer(),
      },
    };
    journal.overrideEntries([...journal.entries(), foreignEntry]);

    const filtered = readIndex(server, peer('DESKTOP_UI'));
    expect(contractIds(filtered)).toStrictEqual(['contract-local-001']);
    expect(filtered.totalCount).toBe(1);
    expect(filtered.truncated).toBe(false);
  });

  it('deduplicates by the latest durable commit rather than issuedAt', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    seedS1(server, 'contract-a', '2026-12-01T00:00:00Z');
    seedS1(server, 'contract-b', '2026-01-01T00:00:00Z');

    const durableOrder = readIndex(server);
    expect(contractIds(durableOrder)).toStrictEqual(['contract-b', 'contract-a']);

    const sourceA = journal
      .entries()
      .find((entry) => isS1Entry(entry) && entry.envelope.aggregateId === 'contract-a');
    if (sourceA === undefined || !isS1Entry(sourceA)) throw new Error('missing S1 entry for A');
    const duplicateA: AcceptedCommandJournalEntry = {
      ...sourceA,
      envelope: {
        ...sourceA.envelope,
        requestId: sourceA.envelope.requestId,
        issuedAt: '2025-01-01T00:00:00Z',
      },
    };
    journal.overrideEntries([...journal.entries(), duplicateA]);

    const deduplicated = readIndex(server);
    expect(contractIds(deduplicated)).toStrictEqual(['contract-a', 'contract-b']);
    expect(deduplicated.totalCount).toBe(2);
    expect(deduplicated.truncated).toBe(false);
    expect(deduplicated.items[0]).toStrictEqual(server.inspectProjection('contract-a'));
    expect(deduplicated.items[1]).toStrictEqual(server.inspectProjection('contract-b'));
  });

  it.each([199, 200, 201])(
    'keeps exact totalCount and truncation at the %i-row boundary',
    (count) => {
      const journal = createInMemorySeamJournal();
      const server = serverWith(journal);
      for (let index = 1; index <= count; index += 1) {
        seedS1(server, `contract-${String(index).padStart(3, '0')}`);
      }

      const projection = readIndex(server);
      expect(projection.totalCount).toBe(count);
      expect(projection.items).toHaveLength(Math.min(count, 200));
      expect(projection.truncated).toBe(count > 200);
      expect(projection.items[0]?.contract.contractId).toBe(
        `contract-${String(count).padStart(3, '0')}`,
      );
      expect(projection.items.at(-1)?.contract.contractId).toBe(
        `contract-${String(count > 200 ? 2 : 1).padStart(3, '0')}`,
      );
    },
    20_000,
  );

  it('fails closed instead of omitting an accepted S1 aggregate without a current projection', () => {
    const journal = controllableJournal();
    const server = serverWith(journal);
    seedS1(server, 'contract-local-001');
    const source = journal.entries().find(isS1Entry);
    if (source === undefined) throw new Error('missing seeded S1 journal entry');
    const inconsistent: AcceptedCommandJournalEntry = {
      ...source,
      envelope: { ...source.envelope, aggregateId: 'contract-missing-001' },
    };
    journal.overrideEntries([...journal.entries(), inconsistent]);

    const response = listResponse(server);
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('AGGREGATE_NOT_FOUND');
    expect(response.diagnostics?.[0]?.path).toBe('journal');
    expect(response.projection).toBeUndefined();
  });

  it('replays the identical index from the same journal after restart without side effects', () => {
    const journal = createInMemorySeamJournal();
    const first = serverWith(journal);
    seedS1(first, 'contract-restart-a');
    seedS1(first, 'contract-restart-b');
    const before = readIndex(first);

    let beginCalls = 0;
    const restarted = serverWith(journal, {
      begin() {
        beginCalls += 1;
      },
    });
    const after = readIndex(restarted);
    expect(after).toStrictEqual(before);
    expect(contractIds(after)).toStrictEqual(['contract-restart-b', 'contract-restart-a']);
    expect(beginCalls).toBe(0);
  });
});
