/**
 * T02 single-K Domain App route — the ONE Core-owned K composition and the
 * explicit v0.2 route over the EXISTING Core seam.
 *
 * Composition rules (frozen Task Pack T02; never a second scheduler/ledger,
 * never a new IPC transport, never a nested runtime factory):
 *
 * - The selected Domain App/K (the T06 sealed S4 HLS VOD composition — K/S
 *   payload bytes pinned to the qualified #183 baseline through
 *   `sealS4HlsComposition`'s own seal self-checks) is loaded EXACTLY ONCE
 *   per Core process through the SDK public `load`. Every surface reaches
 *   the same instance through the same `CoreRuntime.seam`; a per-surface
 *   K instantiation is unrepresentable (the K lives on the runtime, never
 *   on a binder/client), and a second live K in one process is refused by
 *   the T06 bridge-pin conflict gate before composition proceeds.
 * - Route decision per lineageId uses the FROZEN `resolveLineageOwner`
 *   contract: the legacy partition fact comes from the old seam authority
 *   state (replayed durable truth), the new-K fact from the durable route
 *   fact log. Old lineages keep flowing through the old Core verbatim; new
 *   v0.2 lineages flow to the one K. One authority per lineage, forever:
 *   the FIRST partition to durably claim a lineageId keeps it, and every
 *   conflicting claim is refused as a typed `LINEAGE_OWNER_CONFLICT`
 *   BEFORE any network or filesystem effect (no claim append, no K send,
 *   no legacy seam apply). A fresh lineage addressed by a v0.2
 *   `DOMAIN_APP_SEND` is the new-K claim point (the frozen default
 *   partition stays old-core until this route claims it).
 * - The route is exposed through the existing seam only: legacy frames are
 *   delegated to the inner `CoreSeamServer` VERBATIM (byte-identical
 *   behavior; the wrapper only pre-empts legacy commands addressed to a
 *   K-owned lineageId), v0.2 `DOMAIN_APP_SEND` frames ride the seam's own
 *   T01 pipeline (bounds → decode → per-frame peer authorization → exact
 *   no-widening intent validation → binding check) and the wrapper installs
 *   exactly the piece T01 left as a fail-closed stub: the route decision,
 *   the durable claim, and the send into the one K. `READ_JOB_PROJECTION`
 *   is served through the seam's own `jobProjectionProvider` option.
 * - Restart (`reopenCoreRuntime`) re-derives the route truth only from the
 *   durable route fact log and the K's own document store at the same
 *   paths: the owner survives restart, a settled attempt keeps its recorded
 *   outcome, and an attempt that was in flight at crash reads back UNKNOWN
 *   — never fabricated RUNNING/SUCCEEDED.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  currentSeamSchemaIdentity,
  decodeSeamEnvelope,
  seamDiagnostic,
  seamFail,
  seamOk,
  type CoreSeamServer,
  type SeamAcceptance,
  type SeamResponse,
  type SeamResult,
} from '@xdownload/core-seam';
import {
  resolveLineageOwner,
  type DownloadJobProjection,
  type DownloadJobStatus,
} from '@xdownload/domain-contracts';
import { load, type DomainApp, type V10PublicIntent } from '@kaicreator/domain-harness-microkernel';
import {
  acquireS4HlsBridgePin,
  sealS4HlsComposition,
  type S4HlsBridgePin,
  type S4HlsPinCounters,
} from '../../download-domain-app/src/integrations/s4-hls-vod.ts';
import {
  validateConfirmedS4HlsIntent,
  type ConfirmedS4HlsIntent,
} from '../../download-domain-app/src/integrations/s4-hls-vod-contract.ts';
import {
  InMemoryMediaTargetRegistry,
  type MediaTargetRefSeed,
} from '../../download-domain-app/src/integrations/media-registry.ts';
import {
  normalizeEffectEnvelope,
  REFERENCE_TOKEN_PATTERN,
  validateMaterializedEvidence,
  type EffectEnvelope,
} from '../../download-domain-app/src/contracts/index.ts';
import { FileCasDocStore } from '../../download-domain-app/src/composition/runtime.ts';
import { acquireSelectedHlsVod } from '../../download-domain-host/src/media/media-acquisition-bridge.ts';
import {
  FileBackedDomainAppRouteLog,
  type DomainAppRouteFact,
  type DurableLayout,
} from './durable-stores.ts';

/** The route's per-attempt view (durable attempts + this process's liveness). */
export interface DomainAppRouteAttempt {
  readonly attemptId: string;
  readonly requestId: string;
  readonly sequence: number;
  /** Durable outcome; absent while in flight or after a crash mid-send. */
  readonly outcome?: {
    readonly status: 'SUCCEEDED' | 'FAILED';
    readonly errorCode?: string;
    readonly errorMessage?: string;
    readonly transferredBytes?: number;
  };
}

/** Options of the single-K Domain App composition (absent → legacy-only). */
export interface CoreDomainAppOptions {
  /**
   * K document store path. Defaults to `<rootDir>/domain-app/k-documents.json`;
   * reopen composes over the SAME default so K state survives restart.
   */
  readonly storePath?: string;
  readonly tenantId?: string;
  readonly deployedAppId?: string;
  /** Trusted-Host media targetRef seeds (the loopback fixture exception included). */
  readonly mediaTargetRefs?: readonly MediaTargetRefSeed[];
  readonly now?: () => number;
}

/** The runtime's one-K route facade (observation + lifecycle only). */
export interface CoreDomainAppRoute {
  /** Resolves when the one K finished loading; rejects on a load failure. */
  readonly ready: Promise<void>;
  /** True once the K `load` resolved in this process. */
  isLoaded(): boolean;
  /** The verbatim K load error (fail-closed flag; undefined while pending). */
  loadError(): Error | undefined;
  /** The Host bridge pin counters of the single K's S4 media route. */
  readonly pin: S4HlsPinCounters;
  /** Durable route facts read back (observation; never a write path). */
  routeFacts(): readonly DomainAppRouteFact[];
  /** Stop the K, release the bridge pin lease and close the doc store. */
  close(): void;
}

/** Typed composition failure of the single-K route (fail closed). */
export class CoreDomainAppRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreDomainAppRouteError';
  }
}

// ------------------------------------------------------- Host bridge (S4 pin)

interface KernelPermitClaim {
  readonly effectId: string;
  readonly durableControlTurnId: string;
  readonly attempt?: number;
}

/** Strict structural decode of the K effect permit (same gate as T06). */
function parseKernelPermit(value: unknown): KernelPermitClaim | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const attemptOk =
    record.attempt === undefined ||
    (typeof record.attempt === 'number' &&
      Number.isSafeInteger(record.attempt) &&
      record.attempt >= 0);
  if (
    Object.keys(record).some(
      (key) => key !== 'effectId' && key !== 'durableControlTurnId' && key !== 'attempt',
    ) ||
    typeof record.effectId !== 'string' ||
    record.effectId.length < 1 ||
    record.effectId.length > 256 ||
    typeof record.durableControlTurnId !== 'string' ||
    record.durableControlTurnId.length < 1 ||
    record.durableControlTurnId.length > 256 ||
    !attemptOk
  )
    return undefined;
  return {
    effectId: record.effectId,
    durableControlTurnId: record.durableControlTurnId,
    ...(typeof record.attempt === 'number' ? { attempt: record.attempt } : {}),
  };
}

function boundedPermitIdOf(effectId: string): string {
  if (REFERENCE_TOKEN_PATTERN.test(effectId)) return effectId;
  return 'xd-s4-' + createHash('sha256').update(effectId).digest('hex').slice(0, 32);
}

function refusalEnvelope(externalRef: string, code: string, message: string): EffectEnvelope {
  return { phase: 'terminal', externalRef, outcome: { ok: false, error: { code, message } } };
}

/** Fresh pin counters (the T06 bridge observation shape). */
function emptyPinCounters(): S4HlsPinCounters {
  return {
    acquireCalls: 0,
    permitRefusals: 0,
    intentRefusals: 0,
    registryRefusals: 0,
    completedExecutions: 0,
    failedExecutions: 0,
  };
}

/**
 * The trusted Host bridge of the ONE Core-owned K: the S4 media effect route
 * behind the kernel permit gate. Composition glue over T06's trusted pieces
 * (`validateConfirmedS4HlsIntent`, the seeded media targetRef registry, the
 * T06 Host acquisition engine); it adds no fetch path, no retry and no
 * ledger of its own.
 */
function createS4HlsHostBridge(
  registry: InMemoryMediaTargetRegistry,
  pin: S4HlsPinCounters,
): S4HlsBridgePin {
  return {
    async acquireS4HlsVod(payload, permit): Promise<EffectEnvelope> {
      pin.acquireCalls += 1;
      const kernelPermit = parseKernelPermit(permit);
      if (kernelPermit === undefined) {
        pin.permitRefusals += 1;
        return refusalEnvelope(
          'media.acquire:unpermitted',
          'MEDIA_PERMIT_REQUIRED',
          'Kernel effect permit is required',
        );
      }
      const externalRef = kernelPermit.effectId;
      const candidate: Record<string, unknown> = { ...payload };
      delete candidate['effectId'];
      // The K's rule projection maps digestAnchor unconditionally; an absent
      // optional anchor rides the internal path as null (dropped here).
      if (candidate['digestAnchor'] === null) delete candidate['digestAnchor'];
      const checked = validateConfirmedS4HlsIntent(candidate);
      if (!checked.ok) {
        pin.intentRefusals += 1;
        return refusalEnvelope(
          externalRef,
          'S4_INTENT_INVALID',
          checked.diagnostics[0]?.message ?? 'S4 intent refused',
        );
      }
      const intent: ConfirmedS4HlsIntent = checked.value;
      const recordCheck = registry.resolve(intent.targetRef);
      if (!recordCheck.ok) {
        pin.registryRefusals += 1;
        return refusalEnvelope(
          externalRef,
          recordCheck.diagnostics[0]?.code ?? 'MEDIA_TARGET_UNKNOWN',
          'opaque targetRef did not resolve',
        );
      }
      const record = recordCheck.value;
      if (
        record.protocol !== 'HLS' ||
        record.manifestUri !== intent.selection.manifestUri ||
        (record.selectedRenditionUri !== undefined &&
          record.selectedRenditionUri !== intent.selection.renditionUri)
      ) {
        pin.registryRefusals += 1;
        return refusalEnvelope(
          externalRef,
          'S4_SELECTION_TARGET_MISMATCH',
          'confirmed selection does not match trusted target registry facts',
        );
      }
      const result = await acquireSelectedHlsVod({
        intent,
        protocol: record.protocol,
        manifestUri: record.manifestUri,
        permit: {
          kind: 'media-acquisition-permit',
          permitId: boundedPermitIdOf(kernelPermit.effectId),
          operationId: 'media.acquire',
          requestId: intent.requestId,
          lineageId: intent.lineageId,
          allowedManifestOrigins: record.allowedManifestOrigins,
          allowedSegmentOrigins: record.allowedSegmentOrigins,
          budget: record.budget,
        },
        ...(record.artifactFileName === undefined
          ? {}
          : { artifactFileName: record.artifactFileName }),
        ...(record.fixtureLoopbackHttp === true ? { fixtureLoopbackHttp: true } : {}),
        ...(record.manifestMaxBytes === undefined
          ? {}
          : { manifestMaxBytes: record.manifestMaxBytes }),
        ...(record.segmentMaxBytes === undefined
          ? {}
          : { segmentMaxBytes: record.segmentMaxBytes }),
        ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs }),
      });
      if (!result.admitted) {
        pin.failedExecutions += 1;
        return refusalEnvelope(externalRef, result.code, result.message);
      }
      if (result.envelope.phase === 'terminal' && result.envelope.outcome.ok) {
        const normalized = normalizeEffectEnvelope({
          phase: 'terminal',
          externalRef,
          outcome: {
            ok: true,
            output: {
              ...result.envelope.outcome.output,
              permitEffectId: kernelPermit.effectId,
              durableControlTurnId: kernelPermit.durableControlTurnId,
            },
          },
        });
        if (!normalized.ok) {
          throw new Error('S4 Host permit enrichment rejected the T01 envelope grammar');
        }
        pin.completedExecutions += 1;
        return normalized.value;
      }
      pin.failedExecutions += 1;
      return result.envelope;
    },
  };
}

// ----------------------------------------------------------- route composition

interface DomainAppRouteState {
  readonly options: CoreDomainAppOptions;
  readonly store: FileCasDocStore;
  readonly registry: InMemoryMediaTargetRegistry;
  readonly pin: S4HlsPinCounters;
  readonly routeLog: FileBackedDomainAppRouteLog;
  /**
   * The inner seam server, populated by the runtime right after the seam's
   * own construction (the job projection provider installs INTO that
   * construction, so the route composes before the seam exists).
   */
  readonly innerHolder: { current?: CoreSeamServer };
  app: DomainApp | undefined;
  /** Durable attempts per claimed lineage (rebuilt from the route log). */
  readonly attemptsByLineage: Map<string, DomainAppRouteAttempt[]>;
  /** Live in-flight attempt ids (this process only). */
  readonly inFlight: Set<string>;
  /** Duplicate-send convergence cache for this process (requestId → response). */
  readonly admitted: Map<string, SeamResponse>;
  loaded: boolean;
  loadError: Error | undefined;
  closed: boolean;
  readonly ready: Promise<void>;
}

const MAX_ADMITTED_CACHE = 512;

function defaultStorePath(layout: DurableLayout): string {
  return join(layout.rootDir, 'domain-app', 'k-documents.json');
}

function buildAttempts(facts: readonly DomainAppRouteFact[]): Map<string, DomainAppRouteAttempt[]> {
  const attemptsByLineage = new Map<string, DomainAppRouteAttempt[]>();
  const byAttemptId = new Map<string, DomainAppRouteAttempt>();
  for (const fact of facts) {
    if (fact.kind === 'ATTEMPT') {
      const attempt: DomainAppRouteAttempt = {
        attemptId: fact.attemptId,
        requestId: fact.requestId,
        sequence: fact.sequence,
      };
      const list = attemptsByLineage.get(fact.lineageId) ?? [];
      list.push(attempt);
      attemptsByLineage.set(fact.lineageId, list);
      byAttemptId.set(fact.attemptId, attempt);
    } else if (fact.kind === 'OUTCOME') {
      const attempt = byAttemptId.get(fact.attemptId);
      if (attempt !== undefined) {
        const mutable = attempt as { outcome?: DomainAppRouteAttempt['outcome'] };
        mutable.outcome = {
          status: fact.status,
          ...(fact.errorCode === undefined ? {} : { errorCode: fact.errorCode }),
          ...(fact.errorMessage === undefined ? {} : { errorMessage: fact.errorMessage }),
          ...(fact.transferredBytes === undefined
            ? {}
            : { transferredBytes: fact.transferredBytes }),
        };
      }
    }
  }
  return attemptsByLineage;
}

/**
 * Record one attempt's durable outcome and clear its live in-flight mark.
 * Called exactly once per admitted attempt (from the drive's settle paths).
 * Message text is sanitized to the fact log's strict token grammar (bounded,
 * no control characters) so a hostile upstream message can never poison the
 * durable log's fail-closed reopen decode.
 */
function recordOutcome(
  state: DomainAppRouteState,
  lineageId: string,
  attemptId: string,
  outcome: NonNullable<DomainAppRouteAttempt['outcome']>,
): void {
  state.inFlight.delete(attemptId);
  if (state.closed) {
    return;
  }
  const sanitize = (value: string, max: number): string => {
    const stripped = value
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      })
      .join('')
      .slice(0, max);
    return stripped.length === 0 ? 'unprintable' : stripped;
  };
  state.routeLog.append({
    kind: 'OUTCOME',
    lineageId,
    attemptId,
    status: outcome.status,
    ...(outcome.errorCode === undefined ? {} : { errorCode: sanitize(outcome.errorCode, 64) }),
    ...(outcome.errorMessage === undefined
      ? {}
      : { errorMessage: sanitize(outcome.errorMessage, 512) }),
    ...(outcome.transferredBytes === undefined
      ? {}
      : { transferredBytes: outcome.transferredBytes }),
  });
  const attempts = state.attemptsByLineage.get(lineageId);
  const attempt = attempts?.find((candidate) => candidate.attemptId === attemptId);
  if (attempt !== undefined) {
    (attempt as { outcome?: DomainAppRouteAttempt['outcome'] }).outcome = outcome;
  }
}

/**
 * The post-admission drive: send the validated confirmed intent into the
 * ONE K and record the verbatim receipt class as the attempt's durable
 * outcome. Classification mirrors the T06 journey's canonical verdicts
 * (replayed → the already-settled effect is confirmed; terminal ok →
 * SUCCEEDED with the K-reported byte facts; everything else → FAILED with
 * the verbatim refusal code). Never invents success.
 */
function driveKSend(
  state: DomainAppRouteState,
  lineageId: string,
  attemptId: string,
  rawIntent: unknown,
): void {
  const drive = state.ready
    .then(async () => {
      const app = state.app;
      if (app === undefined) {
        throw new Error('the Domain App K did not activate');
      }
      const checked = validateConfirmedS4HlsIntent(rawIntent);
      if (!checked.ok) {
        return {
          status: 'FAILED' as const,
          errorCode: 'S4_INTENT_INVALID',
          errorMessage: checked.diagnostics[0]?.message ?? 'S4 intent refused',
        };
      }
      const intent = checked.value;
      const publicIntent: V10PublicIntent = {
        intentType: 'confirmDownload',
        instanceKey: 's4-hls-' + intent.requestId,
        messageId: 'msg-s4-hls-' + intent.requestId,
        // The K's rule projection maps digestAnchor unconditionally; an
        // absent optional anchor rides the internal path as null (the same
        // discipline as the T06 journey).
        input: {
          ...(intent as unknown as Record<string, unknown>),
          digestAnchor: intent.digestAnchor ?? null,
        },
      };
      const receipt = (await app.send(publicIntent)) as Record<string, unknown>;
      if (receipt['idempotentReplay'] === true) {
        // The effect already settled exactly once for this occurrence; the
        // replay confirms it without re-executing (no byte facts re-claimed).
        return { status: 'SUCCEEDED' as const };
      }
      const effect = (
        receipt['admitted'] as
          { readonly effects?: readonly { readonly output?: unknown }[] } | undefined
      )?.effects?.[0];
      if (effect === undefined) {
        return {
          status: 'FAILED' as const,
          errorCode: 'EFFECT_ENVELOPE_MISSING',
          errorMessage: 'K receipt has no media effect envelope',
        };
      }
      const normalized = normalizeEffectEnvelope(effect.output);
      if (!normalized.ok) {
        return {
          status: 'FAILED' as const,
          errorCode: 'EFFECT_ENVELOPE_INVALID',
          errorMessage: normalized.diagnostics[0]?.message ?? 'invalid effect envelope',
        };
      }
      const terminal = normalized.value;
      if (terminal.phase !== 'terminal') {
        return {
          status: 'FAILED' as const,
          errorCode: 'EFFECT_NOT_TERMINAL',
          errorMessage: 'S4 effect did not settle terminally',
        };
      }
      if (terminal.outcome.ok === false) {
        return {
          status: 'FAILED' as const,
          errorCode: terminal.outcome.error.code,
          errorMessage: terminal.outcome.error.message,
        };
      }
      const output = terminal.outcome.output;
      if (
        output.permitEffectId === undefined ||
        typeof output.permitEffectId !== 'string' ||
        output.permitEffectId.length === 0 ||
        output.durableControlTurnId === undefined ||
        typeof output.durableControlTurnId !== 'string' ||
        output.durableControlTurnId.length === 0
      ) {
        return {
          status: 'FAILED' as const,
          errorCode: 'EVIDENCE_PERMIT_IDENTITY_MISSING',
          errorMessage: 'terminal output is not bound to the K permit',
        };
      }
      const evidenceCheck = validateMaterializedEvidence(
        {
          fileSha256: output.fileSha256,
          bytesWritten: output.bytesWritten,
          artifactPath: output.artifactPath,
          stopReason: output.stopReason,
        },
        intent.outputRootScope,
      );
      if (!evidenceCheck.ok) {
        return {
          status: 'FAILED' as const,
          errorCode: 'EVIDENCE_INVALID',
          errorMessage: evidenceCheck.diagnostics[0]?.message ?? 'invalid artifact evidence',
        };
      }
      const transferred =
        typeof output.transferredByteCount === 'number' && output.transferredByteCount > 0
          ? output.transferredByteCount
          : typeof output.bytesWritten === 'number' && output.bytesWritten > 0
            ? output.bytesWritten
            : undefined;
      return {
        status: 'SUCCEEDED' as const,
        ...(transferred === undefined ? {} : { transferredBytes: transferred }),
      };
    })
    .then(
      (outcome) => {
        recordOutcome(state, lineageId, attemptId, outcome);
      },
      (error: unknown) => {
        recordOutcome(state, lineageId, attemptId, {
          status: 'FAILED',
          errorCode: 'K_SEND_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 512) : String(error),
        });
      },
    );
  void drive;
}

/**
 * Compose the single-K route over the runtime's durable layout. Throws a
 * typed `CoreDomainAppRouteError` (fail closed, before any effect) when the
 * process-global bridge pin is already held — a second live K in one
 * process is refused, never displaced.
 */
export function composeDomainAppRoute(
  options: CoreDomainAppOptions,
  layout: DurableLayout,
  fresh: boolean,
  innerHolder: { readonly current?: CoreSeamServer } = {},
): { state: DomainAppRouteState; facade: CoreDomainAppRoute } {
  const routeLog = fresh
    ? FileBackedDomainAppRouteLog.createFresh(layout.domainAppRouteLogPath)
    : FileBackedDomainAppRouteLog.openExisting(layout.domainAppRouteLogPath);
  const registry = new InMemoryMediaTargetRegistry(options.mediaTargetRefs ?? []);
  const pin = emptyPinCounters();
  const bridge = createS4HlsHostBridge(registry, pin);
  const registration = acquireS4HlsBridgePin(bridge);
  if (!registration.ok) {
    throw new CoreDomainAppRouteError(
      `S4_BRIDGE_PIN_CONFLICT: ${registration.message} (one Core process holds exactly one Domain App/K)`,
    );
  }
  const store = new FileCasDocStore(options.storePath ?? defaultStorePath(layout));
  const state: DomainAppRouteState = {
    options,
    store,
    registry,
    pin,
    routeLog,
    innerHolder,
    app: undefined,
    attemptsByLineage: buildAttempts(routeLog.all()),
    inFlight: new Set<string>(),
    admitted: new Map<string, SeamResponse>(),
    loaded: false,
    loadError: undefined,
    closed: false,
    ready: undefined as unknown as Promise<void>,
  };
  const tenantId = options.tenantId ?? 'tenant:xdownload-core-k';
  const deployedAppId = options.deployedAppId ?? 'deploy:xdownload-core-k';
  const principal = 'xdownload-core-k-host';
  const loadPromise = load(sealS4HlsComposition(), {
    store,
    tenantId,
    deploymentIdentity: { deployedAppId, tenantId, appId: 'app:xdownload-s4-hls-vod' },
    queryAuthority: {
      principal: { actor: principal },
      authorize: (candidate, target) =>
        Boolean(
          candidate !== null &&
          typeof candidate === 'object' &&
          (candidate as { actor?: string }).actor === principal &&
          target.tenantId === tenantId,
        ),
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  }).then(
    (app) => {
      state.app = app;
      state.loaded = true;
    },
    (error: unknown) => {
      // Failed K activation must not leave an orphaned process-global pin or
      // an open doc store behind: the conflict-rejecting registration stays
      // honest, and every v0.2 send keeps failing closed until composition
      // is retried in a fresh process.
      state.loadError = error instanceof Error ? error : new Error(String(error));
      registration.lease.release();
      store.close();
      state.closed = true;
      throw state.loadError;
    },
  );
  (state as { ready: Promise<void> }).ready = loadPromise;
  const facade: CoreDomainAppRoute = Object.freeze({
    ready: loadPromise,
    isLoaded: () => state.loaded,
    loadError: () => state.loadError,
    pin,
    routeFacts: () => routeLog.all(),
    close: () => {
      if (state.closed) return;
      state.closed = true;
      state.app?.stop();
      registration.lease.release();
      state.store.close();
    },
  });
  return { state, facade };
}

// --------------------------------------------------------------- projections

const DOMAIN_APP_SCHEMA_IDENTITY = {
  schema: 'xdownload.domain-contracts',
  version: '1.0.0',
} as const;

/**
 * The Core-owned v0.2 job projection of one claimed K lineage, derived ONLY
 * from durable route facts (plus this process's live in-flight marks). A
 * settled attempt keeps its recorded outcome; an attempt that was in flight
 * at crash reads back UNKNOWN — never a fabricated terminal. `progress` is
 * bound to the settled current attempt and only when the K receipt carried a
 * byte count (totalBytes stays explicitly UNKNOWN).
 */
export function jobProjectionFor(
  lineageId: string,
  state: Pick<DomainAppRouteState, 'attemptsByLineage' | 'inFlight'>,
): DownloadJobProjection {
  const attempts = state.attemptsByLineage.get(lineageId) ?? [];
  const last = attempts[attempts.length - 1];
  const live = last !== undefined && state.inFlight.has(last.attemptId);
  let status: DownloadJobStatus;
  if (live) {
    status = 'RUNNING';
  } else if (last === undefined) {
    // Claimed but no attempt was ever durably admitted.
    status = 'QUEUED';
  } else if (last.outcome === undefined) {
    // The attempt was in flight at the last durable boundary and this
    // process cannot prove otherwise: explicitly UNKNOWN, never guessed.
    status = 'UNKNOWN';
  } else {
    status = last.outcome.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
  }
  const currentAttemptId = last === undefined ? undefined : last.attemptId;
  const progress =
    status === 'SUCCEEDED' &&
    last?.outcome?.transferredBytes !== undefined &&
    currentAttemptId !== undefined
      ? {
          transferredBytes: last.outcome.transferredBytes,
          totalBytes: { kind: 'UNKNOWN' as const },
        }
      : undefined;
  const error =
    status === 'FAILED' && last?.outcome?.errorCode !== undefined
      ? {
          code: last.outcome.errorCode,
          message: last.outcome.errorMessage ?? last.outcome.errorCode,
        }
      : undefined;
  return {
    schemaIdentity: DOMAIN_APP_SCHEMA_IDENTITY,
    lineageId,
    owner: 'new-k',
    status,
    attempts: attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      sequence: attempt.sequence,
      status:
        attempt.outcome === undefined
          ? state.inFlight.has(attempt.attemptId)
            ? 'RUNNING'
            : 'UNKNOWN'
          : attempt.outcome.status,
      ...(attempt.outcome?.errorCode === undefined
        ? {}
        : {
            error: {
              code: attempt.outcome.errorCode,
              message: attempt.outcome.errorMessage ?? attempt.outcome.errorCode,
            },
          }),
    })),
    ...(currentAttemptId === undefined ? {} : { currentAttemptId }),
    ...(progress === undefined ? {} : { progress }),
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * The Core-owned v0.2 job projection of one OLD (legacy) lineage, derived
 * only from the legacy seam authority truth (replayed durable state). The
 * mapping is presentation-only and never fabricates a terminal: ACTIVE
 * reads RUNNING, a durable cancel reads CANCELLED, a projected terminal
 * maps its request-fulfillment verdict, and a terminal lineage without a
 * projected terminal reads UNKNOWN. Byte-facts are absent (the legacy
 * projection carries no authoritative byte sample for this view).
 */
export function oldCoreJobProjectionFor(
  lineageId: string,
  view: NonNullable<ReturnType<CoreSeamServer['inspectProjection']>>,
): DownloadJobProjection {
  const attemptId = `${lineageId}#attempt-1`;
  const terminal = view.terminal;
  let status: DownloadJobStatus;
  let attemptStatus: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  if (view.lineage.status === 'ACTIVE') {
    status = 'RUNNING';
    attemptStatus = 'RUNNING';
  } else if (view.lineage.status === 'CANCELLED') {
    status = 'CANCELLED';
    attemptStatus = 'CANCELLED';
  } else if (terminal === undefined) {
    status = 'UNKNOWN';
    attemptStatus = 'UNKNOWN';
  } else if (terminal.requestFulfillment === 'COMPLETE') {
    status = 'SUCCEEDED';
    attemptStatus = 'SUCCEEDED';
  } else if (terminal.requestFulfillment === 'UNKNOWN') {
    status = 'UNKNOWN';
    attemptStatus = 'UNKNOWN';
  } else {
    status = 'FAILED';
    attemptStatus = 'FAILED';
  }
  return {
    schemaIdentity: DOMAIN_APP_SCHEMA_IDENTITY,
    lineageId,
    owner: 'old-core',
    status,
    attempts: [{ attemptId, sequence: 1, status: attemptStatus }],
    currentAttemptId: attemptId,
  };
}

/**
 * The `jobProjectionProvider` of the ONE Core seam: claimed lineages read
 * from the durable route facts; unclaimed lineages read from the legacy
 * authority truth; an unknown lineageId is a typed refusal — never a
 * fabricated empty job.
 */
export function readJobProjection(
  state: DomainAppRouteState,
  innerHolder: { readonly current?: CoreSeamServer },
  lineageId: string,
): SeamResult<unknown> {
  if (state.routeLog.isClaimed(lineageId)) {
    return seamOk(jobProjectionFor(lineageId, state));
  }
  const view = innerHolder.current?.inspectProjection(lineageId);
  if (view === undefined) {
    return seamFail([
      seamDiagnostic(
        'JOB_PROJECTION_UNAVAILABLE',
        'projection',
        'no v0.2 job projection exists for this lineage',
      ),
    ]);
  }
  return seamOk(oldCoreJobProjectionFor(lineageId, view));
}

// --------------------------------------------------------------- seam wrapper

function v02Rejected(requestId: string, diagnostics: SeamResponse['diagnostics']): SeamResponse {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'response',
    route: 'v0.2',
    inReplyTo: requestId as SeamResponse['inReplyTo'],
    outcome: 'REJECTED',
    diagnostics,
  };
}

function isV02DomainAppSend(
  frame: string,
):
  | { readonly requestId: string; readonly aggregateId: string; readonly intent: unknown }
  | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame) as unknown;
  } catch {
    return undefined;
  }
  const decoded = decodeSeamEnvelope(parsed);
  if (
    !decoded.ok ||
    decoded.value.kind !== 'command' ||
    !('route' in decoded.value) ||
    decoded.value.route !== 'v0.2' ||
    decoded.value.commandType !== 'DOMAIN_APP_SEND'
  ) {
    return undefined;
  }
  return {
    requestId: decoded.value.requestId,
    aggregateId: decoded.value.aggregateId,
    intent: decoded.value.payload.intent,
  };
}

function rejectionCode(response: SeamResponse): string | undefined {
  return response.outcome === 'REJECTED' ? response.diagnostics?.[0]?.code : undefined;
}

/**
 * Wrap the composed inner seam server with the single-K v0.2 route. Every
 * member is delegated verbatim; only `handleFrame` adds the route:
 *
 * 1. Legacy commands addressed to a K-owned lineageId are refused BEFORE the
 *    inner seam applies anything (no aggregate creation, no journal write,
 *    no drive). The pre-decode never rejects on its own: any decode
 *    uncertainty delegates to the seam's own canonical pipeline.
 * 2. Everything else is delegated first (bounds, decode, per-frame peer
 *    authorization, idempotency, revision, intent validation — all seam
 *    owned). Only when the seam's own T01 stub rejects a v0.2
 *    `DOMAIN_APP_SEND` with `V02_COMMAND_ROUTE_UNAVAILABLE` (its "validated,
 *    no sender installed" verdict) does the wrapper decide the route:
 *    resolve the frozen owner facts, refuse conflicts BEFORE any effect,
 *    durably claim the lineage for the K partition, and admit the send into
 *    the one K (the response is the durable ACCEPTED admission; the drive
 *    outcome surfaces through `READ_JOB_PROJECTION`).
 */
export function wrapSeamWithDomainAppRoute(
  inner: CoreSeamServer,
  state: DomainAppRouteState,
): CoreSeamServer {
  const legacyOwnerRefusal = (frame: string): SeamResponse | undefined => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame) as unknown;
    } catch {
      return undefined;
    }
    const decoded = decodeSeamEnvelope(parsed);
    if (!decoded.ok) {
      // Let the seam produce its own canonical decode rejection.
      return undefined;
    }
    const envelope = decoded.value;
    if (envelope.kind !== 'command' || 'route' in envelope) {
      return undefined;
    }
    if (!state.routeLog.isClaimed(envelope.aggregateId)) {
      return undefined;
    }
    // A legacy (v1) command may never create/apply authority over a lineage
    // the one K durably owns: typed refusal before any seam transition.
    return {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      inReplyTo: envelope.requestId,
      outcome: 'REJECTED',
      diagnostics: [
        seamDiagnostic(
          'LINEAGE_OWNER_CONFLICT',
          'lineageOwner',
          'this lineage is durably owned by the new v0.2 Domain App; legacy commands are refused before any effect',
        ),
      ],
    };
  };
  const routeSend = (requestId: string, lineageId: string, rawIntent: unknown): SeamResponse => {
    if (state.closed) {
      return v02Rejected(requestId, [
        seamDiagnostic(
          'V02_COMMAND_ROUTE_UNAVAILABLE',
          'route',
          'the Domain App route is closed in this process; no send was attempted',
        ),
      ]);
    }
    const prior = state.admitted.get(requestId);
    if (prior !== undefined) {
      // Same idempotent identity already admitted in this process: converge,
      // never a second K occurrence for the same requestId.
      return {
        ...prior,
        acceptance: { ...prior.acceptance, converged: true } as SeamResponse['acceptance'],
      };
    }
    // Frozen owner resolution (T01): legacy fact from the old seam authority
    // state, new-K fact from the durable route log.
    const legacyFact =
      state.innerHolder.current?.inspectProjection(lineageId) !== undefined
        ? 'REGISTERED'
        : 'UNREGISTERED';
    const newKFact = state.routeLog.isClaimed(lineageId) ? 'OWNED' : 'ABSENT';
    const resolution = resolveLineageOwner({ oldCore: legacyFact, newK: newKFact });
    if (!resolution.ok) {
      return v02Rejected(requestId, [
        seamDiagnostic(
          'LINEAGE_OWNER_AMBIGUOUS',
          'lineageOwner',
          'the lineage owner facts refuse this v0.2 Domain App send before any effect',
        ),
      ]);
    }
    if (resolution.value.status === 'REFUSED') {
      // Typed refusal strictly BEFORE the claim append (a file effect) and
      // BEFORE any K send (a network effect).
      return v02Rejected(requestId, [
        seamDiagnostic(
          resolution.value.reason,
          'lineageOwner',
          'the lineage owner facts refuse this v0.2 Domain App send before any effect',
        ),
      ]);
    }
    if (resolution.value.owner === 'old-core') {
      if (legacyFact === 'REGISTERED') {
        // The legacy Core partition durably owns this lineage; the v0.2
        // Domain App route can never drive it.
        return v02Rejected(requestId, [
          seamDiagnostic(
            'LINEAGE_OWNER_CONFLICT',
            'lineageOwner',
            'this lineage is owned by the legacy Core partition; the v0.2 Domain App route refuses before any effect',
          ),
        ]);
      }
      // Fresh lineage: the frozen default partition (old-core) has NOT
      // claimed it — this v0.2 send is the new-K claim point.
    }
    // Journal-before-effect: the durable CLAIM (and, below, the durable
    // ATTEMPT) is fsync'd before the K send begins.
    if (newKFact === 'ABSENT') {
      state.routeLog.append({ kind: 'CLAIM', lineageId });
    }
    const attempts = state.attemptsByLineage.get(lineageId) ?? [];
    const sequence = attempts.length + 1;
    const requestIdToken = REFERENCE_TOKEN_PATTERN.test(requestId) ? requestId : `req-${sequence}`;
    const attemptId = `s4hls-${requestIdToken}#${String(sequence)}`;
    state.routeLog.append({
      kind: 'ATTEMPT',
      lineageId,
      requestId: requestIdToken,
      attemptId,
      sequence,
    });
    const attempt: DomainAppRouteAttempt = { attemptId, requestId: requestIdToken, sequence };
    attempts.push(attempt);
    state.attemptsByLineage.set(lineageId, attempts);
    state.inFlight.add(attemptId);
    const response: SeamResponse = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      route: 'v0.2',
      inReplyTo: requestId as SeamResponse['inReplyTo'],
      outcome: 'ACCEPTED',
      acceptance: {
        requestId: requestId as SeamAcceptance['requestId'],
        aggregateId: lineageId,
        revision: 0,
        converged: false,
      },
    };
    state.admitted.set(requestId, response);
    if (state.admitted.size > MAX_ADMITTED_CACHE) {
      const oldest = state.admitted.keys().next();
      if (oldest.done !== true) {
        state.admitted.delete(oldest.value);
      }
    }
    // Post-admission drive into the ONE K (fire-and-forget; the truthful
    // outcome lands in the durable route log and the job projection).
    driveKSend(state, lineageId, attemptId, rawIntent);
    return response;
  };
  return {
    handleFrame: (frame, verifiedSessions, connectionId) => {
      const legacyRefusal = legacyOwnerRefusal(frame);
      if (legacyRefusal !== undefined) {
        return legacyRefusal;
      }
      const response = inner.handleFrame(frame, verifiedSessions, connectionId);
      const addressed = isV02DomainAppSend(frame);
      if (
        addressed === undefined ||
        rejectionCode(response) !== 'V02_COMMAND_ROUTE_UNAVAILABLE' ||
        response.inReplyTo !== addressed.requestId
      ) {
        return response;
      }
      return routeSend(addressed.requestId, addressed.aggregateId, addressed.intent);
    },
    recordFailedMembers: (aggregateId, memberIds) =>
      inner.recordFailedMembers(aggregateId, memberIds),
    recordCoverageAccounting: (aggregateId, accounting, evidenceLedger) =>
      inner.recordCoverageAccounting(aggregateId, accounting, evidenceLedger),
    inspectProjection: (aggregateId) => inner.inspectProjection(aggregateId),
    pendingS1Executions: () => inner.pendingS1Executions(),
    pendingS3Executions: () => inner.pendingS3Executions(),
    pendingS4Previews: () => inner.pendingS4Previews(),
    pendingS4Executions: () => inner.pendingS4Executions(),
    pendingS5Executions: () => inner.pendingS5Executions(),
    recordS5MemberOutcomes: (aggregateId, members) =>
      inner.recordS5MemberOutcomes(aggregateId, members),
    pendingS6Executions: () => inner.pendingS6Executions(),
    recordS6MemberOutcomes: (aggregateId, members) =>
      inner.recordS6MemberOutcomes(aggregateId, members),
    recordS4PreviewResult: (aggregateId, record) =>
      inner.recordS4PreviewResult(aggregateId, record),
    recordExecutedTerminal: (aggregateId, terminal) =>
      inner.recordExecutedTerminal(aggregateId, terminal),
    closeCancelledLineage: (aggregateId, terminal) =>
      inner.closeCancelledLineage(aggregateId, terminal),
    recordTargetEvidence: (aggregateId, receipt) =>
      inner.recordTargetEvidence(aggregateId, receipt),
    recordTargetWitness: (aggregateId, receipt) => inner.recordTargetWitness(aggregateId, receipt),
    targetWitnessFor: (aggregateId) => inner.targetWitnessFor(aggregateId),
    get acceptedCommandCount(): number {
      return inner.acceptedCommandCount;
    },
  };
}
