/**
 * v0.2 T04 — DirectAcquisitionBridge: the trusted C/Host bridge for the
 * `acquisition.acquire` operation (direct-host lane).
 *
 * Contract (frozen Task Pack T04):
 *  - PERMIT GATE: the existing `DirectHttpAdapter.acquire` is called ONLY
 *    when the call carries a kernel permit context (effectId +
 *    durableControlTurnId). Without a permit the bridge refuses with a typed
 *    terminal envelope and performs ZERO network and ZERO filesystem
 *    operations (proved by fixture request counts in the tests).
 *  - TARGETREF: the confirmed intent's targetRef is resolved ONLY through
 *    the injected registry; the bridge never parses it as a URL/path.
 *  - SINGLE BUDGET TRUTH: all budget consumption flows through the injected
 *    `TransferBudgetLedgerPort`; the bridge keeps no private ledger and no
 *    auto-retry — one dispatch is at most ONE adapter acquire (attempt 0).
 *  - DIGEST-BACKED MATERIALIZATION: bytes are written only after the
 *    adapter's target validation AND a bridge-side digest re-check; the write
 *    is atomic (tmp + rename) and the artifact path must pass the T01
 *    `validateArtifactPath` containment grammar against the confirmed root.
 *    Any failure or digest mismatch leaves NO file behind.
 *  - CANCELLATION: the caller's AbortSignal is forwarded verbatim; the bridge
 *    never swallows or re-fires it.
 *  - REDIRECT DOMAIN: `allowedRedirectHosts` come from the registry record
 *    (single source) and are forwarded unchanged — the bridge never widens
 *    the declared delivery graph.
 *
 * Every refusal is a typed terminal `EffectEnvelope` (A05: only a typed
 * terminal outcome settles an effect); the bridge returns BOUNDED EVIDENCE
 * ONLY — never acquired bytes.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type EffectId,
} from '@xdownload/domain-contracts';
import {
  validateArtifactPath,
  validateConfirmedIntent,
  validateMaterializedEvidence,
  type ConfirmedDownloadIntent,
  type EffectEnvelope,
} from '@xdownload/download-domain-app/src/contracts/index.ts';
import {
  DirectHttpAdapter,
  type TransferBudgetLedgerPort,
} from '../../../direct-acquisition/src/index.ts';
import type { TargetRefRegistry } from './target-ref-registry.ts';

/** Kernel permit context riding one acquisition dispatch (T04 permit gate). */
export interface KernelPermitContext {
  /** Durable effect identity the kernel minted for this acquisition. */
  readonly effectId: string;
  /** Durable control turn the effect was admitted in. */
  readonly durableControlTurnId: string;
}

export interface DirectAcquisitionBridgeCounters {
  acquireCalls: number;
  permitRefusals: number;
  scopeRefusals: number;
  targetRefRefusals: number;
  pathRefusals: number;
  filesWritten: number;
  bytesDownloaded: number;
}

export interface DirectAcquisitionBridgeOptions {
  readonly signal?: AbortSignal | undefined;
  /** Artifact path inside the confirmed root; defaults to `<requestId>.bin`. */
  readonly artifactPath?: string | undefined;
}

/** Bridge-side transfer observability record (never gates anything). */
export interface TransferStartRecord {
  readonly requestId: string;
  readonly uri: string;
  readonly at: number;
}

interface PermitRefusal {
  readonly code: 'PERMIT_REQUIRED' | 'PERMIT_MALFORMED';
  readonly message: string;
}

const OPERATION_ACQUIRE = 'acquisition.acquire';

export class DirectAcquisitionBridge {
  readonly counters: DirectAcquisitionBridgeCounters = {
    acquireCalls: 0,
    permitRefusals: 0,
    scopeRefusals: 0,
    targetRefRefusals: 0,
    pathRefusals: 0,
    filesWritten: 0,
    bytesDownloaded: 0,
  };
  readonly transferStarts: TransferStartRecord[] = [];

  private readonly registry: TargetRefRegistry;
  private readonly adapter: DirectHttpAdapter;

  constructor(registry: TargetRefRegistry, ledger: TransferBudgetLedgerPort) {
    this.registry = registry;
    this.adapter = new DirectHttpAdapter(ledger);
  }

  /**
   * Execute one confirmed acquisition behind the permit gate. Returns a
   * typed terminal envelope: ok with bounded materialized evidence, or a
   * typed refusal with zero network/zero file side effects.
   */
  async acquire(
    intent: unknown,
    permit: unknown,
    options: DirectAcquisitionBridgeOptions = {},
  ): Promise<EffectEnvelope> {
    this.counters.acquireCalls += 1;

    // 1. Permit gate — before any registry lookup, ledger touch, network or file.
    const permitGate = parsePermit(permit);
    if (permitGate !== null) {
      this.counters.permitRefusals += 1;
      return refusalEnvelope('unpermitted', permitGate.code, permitGate.message);
    }
    const permitContext = permit as KernelPermitContext;
    const externalRef = permitContext.effectId;

    // 2. Re-verify the confirmed scope — a K payload can never widen it.
    const intentCheck = validateConfirmedIntent(intent);
    if (!intentCheck.ok) {
      this.counters.scopeRefusals += 1;
      return refusalEnvelope(externalRef, intentCheck.diagnostics[0]!.code, intentCheck.diagnostics[0]!.message);
    }
    const confirmed: ConfirmedDownloadIntent = intentCheck.value;
    if (confirmed.allowedOperation !== OPERATION_ACQUIRE) {
      this.counters.scopeRefusals += 1;
      return refusalEnvelope(
        externalRef,
        'OPERATION_NOT_SUPPORTED',
        `the direct bridge serves only ${OPERATION_ACQUIRE}, not '${confirmed.allowedOperation}'`,
      );
    }

    // 3. Resolve the opaque targetRef through the injected registry only.
    const recordCheck = this.registry.resolve(confirmed.targetRef);
    if (!recordCheck.ok) {
      this.counters.targetRefRefusals += 1;
      return refusalEnvelope(externalRef, recordCheck.diagnostics[0]!.code, recordCheck.diagnostics[0]!.message);
    }
    const record = recordCheck.value;

    // 4. Artifact path containment BEFORE any network (a refused path is a
    // zero-transfer refusal by construction).
    const requestedPath = options.artifactPath ?? join(confirmed.outputRootScope, `${confirmed.requestId}.bin`);
    const pathCheck = validateArtifactPath(confirmed.outputRootScope, requestedPath);
    if (!pathCheck.ok) {
      this.counters.pathRefusals += 1;
      return refusalEnvelope(externalRef, pathCheck.diagnostics[0]!.code, pathCheck.diagnostics[0]!.message);
    }
    const resolvedRoot = resolve(confirmed.outputRootScope);
    const resolvedPath = resolve(pathCheck.value);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
      this.counters.pathRefusals += 1;
      return refusalEnvelope(
        externalRef,
        'OUTPUT_ROOT_ESCAPED',
        `artifact path '${pathCheck.value}' escapes the authorized output root after resolution`,
      );
    }

    // 5. Drive the EXISTING adapter exactly once (no hidden auto-retry).
    this.transferStarts.push({ requestId: confirmed.requestId, uri: record.uri, at: Date.now() });
    const transfer = await this.adapter.acquire({
      effectId: adapterEffectIdOf(externalRef),
      contractId: unwrapOrThrow(makeContractId(`contract-${confirmed.lineageId}`)),
      slice: confirmed.slice,
      selectedMemberId: unwrapOrThrow(makeMemberId(`member-${confirmed.requestId}`)),
      binding: {
        identity: unwrapOrThrow(makeLogicalTargetId(`target-${confirmed.requestId}`)),
        locator: { kind: 'direct', uri: record.uri },
        provenance: { binding: 'DECLARED_DELIVERY_EDGE', originLocatorUri: record.uri },
      },
      expectedSha256: confirmed.digestAnchor,
      expectedTotalBytes: confirmed.declaredBytes ?? record.expectedTotalBytes,
      allowedRedirectHosts: record.allowedRedirectHosts,
      attempt: 0,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    // 6. Terminal acceptance: adapter projection must be a completed,
    // all-validations-passed transfer carrying bytes.
    if (!transfer.ok) {
      return refusalEnvelope(externalRef, transfer.diagnostics[0]!.code, transfer.diagnostics[0]!.message);
    }
    const outcome = transfer.value;
    const completed =
      outcome.reason === 'COMPLETED' && outcome.bytes !== undefined && outcome.allApplicableValidationPassed;
    if (!completed || outcome.bytes === undefined) {
      return refusalEnvelope(externalRef, outcome.reason, `transfer did not complete (${outcome.reason})`);
    }

    // 7. Digest re-check (defense in depth behind the adapter target layer):
    // mismatched bytes never materialize.
    const digest = createHash('sha256').update(outcome.bytes).digest('hex');
    if (confirmed.digestAnchor !== undefined && digest !== confirmed.digestAnchor) {
      return refusalEnvelope(
        externalRef,
        'DIGEST_MISMATCH',
        'materialized bytes do not match the confirmed digest anchor; no file was written',
      );
    }

    // 8. Atomic materialization inside the confirmed root.
    const bytesWritten = outcome.bytes.byteLength;
    try {
      mkdirSync(resolvedRoot, { recursive: true });
      const temporary = `${resolvedPath}.tmp`;
      writeFileSync(temporary, outcome.bytes);
      renameSync(temporary, resolvedPath);
    } catch (error) {
      return refusalEnvelope(
        externalRef,
        'MATERIALIZATION_FAILED',
        `artifact write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 9. Bounded evidence only, self-checked against the T01 grammar.
    const evidenceCheck = validateMaterializedEvidence(
      {
        fileSha256: digest,
        bytesWritten,
        artifactPath: pathCheck.value,
        stopReason: outcome.reason,
      },
      confirmed.outputRootScope,
    );
    if (!evidenceCheck.ok) {
      return refusalEnvelope(
        externalRef,
        evidenceCheck.diagnostics[0]!.code,
        `materialized evidence refused by the T01 evidence grammar: ${evidenceCheck.diagnostics[0]!.message}`,
      );
    }

    this.counters.filesWritten += 1;
    this.counters.bytesDownloaded += outcome.receivedBytes;
    return {
      phase: 'terminal',
      externalRef,
      outcome: {
        ok: true,
        output: {
          requestId: confirmed.requestId,
          lineageId: confirmed.lineageId,
          permitEffectId: permitContext.effectId,
          durableControlTurnId: permitContext.durableControlTurnId,
          artifactPath: evidenceCheck.value.artifactPath,
          fileSha256: evidenceCheck.value.fileSha256,
          bytesWritten: evidenceCheck.value.bytesWritten,
          receivedBytes: outcome.receivedBytes,
          stopReason: evidenceCheck.value.stopReason,
          targetBasis: outcome.targetBasis,
          locatorChainUris: outcome.locatorChain.map((binding) => binding.locator.uri),
        },
      },
    };
  }
}

// --- module-scope helpers ---------------------------------------------------

/** Validate the kernel permit context; null means a usable permit. */
function parsePermit(permit: unknown): PermitRefusal | null {
  if (typeof permit !== 'object' || permit === null || Array.isArray(permit)) {
    return {
      code: 'PERMIT_REQUIRED',
      message: 'direct acquisition requires a kernel permit context (effectId + durableControlTurnId)',
    };
  }
  const record = permit as Record<string, unknown>;
  const effectId = record.effectId;
  const turn = record.durableControlTurnId;
  const bounded = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (!bounded(effectId) || !bounded(turn)) {
    return {
      code: 'PERMIT_MALFORMED',
      message: 'kernel permit must carry bounded effectId and durableControlTurnId strings',
    };
  }
  return null;
}

function refusalEnvelope(externalRef: string, code: string, message: string): EffectEnvelope {
  return {
    phase: 'terminal',
    externalRef,
    outcome: { ok: false, error: { code, message } },
  };
}

/**
 * K effect ids can exceed the adapter id grammar; derive a deterministic
 * bounded alias so the adapter lineage stays stable across dispatches of the
 * same permit effect (same input → same alias, no counter drift).
 */
function adapterEffectIdOf(permitEffectId: string): EffectId {
  const direct = makeEffectId(permitEffectId);
  if (direct.ok) {
    return direct.value;
  }
  const digest = createHash('sha256').update(permitEffectId).digest('hex').slice(0, 32);
  return unwrapOrThrow(makeEffectId(`xd-t04-${digest}`));
}
