/**
 * V022-A04 — Direct lane integration matrix, re-established under the Core
 * composition root (packages/core-runtime/test/, discovered by
 * `pnpm run ci:verify`).
 *
 * Real end-to-end over: the sealed direct BUILD loaded through the SDK
 * public `load`, the pinned T04 Host DirectAcquisitionBridge, the EXISTING
 * DirectHttpAdapter, and a REAL 127.0.0.1 node:http fixture on a random
 * port (T04/T01 precedent, zero mocks). The runtime is assembled Core-side
 * by ./slice-journey-testkit.ts (`assembleDirectRuntime`) — the physical
 * Host store/bridge/registry/ledger come from the trusted Host package
 * root, the sealed BUILD and the domain journey from the App package root.
 *
 * A04 R2 EVIDENCE SCOPE (review P1 disposition): this matrix is
 * component-level integration evidence assembled by Core test support — the
 * pinned SDK cannot compose the direct route into the production S4 one-K
 * (route selection by intentType only; the sealed #183 Standard Router
 * returns 'ambiguous' for the shared `confirmDownload` intent — the exact
 * public API limitation with probe transcripts is recorded on
 * kaicreator-mm/xDownload#357). Per Task Pack §3.1.4 the Builder stopped
 * rather than substituting a parallel production claim; the production
 * one-K integration proof of the selected Domain App lives in
 * domain-app-route.test.ts / domain-app-media-flow.test.ts.
 *
 * Counter-evidence convention (T04 precedent): every zero-effect guarantee
 * is proven three ways — bridge-side counters, fixture-side recorded socket
 * requests, and the durable K store (effect-journal / effect-permit docs) —
 * so a claim is never anchored in one component's own bookkeeping.
 *
 * Evidence precision (A03 P2-3): the N3 restart below is a SAME-PROCESS
 * stop/reopen over the same durable store file. It is named and described
 * as such; it is not crash, power-loss or cross-process proof, and no
 * multi-process CAS claim is made.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import type { V10ScopedSubscriptionEvent } from '@kaicreator/domain-harness-microkernel';
import {
  submitConfirmedDownload,
  type DownloadRuntime,
  type SubmissionOutcome,
} from '@xdownload/download-domain-app';
import { assembleDirectRuntime, LocalHttpFixture } from './slice-journey-testkit.ts';

// ---------------------------------------------------------------------------
// Workspace: one assembled runtime per test over its own fixture + temp root.
// ---------------------------------------------------------------------------

function payload(size: number, seed = 7): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface Workspace {
  readonly root: string;
  readonly outputRoot: string;
  readonly storePath: string;
  readonly fixture: LocalHttpFixture;
  readonly runtime: DownloadRuntime;
  readonly handle: string;
  dispose(): Promise<void>;
}

const workspaces: Workspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) {
    await workspace.dispose();
  }
});

async function makeWorkspace(name: string): Promise<Workspace> {
  const fixture = new LocalHttpFixture();
  await fixture.start();
  const root = mkdtempSync(join(tmpdir(), `xd-a04-direct-${name}-`));
  const outputRoot = join(root, 'out');
  const storePath = join(root, 'k-docs.json');
  const handle = `ref:fixture/${name}.bin`;
  const runtime = await assembleDirectRuntime({
    storePath,
    targetRefs: [
      { handle, record: { uri: fixture.uri('/file.bin'), allowedRedirectHosts: [fixture.host] } },
    ],
  });
  const workspace: Workspace = {
    root,
    outputRoot,
    storePath,
    fixture,
    runtime,
    handle,
    async dispose() {
      workspace.runtime.stop();
      await workspace.fixture.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  workspaces.push(workspace);
  return workspace;
}

function intentFor(
  workspace: Workspace,
  requestId: string,
  body: Buffer,
  digestAnchor: string = sha256(body),
): Record<string, unknown> {
  return {
    requestId,
    lineageId: `lineage-${requestId}`,
    targetRef: workspace.handle,
    outputRootScope: workspace.outputRoot,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor,
    declaredBytes: body.byteLength,
    caller: { actor: 'zcode:xd-a04-builder-agent', sessionRef: 'session:a04-direct-test' },
  };
}

interface AnswerView {
  readonly target?: { readonly instanceKey?: string };
  readonly snapshot?: { readonly state?: { readonly stateKey?: string } };
}

function journalHasSuccess(workspace: Workspace): boolean {
  return workspace.runtime.store
    .journalRows()
    .some(({ record }) => JSON.stringify(record).includes('"ok":true'));
}

async function waitForFixtureRequest(workspace: Workspace, before: number): Promise<void> {
  for (let i = 0; i < 400 && workspace.fixture.requests.length === before; i += 1) {
    await new Promise((wait) => setTimeout(wait, 25));
  }
}

// ---------------------------------------------------------------------------
// P1 — the full direct journey: intent → K permit → bridge → adapter → file
// ---------------------------------------------------------------------------

describe('P1 — real journey: intent → K permit → T04 bridge → DirectHttpAdapter → digest-backed file', () => {
  it('completes with real bytes, truthful terminal query/subscription and single-triple evidence', async () => {
    const workspace = await makeWorkspace('p1');
    const body = payload(4096, 11);
    workspace.fixture.serveBytes('/file.bin', body);
    const requestId = 'p1-file';

    const outcome = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, body),
    );
    assert.equal(outcome.status, 'completed');
    if (outcome.status !== 'completed') return;

    // Real bytes and digest: the evidence reproduces the served body and the
    // artifact is really on disk with those bytes.
    assert.equal(outcome.evidence.fileSha256, sha256(body));
    assert.equal(outcome.evidence.bytesWritten, body.byteLength);
    assert.equal(outcome.evidence.stopReason, 'COMPLETED');
    const artifactPath = join(workspace.outputRoot, `${requestId}.bin`);
    assert.ok(existsSync(artifactPath));
    const onDisk = readFileSync(artifactPath);
    assert.equal(sha256(onDisk), sha256(body));
    assert.equal(onDisk.byteLength, body.byteLength);
    assert.equal(
      outcome.evidence.artifactPath === artifactPath ||
        outcome.evidence.artifactPath === artifactPath.replaceAll('\\', '/'),
      true,
    );

    // The dispatch ran under a LIVE K-issued permit identity.
    assert.ok(outcome.permitEffectId.length > 0);
    const receipt = outcome.receipt as {
      status?: string;
      admitted?: { effects?: { disposition?: string }[] };
    };
    assert.equal(receipt.status, 'admitted');
    assert.equal(receipt.admitted?.effects?.[0]?.disposition, 'executed');
    assert.equal(outcome.terminal.phase, 'terminal');

    // Triple evidence, side 1 — bridge counters: exactly one permitted call.
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, 1);
    assert.equal(workspace.runtime.bridge.counters.filesWritten, 1);
    assert.equal(workspace.runtime.bridge.counters.permitRefusals, 0);
    // Triple evidence, side 2 — the real socket saw exactly one request.
    assert.equal(workspace.fixture.requestCount('/file.bin'), 1);

    // Terminal query: the B instance settled truthfully at 'acquired'.
    const answer = (await workspace.runtime.app.query({
      workflowId: 'download-acquisition',
      instanceKey: `download-${requestId}`,
    })) as AnswerView;
    assert.equal(answer.target?.instanceKey, `download-${requestId}`);
    assert.equal(answer.snapshot?.state?.stateKey, 'acquired');

    // Terminal subscription: subscribe, then replay the SAME occurrence —
    // the live seam delivers the frozen public projection of the replay.
    const events: V10ScopedSubscriptionEvent[] = [];
    const subscription = await workspace.runtime.app.subscribe(
      { workflowId: 'download-acquisition', instanceKey: `download-${requestId}` },
      (event) => events.push(event),
    );
    const replay = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, body),
    );
    assert.equal(replay.status, 'replayed');
    await new Promise((wait) => setTimeout(wait, 50));
    const admitted = events.find(
      (event) => event.kind === 'admitted' && event.occurrenceId === `msg-${requestId}`,
    );
    assert.ok(admitted, 'the replayed occurrence must surface through the subscription');
    subscription.unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// P2 — exactly one K permit, exactly one journal row, no double journal
// ---------------------------------------------------------------------------

describe('P2 — exactly one K permit and no double journal', () => {
  it('mints exactly one durable permit and one journal row; replay adds none', async () => {
    const workspace = await makeWorkspace('p2');
    const body = payload(2048, 21);
    workspace.fixture.serveBytes('/file.bin', body);
    const requestId = 'p2-permit';
    const store = workspace.runtime.store;

    assert.equal(store.journalRows().length, 0, 'a fresh runtime starts with zero journal rows');
    assert.equal(store.permitDocs().length, 0, 'a fresh runtime starts with zero permits');

    const outcome = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, body),
    );
    assert.equal(outcome.status, 'completed');

    // Exactly one K permit (durable), exactly one journal row (durable).
    assert.equal(store.permitDocs().length, 1, 'exactly one K permit must exist');
    assert.equal(store.journalRows().length, 1, 'exactly one effect journal row must exist');
    const permitKey = store.permitDocs()[0]?.key ?? '';
    const journalKey = store.journalRows()[0]?.key ?? '';
    assert.ok(
      permitKey.includes(`effect-permit:${outcome.permitEffectId}`),
      'the durable permit is keyed by the permit effect identity',
    );
    assert.ok(
      journalKey.includes('effect-journal:'),
      'the journal row is an effect-journal document',
    );

    // Permit consumed exactly once: one bridge dispatch, one executed row.
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, 1);
    assert.equal(workspace.fixture.requestCount('/file.bin'), 1);
    const journalRecord = store.journalRows()[0]?.record as { status?: string };
    assert.equal(journalRecord?.status, 'completed');

    // Idempotent replay of the same messageId: zero second effects, and the
    // journal/permit families stay at exactly one document (no double journal).
    const replay = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, body),
    );
    assert.equal(replay.status, 'replayed');
    assert.equal(store.permitDocs().length, 1);
    assert.equal(store.journalRows().length, 1);
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, 1);
    assert.equal(workspace.runtime.bridge.counters.filesWritten, 1);
    assert.equal(workspace.fixture.requestCount('/file.bin'), 1);
  });
});

// ---------------------------------------------------------------------------
// N1 — duplicate messageId is idempotent with zero second effects
// ---------------------------------------------------------------------------

describe('N1 — duplicate messageId: idempotent, zero second effects', () => {
  it('replays the settled occurrence without re-dispatching the effect', async () => {
    const workspace = await makeWorkspace('n1');
    const body = payload(1024, 31);
    workspace.fixture.serveBytes('/file.bin', body);
    const requestId = 'n1-dup';
    const intent = intentFor(workspace, requestId, body);

    const first = await submitConfirmedDownload(workspace.runtime, intent);
    assert.equal(first.status, 'completed');
    const artifactPath = join(workspace.outputRoot, `${requestId}.bin`);
    const firstBytes = readFileSync(artifactPath);
    const acquireCallsAfterFirst = workspace.runtime.bridge.counters.acquireCalls;
    const requestsAfterFirst = workspace.fixture.requests.length;
    const journalAfterFirst = workspace.runtime.store.journalRows().length;

    const duplicate = await submitConfirmedDownload(workspace.runtime, intent);
    assert.equal(duplicate.status, 'replayed');
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, acquireCallsAfterFirst);
    assert.equal(workspace.fixture.requests.length, requestsAfterFirst);
    assert.equal(workspace.runtime.store.journalRows().length, journalAfterFirst);
    assert.deepEqual(readFileSync(artifactPath), firstBytes);
  });
});

// ---------------------------------------------------------------------------
// N2 — mid-flight abort: no file, honest non-completion, explicit re-send
// ---------------------------------------------------------------------------

describe('N2 — mid-flight abort: truthful failure, no file, no auto-redownload', () => {
  it('propagates the caller AbortSignal to the bridge and requires a new authorization', async () => {
    const workspace = await makeWorkspace('n2');
    const body = payload(4096, 41);
    workspace.fixture.stallAfterBytes('/file.bin', body, 64);
    const requestId = 'n2-cancel';

    const controller = new AbortController();
    const pending: Promise<SubmissionOutcome> = submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, body),
      { signal: controller.signal },
    );

    // Cancel as soon as the physical request hits the fixture.
    await waitForFixtureRequest(workspace, 0);
    assert.ok(workspace.fixture.requests.length > 0, 'the transfer must have started');
    controller.abort(new Error('caller cancelled'));

    const outcome = await pending;
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.aborted, true, 'the failure must be marked as the caller cancellation');
    assert.equal(outcome.error.code, 'USER_CANCELLED');
    assert.equal(outcome.terminal?.phase, 'terminal');
    assert.equal(outcome.terminal?.outcome.ok, false);

    // No file, honest journal, exactly one attempt — no auto-redownload.
    assert.equal(existsSync(join(workspace.outputRoot, `${requestId}.bin`)), false);
    assert.equal(workspace.runtime.bridge.counters.filesWritten, 0);
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, 1);
    assert.equal(workspace.fixture.requestCount('/file.bin'), 1);
    assert.equal(
      journalHasSuccess(workspace),
      false,
      'no journal row may claim success after an abort',
    );

    // A NEW authorized submission under a fresh identity succeeds.
    const retryBody = payload(1024, 42);
    workspace.fixture.serveBytes('/file.bin', retryBody);
    const retry = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, 'n2-retry', retryBody),
    );
    assert.equal(retry.status, 'completed');
    assert.ok(existsSync(join(workspace.outputRoot, 'n2-retry.bin')));
  });
});

// ---------------------------------------------------------------------------
// N3 — same-process stop/reopen: the durable store survives, replay idempotent
// ---------------------------------------------------------------------------

describe('N3 — SAME-PROCESS stop/reopen: journal survives, replay idempotent', () => {
  it('reopens the same store file (same-process restart) and replays the settled occurrence without new effects', async () => {
    const workspace = await makeWorkspace('n3');
    const body = payload(512, 51);
    workspace.fixture.serveBytes('/file.bin', body);
    const requestId = 'n3-restart';
    const intent = intentFor(workspace, requestId, body);

    const first = await submitConfirmedDownload(workspace.runtime, intent);
    assert.equal(first.status, 'completed');
    const journalBefore = workspace.runtime.store.journalRows().length;
    const permitDocsBefore = workspace.runtime.store.permitDocs().length;
    assert.ok(journalBefore >= 1);
    const artifactPath = join(workspace.outputRoot, `${requestId}.bin`);
    assert.ok(existsSync(artifactPath));

    // Same-process restart boundary: stop the runtime, then re-assemble over
    // the SAME durable store file (the fixture stays up; the replay needs no
    // network anyway). This is a same-process stop/reopen — NOT crash,
    // power-loss or cross-process evidence (A03 P2-3 precision).
    workspace.runtime.stop();
    const reopened = await assembleDirectRuntime({
      storePath: workspace.storePath,
      targetRefs: [
        {
          handle: workspace.handle,
          record: {
            uri: workspace.fixture.uri('/file.bin'),
            allowedRedirectHosts: [workspace.fixture.host],
          },
        },
      ],
    });
    // Dispose the reopened runtime BEFORE the original workspace teardown
    // removes the temp root: unshift puts it first in the afterEach order.
    workspaces.unshift({
      root: '',
      outputRoot: workspace.outputRoot,
      storePath: workspace.storePath,
      fixture: workspace.fixture,
      runtime: reopened,
      handle: workspace.handle,
      async dispose() {
        reopened.stop();
      },
    });

    // The journal and the permit survived the same-process boundary.
    assert.equal(reopened.store.journalRows().length, journalBefore);
    assert.equal(reopened.store.permitDocs().length, permitDocsBefore);
    // The reopened bridge is fresh: a replay must not touch it at all.
    const replay = await submitConfirmedDownload(reopened, intent);
    assert.equal(replay.status, 'replayed');
    assert.equal(reopened.bridge.counters.acquireCalls, 0);
    assert.equal(reopened.bridge.counters.filesWritten, 0);
    assert.equal(existsSync(artifactPath), true, 'no second artifact after restart replay');
    assert.deepEqual(readFileSync(artifactPath), body);
  });
});

// ---------------------------------------------------------------------------
// N4 — digest mismatch: no file, truthful failed journey
// ---------------------------------------------------------------------------

describe('N4 — digest mismatch: no file is materialized', () => {
  it('fails the journey truthfully when served bytes break the confirmed anchor', async () => {
    const workspace = await makeWorkspace('n4');
    const declared = payload(512, 61);
    const actual = payload(512, 62);
    assert.notEqual(sha256(actual), sha256(declared));
    workspace.fixture.serveBytes('/file.bin', actual);
    const requestId = 'n4-tamper';

    const outcome = await submitConfirmedDownload(
      workspace.runtime,
      intentFor(workspace, requestId, actual, sha256(declared)),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.error.code, 'WRONG_TARGET');
    assert.equal(outcome.aborted, false);

    assert.equal(existsSync(join(workspace.outputRoot, `${requestId}.bin`)), false);
    assert.equal(workspace.runtime.bridge.counters.filesWritten, 0);
    assert.equal(
      workspace.runtime.bridge.counters.acquireCalls,
      1,
      'exactly one attempt, no retry',
    );
    assert.equal(workspace.fixture.requestCount('/file.bin'), 1);
    assert.equal(journalHasSuccess(workspace), false);
  });
});

// ---------------------------------------------------------------------------
// N5 — the T01 no-widening gate refuses before any send
// ---------------------------------------------------------------------------

describe('N5 — T01 gate before send: refused intents create zero effects', () => {
  it('refuses scope widening and raw-locator substitution before K admission', async () => {
    const workspace = await makeWorkspace('n5');
    const body = payload(64, 71);
    workspace.fixture.serveBytes('/file.bin', body);

    const widened = { ...intentFor(workspace, 'n5-wide', body), extraField: 'not allowed' };
    await assert.rejects(
      submitConfirmedDownload(workspace.runtime, widened),
      /CONFIRMED_INTENT_INVALID.*SCOPE_WIDENING_REFUSED/,
    );
    const locator = {
      ...intentFor(workspace, 'n5-locator', body),
      targetRef: 'https://evil.example/file.bin',
    };
    await assert.rejects(
      submitConfirmedDownload(workspace.runtime, locator),
      /CONFIRMED_INTENT_INVALID.*LOCATOR_SUBSTITUTION_REJECTED/,
    );

    // Triple evidence of the zero effect: no bridge call, no socket request,
    // no journal row, no permit.
    assert.equal(workspace.runtime.bridge.counters.acquireCalls, 0);
    assert.equal(workspace.fixture.requests.length, 0);
    assert.equal(workspace.runtime.store.journalRows().length, 0);
    assert.equal(workspace.runtime.store.permitDocs().length, 0);
  });
});
