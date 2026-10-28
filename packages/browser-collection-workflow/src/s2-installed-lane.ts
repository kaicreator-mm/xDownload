/**
 * #95 installed S2 lane — the native-host-side composition that carries one
 * explicit current-page attachment from the privileged extension context to
 * the ONE Core authority.
 *
 * Composition (every verdict is the verbatim upstream one, fail closed at
 * every arrow):
 *
 *   structurally decoded S2_ACQUIRE (broker session, origin-allow-listed)
 *   → strict lane decode (closed fields, raw-secret rejection, explicit
 *     `user-confirm:` decision token, TTL bounds)
 *   → deterministic identity derivation from the observation provenance
 *   → scoped capability issue/use in the privileged broker zone (T016
 *     auth-lifecycle; exact origin/target/contract/snapshot/provenance tuple;
 *     only the opaque AuthorizationContextRef crosses)
 *   → single Core authority via the frozen canonical seam through the T017
 *     one-authority surface binding (BROWSER_EXTENSION peer, OS-verified
 *     Windows pipe for installed mode; explicit legacy loopback if selected): SUBMIT_CONTRACT → EXECUTE_S2_ACQUISITION →
 *     READ_PROJECTION
 *   → capability revocation after the journey (least authority)
 *
 * The lane owns no scheduler, no ledger, no truth and no acceptance: terminal
 * truth is the verbatim Core projection. Raw session material never enters
 * this lane — the bytes were acquired by the browser zone under the page's
 * own authorized context and cross as base64 payload only.
 */

import { createHash } from 'node:crypto';
import { decodeAcquisitionContract, type AcquisitionContract } from '@xdownload/domain-contracts';
import {
  brokerDiagnostic,
  rejectRawSecretPayload,
  type AuthBroker,
  type BrokerDiagnostic,
  type BrokerResponse,
  type S2LaneDiagnostic,
  type S2AcquireCommandShape,
  type S2LaneHandler,
} from '@xdownload/browser-auth-broker';
import { createLoopbackClientTransport, createWindowsPipeClientTransport } from '@xdownload/core-seam';
import type { SeamDiagnostic, SeamResponse } from '@xdownload/core-seam';
import { bindSurfaceToCore, type BoundSurface } from '@xdownload/converged-runtime';
import {
  capabilityBindingFor,
  issueScopedCapability,
  useScopedCapability,
} from './auth-lifecycle.ts';

/** Bounded S2 budget profile for the installed explicit-attachment lane. */
const S2_BUDGET_PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 1,
    maxNavigationActions: 1,
    maxModelCalls: 1,
  },
  transfer: {
    domain: 'transfer',
    // #95 R1/F04: the declared v0.1.0 S2 delivered-acquisition bound
    // (64 MiB) — consistent with the browser lane's MAX_S2_ATTACHMENT_BYTES
    // and Core's MAX_S2_DELIVERED_BYTES; charged once at staging.
    maxBytes: 67_108_864,
    maxSegments: 1,
    maxActiveTransferMs: 600_000,
    maxRetryTransferRequests: 2,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 1,
    maxActiveElapsedMs: 600_000,
  },
} as const;

const SCHEMA = { schema: 'xdownload.domain-contracts', version: '1.0.0' } as const;
const MAX_TTL_MS = 600_000;
const DEFAULT_PROJECTION_WAIT_MS = 10_000;
const PROJECTION_POLL_MS = 100;

/**
 * #100-P1: Choose ONE existing Core seam transport, never a separate Core
 * authority. An installed Windows pipe takes precedence when present; a
 * failed pipe cannot silently downgrade to the weaker loopback TCP path.
 * The legacy TCP-only test/host tuple remains explicit and supported.
 */
export function selectInstalledS2CoreTransport(
  core: InstalledS2LaneConfig['core'],
):
  | { readonly kind: 'WINDOWS_PIPE'; readonly target: { readonly host: string; readonly port: 0; readonly pipeName: string } }
  | { readonly kind: 'LOOPBACK'; readonly target: { readonly host: string; readonly port: number } } {
  if (core.pipeName !== undefined) {
    return {
      kind: 'WINDOWS_PIPE',
      target: { host: '127.0.0.1', port: 0, pipeName: core.pipeName },
    };
  }
  if (core.host === undefined || core.port === undefined) {
    throw new Error('S2 Core requires a canonical Windows pipe or explicit loopback target');
  }
  return { kind: 'LOOPBACK', target: { host: core.host, port: core.port } };
}

/**
 * #95 R1/F04: seam-frame shaping of the delivered byte stream. The frozen
 * seam wire bounds (L2 §12: maxPayloadBytes 786,432, maxStringFieldLength
 * 4096) cap one command, so the delivered stream crosses as bounded chunk
 * commands of 224 seam strings (224 × 3072 = 688,128 base64 chars ≈ 688 KiB
 * of payload per command, safely below the frozen payload bound). Chunk
 * commands are journaled like any accepted command; the Core executor
 * restarts the durable lifecycle only once the declared stream is complete.
 */
const S2_SEAM_CHUNKS_PER_COMMAND = 224;

export interface InstalledS2LaneConfig {
  readonly broker: AuthBroker;
  /** One Core authority: prefer the OS-verified Windows pipe when configured. */
  readonly core: {
    readonly installId: string;
    readonly userId: string;
    readonly pipeName?: string;
    readonly host?: string;
    readonly port?: number;
  };
  /** Bounded wait for the authoritative terminal projection. */
  readonly projectionWaitMs?: number;
}

export type { S2LaneDiagnostic };

export type S2LaneRejectionStage =
  | 'LANE_DECODE'
  | 'AUTHORIZATION_ISSUE'
  | 'AUTHORIZATION_USE'
  | 'CORE_TRANSPORT'
  | 'CORE_SUBMIT'
  | 'CORE_EXECUTE'
  | 'CORE_PROJECTION';

/** New response kinds for the installed S2 lane (added to the NM vocabulary). */
export type S2LaneResponse =
  | {
      readonly kind: 'S2_RESULT';
      readonly requestId: string;
      readonly contractId: string;
      /** Verbatim Core terminal projection (facts only; never secrets). */
      readonly terminal: unknown;
      readonly authorizationContextRef: string;
    }
  | {
      readonly kind: 'S2_REJECTED';
      readonly requestId: string;
      readonly stage: S2LaneRejectionStage;
      readonly reasons: readonly BrokerDiagnostic[];
    };

interface DecodedS2Acquire {
  readonly handoff: {
    readonly kind: string;
    readonly provenanceKey: string;
    readonly origin: string;
    readonly payload: Readonly<Record<string, string>>;
    readonly capturedAtMs: number;
  };
  readonly decisionToken: string;
  readonly ttlMs: number;
  readonly delivery: Record<string, unknown>;
  readonly browserResponse: Record<string, unknown>;
  readonly bytes: readonly string[];
}

function laneFail(
  requestId: string,
  stage: S2LaneRejectionStage,
  diagnostics: readonly (BrokerDiagnostic | SeamDiagnostic)[],
): BrokerResponse {
  return {
    kind: 'S2_REJECTED',
    requestId,
    stage,
    reasons: diagnostics.map((item) => ({
      code: item.code,
      path: item.path,
      message: item.message,
      ...('invariant' in item && item.invariant !== undefined ? { invariant: item.invariant } : {}),
    })),
  };
}

function decodeLanePayload(payload: Record<string, unknown>):
  | {
      ok: true;
      value: DecodedS2Acquire;
    }
  | {
      ok: false;
      diagnostics: readonly BrokerDiagnostic[];
    } {
  // Raw-secret rejection over the WHOLE lane payload first (defense in depth;
  // the SW already redacted the handoff at its exit sink).
  const secretScan = rejectRawSecretPayload(payload, 's2');
  if (!secretScan.ok) {
    return { ok: false, diagnostics: secretScan.diagnostics };
  }
  const handoff = payload['handoff'];
  if (typeof handoff !== 'object' || handoff === null || Array.isArray(handoff)) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff',
          'handoff envelope must be an object',
        ),
      ],
    };
  }
  const handoffRecord = handoff as Record<string, unknown>;
  const handoffKeys = Object.keys(handoffRecord).filter(
    (key) =>
      ![
        'kind',
        'provenanceKey',
        'origin',
        'payload',
        'capturedAtMs',
        'authority',
        'authorizationContextRef',
      ].includes(key),
  );
  if (handoffKeys.length > 0) {
    return {
      ok: false,
      diagnostics: handoffKeys.map((key) =>
        brokerDiagnostic(
          'UNKNOWN_FIELD',
          `s2.handoff.${key}`,
          'unknown field on the observation handoff; fail closed',
          'L2-inv11',
        ),
      ),
    };
  }
  if (handoffRecord['authority'] !== 'EVIDENCE_INPUT_ONLY') {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.authority',
          'handoff must stay EVIDENCE_INPUT_ONLY',
        ),
      ],
    };
  }
  const provenanceKey = handoffRecord['provenanceKey'];
  if (
    typeof provenanceKey !== 'string' ||
    provenanceKey.length === 0 ||
    provenanceKey.length > 512
  ) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.provenanceKey',
          'provenance key must be a bounded string',
        ),
      ],
    };
  }
  const origin = handoffRecord['origin'];
  if (typeof origin !== 'string' || !/^https?:\/\/.+:.+$|^https?:\/\/.+$/u.test(origin)) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.origin',
          'origin must be an http(s) origin',
        ),
      ],
    };
  }
  const handoffKind = handoffRecord['kind'];
  if (typeof handoffKind !== 'string' || handoffKind.length === 0) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.kind',
          'observation kind is required',
        ),
      ],
    };
  }
  const handoffPayload = handoffRecord['payload'];
  if (
    typeof handoffPayload !== 'object' ||
    handoffPayload === null ||
    Array.isArray(handoffPayload)
  ) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.payload',
          'handoff payload must be an object',
        ),
      ],
    };
  }
  const capturedAtMs = handoffRecord['capturedAtMs'];
  if (typeof capturedAtMs !== 'number' || !Number.isFinite(capturedAtMs)) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.handoff.capturedAtMs',
          'capturedAtMs must be a number',
        ),
      ],
    };
  }
  const decisionToken = payload['decisionToken'];
  if (typeof decisionToken !== 'string' || !decisionToken.startsWith('user-confirm:')) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'ISSUE_DECISION_REQUIRED',
          's2.decisionToken',
          'an explicit user confirmation decision token (user-confirm:…) is mandatory; there is no automatic issue path',
        ),
      ],
    };
  }
  const ttlMs = payload['ttlMs'];
  if (typeof ttlMs !== 'number' || !Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.ttlMs',
          `ttlMs must be a positive integer ≤ ${String(MAX_TTL_MS)}`,
        ),
      ],
    };
  }
  const delivery = payload['delivery'];
  if (typeof delivery !== 'object' || delivery === null || Array.isArray(delivery)) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.delivery',
          'delivery declaration must be an object',
        ),
      ],
    };
  }
  const browserResponse = payload['browserResponse'];
  if (
    typeof browserResponse !== 'object' ||
    browserResponse === null ||
    Array.isArray(browserResponse)
  ) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.browserResponse',
          'browser response facts must be an object',
        ),
      ],
    };
  }
  const bytes = payload['bytes'];
  if (!Array.isArray(bytes) || bytes.length === 0) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's2.bytes',
          'delivered base64 chunks are required',
        ),
      ],
    };
  }
  for (const chunk of bytes) {
    if (typeof chunk !== 'string' || chunk.length === 0 || chunk.length > 4096) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic(
            'MALFORMED_REQUIRED_FIELD',
            's2.bytes',
            'each chunk must be a base64 string of at most 4096 chars',
          ),
        ],
      };
    }
  }
  return {
    ok: true,
    value: {
      handoff: {
        kind: handoffKind,
        provenanceKey,
        origin,
        payload: handoffPayload as Record<string, string>,
        capturedAtMs,
      },
      decisionToken,
      ttlMs,
      delivery: delivery as Record<string, unknown>,
      browserResponse: browserResponse as Record<string, unknown>,
      bytes: bytes as string[],
    },
  };
}

function s2ContractInput(input: {
  readonly contractId: string;
  readonly targetId: string;
}): Record<string, unknown> {
  return {
    schemaIdentity: SCHEMA,
    contractId: input.contractId,
    status: 'CONFIRMED',
    intentType: 'SINGLE_RESOURCE',
    requestedTarget: input.targetId,
    requestedScope: { kind: 'single_resource', targetId: input.targetId },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: false },
    automationMode: 'AUTO',
    explorationPermission: 'NONE',
    budgetProfile: S2_BUDGET_PROFILE,
    authorizationContextRef: 'authctx/installed-s2-lane',
    validationPolicy: { requiredLayers: ['target', 'transfer', 'format'] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
    confirmedAt: new Date(0).toISOString(),
  };
}

/**
 * Create the installed S2 lane handler for the native host. Every journey
 * opens its own seam client and closes it before responding; Core lifetime
 * is never affected by the lane.
 */
export function createInstalledS2Lane(config: InstalledS2LaneConfig): S2LaneHandler {
  return {
    async handle(command: S2AcquireCommandShape): Promise<BrokerResponse> {
      const decoded = decodeLanePayload(command.payload);
      if (!decoded.ok) {
        return laneFail(command.requestId, 'LANE_DECODE', decoded.diagnostics);
      }
      const acquire = decoded.value;
      const identity = createHash('sha256')
        .update(`${acquire.handoff.provenanceKey}\n${String(acquire.delivery['locatorUri'])}`)
        .digest('hex')
        .slice(0, 24);
      const contractId = `contract-s2-${identity}`;
      const targetId = `s2-attachment:${identity}`;
      const memberId = `member-s2-${identity}`;
      const artifactId = `artifact:s2:${identity}`;
      const snapshotId = `snapshot-s2-${identity}`;

      const contractDecoded = decodeAcquisitionContract(s2ContractInput({ contractId, targetId }));
      if (!contractDecoded.ok) {
        return laneFail(command.requestId, 'LANE_DECODE', [
          brokerDiagnostic(
            'MALFORMED_REQUIRED_FIELD',
            's2.contract',
            'the derived S2 contract fails canonical decode',
          ),
        ]);
      }
      const contract = contractDecoded.value as AcquisitionContract;

      // Scoped capability in the privileged broker zone (T016 auth-lifecycle):
      // issue from the explicit user decision, then exact-binding use.
      const binding = capabilityBindingFor({
        authorization: {
          origin: acquire.handoff.origin,
          target: targetId,
          provenanceChain: acquire.handoff.provenanceKey,
        },
        contract,
        snapshotId,
      });
      const issued = issueScopedCapability(
        config.broker,
        binding,
        acquire.ttlMs,
        acquire.decisionToken,
      );
      if (!issued.ok) {
        return laneFail(command.requestId, 'AUTHORIZATION_ISSUE', issued.diagnostics);
      }
      const ref = issued.value.ref;
      // Least authority: the capability dies with the journey, whatever the
      // Core outcome is.
      const use = useScopedCapability(config.broker, ref, binding);
      if (use.outcome !== 'AUTH_GRANTED') {
        void config.broker.revoke(ref);
        return laneFail(command.requestId, 'AUTHORIZATION_USE', use.reasons);
      }

      let surface: BoundSurface | undefined;
      try {
        const selectedCore = selectInstalledS2CoreTransport(config.core);
        surface = bindSurfaceToCore({
          surface: 'BROWSER_EXTENSION',
          installId: config.core.installId,
          userId: config.core.userId,
          transport:
            selectedCore.kind === 'WINDOWS_PIPE'
              ? createWindowsPipeClientTransport()
              : createLoopbackClientTransport(),
          target: selectedCore.target,
          makeRequestId: () => `s2-${command.requestId}-${String(nextLaneSequence())}`,
        });
        // A resumed S2 observation has the SAME Core contract identity after
        // host restart. Read the durable authority first: a second
        // SUBMIT_CONTRACT(expectedRevision=0) would always reject it, leaving
        // earlier journaled slabs orphaned. This read does not grant authority;
        // the fresh user decision/capability above is still mandatory.
        const slabCount = Math.ceil(acquire.bytes.length / S2_SEAM_CHUNKS_PER_COMMAND) || 1;
        const observed = await surface.readProjection(contractId);
        let currentRevision: number;
        if (observed.outcome === 'PROJECTION') {
          const view = observed.projection as Record<string, unknown>;
          const previous = view['contract'] as Record<string, unknown> | undefined;
          const scope = previous?.['requestedScope'] as Record<string, unknown> | undefined;
          const lineage = view['lineage'] as Record<string, unknown> | undefined;
          if (
            previous?.['contractId'] !== contractId ||
            previous['status'] !== 'CONFIRMED' ||
            previous['intentType'] !== 'SINGLE_RESOURCE' ||
            scope?.['kind'] !== 'single_resource' ||
            scope['targetId'] !== targetId ||
            lineage === undefined
          ) {
            return laneFail(command.requestId, 'CORE_PROJECTION', [
              brokerDiagnostic(
                'S2_LANE_REJECTED',
                'projection.contract',
                'existing Core contract does not match this exact S2 observation and target',
              ),
            ]);
          }
          if (lineage['status'] === 'TERMINAL' && view['terminal'] !== undefined) {
            // Show the EXISTING Core terminal verbatim. No new accepted
            // effect, network request, or budget charge can occur here.
            return {
              kind: 'S2_RESULT',
              requestId: command.requestId,
              contractId,
              terminal: view['terminal'],
              authorizationContextRef: ref,
            } satisfies S2LaneResponse as BrokerResponse;
          }
          if (
            lineage['status'] !== 'ACTIVE' ||
            !Number.isSafeInteger(previous['revision']) ||
            (previous['revision'] as number) < 1 ||
            (previous['revision'] as number) >= 1 + slabCount
          ) {
            return laneFail(command.requestId, 'CORE_PROJECTION', [
              brokerDiagnostic(
                'S2_LANE_REJECTED',
                'projection.contract.revision',
                'existing S2 stream is cancelled, inconsistent, or not safely resumable',
              ),
            ]);
          }
          currentRevision = previous['revision'] as number;
        } else if (
          observed.outcome === 'REJECTED' &&
          observed.diagnostics?.length === 1 &&
          observed.diagnostics[0]?.code === 'AGGREGATE_NOT_FOUND'
        ) {
          const submitted = await surface.submitCanonicalCommand({
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: contractId,
            requestId: `s2-submit-${command.requestId}`.slice(0, 128),
            expectedRevision: 0,
            correlation: { contractId },
            payload: s2ContractInput({ contractId, targetId }),
          });
          if (submitted.outcome !== 'ACCEPTED') {
            return laneFail(command.requestId, 'CORE_SUBMIT', submitted.diagnostics ?? []);
          }
          currentRevision = 1;
        } else {
          const diagnostics = observed.diagnostics ?? [
            brokerDiagnostic(
              'S2_LANE_REJECTED',
              'projection',
              'Core returned no trustworthy S2 aggregate state',
            ),
          ];
          return laneFail(command.requestId, 'CORE_PROJECTION', diagnostics);
        }
        // Redeliver ALL original slabs from the current authority revision,
        // including the persisted prefix. Core's S2ChunkStagingStore compares
        // each previously journaled slab byte-for-byte and refuses changed
        // content/count; suffix-only replay would silently splice different
        // streams. This requires no new wire API or untrusted progress cursor.
        for (let index = 0; index < slabCount; index += 1) {
          const slab = acquire.bytes.slice(
            index * S2_SEAM_CHUNKS_PER_COMMAND,
            (index + 1) * S2_SEAM_CHUNKS_PER_COMMAND,
          );
          const executed = await surface.submitCanonicalCommand({
            commandType: 'EXECUTE_S2_ACQUISITION',
            aggregateId: contractId,
            requestId: `s2-execute-${command.requestId.slice(0, 96)}-${String(index)}`.slice(
              0,
              128,
            ),
            expectedRevision: currentRevision + index,
            correlation: { contractId, snapshotId },
            payload: {
              snapshotId,
              memberId,
              artifactId,
              authorizationContextRef: ref,
              delivery: acquire.delivery,
              browserResponse: acquire.browserResponse,
              bytes: slab,
              chunk: { index, count: slabCount },
            },
          });
          if (executed.outcome !== 'ACCEPTED') {
            return laneFail(command.requestId, 'CORE_EXECUTE', executed.diagnostics ?? []);
          }
        }
        // Terminal truth: bounded poll of the authoritative projection.
        const projection = await pollTerminalProjection(
          surface,
          contractId,
          config.projectionWaitMs ?? DEFAULT_PROJECTION_WAIT_MS,
        );
        if (projection === undefined) {
          return laneFail(command.requestId, 'CORE_PROJECTION', [
            brokerDiagnostic(
              'S2_LANE_REJECTED',
              'projection',
              'the authoritative terminal projection did not become readable within the bounded wait',
            ),
          ]);
        }
        const view = projection.projection as Record<string, unknown>;
        if (view['terminal'] === undefined) {
          return laneFail(command.requestId, 'CORE_PROJECTION', [
            brokerDiagnostic(
              'S2_LANE_REJECTED',
              'projection.terminal',
              'Core returned no terminal truth',
            ),
          ]);
        }
        return {
          kind: 'S2_RESULT',
          requestId: command.requestId,
          contractId,
          terminal: view['terminal'],
          authorizationContextRef: ref,
        } satisfies S2LaneResponse as BrokerResponse;
      } catch (error) {
        return laneFail(command.requestId, 'CORE_TRANSPORT', [
          brokerDiagnostic(
            'CORE_UNREACHABLE',
            'core',
            `the single Core authority is unreachable; the S2 journey fails closed: ${
              error instanceof Error ? error.message : 'seam transport failed'
            }`,
          ),
        ]);
      } finally {
        void config.broker.revoke(ref);
        if (surface !== undefined) {
          await surface.close().catch(() => undefined);
        }
      }
    },
  };
}

async function pollTerminalProjection(
  surface: BoundSurface,
  contractId: string,
  waitMs: number,
): Promise<SeamResponse | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const response = await surface.readProjection(contractId).catch(() => undefined);
    if (
      response !== undefined &&
      response.outcome === 'PROJECTION' &&
      (response.projection as Record<string, unknown> | undefined)?.['terminal'] !== undefined
    ) {
      return response;
    }
    if (Date.now() >= deadline) {
      return response?.outcome === 'PROJECTION' ? response : undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECTION_POLL_MS));
  }
}

let laneSequence = 0;
function nextLaneSequence(): number {
  laneSequence += 1;
  return laneSequence;
}

/** Response-kind discriminants of the installed S2 lane (for type narrowing). */
export function isS2LaneResponse(value: BrokerResponse): value is S2LaneResponse {
  return value.kind === 'S2_RESULT' || value.kind === 'S2_REJECTED';
}

/** Contract identity derivation exposed for tests (deterministic, no state). */
export function s2IdentityFor(input: {
  readonly provenanceKey: string;
  readonly locatorUri: string;
}): { readonly contractId: string; readonly targetId: string } {
  const identity = createHash('sha256')
    .update(`${input.provenanceKey}\n${input.locatorUri}`)
    .digest('hex')
    .slice(0, 24);
  return { contractId: `contract-s2-${identity}`, targetId: `s2-attachment:${identity}` };
}
