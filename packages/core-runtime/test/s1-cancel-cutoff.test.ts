/**
 * #101 P2-1/P2-2 — S1 cancel cutoff + durable target evidence through the
 * composed runtime (real HTTP against controlled localhost only).
 *
 * Proves the durably committed user cancel order end-to-end:
 * - cancel during a hung stream: the in-flight socket is torn down at the
 *   abort checkpoint, no acceptance/terminal-failure crosses the cutoff, and
 *   the lineage closes with the truthful USER_CANCELLED projector terminal
 *   (never a fabricated COMPLETED, never a lingering connection, never a
 *   re-executed transfer);
 * - acceptance-before-cancel stands: a completed download cancelled after
 *   its durable acceptance still projects COMPLETE (ADR-013 — cancellation
 *   cannot downgrade completed acquisition) with the durable target evidence
 *   recorded;
 * - restart re-derives the identical cancellation closure from durable truth
 *   (the closure terminal is unjournaled; reconcile re-derives it);
 * - no-digest and publisher-hash successful records stay distinguishable
 *   on the projection and in the artifact provenance across restart.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeAcquisitionContract,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import type { SeamProjectionView } from '@xdownload/core-seam';
import {
  closeRuntime,
  makeTempDir,
  openRuntime,
  rawSingleResourceContract,
  removeTempDir,
  runtimeOptions,
  seamCommand,
} from './helpers.ts';
import { ControlledHttpFixture } from './fixture-http.ts';
import { reopenCoreRuntime } from '../src/index.ts';

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
const HOST = '127.0.0.1';

function s1Payload(
  baseUri: string,
  digest?: string,
  artifactId: string = ARTIFACT,
): Record<string, unknown> {
  return {
    snapshotId: SNAPSHOT,
    memberId: MEMBER,
    artifactId,
    delivery: {
      locatorUri: baseUri,
      declaredRedirectHosts: [HOST],
      ...(digest === undefined ? {} : { expectedSha256: digest }),
    },
  };
}

async function waitForTerminal(
  inspect: () => SeamProjectionView | undefined,
): Promise<SeamProjectionView> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const view = inspect();
    if (view !== undefined && view.terminal !== undefined) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('terminal was not projected in time');
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition was not met in time');
}

function decodedContract(contractId: string): AcquisitionContract {
  const decoded = decodeAcquisitionContract(
    rawSingleResourceContract({ contractId }) as unknown as Record<string, unknown>,
  );
  if (!decoded.ok) {
    throw new Error('fixture contract does not decode');
  }
  return decoded.value;
}

describe('S1 cancel cutoff through the composed runtime (#101 P2-1)', () => {
  it(
    'cancel during a hung stream aborts the socket and closes with a truthful USER_CANCELLED terminal',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-cancel-hang');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      let connectionClosed = false;
      fixture.on('/file.bin', (_request, response) => {
        // Headers promise 100 bytes that never arrive: the transfer hangs
        // inside the body read until the abort checkpoint fires.
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': '100',
        });
        response.on('close', () => {
          connectionClosed = true;
        });
      });

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
            payload: s1Payload(`${baseUri}/file.bin`),
            expectedRevision: 1,
          }).outcome,
        ).toBe('ACCEPTED');

        // The transfer started (one origin request, still hung)…
        await waitForCondition(() => fixture.requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(connectionClosed).toBe(false);

        // …the user cancels durably at the seam…
        expect(
          seamCommand(runtime, {
            commandType: 'CANCEL_LINEAGE',
            aggregateId: CONTRACT,
            payload: {},
            expectedRevision: 2,
          }).outcome,
        ).toBe('ACCEPTED');

        // …and the lineage closes truthfully: the in-flight socket is torn
        // down at the abort checkpoint, nothing is accepted across the
        // cutoff, and the terminal is the projector's USER_CANCELLED output
        // — never a fabricated COMPLETED escape.
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(view.lineage.status).toBe('TERMINAL');
        expect(view.terminal?.stopReason).toBe('USER_CANCELLED');
        expect(view.terminal?.selectionAcquisition).toBe('CANCELLED');
        expect(view.terminal?.requestFulfillment).toBe('UNSATISFIED');
        expect(connectionClosed).toBe(true);

        // No lingering socket kept the transfer alive and no retry
        // re-executed it: exactly one origin request, no accepted artifact.
        expect(fixture.requests).toHaveLength(1);
        const workItem = runtime.writer.reader
          .workItems()
          .find((item) => item.contractId === CONTRACT);
        expect(workItem).toBeDefined();
        const classification = runtime.recovery.classify(workItem!.workItemId);
        expect(classification.lifecycleClass).not.toBe('ACCEPTED');

        // After the truthful closure the lineage is TERMINAL: a late cancel
        // is recorded as LATE and can never rewrite terminal truth
        // (revisions: submit(1) → execute(2) → cancel(3) → closure(4)).
        const lateCancel = seamCommand(runtime, {
          commandType: 'CANCEL_LINEAGE',
          aggregateId: CONTRACT,
          payload: {},
          expectedRevision: 4,
        });
        expect(lateCancel.outcome).toBe('REJECTED');
        expect(lateCancel.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
        expect(runtime.seam.inspectProjection(CONTRACT)?.lineage.status).toBe('TERMINAL');
        expect(fixture.requests).toHaveLength(1);
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    'acceptance before the cancel stands: the closure projects COMPLETE with durable target evidence',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-cancel-after-accept');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 4096 }, (_, index) => index % 251));
      const digest = createHash('sha256').update(bytes).digest('hex');
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1-cancel-acc"' });

      const runtime = openRuntime(rootDir);
      try {
        expect(
          seamCommand(runtime, {
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: CONTRACT,
            payload: rawSingleResourceContract({ contractId: CONTRACT }),
          }).outcome,
        ).toBe('ACCEPTED');

        // The transfer + durable acceptance run at the flow level, so the
        // cancel command deterministically lands AFTER the durable
        // acceptance but BEFORE any terminal is recorded.
        const flow = await import('../src/index.ts').then((m) =>
          m.executeDirectAcquisition(runtime, {
            contractId: CONTRACT,
            snapshotId: SNAPSHOT,
            targetId: 'target-file-001',
            authorizationContextRef: String(rawSingleResourceContract()['authorizationContextRef']),
            budgetProfile: rawSingleResourceContract()['budgetProfile'],
            frozenMemberIds: [MEMBER],
            commandId: `s1-direct:${CONTRACT}:${SNAPSHOT}:${MEMBER}`,
            memberId: MEMBER,
            artifactId: ARTIFACT,
            transfer: {
              effectId: unwrapOrThrow(
                makeEffectId(`effect:${CONTRACT}:${SNAPSHOT}:target-file-001`),
              ),
              contractId: CONTRACT,
              slice: 'S1',
              selectedMemberId: unwrapOrThrow(makeMemberId(MEMBER)),
              binding: {
                identity: unwrapOrThrow(makeLogicalTargetId('target-file-001')),
                locator: { kind: 'direct', uri: `${baseUri}/file.bin` },
                provenance: {
                  binding: 'SELECTED_RESOURCE_PROVENANCE',
                  originLocatorUri: `${baseUri}/file.bin`,
                },
              },
              expectedSha256: digest,
              allowedRedirectHosts: [HOST],
              attempt: 0,
            },
          }),
        );
        const classification = runtime.recovery.classify(flow.workItemId);
        expect(classification.lifecycleClass).toBe('ACCEPTED');
        expect(classification.bytesVerified).toBe(true);
        expect(runtime.seam.inspectProjection(CONTRACT)?.terminal).toBeUndefined();

        // The user cancel commits after the durable acceptance.
        expect(
          seamCommand(runtime, {
            commandType: 'CANCEL_LINEAGE',
            aggregateId: CONTRACT,
            payload: {},
            expectedRevision: 1,
          }).outcome,
        ).toBe('ACCEPTED');

        // Reconcile the intent from durable truth: the projector applies the
        // frozen cutoff — acceptance committed before the cancel is not
        // retroactively revoked, so the truthful closure is COMPLETE (with
        // the durable target evidence recorded before terminal authority).
        const drive = await import('../src/index.ts').then((m) =>
          m.driveS1DirectExecution(runtime, {
            aggregateId: CONTRACT,
            contract: decodedContract(CONTRACT),
            payload: s1Payload(`${baseUri}/file.bin`, digest),
          }),
        );
        expect(drive.ok).toBe(true);
        const view = runtime.seam.inspectProjection(CONTRACT);
        expect(view?.lineage.status).toBe('TERMINAL');
        expect(view?.terminal?.requestFulfillment).toBe('COMPLETE');
        expect(view?.terminal?.selectionAcquisition).toBe('COMPLETE');
        expect(view?.targetEvidence?.basis).toBe('PUBLISHED_SHA256');
        expect(view?.targetEvidence?.certaintyClass).toBe('DECISIVE');
        expect(view?.targetEvidence?.artifactSha256).toBe(digest);
        // No re-download: the accepted artifact is never re-executed.
        expect(fixture.requests).toHaveLength(1);
      } finally {
        closeRuntime(runtime);
      }
    },
  );

  it(
    'restart re-derives the identical cancellation closure from durable truth (no re-download)',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-cancel-restart');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      let connectionClosed = false;
      fixture.on('/file.bin', (_request, response) => {
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': '100',
        });
        response.on('close', () => {
          connectionClosed = true;
        });
      });

      const runtime = openRuntime(rootDir);
      let closureBeforeRestart: unknown;
      try {
        seamCommand(runtime, {
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: CONTRACT,
          payload: rawSingleResourceContract({ contractId: CONTRACT }),
        });
        seamCommand(runtime, {
          commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
          aggregateId: CONTRACT,
          payload: s1Payload(`${baseUri}/file.bin`),
          expectedRevision: 1,
        });
        await waitForCondition(() => fixture.requests.length === 1);
        seamCommand(runtime, {
          commandType: 'CANCEL_LINEAGE',
          aggregateId: CONTRACT,
          payload: {},
          expectedRevision: 2,
        });
        const view = await waitForTerminal(() => runtime.seam.inspectProjection(CONTRACT));
        expect(view.terminal?.stopReason).toBe('USER_CANCELLED');
        expect(connectionClosed).toBe(true);
        closureBeforeRestart = view.terminal;
      } finally {
        closeRuntime(runtime);
      }
      expect(fixture.requests).toHaveLength(1);

      // Reopen: the journal replays the durably committed cancel (lineage
      // CANCELLED); the reconcile re-derives the identical closure from
      // durable truth with no new transfer and no fabricated completion.
      const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        const view = await waitForTerminal(() => reopened.seam.inspectProjection(CONTRACT));
        expect(view.lineage.status).toBe('TERMINAL');
        expect(view.terminal).toEqual(closureBeforeRestart);
        expect(view.terminal?.stopReason).toBe('USER_CANCELLED');
        expect(fixture.requests).toHaveLength(1);
      } finally {
        closeRuntime(reopened);
      }
    },
  );
});

describe('durable target evidence basis (#101 P2-2)', () => {
  it(
    'publisher-hash and no-digest successful records stay distinguishable across restart',
    { timeout: 60_000 },
    async () => {
      const rootDir = makeTempDir('s1-evidence-basis');
      dirs.push(rootDir);
      const fixture = new ControlledHttpFixture();
      fixtures.push(fixture);
      const baseUri = await fixture.start();
      const bytes = new Uint8Array(Array.from({ length: 8192 }, (_, index) => (index * 7) % 251));
      const digest = createHash('sha256').update(bytes).digest('hex');
      fixture.serveFile('/file.bin', { body: bytes, etag: '"s1-basis"' });

      const runtime = openRuntime(rootDir);
      const digested = 'contract-s1-dig';
      const digestFree = 'contract-s1-free';
      // One fresh identity set per download invocation, exactly like the
      // CLI: the durable ledger converges duplicates by (snapshot, member),
      // so two ordinary downloads never share identities.
      const digestedPayload = {
        snapshotId: 's1snap-dig',
        memberId: 's1member-dig',
        artifactId: 's1artifact-dig',
        delivery: {
          locatorUri: `${baseUri}/file.bin`,
          declaredRedirectHosts: [new URL(baseUri).host],
          expectedSha256: digest,
        },
      };
      const freePayload = {
        snapshotId: 's1snap-free',
        memberId: 's1member-free',
        artifactId: 's1artifact-free',
        delivery: {
          locatorUri: `${baseUri}/file.bin`,
          declaredRedirectHosts: [new URL(baseUri).host],
        },
      };
      try {
        for (const [contractId, payload] of [
          [digested, digestedPayload],
          [digestFree, freePayload],
        ] as const) {
          expect(
            seamCommand(runtime, {
              commandType: 'SUBMIT_CONTRACT',
              aggregateId: contractId,
              payload: rawSingleResourceContract({ contractId }),
            }).outcome,
          ).toBe('ACCEPTED');
          expect(
            seamCommand(runtime, {
              commandType: 'EXECUTE_S1_DIRECT_ACQUISITION',
              aggregateId: contractId,
              payload,
              expectedRevision: 1,
            }).outcome,
          ).toBe('ACCEPTED');
        }
        await waitForTerminal(() => runtime.seam.inspectProjection(digested));
        await waitForTerminal(() => runtime.seam.inspectProjection(digestFree));

        const digestedView = runtime.seam.inspectProjection(digested);
        const freeView = runtime.seam.inspectProjection(digestFree);
        expect(digestedView?.terminal?.requestFulfillment).toBe('COMPLETE');
        expect(freeView?.terminal?.requestFulfillment).toBe('COMPLETE');
        // The two successful S1 records can never be confused: the declared
        // publisher digest is a decisive byte-identity anchor; the ordinary
        // no-digest download rests on the probative requested-locator
        // provenance basis (C34).
        expect(digestedView?.targetEvidence).toStrictEqual({
          artifactId: 's1artifact-dig',
          effectId: `effect:${digested}:s1snap-dig:target-file-001`,
          artifactSha256: digest,
          basis: 'PUBLISHED_SHA256',
          certaintyClass: 'DECISIVE',
        });
        expect(freeView?.targetEvidence).toMatchObject({
          basis: 'REQUESTED_LOCATOR_PROVENANCE',
          certaintyClass: 'PROBATIVE',
        });
        // Secret-free: no locator/query material ever enters the receipt.
        expect(JSON.stringify(freeView?.targetEvidence)).not.toContain('file.bin');
        expect(JSON.stringify(freeView?.targetEvidence)).not.toContain('http');

        // The accepted artifact's durable provenance row carries the same
        // typed basis (SQLite restart truth, not just in-memory projection).
        for (const [contractId, expectedBasis] of [
          [digested, 'PUBLISHED_SHA256'],
          [digestFree, 'REQUESTED_LOCATOR_PROVENANCE'],
        ] as const) {
          const workItem = runtime.writer.reader
            .workItems()
            .find((item) => item.contractId === contractId);
          expect(workItem).toBeDefined();
          const artifact = runtime.writer.reader.artifacts(workItem!.workItemId)[0];
          expect(artifact).toBeDefined();
          const provenance = JSON.parse(artifact!.provenanceJson) as {
            targetEvidence?: { basis?: string };
          };
          expect(provenance.targetEvidence?.basis).toBe(expectedBasis);
        }
      } finally {
        closeRuntime(runtime);
      }

      // Restart: the journaled receipts re-establish the identical recorded
      // identity bases (no re-download, no re-derivation drift).
      expect(fixture.requests).toHaveLength(2);
      const reopened = reopenCoreRuntime(runtimeOptions(rootDir));
      try {
        expect(reopened.seam.inspectProjection(digested)?.targetEvidence?.basis).toBe(
          'PUBLISHED_SHA256',
        );
        expect(reopened.seam.inspectProjection(digestFree)?.targetEvidence?.basis).toBe(
          'REQUESTED_LOCATOR_PROVENANCE',
        );
        await waitForTerminal(() => reopened.seam.inspectProjection(digested));
        await waitForTerminal(() => reopened.seam.inspectProjection(digestFree));
        expect(fixture.requests).toHaveLength(2);
      } finally {
        closeRuntime(reopened);
      }
    },
  );
});
