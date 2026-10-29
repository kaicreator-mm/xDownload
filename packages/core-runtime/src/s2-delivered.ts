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
 * Truthfulness rules (issue #95, R1):
 * - a malformed payload REJECTS (nothing executes);
 * - a truthful execution failure (digest/format/target/auth) ACCEPTS the
 *   command and returns a FAILED terminal — submit-accepted is never
 *   conflated with download-success;
 * - the terminal projection is Core-derived through the T007 projector with
 *   a deterministic recordedAt (the durable work-item creation timestamp), so
 *   journal replay after restart re-derives identical authority state.
 *
 * R1 repairs (PR #96 review findings F01/F02/F04):
 * - F01: `delivery.expectedSha256` is OPTIONAL. The target anchor is the
 *   programmatically established, pre-registered selection provenance (the
 *   observed page member + declared delivery hosts); a declared digest only
 *   STRENGTHENS target validation, it is never the admission gate. The hash
 *   of the just-delivered bytes is never used as an independent oracle (C34).
 * - F02: Format validation ALWAYS runs (HTML-masquerade rejection plus
 *   declared content-type consistency when a prefix exists); the layer set
 *   recorded into acceptance is always transfer+format+target.
 * - F04: delivered bytes may arrive as a bounded chunk stream
 *   (`payload.chunk = {index,count}`) so one acquisition is not squeezed into
 *   a single frozen seam frame; staged bytes are capped per acquisition at
 *   MAX_S2_DELIVERED_BYTES and the stream is all-or-nothing (the durable
 *   lifecycle starts only when the declared stream is complete).
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
import {
  isSha256Hex,
  validateFormat,
  type ValidationLayerOutcome,
} from '@xdownload/direct-acquisition';
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
    /**
     * Optional independent content anchor declared BEFORE the bytes existed
     * (e.g. a publisher-known digest). It only strengthens Target validation;
     * it is never required and never derived from the delivered bytes (C34).
     */
    readonly expectedSha256?: string;
    readonly expectedContentTypePrefix?: string;
    readonly expectedTotalBytes?: number;
  };
  readonly browserResponse: {
    readonly finalUrl: string;
    readonly contentType?: string;
    /**
     * The browser-observed Content-Length of the final response, when the
     * server declared one — the independent transfer oracle the delivered
     * byte count is checked against.
     */
    readonly contentLength?: number;
    readonly status: number;
  };
  /** base64 chunks exactly as they crossed the seam (≤4096 chars each). */
  readonly bytes: readonly string[];
  /**
   * Chunked-delivery framing (F04): when present, `bytes` carries slab
   * `index` of `count`; the durable lifecycle starts only once every slab of
   * the declared stream was staged. Absent → the payload is the complete
   * single-frame delivery (the v1 legacy shape, kept for journal replay).
   */
  readonly chunk?: { readonly index: number; readonly count: number };
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
const RESPONSE_KEYS: readonly string[] = ['finalUrl', 'contentType', 'contentLength', 'status'];
const PROVENANCE_BINDING_KINDS: readonly LocatorProvenanceBinding[] = [
  'DECLARED_DELIVERY_EDGE',
  'SELECTED_RESOURCE_PROVENANCE',
  'MEMBER_DELIVERY_EDGE',
];
const MAX_REDIRECT_HOSTS = 8;
const MAX_S2_IDENTITY_LENGTH = 256;

/**
 * Declared v0.1.0 S2 delivered-acquisition bound (F04): one explicit
 * attachment may carry at most 64 MiB across its chunk stream. The bound is
 * derived from the actual lane budgets (native-host assembly, lane transfer
 * budget, Core staging), enforced BEFORE unconsumed buffering at every hop,
 * and recorded in docs/implementation/v0.1.0/S2_DELIVERED_ACQUISITION_LIMITS.md.
 * It must equal the browser lane's MAX_S2_ATTACHMENT_BYTES (s2-glue.ts).
 */
export const MAX_S2_DELIVERED_BYTES = 64 * 1024 * 1024;
/** Bound on the declared chunk count of one delivered stream (512 KiB slabs). */
export const MAX_S2_CHUNK_COUNT = 1024;

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

const BASE64_CHUNK_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

function decodeBase64Chunks(chunks: readonly unknown[]): SeamResult<Uint8Array> {
  const parts: Buffer[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (typeof chunk !== 'string' || chunk.length === 0 || chunk.length > 4096) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.bytes',
          'each chunk must be a non-empty base64 string of at most 4096 chars',
        ),
      ]);
    }
    // Strict stream semantics: every chunk is canonical base64, only the
    // final chunk may carry padding, and non-final chunks are quantum-aligned
    // — per-chunk decode then equals whole-stream decode (no lenient-parser
    // byte drift between the lane and Core).
    if (!BASE64_CHUNK_PATTERN.test(chunk)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.bytes',
          'each chunk must be canonical base64 (padding only at the stream end)',
        ),
      ]);
    }
    if (index < chunks.length - 1 && (chunk.length % 4 !== 0 || chunk.endsWith('='))) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.bytes',
          'non-final chunks must be quantum-aligned base64 without padding',
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
      'chunk',
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
  // F01: the digest is an OPTIONAL strengthening anchor. When declared it
  // must be a well-formed hex SHA-256; when absent, Target validation rests
  // on the pre-registered selection provenance alone (never on a hash of the
  // just-delivered bytes — C34).
  let expectedSha256: string | undefined;
  if (deliveryRecord['expectedSha256'] !== undefined) {
    const digest = requireString(deliveryRecord, 'expectedSha256', 'payload.delivery');
    if (!digest.ok) {
      return digest;
    }
    if (!isSha256Hex(digest.value)) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.delivery.expectedSha256',
          'expected a hex SHA-256 digest',
        ),
      ]);
    }
    expectedSha256 = digest.value;
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
  let contentLength: number | undefined;
  if (responseRecord['contentLength'] !== undefined) {
    const declared = responseRecord['contentLength'];
    if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.browserResponse.contentLength',
          'expected a non-negative integer',
        ),
      ]);
    }
    contentLength = declared;
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
  let chunk: { readonly index: number; readonly count: number } | undefined;
  if (record['chunk'] !== undefined) {
    const rawChunk = record['chunk'];
    if (typeof rawChunk !== 'object' || rawChunk === null || Array.isArray(rawChunk)) {
      return seamFail([
        seamDiagnostic('ENVELOPE_MALFORMED', 'payload.chunk', 'chunk framing must be an object'),
      ]);
    }
    const chunkRecord = rawChunk as Record<string, unknown>;
    const chunkShaped = rejectUnknown(chunkRecord, ['index', 'count'], 'payload.chunk');
    if (!chunkShaped.ok) {
      return chunkShaped;
    }
    const index = chunkRecord['index'];
    const count = chunkRecord['count'];
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_S2_CHUNK_COUNT ||
      index < 0 ||
      index >= count
    ) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.chunk',
          `chunk framing must be integer index/count with 0 ≤ index < count ≤ ${String(MAX_S2_CHUNK_COUNT)}`,
        ),
      ]);
    }
    chunk = { index, count };
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
      ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
      ...(expectedContentTypePrefix === undefined ? {} : { expectedContentTypePrefix }),
      ...(expectedTotalBytes === undefined ? {} : { expectedTotalBytes }),
    },
    browserResponse: {
      finalUrl: finalUrl.value,
      ...(contentType === undefined ? {} : { contentType }),
      ...(contentLength === undefined ? {} : { contentLength }),
      status,
    },
    bytes: rawBytes as string[],
    ...(chunk === undefined ? {} : { chunk }),
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
  /**
   * The frozen §28 S2 layer set (transfer+format+target) recorded into
   * acceptance when the verdict passed — every layer actually ran.
   */
  readonly layers: readonly ValidationLayerOutcome[];
}

/**
 * Delivered-bytes validation (PRD §22/§28 S2, R1):
 * - Transfer: the browser-observed response facts are the independent
 *   transfer oracle — the delivered byte count must match the observed
 *   Content-Length (when the server declared one) and any size declared at
 *   selection time; a seam-side byte drift is a truthful CORRUPT_BYTES.
 * - Target: the observed final URL must stay inside the declared delivery
 *   scope (the positively grounded selected member plus its declared
 *   redirect/CDN hosts — C29); when an independently declared digest exists
 *   it is additionally enforced. The delivered bytes' own hash is never the
 *   target oracle (C34).
 * - Format: ALWAYS evaluated — login/error HTML masquerading as target
 *   content is rejected, and a declared content-type prefix is enforced when
 *   present. The format layer is never silently skipped (F02).
 */
function validateDeliveredAcquisition(input: {
  readonly payload: S2DeliveredAcquisitionPayload;
  readonly bytes: Uint8Array;
}): S2ValidationVerdict {
  const { payload } = input;
  const failed = (
    failure: S2FailureCategory,
    stopFacts: Readonly<Record<string, boolean>>,
  ): S2ValidationVerdict => ({ passed: false, failure, stopFacts, layers: [] });
  if (payload.browserResponse.status !== 200) {
    const auth = payload.browserResponse.status === 401 || payload.browserResponse.status === 403;
    return failed(
      auth ? 'AUTH_REQUIRED' : 'NETWORK_FAILURE',
      auth ? { authRequired: true } : { noProgress: true },
    );
  }
  const allowed = new Set<string>([
    ...payload.delivery.declaredRedirectHosts,
    new URL(payload.delivery.originLocatorUri).host,
    new URL(payload.delivery.locatorUri).host,
  ]);
  const finalHost = new URL(payload.browserResponse.finalUrl).host;
  if (!allowed.has(finalHost)) {
    return failed('REDIRECT_SCOPE_EXPANSION', { targetChanged: true });
  }
  if (
    payload.browserResponse.contentLength !== undefined &&
    payload.browserResponse.contentLength !== input.bytes.length
  ) {
    return failed('CORRUPT_BYTES', { validationFailed: true });
  }
  if (
    payload.delivery.expectedTotalBytes !== undefined &&
    payload.delivery.expectedTotalBytes !== input.bytes.length
  ) {
    return failed('CORRUPT_BYTES', { validationFailed: true });
  }
  if (payload.delivery.expectedSha256 !== undefined) {
    const digest = sha256Hex(input.bytes);
    if (digest !== payload.delivery.expectedSha256) {
      return failed('CORRUPT_BYTES', { validationFailed: true });
    }
  }
  const format = validateFormat({
    contentType: payload.browserResponse.contentType,
    bodyPrefix: input.bytes.subarray(0, 512),
    ...(payload.delivery.expectedContentTypePrefix === undefined
      ? {}
      : { expectedContentTypePrefix: payload.delivery.expectedContentTypePrefix }),
  });
  if (!format.passed) {
    return failed('FORMAT_REJECTED', { validationFailed: true });
  }
  return {
    passed: true,
    stopFacts: {},
    layers: [
      { layer: 'transfer', passed: true },
      { layer: 'format', passed: true },
      { layer: 'target', passed: true },
    ],
  };
}

/**
 * Bounded per-acquisition staging of a chunked delivered stream (F04).
 * State lives as long as the owning seam composition: journaled chunk
 * commands replay through the same store on restart, so the staged truth is
 * rebuilt deterministically before the completing chunk re-executes.
 */
export interface S2ChunkStagingStore {
  /**
   * Stage one decoded slab. Returns 'COMPLETE' with the assembled bytes once
   * every declared chunk arrived exactly once; conflicting re-delivery of an
   * index with different bytes rejects (byte-identical re-delivery is a
   * convergent no-op); crossing the declared MAX_S2_DELIVERED_BYTES bound
   * rejects before the stream is buffered further.
   */
  readonly stage: (input: {
    readonly key: string;
    readonly index: number;
    readonly count: number;
    readonly bytes: Uint8Array;
  }) => SeamResult<
    { readonly status: 'STAGED' } | { readonly status: 'COMPLETE'; readonly bytes: Uint8Array }
  >;
  /** Drop any staged state for the key (terminal or abandoned stream). */
  readonly discard: (key: string) => void;
}

export function createS2ChunkStaging(): S2ChunkStagingStore {
  const staged = new Map<
    string,
    { readonly count: number; readonly slabs: (Uint8Array | undefined)[]; total: number }
  >();
  return {
    stage(input) {
      let entry = staged.get(input.key);
      if (entry === undefined) {
        entry = { count: input.count, slabs: Array.from({ length: input.count }), total: 0 };
        staged.set(input.key, entry);
      }
      if (entry.count !== input.count) {
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.chunk.count',
            'the declared chunk count changed mid-stream; the stream is not trustworthy',
          ),
        ]);
      }
      const prior = entry.slabs[input.index];
      if (prior !== undefined) {
        if (
          prior.length === input.bytes.length &&
          Buffer.compare(prior as Buffer, input.bytes as Buffer) === 0
        ) {
          // Byte-identical re-delivery: convergent no-op (idempotent retry).
          return seamOk({ status: 'STAGED' });
        }
        return seamFail([
          seamDiagnostic(
            'ENVELOPE_MALFORMED',
            'payload.chunk.index',
            'conflicting bytes re-delivered for an already staged chunk index',
          ),
        ]);
      }
      if (entry.total + input.bytes.length > MAX_S2_DELIVERED_BYTES) {
        staged.delete(input.key);
        return seamFail([
          seamDiagnostic(
            'ADMISSION_REJECTED',
            'payload.chunk',
            `the declared stream crosses the v0.1.0 S2 delivered-acquisition bound of ${String(MAX_S2_DELIVERED_BYTES)} bytes`,
            'PRD-§28 S2',
          ),
        ]);
      }
      entry.slabs[input.index] = input.bytes;
      entry.total += input.bytes.length;
      if (entry.slabs.some((slab) => slab === undefined)) {
        return seamOk({ status: 'STAGED' });
      }
      staged.delete(input.key);
      return seamOk({
        status: 'COMPLETE',
        bytes: new Uint8Array(Buffer.concat(entry.slabs as Uint8Array[])),
      });
    },
    discard(key) {
      staged.delete(key);
    },
  };
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
 *
 * Chunked delivery (F04): a payload carrying `chunk` stages its slab and
 * returns STAGED without touching the lifecycle; the completing chunk runs
 * the canonical path over the assembled bytes. The staging store is owned by
 * the runtime composition so journal replay rebuilds staged truth
 * deterministically.
 */
export function executeS2DeliveredAcquisition(
  runtime: FlowRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly payload: unknown;
  },
  staging: S2ChunkStagingStore,
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
  const effectId = unwrapOrThrow(
    makeEffectId(
      `effect:${input.contract.contractId}:${payload.snapshotId}:${input.contract.requestedTarget}`,
    ),
  );

  // Replay/restart reconcile: the durable ledger may already contain the
  // accepted effect before its seam journal is replayed. For a chunked stream,
  // the earlier journal entries are STAGED commands, not terminal commands:
  // projecting terminal on the first one would make the next entry LATE and
  // permanently fence this otherwise-valid Core root on reopen (#98).
  //
  // Rebuild only the EPHEMERAL stream-completion counter from accepted journal
  // bytes. Until the completing chunk arrives, return STAGED so replay
  // advances the exact original per-command revision. Once complete, derive
  // terminal truth from the existing durable work item (never re-execute or
  // re-charge the accepted acquisition). The staging bytes are discarded.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    if (payload.chunk !== undefined) {
      const replayed = staging.stage({
        key: effectId,
        index: payload.chunk.index,
        count: payload.chunk.count,
        bytes: byteDecode.value,
      });
      if (!replayed.ok) {
        return replayed;
      }
      if (replayed.value.status === 'STAGED') {
        return seamOk({ kind: 'STAGED' });
      }
    }
    staging.discard(effectId);
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

  // F04 chunked delivery: stage this slab and stop short of the lifecycle
  // until the declared stream is complete (all-or-nothing — a partial stream
  // never produces durable artifact truth).
  let bytes: Uint8Array;
  if (payload.chunk !== undefined) {
    const staged = staging.stage({
      key: effectId,
      index: payload.chunk.index,
      count: payload.chunk.count,
      bytes: byteDecode.value,
    });
    if (!staged.ok) {
      return staged;
    }
    if (staged.value.status === 'STAGED') {
      return seamOk({ kind: 'STAGED' });
    }
    bytes = staged.value.bytes;
  } else {
    bytes = byteDecode.value;
  }

  const commandId = `s2-delivered:${input.contract.contractId}:${payload.snapshotId}:${payload.memberId}`;
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
      acceptanceValidationOf(verdict.layers),
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
    kind: 'TERMINAL',
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
