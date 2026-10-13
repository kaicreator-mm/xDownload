/**
 * #95 S2 delivered-bytes acquisition — the Core-side executor behind the one
 * narrowly typed `EXECUTE_S2_ACQUISITION` seam command.
 *
 * The browser lane acquires the attachment bytes under the page's own
 * authorized context (raw session material stays in the browser/broker zone,
 * recorded T010 F1 choice) and delivers the BYTES plus the browser-observed
 * response facts. Core owns everything durable: it decodes the payload
 * fail-closed, validates transfer/format/target truth over the delivered
 * bytes, and drives the SAME canonical lifecycle as every other acquisition
 * (register → dispatch → attempt → effect truth → staged → materialized →
 * finalized → accepted → scheduler acceptance → projection).
 *
 * Truthfulness rules (issue #95):
 * - a malformed payload REJECTS (nothing executes);
 * - a truthful execution failure (digest/format/target/auth) ACCEPTS the
 *   command and returns a FAILED terminal — submit-accepted is never
 *   conflated with download-success;
 * - the terminal projection is Core-derived through the T007 projector with
 *   a deterministic recordedAt (the durable work-item creation timestamp), so
 *   journal replay after restart re-derives identical authority state.
 */

import { lineageKeyOf } from '@xdownload/core-scheduler';
import {
  bindLocator,
  makeAuthorizationContextRef,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  unwrapOrThrow,
  type AcquisitionContract,
  type LocatorProvenance,
  type LocatorProvenanceBinding,
  type ResourceLocator,
} from '@xdownload/domain-contracts';
import { isSha256Hex, type ValidationLayerOutcome } from '@xdownload/direct-acquisition';
import {
  seamDiagnostic,
  seamFail,
  seamOk,
  type SeamResult,
  type S2DeliveredAcquisitionExecution,
} from '@xdownload/core-seam';
import { assertArtifactId, sha256Hex } from '@xdownload/persistence-ledger';
import type { FlowRuntime, ProjectionRuntime } from './flow.ts';
import {
  acceptanceValidationOf,
  attemptIdFor,
  completeArtifactLifecycle,
  projectLineageResult,
  registerLineage,
} from './flow.ts';

/** Declared delivery + observed response facts + delivered bytes (one S2 acquisition). */
export interface S2DeliveredAcquisitionPayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly authorizationContextRef: string;
  readonly delivery: {
    readonly locatorUri: string;
    readonly originLocatorUri: string;
    readonly provenanceBinding: LocatorProvenanceBinding;
    readonly declaredRedirectHosts: readonly string[];
    readonly expectedSha256: string;
    readonly expectedContentTypePrefix?: string;
    readonly expectedTotalBytes?: number;
  };
  readonly browserResponse: {
    readonly finalUrl: string;
    readonly contentType?: string;
    readonly status: number;
  };
  /** base64 chunks exactly as they crossed the seam (≤4096 chars each). */
  readonly bytes: readonly string[];
}

const DELIVERY_KEYS: readonly string[] = [
  'locatorUri',
  'originLocatorUri',
  'provenanceBinding',
  'declaredRedirectHosts',
  'expectedSha256',
  'expectedContentTypePrefix',
  'expectedTotalBytes',
];
const RESPONSE_KEYS: readonly string[] = ['finalUrl', 'contentType', 'status'];
const PROVENANCE_BINDING_KINDS: readonly LocatorProvenanceBinding[] = [
  'DECLARED_DELIVERY_EDGE',
  'SELECTED_RESOURCE_PROVENANCE',
  'MEMBER_DELIVERY_EDGE',
];
const MAX_REDIRECT_HOSTS = 8;
const MAX_S2_IDENTITY_LENGTH = 256;

function rejectUnknown(
  record: Record<string, unknown>,
  keys: readonly string[],
  at: string,
): SeamResult<void> {
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    return seamFail(
      unknown.map((key) =>
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          `${at}.${key}`,
          'unknown field on S2 acquisition payload',
        ),
      ),
    );
  }
  return seamOk(undefined);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  at: string,
): SeamResult<string> {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_S2_IDENTITY_LENGTH) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        `${at}.${key}`,
        `expected a non-empty string of at most ${String(MAX_S2_IDENTITY_LENGTH)} chars`,
      ),
    ]);
  }
  return seamOk(value);
}

function requireHttpUrl(value: string, at: string): SeamResult<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return seamFail([seamDiagnostic('ENVELOPE_MALFORMED', at, 'expected an absolute http(s) URL')]);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', at, 'only http(s) locators are admissible'),
    ]);
  }
  return seamOk(parsed);
}

function decodeBase64Chunks(chunks: readonly unknown[]): SeamResult<Uint8Array> {
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    if (typeof chunk !== 'string' || chunk.length === 0 || chunk.length > 4096) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.bytes',
          'each chunk must be a non-empty base64 string of at most 4096 chars',
        ),
      ]);
    }
    const decoded = Buffer.from(chunk, 'base64');
    if (decoded.length === 0) {
      return seamFail([
        seamDiagnostic('ENVELOPE_MALFORMED', 'payload.bytes', 'empty base64 chunk'),
      ]);
    }
    parts.push(decoded);
  }
  return seamOk(new Uint8Array(Buffer.concat(parts)));
}

/** Strict, fail-closed decode of the S2 delivered-acquisition payload. */
export function decodeS2DeliveredPayload(
  payload: unknown,
): SeamResult<S2DeliveredAcquisitionPayload> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'S2 payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const shaped = rejectUnknown(
    record,
    [
      'snapshotId',
      'memberId',
      'artifactId',
      'authorizationContextRef',
      'delivery',
      'browserResponse',
      'bytes',
    ],
    'payload',
  );
  if (!shaped.ok) {
    return shaped;
  }
  if (!makeSnapshotId(record['snapshotId'] as string).ok) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'not a canonical snapshot identity',
      ),
    ]);
  }
  if (!makeMemberId(record['memberId'] as string).ok) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.memberId', 'not a canonical member identity'),
    ]);
  }
  try {
    assertArtifactId(record['artifactId'] as string);
  } catch {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.artifactId',
        'not a canonical artifact identity',
      ),
    ]);
  }
  if (!makeAuthorizationContextRef(record['authorizationContextRef'] as string).ok) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.authorizationContextRef',
        'not a canonical authorization context ref',
      ),
    ]);
  }
  const rawDelivery = record['delivery'];
  if (typeof rawDelivery !== 'object' || rawDelivery === null || Array.isArray(rawDelivery)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.delivery', 'delivery must be an object'),
    ]);
  }
  const deliveryRecord = rawDelivery as Record<string, unknown>;
  const deliveryShaped = rejectUnknown(deliveryRecord, DELIVERY_KEYS, 'payload.delivery');
  if (!deliveryShaped.ok) {
    return deliveryShaped;
  }
  const locatorUri = requireString(deliveryRecord, 'locatorUri', 'payload.delivery');
  if (!locatorUri.ok) {
    return locatorUri;
  }
  const locator = requireHttpUrl(locatorUri.value, 'payload.delivery.locatorUri');
  if (!locator.ok) {
    return locator;
  }
  const originLocatorUri = requireString(deliveryRecord, 'originLocatorUri', 'payload.delivery');
  if (!originLocatorUri.ok) {
    return originLocatorUri;
  }
  const originLocator = requireHttpUrl(originLocatorUri.value, 'payload.delivery.originLocatorUri');
  if (!originLocator.ok) {
    return originLocator;
  }
  const provenanceBinding = requireString(deliveryRecord, 'provenanceBinding', 'payload.delivery');
  if (!provenanceBinding.ok) {
    return provenanceBinding;
  }
  if (!PROVENANCE_BINDING_KINDS.includes(provenanceBinding.value as LocatorProvenanceBinding)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.provenanceBinding',
        'provenance binding must be a canonical locator-provenance kind',
      ),
    ]);
  }
  const rawHosts = deliveryRecord['declaredRedirectHosts'];
  if (!Array.isArray(rawHosts) || rawHosts.length === 0 || rawHosts.length > MAX_REDIRECT_HOSTS) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.declaredRedirectHosts',
        `expected 1..${String(MAX_REDIRECT_HOSTS)} declared hosts`,
      ),
    ]);
  }
  const declaredRedirectHosts: string[] = [];
  for (const host of rawHosts) {
    if (typeof host !== 'string' || host.length === 0 || host.length > 255 || /[/\\]/.test(host)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.delivery.declaredRedirectHosts',
          'each entry must be a plain host string',
        ),
      ]);
    }
    declaredRedirectHosts.push(host);
  }
  const expectedSha256 = requireString(deliveryRecord, 'expectedSha256', 'payload.delivery');
  if (!expectedSha256.ok) {
    return expectedSha256;
  }
  if (!isSha256Hex(expectedSha256.value)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedSha256',
        'expected a hex SHA-256 digest',
      ),
    ]);
  }
  let expectedContentTypePrefix: string | undefined;
  if (deliveryRecord['expectedContentTypePrefix'] !== undefined) {
    const prefix = requireString(deliveryRecord, 'expectedContentTypePrefix', 'payload.delivery');
    if (!prefix.ok) {
      return prefix;
    }
    expectedContentTypePrefix = prefix.value;
  }
  let expectedTotalBytes: number | undefined;
  if (deliveryRecord['expectedTotalBytes'] !== undefined) {
    const declared = deliveryRecord['expectedTotalBytes'];
    if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.delivery.expectedTotalBytes',
          'expected a non-negative integer',
        ),
      ]);
    }
    expectedTotalBytes = declared;
  }
  const rawResponse = record['browserResponse'];
  if (typeof rawResponse !== 'object' || rawResponse === null || Array.isArray(rawResponse)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.browserResponse',
        'browserResponse must be an object',
      ),
    ]);
  }
  const responseRecord = rawResponse as Record<string, unknown>;
  const responseShaped = rejectUnknown(responseRecord, RESPONSE_KEYS, 'payload.browserResponse');
  if (!responseShaped.ok) {
    return responseShaped;
  }
  const finalUrl = requireString(responseRecord, 'finalUrl', 'payload.browserResponse');
  if (!finalUrl.ok) {
    return finalUrl;
  }
  const final = requireHttpUrl(finalUrl.value, 'payload.browserResponse.finalUrl');
  if (!final.ok) {
    return final;
  }
  let contentType: string | undefined;
  if (responseRecord['contentType'] !== undefined) {
    const type = requireString(responseRecord, 'contentType', 'payload.browserResponse');
    if (!type.ok) {
      return type;
    }
    contentType = type.value;
  }
  const status = responseRecord['status'];
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.browserResponse.status',
        'expected an integer HTTP status',
      ),
    ]);
  }
  const rawBytes = record['bytes'];
  if (!Array.isArray(rawBytes) || rawBytes.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.bytes',
        'expected a non-empty base64 chunk array',
      ),
    ]);
  }
  const bytes = decodeBase64Chunks(rawBytes);
  if (!bytes.ok) {
    return bytes;
  }
  return seamOk({
    snapshotId: record['snapshotId'] as string,
    memberId: record['memberId'] as string,
    artifactId: record['artifactId'] as string,
    authorizationContextRef: record['authorizationContextRef'] as string,
    delivery: {
      locatorUri: locatorUri.value,
      originLocatorUri: originLocatorUri.value,
      provenanceBinding: provenanceBinding.value as LocatorProvenanceBinding,
      declaredRedirectHosts,
      expectedSha256: expectedSha256.value,
      ...(expectedContentTypePrefix === undefined ? {} : { expectedContentTypePrefix }),
      ...(expectedTotalBytes === undefined ? {} : { expectedTotalBytes }),
    },
    browserResponse: {
      finalUrl: finalUrl.value,
      ...(contentType === undefined ? {} : { contentType }),
      status,
    },
    bytes: rawBytes as string[],
  });
}

/** Truthful execution failure categories (PRD §30 taxonomy subset). */
type S2FailureCategory =
  | 'AUTH_REQUIRED'
  | 'NETWORK_FAILURE'
  | 'CORRUPT_BYTES'
  | 'FORMAT_REJECTED'
  | 'WRONG_TARGET'
  | 'REDIRECT_SCOPE_EXPANSION';

interface S2ValidationVerdict {
  readonly passed: boolean;
  readonly failure?: S2FailureCategory;
  readonly stopFacts: Readonly<Record<string, boolean>>;
}

function validateDeliveredAcquisition(input: {
  readonly payload: S2DeliveredAcquisitionPayload;
  readonly bytes: Uint8Array;
}): S2ValidationVerdict {
  const { payload } = input;
  if (payload.browserResponse.status !== 200) {
    const auth = payload.browserResponse.status === 401 || payload.browserResponse.status === 403;
    return {
      passed: false,
      failure: auth ? 'AUTH_REQUIRED' : 'NETWORK_FAILURE',
      stopFacts: auth ? { authRequired: true } : { noProgress: true },
    };
  }
  const allowed = new Set<string>([
    ...payload.delivery.declaredRedirectHosts,
    new URL(payload.delivery.originLocatorUri).host,
    new URL(payload.delivery.locatorUri).host,
  ]);
  const finalHost = new URL(payload.browserResponse.finalUrl).host;
  if (!allowed.has(finalHost)) {
    return {
      passed: false,
      failure: 'REDIRECT_SCOPE_EXPANSION',
      stopFacts: { targetChanged: true },
    };
  }
  const digest = sha256Hex(input.bytes);
  if (digest !== payload.delivery.expectedSha256) {
    return { passed: false, failure: 'CORRUPT_BYTES', stopFacts: { validationFailed: true } };
  }
  if (
    payload.delivery.expectedTotalBytes !== undefined &&
    payload.delivery.expectedTotalBytes !== input.bytes.length
  ) {
    return { passed: false, failure: 'CORRUPT_BYTES', stopFacts: { validationFailed: true } };
  }
  if (
    payload.delivery.expectedContentTypePrefix !== undefined &&
    (payload.browserResponse.contentType === undefined ||
      !payload.browserResponse.contentType.startsWith(payload.delivery.expectedContentTypePrefix))
  ) {
    return { passed: false, failure: 'FORMAT_REJECTED', stopFacts: { validationFailed: true } };
  }
  return { passed: true, stopFacts: {} };
}

/** Validation-layer truth of a delivered acquisition whose verdict passed. */
function deliveredValidations(
  expectedContentTypePrefix: string | undefined,
): readonly ValidationLayerOutcome[] {
  const layers: ValidationLayerOutcome[] = [{ layer: 'transfer', passed: true }];
  if (expectedContentTypePrefix !== undefined) {
    layers.push({ layer: 'format', passed: true });
  }
  layers.push({ layer: 'target', passed: true });
  return layers;
}

/** True when the durable lifecycle for the work item reached accepted+verified bytes. */
function memberValidatedFromDurable(runtime: FlowRuntime, workItemId: string): boolean {
  const classification = runtime.recovery.classify(workItemId);
  return classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
}

/**
 * Execute the delivered-bytes S2 acquisition through the canonical durable
 * lifecycle. The contract comes from seam authority state; scope/target can
 * never be rewritten by the payload. Returns the Core-derived terminal for
 * the projector gate, never a surface-asserted one.
 */
export function executeS2DeliveredAcquisition(
  runtime: FlowRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly payload: unknown;
  },
): SeamResult<S2DeliveredAcquisitionExecution> {
  const decoded = decodeS2DeliveredPayload(input.payload);
  if (!decoded.ok) {
    return decoded;
  }
  const payload = decoded.value;
  if (
    input.contract.intentType !== 'SINGLE_RESOURCE' ||
    input.contract.requestedScope.kind !== 'single_resource'
  ) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S2 delivered-acquisition executor serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S2',
      ),
    ]);
  }
  if (input.contract.contractId !== input.aggregateId) {
    return seamFail([
      seamDiagnostic(
        'CORRELATION_BINDING_REJECTED',
        'aggregateId',
        'contract identity does not bind the addressed aggregate',
      ),
    ]);
  }
  // Canonical target/locator binding against the frozen contract target —
  // an undeclared locator for this target fails closed before any effect.
  const locatorValue: ResourceLocator = { kind: 'direct', uri: payload.delivery.locatorUri };
  const provenance: LocatorProvenance = {
    binding: payload.delivery.provenanceBinding,
    originLocatorUri: payload.delivery.originLocatorUri,
  };

  const bound = bindLocator(locatorValue, input.contract.requestedTarget, provenance);
  if (!bound.ok) {
    return seamFail(
      bound.diagnostics.map((item) =>
        seamDiagnostic(item.code, `payload.delivery.${item.path}`, item.message),
      ),
    );
  }
  const byteDecode = decodeBase64Chunks(payload.bytes);
  if (!byteDecode.ok) {
    return byteDecode;
  }
  const bytes = byteDecode.value;
  const effectId = unwrapOrThrow(
    makeEffectId(
      `effect:${input.contract.contractId}:${payload.snapshotId}:${input.contract.requestedTarget}`,
    ),
  );
  const commandId = `s2-delivered:${input.contract.contractId}:${payload.snapshotId}:${payload.memberId}`;

  // Replay/restart reconcile: the identical durable lineage already exists
  // (journal replay after restart re-applies the accepted command). The flow
  // re-derives truth from durable state only — never re-charges budgets and
  // never re-stages bytes.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    return projectS2Terminal(runtime, {
      contract: input.contract,
      payload,
      workItemId: existing.workItemId,
      lineageKey: s2LineageKey({
        contractId: input.contract.contractId,
        snapshotId: payload.snapshotId,
        targetId: input.contract.requestedTarget,
        effectId,
      }),
      recordedAt: existing.createdAt,
    });
  }

  const { submission, workItemId } = registerLineage(
    runtime,
    {
      contractId: input.contract.contractId,
      snapshotId: payload.snapshotId,
      targetId: input.contract.requestedTarget,
      authorizationContextRef: payload.authorizationContextRef,
      budgetProfile: input.contract.budgetProfile,
      frozenMemberIds: [payload.memberId],
    },
    { commandId, memberId: payload.memberId },
  );
  const workItem = runtime.writer.reader.workItems().find((item) => item.workItemId === workItemId);
  const recordedAt = workItem?.createdAt ?? new Date().toISOString();

  runtime.writer.dispatch({ workItemId, attemptId: attemptIdFor(workItemId) });
  const attempt = runtime.scheduler.startEffectAttempt(
    submission.lineageKey,
    attemptIdFor(workItemId),
  );
  if (!attempt.ok) {
    return seamFail([
      seamDiagnostic('ADMISSION_REJECTED', 'attempt', attempt.rejection.code, 'L2-§6.3'),
    ]);
  }
  runtime.writer.recordExternalEffectObserved(workItemId);

  const verdict = validateDeliveredAcquisition({ payload, bytes });
  const effectOutcome = runtime.scheduler.recordEffectOutcome(submission.lineageKey, {
    attemptId: attemptIdFor(workItemId),
    outcome: verdict.passed ? 'SUCCEEDED' : 'FAILED',
    ...(verdict.failure === undefined ? {} : { failureCategory: verdict.failure }),
  });
  if (!effectOutcome.ok) {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'effectOutcome',
        effectOutcome.rejection.code,
        'L2-§6.3',
      ),
    ]);
  }

  let failedMemberIds: readonly string[] = [];
  if (!verdict.passed) {
    runtime.writer.recordTerminalFailure(workItemId, verdict.failure ?? 'NETWORK_FAILURE');
    failedMemberIds = [payload.memberId];
  } else {
    runtime.writer.stageArtifact({
      workItemId,
      artifactId: payload.artifactId,
      bytes,
      provenance: {
        locatorChain: [payload.browserResponse.finalUrl],
        observedIdentity: { contentLength: bytes.length },
        slice: 'S1',
      },
      consumption: {
        domain: 'transfer',
        limitKey: 'bytes',
        amount: bytes.length,
        convergenceKey: `${attemptIdFor(workItemId)}:bytes`,
      },
    });
    const lifecycle = completeArtifactLifecycle(
      runtime,
      workItemId,
      payload.artifactId,
      acceptanceValidationOf(deliveredValidations(payload.delivery.expectedContentTypePrefix)),
    );
    if (lifecycle.error !== undefined) {
      runtime.writer.recordTerminalFailure(workItemId, lifecycle.error.code);
      failedMemberIds = [payload.memberId];
    } else {
      runtime.scheduler.tryAccept(submission.lineageKey);
    }
  }

  return projectS2Terminal(runtime, {
    contract: input.contract,
    payload,
    workItemId,
    lineageKey: submission.lineageKey,
    recordedAt,
    stopFacts: verdict.stopFacts,
    failedMemberIds,
  });
}

/** The canonical effect-lineage identity (LineageKey is a frozen string). */
function s2LineageKey(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly targetId: string;
  readonly effectId: string;
}): string {
  return lineageKeyOf({
    contractId: unwrapOrThrow(makeContractId(input.contractId)),
    snapshotId: unwrapOrThrow(makeSnapshotId(input.snapshotId)),
    targetId: unwrapOrThrow(makeLogicalTargetId(input.targetId)),
    effectId: unwrapOrThrow(makeEffectId(input.effectId)),
  });
}

/** Derive the terminal projection from durable facts only (T007 projector). */
function projectS2Terminal(
  runtime: ProjectionRuntime,
  input: {
    readonly contract: AcquisitionContract;
    readonly payload: S2DeliveredAcquisitionPayload;
    readonly workItemId: string;
    readonly lineageKey: string;
    readonly recordedAt: string;
    readonly stopFacts?: Readonly<Record<string, boolean>>;
    readonly failedMemberIds?: readonly string[];
  },
): SeamResult<S2DeliveredAcquisitionExecution> {
  const projected = projectLineageResult(runtime, {
    lineageKey: input.lineageKey,
    contractId: input.contract.contractId,
    snapshotId: input.payload.snapshotId,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [input.payload.memberId],
    recordedAt: input.recordedAt,
    enumeration: { kind: 'NOT_APPLICABLE' },
    ...(input.stopFacts === undefined ? {} : { stopFacts: input.stopFacts }),
  });
  if (!projected.ok) {
    return seamFail(
      projected.diagnostics.map((item) =>
        seamDiagnostic(item.code, `projection.${item.path}`, item.message),
      ),
    );
  }
  return seamOk({
    terminal: projected.value.result,
    context: {
      selectedValidationOutcomes: [
        {
          memberId: unwrapOrThrow(makeMemberId(input.payload.memberId)),
          requiredValidationPassed: memberValidatedFromDurable(runtime, input.workItemId),
        },
      ],
    },
    failedMemberIds: input.failedMemberIds ?? [],
  });
}
