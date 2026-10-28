/**
 * xDownload #183 PoC — trusted Host acquisition bridge (C's physical adapter).
 *
 * Installed as `globalThis.__xdAcquisitionBridge` before `load()`; the sealed
 * capability module reaches ONLY this object. The bridge:
 *   - re-verifies the confirmed scope (host, output root, digest shape) that
 *     the pre-send gateway sealed — the K effect payload cannot widen it;
 *   - claims a one-writer slot per artifact lineage in a Host CAS file (N06);
 *   - drives the EXISTING `DirectHttpAdapter` (real transfer, budget ledger,
 *     redirect-scope enforcement, AbortSignal cancellation);
 *   - writes the materialized file only after the full digest check, inside
 *     the authorized root (containment re-checked);
 *   - returns BOUNDED EVIDENCE ONLY to the Kernel — never bytes.
 * One dispatch = at most one physical transfer attempt; no internal retry, no
 * auto-redownload, no journal access.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  DirectHttpAdapter,
  type DirectTransferOutcome,
  type TransferBudgetLedgerPort,
  type TransferConsumption,
} from "@xdownload/direct-acquisition";
import {
  bindLocator,
  budgetRemaining,
  decodeBudgetProfile,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  unwrapOrThrow,
  type BudgetProfile,
  type ConsumedBudget,
  type BudgetRemaining,
} from "@xdownload/domain-contracts";

export interface AcquisitionScope {
  readonly allowedHosts: readonly string[];
  readonly outputRoot: string;
  readonly maxBytes: number;
}

export interface BridgeCounters {
  acquireCalls: number;
  scopeRefusals: number;
  writerConflicts: number;
  filesWritten: number;
  bytesDownloaded: number;
}

interface WriterLockFile {
  artifacts: Record<string, { writerEffectId: string; fileSha256: string | null }>;
}

/** Minimal in-memory TransferBudgetLedgerPort over the canonical profile math. */
export class InMemoryBudgetLedger implements TransferBudgetLedgerPort {
  private readonly consumed: ConsumedBudget;

  constructor(rawProfile: unknown) {
    this.profile = unwrapOrThrow(decodeBudgetProfile(rawProfile));
    this.consumed = {
      discovery: { generatedRequests: 0, navigationActions: 0, modelCalls: 0 },
      transfer: { bytes: 0, segments: 0, activeTransferMs: 0, retryTransferRequests: 0 },
      globalSafety: { totalGeneratedRequests: 0, modelCostUnits: 0, activeElapsedMs: 0 },
    };
  }

  private readonly profile: BudgetProfile;

  remaining(): BudgetRemaining {
    return budgetRemaining(this.profile, this.consumed);
  }

  consume(units: TransferConsumption): BudgetRemaining {
    this.consumed.transfer.bytes += units.bytes;
    this.consumed.transfer.retryTransferRequests += units.retryTransferRequests;
    return this.remaining();
  }
}

export class AcquisitionHost {
  readonly counters: BridgeCounters = {
    acquireCalls: 0,
    scopeRefusals: 0,
    writerConflicts: 0,
    filesWritten: 0,
    bytesDownloaded: 0,
  };
  readonly transferStarts: Array<{ requestId: string; url: string; at: number }> = [];
  private readonly cancelControllers = new Map<string, AbortController>();
  private readonly adapter: DirectHttpAdapter;

  constructor(
    private readonly scope: AcquisitionScope,
    ledger: TransferBudgetLedgerPort,
    private readonly writerLockPath: string,
  ) {
    this.adapter = new DirectHttpAdapter(ledger);
    mkdirSync(scope.outputRoot, { recursive: true });
  }

  /** Pre-transfer cancellation checkpoint for N04 (test-visible). */
  cancel(requestId: string): void {
    this.cancelControllers.get(requestId)?.abort();
  }

  /** The single C-resource implementation behind `acquisition.acquire`. */
  async acquire(payload: Record<string, unknown>, permit?: unknown): Promise<unknown> {
    this.counters.acquireCalls += 1;
    const refusal = this.reverifyScope(payload);
    if (refusal !== null) {
      this.counters.scopeRefusals += 1;
      return {
        phase: "terminal",
        externalRef: String(payload.effectId ?? "unknown"),
        outcome: { ok: false, error: { code: refusal.code, message: refusal.message } },
      };
    }
    const requestId = String(payload.requestId);
    const writerClaim = this.claimWriter(requestId, String(payload.effectId));
    if (!writerClaim.ok) {
      this.counters.writerConflicts += 1;
      return {
        phase: "terminal",
        externalRef: String(payload.effectId),
        outcome: {
          ok: false,
          error: { code: "WRITER_IDENTITY_CONFLICT", message: writerClaim.message },
        },
      };
    }

    const controller = new AbortController();
    this.cancelControllers.set(requestId, controller);
    const effectRef = String(payload.effectId);
    const outcome = unwrapOrThrow(
      await this.adapter.acquire({
        effectId: this.adapterEffectId(effectRef),
        contractId: unwrapOrThrow(makeContractId(`contract-download-${requestId}`)),
        slice: "S1",
        selectedMemberId: unwrapOrThrow(makeMemberId(`member-download-${requestId}`)),
        binding: unwrapOrThrow(
          bindLocator(
            { kind: "direct", uri: String(payload.url) },
            unwrapOrThrow(makeLogicalTargetId(`target-download-${requestId}`)),
            { binding: "DECLARED_DELIVERY_EDGE", originLocatorUri: String(payload.url) },
          ),
        ),
        expectedSha256: String(payload.expectedSha256),
        expectedTotalBytes: Number(payload.expectedTotalBytes),
        allowedRedirectHosts: [String(payload.allowedHost)],
        attempt: 0,
        signal: controller.signal,
      }),
    );
    this.transferStarts.push({ requestId, url: String(payload.url), at: Date.now() });

    const stopReason = outcome.reason;
    const completed =
      stopReason === "COMPLETED" && outcome.bytes !== undefined && outcome.allApplicableValidationPassed;
    if (!completed || outcome.bytes === undefined) {
      return {
        phase: "terminal",
        externalRef: effectRef,
        outcome: {
          ok: false,
          error: { code: stopReason, message: `transfer did not complete (${stopReason})` },
        },
      };
    }

    const digest = createHash("sha256").update(outcome.bytes).digest("hex");
    if (digest !== String(payload.expectedSha256)) {
      return {
        phase: "terminal",
        externalRef: effectRef,
        outcome: {
          ok: false,
          error: {
            code: "DIGEST_MISMATCH",
            message: "materialized bytes do not match the confirmed digest",
          },
        },
      };
    }

    const filePath = this.writeArtifact(requestId, outcome.bytes, digest);
    this.counters.filesWritten += 1;
    this.counters.bytesDownloaded += outcome.receivedBytes;
    const permitRecord = permit as Record<string, unknown> | undefined;
    return {
      phase: "terminal",
      externalRef: effectRef,
      outcome: {
        ok: true,
        output: {
          requestId,
          effectId: effectRef,
          permitEffectId:
            permitRecord && typeof permitRecord.effectId === "string" ? permitRecord.effectId : null,
          filePath,
          fileSha256: digest,
          bytesWritten: outcome.bytes.byteLength,
          receivedBytes: outcome.receivedBytes,
          stopReason,
        },
      },
    };
  }

  private reverifyScope(payload: Record<string, unknown>): { code: string; message: string } | null {
    let parsed: URL;
    try {
      parsed = new URL(String(payload.url));
    } catch {
      return { code: "SCOPE_SOURCE", message: "effect url is not an absolute URI" };
    }
    if (!this.scope.allowedHosts.includes(parsed.host) || parsed.host !== String(payload.allowedHost)) {
      return { code: "SCOPE_HOST", message: `host ${parsed.host} outside confirmed scope` };
    }
    if (String(payload.outputRoot) !== this.scope.outputRoot) {
      return { code: "SCOPE_ROOT", message: "effect outputRoot differs from the authorized root" };
    }
    if (!/^[0-9a-f]{64}$/.test(String(payload.expectedSha256))) {
      return { code: "SCOPE_DIGEST", message: "effect digest anchor is not lowercase 64-hex" };
    }
    if (!(Number(payload.expectedTotalBytes) > 0 && Number(payload.expectedTotalBytes) <= this.scope.maxBytes)) {
      return { code: "SCOPE_SIZE", message: "declared size outside the authorized bound" };
    }
    return null;
  }

  /** Host-side one-writer claim per artifact lineage (N06); CAS on a lock file. */
  private claimWriter(requestId: string, effectId: string): { ok: true } | { ok: false; message: string } {
    let lock: WriterLockFile;
    if (existsSync(this.writerLockPath)) {
      lock = JSON.parse(readFileSync(this.writerLockPath, "utf8")) as WriterLockFile;
    } else {
      lock = { artifacts: {} };
    }
    const existing = lock.artifacts[requestId];
    if (existing !== undefined && existing.writerEffectId !== effectId) {
      return {
        ok: false,
        message: `artifact ${requestId} is already claimed by writer ${existing.writerEffectId}`,
      };
    }
    lock.artifacts[requestId] = { writerEffectId: effectId, fileSha256: existing?.fileSha256 ?? null };
    this.persistLock(lock);
    return { ok: true };
  }

  private writeArtifact(requestId: string, bytes: Uint8Array, digest: string): string {
    const requested = resolve(this.scope.outputRoot, `${requestId}.bin`);
    const root = resolve(this.scope.outputRoot);
    if (requested !== root && !requested.startsWith(root + sep)) {
      throw new Error(`artifact path escaped the authorized output root: ${requested}`);
    }
    const temporary = `${requested}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, requested);
    const lock: WriterLockFile = JSON.parse(readFileSync(this.writerLockPath, "utf8"));
    lock.artifacts[requestId] = {
      writerEffectId: lock.artifacts[requestId]!.writerEffectId,
      fileSha256: digest,
    };
    this.persistLock(lock);
    return requested;
  }

  private persistLock(lock: WriterLockFile): void {
    const temporary = `${this.writerLockPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(lock, null, 2));
    renameSync(temporary, this.writerLockPath);
  }

  /** K effect ids can exceed the adapter id pattern; derive a bounded alias. */
  private adapterEffectId(kEffectId: string) {
    const direct = makeEffectId(kEffectId);
    if (direct.ok) return direct.value;
    const digest = createHash("sha256").update(kEffectId).digest("hex").slice(0, 32);
    return unwrapOrThrow(makeEffectId(`xd183-${digest}`));
  }
}

export type { DirectTransferOutcome };
