/**
 * v0.2 T03 — business lane runtime matrix (node:test, REAL SDK load+send).
 *
 * Over the real selected K/S/B/C sealed BUILD loaded through the public
 * @kaicreator/domain-harness-microkernel `load`, with the in-test plain CAS
 * store (PoC plain-store pattern, in-memory) and the T03 stub capability's
 * test-only trusted-bridge pin:
 *
 *   - permitted external effect: live K-issued permit, executed disposition,
 *     T01 terminal envelope, truthful journal, zero model (llmAvoided);
 *   - route-less intent: typed refusal, zero dispatch, zero journal rows;
 *   - effect fault: honest failed journal row, no fake success, no retry;
 *   - accepted/running ACK under await:'terminal': never a completion
 *     (asserted through the T01 normalizeEffectEnvelope grammar);
 *   - guard: declaredBytes above the sealed profile bound routes to the
 *     refused state with zero dispatch.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, type DomainApp } from '@kaicreator/domain-harness-microkernel';
import type { V10DocStore, V10DocWriteCondition, V10PublicIntent } from '@kaicreator/domain-harness-contracts';
import { normalizeEffectEnvelope, type EffectEnvelope } from '../contracts/index.ts';
import { buildDownloadDomainApp, confirmDownloadRequest } from './composition.ts';

// ---------------------------------------------------------------------------
// In-test plain CAS store (PoC plain-store pattern, in-memory variant).
// ---------------------------------------------------------------------------

class InMemoryCasDocStore implements V10DocStore {
  readonly docs = new Map<string, { value: unknown; revision: number }>();

  async get(key: string): Promise<{ value: unknown; revision: number } | null> {
    const row = this.docs.get(key);
    return row === undefined ? null : { value: row.value, revision: row.revision };
  }

  async put(key: string, value: unknown, condition: V10DocWriteCondition): Promise<{ revision: number }> {
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(new Error(`CAS conflict on ${key}: document already exists`), {
          code: 'HOST_CAS_CONFLICT',
        });
      }
      this.docs.set(key, { revision: 0, value });
      return { revision: 0 };
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(
        new Error(
          `CAS conflict on ${key}: revision moved (expected ${condition.revision}, held ${existing === undefined ? 'absent' : existing.revision})`,
        ),
        { code: 'HOST_CAS_CONFLICT' },
      );
    }
    this.docs.set(key, { revision: condition.revision + 1, value });
    return { revision: condition.revision + 1 };
  }

  async remove(key: string, condition: V10DocWriteCondition): Promise<void> {
    const existing = this.docs.get(key);
    if (condition.kind === 'create') {
      if (existing !== undefined) {
        throw Object.assign(new Error(`CAS conflict on ${key}: create-conditioned remove refused`), {
          code: 'HOST_CAS_CONFLICT',
        });
      }
      return;
    }
    if (existing === undefined || existing.revision !== condition.revision) {
      throw Object.assign(new Error(`CAS conflict on ${key}: revision moved`), { code: 'HOST_CAS_CONFLICT' });
    }
    this.docs.delete(key);
  }

  keys(): readonly string[] {
    return [...this.docs.keys()].sort();
  }

  /** Durable K effect-journal records currently held by this store. */
  journalRows(): Array<{ key: string; record: unknown }> {
    return this.keys()
      .filter((key) => key.includes('effect-journal'))
      .map((key) => {
        // The journal doc wraps the effect record: {kernelModuleSha256, record}.
        const value = this.docs.get(key)?.value as { record?: unknown } | undefined;
        return { key, record: value?.record ?? value };
      });
  }
}

// ---------------------------------------------------------------------------
// Stub-bridge workspace: real load, test-only trusted-bridge pin.
// ---------------------------------------------------------------------------

interface AcquireCall {
  readonly payload: Record<string, unknown>;
  readonly permit: unknown;
  /** The envelope the bridge returned, exactly as the adapter produced it. */
  returned?: unknown;
}

interface EffectView {
  readonly disposition?: string;
  readonly output?: {
    readonly phase?: string;
    readonly outcome?: {
      readonly ok?: boolean;
      readonly output?: Record<string, unknown>;
      readonly error?: { readonly code?: string; readonly message?: string };
    };
  };
}

interface ReceiptView {
  readonly status?: string;
  readonly idempotentReplay?: boolean;
  readonly admitted?: {
    readonly effects?: readonly EffectView[];
    readonly resolver?: { readonly llmAvoided?: boolean };
  };
}

interface AnswerView {
  readonly target?: { readonly instanceKey?: string };
  readonly snapshot?: { readonly state?: { readonly stateKey?: string } };
}

type BridgeAcquire = (payload: Record<string, unknown>, permit: unknown, call: AcquireCall) => unknown;

interface Workspace {
  readonly app: DomainApp;
  readonly store: InMemoryCasDocStore;
  readonly calls: readonly AcquireCall[];
  dispose(): void;
}

const hostGlobals = (): { __xdownloadAcquisitionStubBridge?: { acquire: BridgeAcquire } } =>
  globalThis as unknown as { __xdownloadAcquisitionStubBridge?: { acquire: BridgeAcquire } };

async function makeWorkspace(bridgeAcquire: BridgeAcquire | null): Promise<Workspace> {
  const { built } = buildDownloadDomainApp();
  const store = new InMemoryCasDocStore();
  const calls: AcquireCall[] = [];
  if (bridgeAcquire !== null) {
    hostGlobals().__xdownloadAcquisitionStubBridge = {
      acquire: (payload, permit) => {
        const call: AcquireCall = { payload, permit };
        calls.push(call);
        call.returned = bridgeAcquire(payload, permit, call);
        return call.returned;
      },
    };
  }
  const tenantId = 'tenant:xdownload-v02-t03-test';
  const app = await load(built, {
    store,
    tenantId,
    deploymentIdentity: {
      deployedAppId: 'deploy:xdownload-v02-t03-test',
      tenantId,
      appId: built.appId,
    },
    queryAuthority: {
      principal: { actor: 'xdownload-v02-t03-test-host' },
      authorize: (principal, target) =>
        Boolean(
          principal !== null &&
            typeof principal === 'object' &&
            (principal as { actor?: string }).actor === 'xdownload-v02-t03-test-host' &&
            target.tenantId === tenantId,
        ),
    },
  });
  return {
    app,
    store,
    calls,
    dispose() {
      app.stop();
      delete hostGlobals().__xdownloadAcquisitionStubBridge;
    },
  };
}

function confirmedIntent(requestId: string): Record<string, unknown> {
  return {
    requestId,
    lineageId: 't03-lineage',
    targetRef: `ref:fixture/${requestId}.bin`,
    outputRootScope: '/tmp/xd-t03-out',
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: 'a'.repeat(64),
    declaredBytes: 4096,
    caller: { actor: 'zcode:xd-v02-t03-builder-agent', sessionRef: 'session:t03-test' },
  };
}

/** The settled terminal envelope a trusted Host bridge returns on success. */
function terminalOk(call: AcquireCall): unknown {
  return {
    phase: 'terminal',
    externalRef: `stub-acquire-${call.payload.requestId as string}`,
    outcome: {
      ok: true,
      output: {
        fileSha256: 'b'.repeat(64),
        bytesWritten: 4096,
        artifactPath: `/tmp/xd-t03-out/${String(call.payload.requestId)}.bin`,
        stopReason: 'COMPLETED',
        permitEffectId: (call.permit as { effectId?: string } | undefined)?.effectId,
      },
    },
  };
}

function errorCode(error: unknown): string {
  return String((error as { code?: string })?.code ?? (error as Error)?.name ?? '');
}

function assertNoSuccessInJournal(store: InMemoryCasDocStore): void {
  for (const { key, record } of store.journalRows()) {
    const text = JSON.stringify(record);
    assert.ok(
      !text.includes('"ok":true'),
      `journal row ${key} must not claim a successful outcome: ${text.slice(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

describe('P1 — permitted external effect: live permit, executed, terminal envelope, zero model', () => {
  it('drives the whole permitted journey over real load+send', async () => {
    const workspace = await makeWorkspace((_payload, _permit, call) => terminalOk(call));
    try {
      const journalBefore = workspace.store.journalRows().length;
      const { intent } = confirmDownloadRequest(confirmedIntent('t03-ok'));
      const receipt = (await workspace.app.send(intent)) as ReceiptView;

      assert.equal(receipt.status, 'admitted');
      const effect = receipt.admitted?.effects?.[0];
      assert.equal(effect?.disposition, 'executed');
      // The effect output IS the T01 envelope grammar; only a terminal ok
      // outcome settles the effect (A05).
      const envelope = normalizeEffectEnvelope(effect?.output);
      assert.ok(envelope.ok, 'effect output must normalize into the T01 envelope grammar');
      const settled: EffectEnvelope = envelope.value;
      assert.equal(settled.phase, 'terminal');
      assert.ok(settled.outcome.ok === true, 'permitted journey must settle ok');
      // The dispatch ran under a LIVE K-issued permit riding the attest
      // channel: the stub bridge observed the kernel-minted permit identity.
      const permitEffectId = settled.outcome.output.permitEffectId;
      assert.equal(typeof permitEffectId, 'string');
      assert.ok((permitEffectId as string).length > 0);

      // The effect input projection carried exactly the T01 confirmed-intent
      // fields plus the kernel-assigned durable effectId.
      assert.equal(workspace.calls.length, 1);
      const projected = workspace.calls[0]?.payload ?? {};
      for (const field of [
        'requestId',
        'lineageId',
        'targetRef',
        'outputRootScope',
        'allowedOperation',
        'slice',
        'digestAnchor',
        'declaredBytes',
        'caller',
        'effectId',
      ]) {
        assert.ok(field in projected, `effect payload must project ${field}`);
      }
      assert.equal(projected.targetRef, 'ref:fixture/t03-ok.bin');
      assert.equal(projected.allowedOperation, 'acquisition.acquire');
      assert.equal(projected.declaredBytes, 4096);

      // Truthful journal: rows were appended, none claim a failure.
      const rowsAfter = workspace.store.journalRows();
      assert.ok(rowsAfter.length > journalBefore, 'the K effect journal must record the effect');
      // Zero model: the deterministic resolver avoided any LLM grant.
      assert.equal(receipt.admitted?.resolver?.llmAvoided, true);

      const answer = (await workspace.app.query({
        workflowId: 'download-acquisition',
        instanceKey: 'download-t03-ok',
      })) as AnswerView;
      assert.equal(answer.target?.instanceKey, 'download-t03-ok');
      assert.equal(answer.snapshot?.state?.stateKey, 'acquired');

      // Same identity replay: idempotent, no second physical effect.
      const replay = (await workspace.app.send(intent)) as ReceiptView;
      assert.equal(replay.idempotentReplay, true);
      assert.equal(workspace.calls.length, 1, 'replay must not re-dispatch the effect');
    } finally {
      workspace.dispose();
    }
  });
});

describe('N1 — route-less intent: typed refusal, zero dispatch, zero journal rows', () => {
  it('refuses an unsealed intentType before any permit or capability run', async () => {
    const workspace = await makeWorkspace((_payload, _permit, call) => terminalOk(call));
    try {
      const raw: V10PublicIntent = {
        intentType: 'confirmDownloadUnknown',
        instanceKey: 'download-t03-unrouted',
        messageId: 'msg-t03-unrouted',
        input: confirmedIntent('t03-unrouted'),
      };
      await assert.rejects(workspace.app.send(raw), (error: unknown) => errorCode(error) === 'INTENT_UNSEALED');
      assert.equal(workspace.store.journalRows().length, 0, 'a refused intent writes zero journal rows');
      assert.equal(workspace.calls.length, 0, 'zero dispatch: the stub capability never ran');
    } finally {
      workspace.dispose();
    }
  });
});

describe('N2 — effect fault: honest failed journal row, no fake success, no retry', () => {
  it('journals the failure and never reports ok when the bridge throws', async () => {
    const workspace = await makeWorkspace(() => {
      throw new Error('stub bridge physical fault');
    });
    try {
      const { intent } = confirmDownloadRequest(confirmedIntent('t03-fault'));
      // The public facade masks the kernel-internal admission failure to its
      // fixed typed refusal (the honest observed shape, #183 PoC N01b); the
      // DURABLE journal row below is the truthfulness evidence.
      await assert.rejects(
        workspace.app.send(intent),
        (error: unknown) => /ADMISSION_EFFECT_FAILED|HOST_DOC_READ_FAILED|V10/.test(errorCode(error)),
      );
      assert.equal(workspace.calls.length, 1, 'no internal retry: exactly one adapter attempt');
      const rows = workspace.store.journalRows();
      assert.ok(rows.length >= 1, 'the failure must be journaled');
      assert.ok(
        rows.every(({ record }) => (record as { status?: string })?.status === 'failed'),
        'every effect row must be truthfully failed',
      );
      // The honest fault reason is preserved in the durable record.
      assert.ok(
        rows.some(({ record }) => JSON.stringify(record).includes('stub bridge physical fault')),
        'the journaled failure must carry the real fault, not a fake success',
      );
      assertNoSuccessInJournal(workspace.store);
      // The instance must not be observable as completed.
      const answer = (await workspace.app.query({
        workflowId: 'download-acquisition',
        instanceKey: 'download-t03-fault',
      })) as AnswerView;
      assert.notEqual(answer.snapshot?.state?.stateKey, 'acquired');
    } finally {
      workspace.dispose();
    }
  });

  it('fails closed honestly when the trusted bridge pin is absent (T04 not integrated)', async () => {
    const workspace = await makeWorkspace(null);
    try {
      const { intent } = confirmDownloadRequest(confirmedIntent('t03-nobridge'));
      await assert.rejects(
        workspace.app.send(intent),
        (error: unknown) => /ADMISSION_EFFECT_FAILED|HOST_DOC_READ_FAILED|V10/.test(errorCode(error)),
      );
      assertNoSuccessInJournal(workspace.store);
    } finally {
      workspace.dispose();
    }
  });
});

describe('N3 — accepted/running ACK under await:terminal is never a completion', () => {
  it('settles the effect as failed and the T01 grammar proves accepted carries no outcome', async () => {
    const workspace = await makeWorkspace(() => ({
      phase: 'accepted',
      externalRef: 'stub-accepted-1',
    }));
    try {
      const { intent } = confirmDownloadRequest(confirmedIntent('t03-accepted'));
      // await:'terminal' + an accepted ACK = honest effect failure
      // (V10_EXTERNAL_PENDING inside K; the facade's fixed public refusal
      // crosses the boundary). The journal row and the T01 grammar below are
      // the truthful-completion assertions.
      await assert.rejects(
        workspace.app.send(intent),
        (error: unknown) => /ADMISSION_EFFECT_FAILED|HOST_DOC_READ_FAILED|V10/.test(errorCode(error)),
      );
      assert.equal(workspace.calls.length, 1, 'exactly one adapter attempt, no auto-redownload');
      // The await:'terminal' refusal is journaled with its true reason.
      const rows = workspace.store.journalRows();
      assert.ok(
        rows.some(({ record }) => JSON.stringify(record).includes('V10_EXTERNAL_PENDING')),
        'the pending-not-success refusal must be journaled truthfully',
      );
      assertNoSuccessInJournal(workspace.store);

      // T01 grammar on the observed adapter return: an accepted-phase
      // envelope carries NO outcome — it can never be read as completion.
      const observed = workspace.calls[0]?.returned;
      const accepted = normalizeEffectEnvelope(observed);
      assert.ok(accepted.ok, 'the accepted ACK must normalize into the T01 envelope grammar');
      assert.equal(accepted.value.phase, 'accepted');
      assert.equal('outcome' in accepted.value, false, 'accepted must carry no outcome');

      // Same grammar for running, for contrast with the terminal grammar.
      const running = normalizeEffectEnvelope({ phase: 'running', externalRef: 'stub-running-1' });
      assert.ok(running.ok);
      assert.equal(running.value.phase, 'running');
      assert.equal('outcome' in running.value, false);

      const answer = (await workspace.app.query({
        workflowId: 'download-acquisition',
        instanceKey: 'download-t03-accepted',
      })) as AnswerView;
      assert.notEqual(answer.snapshot?.state?.stateKey, 'acquired');
    } finally {
      workspace.dispose();
    }
  });
});

describe('G1 — guard: declaredBytes above the sealed profile bound never dispatches', () => {
  it('routes an over-bound confirmed intent to the refused state with zero effect', async () => {
    const workspace = await makeWorkspace((_payload, _permit, call) => terminalOk(call));
    try {
      const overBound = { ...confirmedIntent('t03-overbound'), declaredBytes: 2_097_152 };
      const { intent } = confirmDownloadRequest(overBound); // valid per T01 (<= 1 TiB)
      const receipt = (await workspace.app.send(intent)) as ReceiptView;
      assert.equal(workspace.calls.length, 0, 'the guarded effect must never dispatch');
      assert.equal(workspace.store.journalRows().length, 0, 'zero effects: zero journal rows');
      const answer = (await workspace.app.query({
        workflowId: 'download-acquisition',
        instanceKey: 'download-t03-overbound',
      })) as AnswerView;
      assert.equal(answer.snapshot?.state?.stateKey, 'refused');
      assert.notEqual(receipt.status, undefined);
    } finally {
      workspace.dispose();
    }
  });
});
