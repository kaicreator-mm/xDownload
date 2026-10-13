/**
 * #101 first slice — S1 Core-executed direct acquisition through the seam.
 *
 * Proves the first vertical slice end-to-end against controlled localhost
 * HTTP only: an accepted submitted contract leads through a Core-owned
 * executable acquisition lifecycle (real HTTP transfer through the canonical
 * T008 adapter port) to durable bytes + a Core-derived genuine terminal —
 * submission ACK is never conflated with download success. Covers the
 * truthful negatives (bad digest, cancel-before-execute, retry-after-
 * terminal, non-CLI surface, collection contract), idempotent convergence,
 * and restart replay (terminal re-derived from durable truth, no
 * re-download).
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeamResponse, SeamProjectionView } from '@xdownload/core-seam';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  rawCollectionContract,
  removeTempDir,
  requestIdOf,
  queryEnvelope,
  seamCommand,
  peer,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { reopenCoreRuntime } from '../src/index.ts';
import { runtimeOptions } from './helpers.ts';

const dirs: string[] = [];
const fixtures: ControlledHttpFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.stop();
  }
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

const CONTRACT = 'contract-s1-001';
const SNAPSHOT = 's1snap-001';
const MEMBER = 's1member-001';
const ARTIFACT = 's1artifact-001';

function s1Payload(baseUri: string, digest: string, host: string): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    memberId: MEMBER,
    artifactId: ARTIFACT,
    delivery: {
      locatorUri: `${baseUri}/file.bin`,
      declaredRedirectHosts: [host],
      expectedSha256: digest,
    },
  };
}

async function waitForTerminal(
  inspect: () => SeamProjectionView | undefined,
): Promise<SeamProjectionView> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = inspect();
    if (view !== undefined && view.terminal !== undefined) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('terminal was not projected in time');
}

function terminalOf(response: SeamResponse): SeamProjectionView {
  expect(response.outcome).toBe('PROJECTION');
  return response.projection as SeamProjectionView;
}

describe('S1 Core-executed direct acquisition (#101 first slice)', () => {
  it(
    'submit → execute → real HTTP download → durable bytes → Core-derived COMPLETE terminal',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-direct');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 8192 }, (_, index) => (index * 31) % 251));
      const digest = createHash('sha256').update(bytes).digest('hex');
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1etag"' });

      const runtime = openRuntime(rootDir);
      try {
        const submit = seamCommand(runtime, {
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: CONTRACT,
          payload: rawSingleResourceContract({ contractId: CONTRACT }),
        });
        expect(submit.outcome).toBe('ACCEPTED');

        // The execution command is accepted (intent registered); the real
        // transfer runs strictly after the journal commit, asynchronously.
        const executeRequestId = requestIdOf('req-s1-exec-0001');
        const execute = seamCommand(runtime, {
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: CONTRACT,
          payload: s1Payload(baseUri, digest, new URL(baseUri).host),
          requestId: executeRequestId,
          expectedRevision: 1,
        });
        expect(execute.outcome).toBe('ACCEPTED');

        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(view.terminal?.requestFulfillment).toBe('COMPLETE');
        expect(view.terminal?.selectionAcquisition).toBe('COMPLETE');
        expect(view.terminal?.stopReason).toBe('NONE');
        expect(view.lineage.status).toBe('TERMINAL');

        // The Core really performed exactly one HTTP transfer...
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.requests[0]?.path).toBe('/file.bin');
        // ...persisted the bytes durably with the verified digest...
        const observation = runtime.store.observe(ARTIFACT);
        expect(observation.phase).toBe('FINALIZED');
        expect(observation.observedDigest).toBe(digest);
        expect(observation.observedByteSize).toBe(bytes.length);
        const workItem = runtime.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        expect(workItem).toBeDefined();
        const classification = runtime.recovery.classify(workItem!.workItemId);
        expect(classification.lifecycleClass).toBe('ACCEPTED');
        expect(classification.bytesVerified).toBe(true);

        // Idempotent replay of the same command converges; a conflicting
        // new registration for the same lineage rejects (no double drive).
        const replayed = seamCommand(runtime, {
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: CONTRACT,
          payload: s1Payload(baseUri, digest, new URL(baseUri).host),
          requestId: executeRequestId,
          expectedRevision: 1,
        });
        expect(replayed.outcome).toBe('ACCEPTED');
        expect(replayed.acceptance?.converged).toBe(true);
        const duplicate = seamCommand(runtime, {
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: CONTRACT,
          payload: s1Payload(baseUri, digest, new URL(baseUri).host),
          expectedRevision: view.contract.revision,
        });
        expect(duplicate.outcome).toBe('REJECTED');
        // Terminal lineages reject new executions as LATE (checked before
        // the intent registry — the same gate order as the S2 lane).
        expect(duplicate.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
        expect(fixture.requests).toHaveLength(1);

        // The terminal is readable through the wire query as well.
        const queried = terminalOf(
          runtime.seam.handleFrame(JSON.stringify(queryEnvelope({ aggregateId: CONTRACT }))),
        );
        expect(queried.terminal).toEqual(view.terminal);
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    'a wrong digest is a truthful FAILED terminal; retry after terminal is LATE',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-digest');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      fixture.serveFile('/file.bin', { body: bytes });
      const wrongDigest = '0'.repeat(64);

      const runtime = openRuntime(rootDir);
      try {
        expect(
          seamCommand(runtime, {
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: CONTRACT,
            payload: rawSingleResourceContract({ contractId: CONTRACT }),
          }).outcome,
        ).toBe('ACCEPTED');
        expect(
          seamCommand(runtime, {
            commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
            aggregateId: CONTRACT,
            payload: s1Payload(baseUri, wrongDigest, new URL(baseUri).host),
            expectedRevision: 1,
          }).outcome,
        ).toBe('ACCEPTED');

        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        // Submission was accepted, the download truthfully failed: never a
        // fabricated success.
        expect(view.terminal?.requestFulfillment).not.toBe('COMPLETE');
        expect(view.lineage.status).toBe('TERMINAL');
        expect(view.lineage.failedMemberIds).toContain(MEMBER);

        const workItem = runtime.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        const classification = runtime.recovery.classify(workItem!.workItemId);
        expect(classification.lifecycleClass).toBe('TERMINAL_FAILED');
        // The durable bytes are intact (they verify against their own staged
        // record); the acquisition still truthfully failed declared-digest
        // validation — bytes integrity never rewrites terminal truth.
        expect(classification.bytesVerified).toBe(true);

        // Retry vocabulary stays truthful: terminal truth is never rewritten.
        const retry = seamCommand(runtime, {
          commandType: 'RETRY_FAILED_MEMBERS',
          aggregateId: CONTRACT,
          payload: { memberIds: [MEMBER] },
          expectedRevision: view.contract.revision,
        });
        expect(retry.outcome).toBe('REJECTED');
        expect(retry.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
        const after = runtime.seam.inspectProjection(CONTRACT);
        expect(after?.terminal).toEqual(view.terminal);
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it('cancel before execute rejects the execution command as LATE (no transfer runs)', async () => {
    const rootDir = makeTempDir('s1-cancel');
    dirs.push(rootDir);
    const fixture = new ControlledHttpFixture();
    fixtures.push(fixture);
    const baseUri = await fixture.start();

    const runtime = openRuntime(rootDir);
    try {
      expect(
        seamCommand(runtime, {
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: CONTRACT,
          payload: rawSingleResourceContract({ contractId: CONTRACT }),
        }).outcome,
      ).toBe('ACCEPTED');
      expect(
        seamCommand(runtime, {
          commandType: 'CANCEL_LINEAGE',
          aggregateId: CONTRACT,
          payload: {},
          expectedRevision: 1,
        }).outcome,
      ).toBe('ACCEPTED');
      const execute = seamCommand(runtime, {
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: CONTRACT,
        payload: s1Payload(baseUri, '0'.repeat(64), new URL(baseUri).host),
        expectedRevision: 2,
      });
      expect(execute.outcome).toBe('REJECTED');
      expect(execute.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
      expect(fixture.requests).toHaveLength(0);
      expect(runtime.seam.pendingS1Executions()).toHaveLength(0);
    } finally {
      closeRuntime(runtime);
    }
  });

  it(
    'restart after completion re-derives the identical terminal from durable truth (no re-download)',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-restart');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 4096 }, (_, index) => index % 251));
      const digest = createHash('sha256').update(bytes).digest('hex');
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1restart"' });

      const runtime = openRuntime(rootDir);
      let terminalBeforeClose: unknown;
      try {
        seamCommand(runtime, {
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: CONTRACT,
          payload: rawSingleResourceContract({ contractId: CONTRACT }),
        });
        seamCommand(runtime, {
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: CONTRACT,
          payload: s1Payload(baseUri, digest, new URL(baseUri).host),
          expectedRevision: 1,
        });
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        terminalBeforeClose = view.terminal;
        expect(terminalBeforeClose).toBeDefined();
      } finally {
        closeRuntime(runtime);
      }
      expect(fixture.requests).toHaveLength(1);

      // Reopen from durable truth only: the intent replays from the journal
      // and the reconcile re-derives the identical terminal without any new
      // HTTP request.
      const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        const view = await waitForTerminal(() => reopened.seam.inspectProjection(CONTRACT));
        expect(view.terminal).toEqual(terminalBeforeClose);
        expect(view.lineage.status).toBe('TERMINAL');
        expect(fixture.requests).toHaveLength(1);
        const workItem = reopened.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        const classification = reopened.recovery.classify(workItem!.workItemId);
        expect(classification.lifecycleClass).toBe('ACCEPTED');
        expect(classification.bytesVerified).toBe(true);
        expect(reopened.store.observe(ARTIFACT).observedDigest).toBe(digest);
      } finally {
        closeRuntime(reopened);
      }
    },
  );

  it('the S1 lane fails closed off the CLI surface and for collection contracts', () => {
    const rootDir = makeTempDir('s1-gates');
    dirs.push(rootDir);
    const runtime = openRuntime(rootDir);
    try {
      seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: CONTRACT,
        payload: rawSingleResourceContract({ contractId: CONTRACT }),
      });
      const offSurface = seamCommand(runtime, {
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: CONTRACT,
        payload: s1Payload('http://127.0.0.1:1', '0'.repeat(64), '127.0.0.1:1'),
        expectedRevision: 1,
        asPeer: peer('BROWSER_EXTENSION'),
      });
      expect(offSurface.outcome).toBe('REJECTED');
      expect(offSurface.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
      expect(runtime.seam.pendingS1Executions()).toHaveLength(0);

      const collectionRaw = rawCollectionContract({ contractId: 'contract-s1-coll' });
      const collectionSubmit = seamCommand(runtime, {
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-s1-coll',
        payload: {
          ...collectionRaw,
          collectionIdentity: 'collection/playlist-001',
          membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
          requestedScope: {
            kind: 'entire_supported_collection',
            collectionIdentity: 'collection/playlist-001',
          },
          explorationPermission: 'COLLECTION_MEMBER_EDGES',
        },
      });
      expect(collectionSubmit.outcome).toBe('ACCEPTED');
      const collection = seamCommand(runtime, {
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: 'contract-s1-coll',
        payload: s1Payload('http://127.0.0.1:1', '0'.repeat(64), '127.0.0.1:1'),
        expectedRevision: 1,
      });
      expect(collection.outcome).toBe('REJECTED');
      expect(collection.diagnostics?.[0]?.code).toBe('ADMISSION_REJECTED');
      expect(runtime.seam.pendingS1Executions()).toHaveLength(0);

      // A malformed payload (bad digest shape) rejects before any intent.
      const malformed = seamCommand(runtime, {
        commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
        aggregateId: CONTRACT,
        payload: {
          snapshotId: SNAPSHOT,
          memberId: MEMBER,
          artifactId: ARTIFACT,
          delivery: {
            locatorUri: 'http://127.0.0.1:1/file.bin',
            declaredRedirectHosts: ['127.0.0.1:1'],
            expectedSha256: 'not-a-digest',
          },
        },
        expectedRevision: 1,
      });
      expect(malformed.outcome).toBe('REJECTED');
      expect(malformed.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');
      expect(runtime.seam.pendingS1Executions()).toHaveLength(0);
    } finally {
      closeRuntime(runtime);
    }
  });
});
