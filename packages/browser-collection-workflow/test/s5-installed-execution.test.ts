/**
 * #151 installed S5 collection execution driver — real closed loop over a
 * real CoreRuntime + controlled local HTTP: per-member durable acquisition,
 * per-member outcome records, aggregate COLLECTION terminal through
 * recordExecutedTerminal, truthful refusal when the collection flow cannot
 * proceed, and reconcile convergence on re-drive.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthBroker } from '@xdownload/browser-auth-broker';
import type { S5ConfirmedGroupRecord, S5PreparedGroupRecord } from '@xdownload/core-seam';
import { ControlledHttpFixture } from '../../core-runtime/test/fixture-http.ts';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  removeTempDir,
  seamCommand,
} from '../../core-runtime/test/helpers.ts';
import {
  createS5CollectionDriver,
  driveS5CollectionExecution,
} from '../src/s5-installed-execution.ts';
import { budgetsOpen, currentPageContract, payload, sha256, snapshotFor } from './fixtures.ts';
import { decodeAcquisitionContract, decodeSelectionSnapshot } from '@xdownload/domain-contracts';

const MEMBER_IDS = ['member-page-001', 'member-page-002', 'member-page-003'] as const;
const fixtures: ControlledHttpFixture[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.stop();
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

interface DriverWorld {
  readonly fixture: ControlledHttpFixture;
  readonly origin: string;
  readonly prepared: S5PreparedGroupRecord;
  readonly confirmed: S5ConfirmedGroupRecord;
  readonly root: string;
}

async function driverWorld(
  options: { readonly failingMember?: boolean } = {},
): Promise<DriverWorld & { runtime: ReturnType<typeof openRuntime> }> {
  const fixture = new ControlledHttpFixture();
  fixtures.push(fixture);
  const origin = await fixture.start();
  const members = MEMBER_IDS.map((memberId, index) => ({
    memberId,
    href: `${origin}/file-${String(index)}.bin`,
    text: `file ${String(index)}`,
  }));
  for (const [index, memberId] of MEMBER_IDS.entries()) {
    if (options.failingMember === true && index === MEMBER_IDS.length - 1) {
      // An unregistered path serves 404 — a truthful per-member failure.
      continue;
    }
    fixture.serveFile(`/file-${String(index)}.bin`, {
      body: payload(256, index + 3),
      etag: `s5-installed-${memberId}`,
    });
  }
  const base = currentPageContract({
    contractId: 'contract-s5-driver-001',
    collectionIdentity: 'collection/s5-driver-001',
    requestedScope: { kind: 'current_page', collectionIdentity: 'collection/s5-driver-001' },
    authorizationContextRef: 'authctx/installed-s5-lane',
  });
  const snapshotRaw = snapshotFor(base, [...MEMBER_IDS]);
  const contract = decodeAcquisitionContract({
    ...JSON.parse(JSON.stringify(base)),
    selectionSnapshotRef: 'snapshot-s5-driver-001',
    confirmedAt: '2026-10-26T00:00:00Z',
  });
  if (!contract.ok) throw new Error('contract decode failed');
  const snapshot = decodeSelectionSnapshot({
    ...JSON.parse(JSON.stringify(snapshotRaw)),
    snapshotId: 'snapshot-s5-driver-001',
  });
  if (!snapshot.ok) throw new Error('snapshot decode failed');
  const prepared: S5PreparedGroupRecord = {
    prepareId: 's5prepare:contract-s5-driver-001:snapshot-s5-driver-001',
    snapshotId: 'snapshot-s5-driver-001',
    pageOrigin: origin,
    provenanceKey: 'tab-7/frame-0/http://127.0.0.1:9/a/-/-',
    members: Object.freeze(members),
    observedTupleDigest: 'a'.repeat(64),
    status: 'AVAILABLE',
    preparedAt: '2026-10-26T00:00:00Z',
  };
  const confirmed: S5ConfirmedGroupRecord = {
    confirmedGroupId: 's5group:contract-s5-driver-001:snapshot-s5-driver-001',
    prepareId: prepared.prepareId,
    snapshotId: 'snapshot-s5-driver-001',
    selectedMemberIds: Object.freeze([...MEMBER_IDS]),
    displayedTupleDigest: 'b'.repeat(64),
    contract: contract.value,
    snapshot: snapshot.value,
    confirmedAt: '2026-10-26T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const root = makeTempDir('s5-installed-execution');
  dirs.push(root);
  const runtime = openRuntime(root);
  // The production flow registers the aggregate through SUBMIT_CONTRACT
  // before any S5 command; mirror that so the lineage exists for the
  // driver's outcome/terminal recording.
  const submitted = seamCommand(runtime, {
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: 'contract-s5-driver-001',
    payload: JSON.parse(JSON.stringify(contract.value)) as Record<string, unknown>,
    asPeer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
  });
  if (submitted.outcome !== 'ACCEPTED') {
    closeRuntime(runtime);
    throw new Error(`aggregate submit failed: ${JSON.stringify(submitted.diagnostics)}`);
  }
  // The production CONFIRM_S5_PAGE_GROUP binds the Core-constructed
  // confirmed snapshot on the lineage; mirror that binding through the
  // generic CONFIRM_SNAPSHOT command (the same durable state the coverage
  // accounting gate reads).
  const snapshotted = seamCommand(runtime, {
    commandType: 'CONFIRM_SNAPSHOT',
    aggregateId: 'contract-s5-driver-001',
    expectedRevision: 1,
    payload: JSON.parse(JSON.stringify(snapshot.value)) as Record<string, unknown>,
    asPeer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
  });
  if (snapshotted.outcome !== 'ACCEPTED') {
    closeRuntime(runtime);
    throw new Error(`snapshot binding failed: ${JSON.stringify(snapshotted.diagnostics)}`);
  }
  return { fixture, origin, prepared, confirmed, root, runtime };
}

describe('#151 S5 collection execution driver (real CoreRuntime + real HTTP)', () => {
  it('downloads every member through Core and records per-member + aggregate terminals', async () => {
    const world = await driverWorld();
    try {
      const result = await driveS5CollectionExecution(world.runtime, {
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-001',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const view = world.runtime.seam.inspectProjection(
        'contract-s5-driver-001',
      ) as unknown as Record<string, unknown>;
      const members = view['s5Members'] as readonly Record<string, unknown>[];
      expect(members).toHaveLength(3);
      expect(members.every((member) => member['accepted'] === true)).toBe(true);
      const terminal = view['terminal'] as Record<string, unknown>;
      expect(terminal['coverage']).toBe('VERIFIED_COMPLETE');
      expect(terminal['requestFulfillment']).toBe('COMPLETE');
      expect(world.runtime.writer.reader.workItems()).toHaveLength(3);
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('converges on re-drive without re-downloading (reconcile discipline)', async () => {
    const world = await driverWorld();
    try {
      await driveS5CollectionExecution(world.runtime, {
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-001',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      const before = world.fixture.requests.length;
      const again = await driveS5CollectionExecution(world.runtime, {
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-001',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      expect(again.ok).toBe(true);
      expect(world.fixture.requests.length).toBe(before);
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('recovers accepted S5 member work after a real Core restart without duplicate acquire commands', async () => {
    const world = await driverWorld();
    const input = {
      aggregateId: 'contract-s5-driver-001',
      requestId: 'req-s5-restart-reconcile',
      confirmed: world.confirmed,
      prepared: world.prepared,
    };
    let initialClosed = false;
    try {
      const first = await driveS5CollectionExecution(world.runtime, input);
      expect(first.ok).toBe(true);
      const requests = world.fixture.requests.length;
      expect(requests).toBe(3);
      closeRuntime(world.runtime);
      initialClosed = true;

      const reopened = openRuntime(world.root);
      try {
        // recordExecutedTerminal is derived, not command-journalled. On
        // restart the Core lineage is ACTIVE while accepted per-member
        // ledger rows remain; replay MUST NOT resubmit duplicate ACQUIRE.
        const before = reopened.seam.inspectProjection(input.aggregateId);
        expect(before?.lineage.status).toBe('ACTIVE');
        const again = await driveS5CollectionExecution(reopened, input);
        if (!again.ok) throw new Error(JSON.stringify(again.diagnostics));
        const after = reopened.seam.inspectProjection(input.aggregateId);
        expect(after?.lineage.status).toBe('TERMINAL');
        expect(after?.terminal?.requestFulfillment).toBe('COMPLETE');
        expect(reopened.writer.reader.workItems()).toHaveLength(3);
        expect(world.fixture.requests.length).toBe(requests);
      } finally {
        closeRuntime(reopened);
      }
    } finally {
      if (!initialClosed) closeRuntime(world.runtime);
    }
  });

  it('recovers a partial S5 group after restart without treating a 404 as success', async () => {
    const world = await driverWorld({ failingMember: true });
    const input = {
      aggregateId: 'contract-s5-driver-001',
      requestId: 'req-s5-partial-restart',
      confirmed: world.confirmed,
      prepared: world.prepared,
    };
    let initialClosed = false;
    try {
      const first = await driveS5CollectionExecution(world.runtime, input);
      expect(first.ok).toBe(true);
      const requests = world.fixture.requests.length;
      closeRuntime(world.runtime);
      initialClosed = true;
      const reopened = openRuntime(world.root);
      try {
        const result = await driveS5CollectionExecution(reopened, input);
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        const view = reopened.seam.inspectProjection(input.aggregateId);
        expect(view?.lineage.status).toBe('TERMINAL');
        expect(view?.terminal?.requestFulfillment).toBe('PARTIAL');
        expect(view?.terminal?.coverage).toBe('UNKNOWN');
        expect(world.fixture.requests.length).toBe(requests);
      } finally {
        closeRuntime(reopened);
      }
    } finally {
      if (!initialClosed) closeRuntime(world.runtime);
    }
  });

  it('records a truthful partial terminal when one member cannot be acquired', async () => {
    const world = await driverWorld({ failingMember: true });
    try {
      const result = await driveS5CollectionExecution(world.runtime, {
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-002',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const view = world.runtime.seam.inspectProjection(
        'contract-s5-driver-001',
      ) as unknown as Record<string, unknown>;
      const members = view['s5Members'] as readonly Record<string, unknown>[];
      expect(members).toHaveLength(3);
      const failed = members.filter((member) => member['accepted'] !== true);
      expect(failed).toHaveLength(1);
      const terminal = view['terminal'] as Record<string, unknown>;
      // Per-member failure surfaces in the aggregate terminal truthfully —
      // never COMPLETE over a failed member, never a masked success.
      // Truthful partial: requestFulfillment PARTIAL, acquisition PARTIAL,
      // coverage honestly UNKNOWN (one member has no validated evidence).
      expect(terminal['requestFulfillment']).toBe('PARTIAL');
      expect(terminal['selectionAcquisition']).toBe('PARTIAL');
      expect(terminal['coverage']).toBe('UNKNOWN');
      const summary = terminal['validationSummary'] as Record<string, unknown>;
      expect(summary['passedCount']).toBe(2);
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('converges without recording a terminal when the lineage was durably cancelled (ADR-013 cutoff)', async () => {
    const world = await driverWorld();
    try {
      const cancelled = seamCommand(world.runtime, {
        commandType: 'CANCEL_LINEAGE',
        aggregateId: 'contract-s5-driver-001',
        expectedRevision: 2,
        asPeer: { installId: 'install-001', userId: 'user-001', surface: 'BROWSER_EXTENSION' },
      });
      expect(cancelled.outcome).toBe('ACCEPTED');
      const result = await driveS5CollectionExecution(world.runtime, {
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-cancelled',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      expect(result.ok).toBe(true);
      const view = world.runtime.seam.inspectProjection(
        'contract-s5-driver-001',
      ) as unknown as Record<string, unknown>;
      const lineage = view['lineage'] as Record<string, unknown>;
      expect(lineage['status']).toBe('CANCELLED');
      // No executed terminal across the durable user-cancel cutoff.
      expect(view['terminal']).toBeUndefined();
    } finally {
      closeRuntime(world.runtime);
    }
  });

  it('factory drives through the injected runtime (composition shape)', async () => {
    const world = await driverWorld();
    try {
      const drive = createS5CollectionDriver()(world.runtime);
      const result = await drive({
        aggregateId: 'contract-s5-driver-001',
        requestId: 'req-exec-003',
        confirmed: world.confirmed,
        prepared: world.prepared,
      });
      expect(result.ok).toBe(true);
      void createAuthBroker();
      void budgetsOpen;
      void sha256;
    } finally {
      closeRuntime(world.runtime);
    }
  });
});
