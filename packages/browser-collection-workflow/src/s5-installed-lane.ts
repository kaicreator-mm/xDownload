/**
 * #151/#152 installed S5 lane — the native-host-side composition that carries
 * the browser current-page group journey to the ONE Core authority over the
 * OS-verified Windows named pipe (BROWSER_EXTENSION surface).
 *
 * Composition (every verdict is the verbatim upstream one, fail closed at
 * every arrow):
 *
 *   structurally decoded S5 NM command (broker session, origin-allow-listed)
 *   → strict lane decode (closed fields, canonical observed URIs, bounded
 *     member set, explicit user-confirm decision token on confirm)
 *   → SUBMIT_CONTRACT (DRAFT COLLECTION current-page contract, deterministic
 *     identity derived from the observed page + member tuple)
 *   → PREPARE_S5_PAGE_GROUP (Core freezes the observed member set and mints
 *     the member identities; no network)
 *   → CONFIRM_S5_PAGE_GROUP BEGIN/COMMIT (single-use connection-bound Core
 *     challenge consumed atomically with the durable CONFIRMED contract +
 *     BATCH snapshot over the user-chosen subset — Core-persisted truth)
 *   → EXECUTE_S5_COLLECTION (one durable execution intent; the Core runtime
 *     performs the REAL bounded per-member acquisition itself)
 *   → bounded READ_PROJECTION poll of the verbatim per-member and aggregate
 *     Core terminal
 *
 * The lane owns no scheduler, no ledger, no truth and no acceptance: terminal
 * truth is the verbatim Core projection. No byte ever crosses this lane —
 * the members are downloaded by Core, never by the browser or the host.
 */

import { createHash } from 'node:crypto';
import {
  brokerDiagnostic,
  type AuthBroker,
  type BrokerDiagnostic,
  type BrokerResponse,
  type S5LaneCommandShape,
  type S5LaneHandler,
} from '@xdownload/browser-auth-broker';
import {
  bindSurfaceToCore,
  type BoundSurface,
} from '@xdownload/converged-runtime';
import {
  createWindowsPipeClientTransport,
  s5SelectionTupleDigest,
  type SeamDiagnostic,
  type SeamResponse,
} from '@xdownload/core-seam';
import type { S5ObservedMember } from '@xdownload/core-seam';

const DEFAULT_PROJECTION_WAIT_MS = 300_000;
const PROJECTION_POLL_MS = 250;

export interface InstalledS5LaneConfig {
  readonly broker: AuthBroker;
  /** The one Core authority seam target (OS-verified Windows named pipe only). */
  readonly core: {
    readonly pipeName: string;
    readonly installId: string;
    readonly userId: string;
  };
  /** Bounded wait for the authoritative terminal projection after EXECUTE. */
  readonly projectionWaitMs?: number;
}

export type S5LaneRejectionStage =
  | 'LANE_DECODE'
  | 'CORE_TRANSPORT'
  | 'CORE_SUBMIT'
  | 'CORE_PROJECTION';

/** Response frames of the installed S5 lane (added to the NM vocabulary). */
export type S5LaneResponse =
  | {
      readonly kind: 'S5_RESULT';
      readonly requestId: string;
      readonly phase: 'PREPARED' | 'CONFIRMED' | 'TERMINAL' | 'RUNNING' | 'STATUS';
      readonly contractId: string;
      /** Verbatim Core projection facts (frozen members / confirmed group / terminal). */
      readonly facts: Record<string, unknown>;
    }
  | {
      readonly kind: 'S5_REJECTED';
      readonly requestId: string;
      readonly stage: S5LaneRejectionStage;
      readonly reasons: readonly BrokerDiagnostic[];
    };

const S5_LAYERS = ['membership', 'target', 'transfer', 'format', 'coverage'] as const;

/** Bounded S5 budget profile for the installed current-page batch lane. */
const S5_BUDGET_PROFILE = {
  discovery: {
    domain: 'discovery',
    maxGeneratedRequests: 1,
    maxNavigationActions: 1,
    maxModelCalls: 1,
  },
  transfer: {
    domain: 'transfer',
    maxBytes: 1_073_741_824,
    maxSegments: 20,
    maxActiveTransferMs: 600_000,
    maxRetryTransferRequests: 2,
  },
  globalSafety: {
    domain: 'global_safety',
    maxTotalGeneratedRequests: 20,
    maxActiveElapsedMs: 600_000,
  },
} as const;

const SCHEMA = { schema: 'xdownload.domain-contracts', version: '1.0.0' } as const;

function laneFail(
  requestId: string,
  stage: S5LaneRejectionStage,
  diagnostics: readonly (BrokerDiagnostic | SeamDiagnostic)[],
): BrokerResponse {
  return {
    kind: 'S5_REJECTED',
    requestId,
    stage,
    reasons: diagnostics.map((item) => ({
      code: item.code,
      path: item.path,
      message: item.message,
      ...('invariant' in item && item.invariant !== undefined ? { invariant: item.invariant } : {}),
    })),
  } as BrokerResponse;
}

/** Canonical credential-free page-observed http(s) URI (the #157 frozen rule). */
function canonicalObservedUri(raw: unknown): raw is string {
  if (
    typeof raw !== 'string' ||
    raw.length < 8 ||
    raw.length > 2048 ||
    Array.from(raw).some(
      (character) =>
        character === '\\' || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.href === raw &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

interface DecodedPrepare {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly members: readonly S5ObservedMember[];
}

function decodePreparePayload(
  payload: Record<string, unknown>,
): { ok: true; value: DecodedPrepare } | { ok: false; diagnostics: readonly BrokerDiagnostic[] } {
  const keys = Object.keys(payload).filter((key) => key !== 'tabId' && key !== 'pageUrl' && key !== 'members' && key !== 'decisionToken');
  if (keys.length > 0) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic('UNKNOWN_FIELD', `s5.${keys[0]}`, 'unknown field on the S5 prepare payload; fail closed', 'L2-inv11'),
      ],
    };
  }
  const tabId = payload['tabId'];
  if (!Number.isSafeInteger(tabId) || (tabId as number) < 0) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.tabId', 'tabId must be a nonnegative integer'),
      ],
    };
  }
  const pageUrl = payload['pageUrl'];
  if (!canonicalObservedUri(pageUrl)) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's5.pageUrl',
          'pageUrl must be a canonical credential-free http(s) URI',
        ),
      ],
    };
  }
  const members = payload['members'];
  if (!Array.isArray(members) || members.length < 1 || members.length > 20) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.members', 'members must carry 1..20 observed anchors'),
      ],
    };
  }
  const decoded: S5ObservedMember[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (
      typeof member !== 'object' ||
      member === null ||
      Array.isArray(member)
    ) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.members', 'each member must be an object'),
        ],
      };
    }
    const record = member as Record<string, unknown>;
    const unknown = Object.keys(record).filter((key) => key !== 'href' && key !== 'text');
    if (unknown.length > 0 || !Object.hasOwn(record, 'href') || !Object.hasOwn(record, 'text')) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.members', 'each member must have exactly href and text'),
        ],
      };
    }
    if (!canonicalObservedUri(record['href'])) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic(
            'MALFORMED_REQUIRED_FIELD',
            's5.members.href',
            'each member href must be a canonical credential-free http(s) URI without query or fragment',
          ),
        ],
      };
    }
    if (typeof record['text'] !== 'string' || record['text'].length > 256) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.members.text', 'anchor text must be at most 256 chars'),
        ],
      };
    }
    if (seen.has(record['href'])) {
      return {
        ok: false,
        diagnostics: [
          brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.members', 'duplicate member href'),
        ],
      };
    }
    seen.add(record['href']);
    decoded.push({ href: record['href'], text: record['text'] });
  }
  return { ok: true, value: { tabId: tabId as number, pageUrl: pageUrl as string, members: decoded } };
}

/** Closed top-level key set per command kind (unknown fields reject). */
const S5_PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = {
  S5_GROUP_PREPARE: ['tabId', 'pageUrl', 'members'],
  S5_GROUP_CONFIRM: ['contractId', 'prepareId', 'snapshotId', 'selectedMemberIds', 'decisionToken'],
  S5_GROUP_EXECUTE: ['contractId', 'confirmedGroupId', 'snapshotId'],
  S5_GROUP_STATUS: ['contractId'],
};

function rejectUnknownFields(
  kind: string,
  payload: Record<string, unknown>,
): readonly BrokerDiagnostic[] | undefined {
  const allowed = S5_PAYLOAD_KEYS[kind];
  if (allowed === undefined) {
    return [
      brokerDiagnostic('UNKNOWN_FIELD', 's5', `unknown S5 command kind ${kind}; fail closed`, 'L2-inv11'),
    ];
  }
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return [
      brokerDiagnostic('UNKNOWN_FIELD', `s5.${unknown[0]}`, 'unknown field on the S5 payload; fail closed', 'L2-inv11'),
    ];
  }
  return undefined;
}

function requireBoundedId(
  payload: Record<string, unknown>,
  field: string,
): { ok: true; value: string } | { ok: false; diagnostics: readonly BrokerDiagnostic[] } {
  const value = payload[field];
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_.:-]+$/u.test(value)
  ) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic('MALFORMED_REQUIRED_FIELD', `s5.${field}`, `${field} must be a bounded identifier`),
      ],
    };
  }
  return { ok: true, value };
}

function requireMemberIds(
  payload: Record<string, unknown>,
): { ok: true; value: readonly string[] } | { ok: false; diagnostics: readonly BrokerDiagnostic[] } {
  const selected = payload['selectedMemberIds'];
  if (
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 20 ||
    selected.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]+$/u.test(id)) ||
    new Set(selected).size !== selected.length
  ) {
    return {
      ok: false,
      diagnostics: [
        brokerDiagnostic(
          'MALFORMED_REQUIRED_FIELD',
          's5.selectedMemberIds',
          'selectedMemberIds must be 1..20 unique bounded identifiers',
        ),
      ],
    };
  }
  return { ok: true, value: selected as string[] };
}

/**
 * Deterministic S5 journey identity from the observed page + member tuple:
 * the same observed page always maps to the same contract/snapshot ids, so
 * tab rescans and lane restarts converge on one aggregate (no duplicate
 * aggregates for one user intent).
 */
export function s5IdentityFor(input: {
  readonly pageUrl: string;
  readonly hrefs: readonly string[];
}): {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly collectionIdentity: string;
} {
  const identity = createHash('sha256')
    .update(`${input.pageUrl}\n${[...input.hrefs].sort().join('\n')}`)
    .digest('hex')
    .slice(0, 24);
  return {
    contractId: `contract-s5-${identity}`,
    snapshotId: `snapshot-s5-${identity}`,
    collectionIdentity: `collection/s5-${identity}`,
  };
}

function s5DraftContract(input: {
  readonly contractId: string;
  readonly collectionIdentity: string;
  readonly pageOrigin: string;
}): Record<string, unknown> {
  return {
    schemaIdentity: SCHEMA,
    contractId: input.contractId,
    status: 'DRAFT',
    intentType: 'COLLECTION',
    requestedTarget: `target-s5-${input.contractId.slice('contract-'.length)}`,
    collectionIdentity: input.collectionIdentity,
    membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' },
    requestedScope: { kind: 'current_page', collectionIdentity: input.collectionIdentity },
    continuationScope: { kind: 'NONE' },
    selectionPolicy: { basis: 'ENTIRE_REQUESTED_SCOPE', allowsBatchSelection: true },
    automationMode: 'ASSISTED',
    explorationPermission: 'NONE',
    budgetProfile: S5_BUDGET_PROFILE,
    authorizationContextRef: 'authctx/installed-s5-lane',
    validationPolicy: { requiredLayers: [...S5_LAYERS] },
    stopPolicy: { globalSafetyPrecedence: 'HIGHEST' },
    resultPolicy: { requireMultidimensionalResult: true },
  };
}

function projectionViewOf(response: SeamResponse | undefined): Record<string, unknown> | undefined {
  if (response === undefined || response.outcome !== 'PROJECTION') {
    return undefined;
  }
  const projection = response.projection;
  if (typeof projection !== 'object' || projection === null) {
    return undefined;
  }
  return projection as Record<string, unknown>;
}

function revisionOf(view: Record<string, unknown> | undefined): number | undefined {
  const revision = (view?.['contract'] as Record<string, unknown> | undefined)?.['revision'];
  return typeof revision === 'number' ? revision : undefined;
}

let laneSequence = 0;
function nextLaneSequence(): number {
  laneSequence += 1;
  return laneSequence;
}

/**
 * Map a non-ACCEPTED seam response onto a typed lane rejection carrying the
 * verbatim seam diagnostics (never normalized into broker codes).
 */
function mustAccept(
  requestId: string,
  stage: S5LaneRejectionStage,
  response: SeamResponse,
): BrokerResponse | undefined {
  if (response.outcome === 'ACCEPTED') {
    return undefined;
  }
  return laneFail(
    requestId,
    stage,
    (response.diagnostics ?? []).map((diagnostic) => ({
      code: diagnostic.code,
      path: diagnostic.path,
      message: diagnostic.message,
      ...(diagnostic.invariant !== undefined ? { invariant: diagnostic.invariant } : {}),
    })),
  );
}

/**
 * Create the installed S5 lane handler for the native host. The lane holds
 * ONE Core surface over the OS-verified pipe for its lifetime (the
 * connection-bound CONFIRM challenge discipline); Core lifetime is never
 * affected by the lane.
 */
export function createInstalledS5Lane(config: InstalledS5LaneConfig): S5LaneHandler {
  let surface: Promise<BoundSurface> | undefined;
  const openSurface = (): Promise<BoundSurface> => {
    // A failed connect never caches: the next command retries the pipe
    // (fail closed, but a transient pipe outage does not poison the host
    // process for its whole lifetime).
    surface ??= Promise.resolve(
      bindSurfaceToCore({
        surface: 'BROWSER_EXTENSION',
        installId: config.core.installId,
        userId: config.core.userId,
        transport: createWindowsPipeClientTransport(),
        target: { host: '127.0.0.1', port: 0, pipeName: config.core.pipeName },
        makeRequestId: () => `s5-${String(nextLaneSequence())}-${Date.now().toString(36)}`,
      }),
    ).catch((error: unknown) => {
      surface = undefined;
      throw error;
    });
    return surface;
  };
  const submit = async (command: {
    readonly commandType: string;
    readonly aggregateId: string;
    readonly requestId: string;
    readonly expectedRevision: number | undefined;
    readonly correlation: Record<string, unknown>;
    readonly payload: Record<string, unknown>;
  }): Promise<SeamResponse> => {
    const bound = await openSurface();
    return bound.submitCanonicalCommand({
      commandType: command.commandType as never,
      aggregateId: command.aggregateId,
      requestId: command.requestId,
      expectedRevision: command.expectedRevision,
      correlation: command.correlation,
      payload: command.payload,
    });
  };
  const readProjection = async (aggregateId: string): Promise<SeamResponse | undefined> => {
    const bound = await openSurface();
    return bound.readProjection(aggregateId).catch(() => undefined);
  };

  return {
    async handle(command: S5LaneCommandShape): Promise<BrokerResponse> {
      try {
        if (command.kind === 'S5_GROUP_PREPARE') {
          return await handlePrepare(command, { submit, readProjection });
        }
        if (command.kind === 'S5_GROUP_CONFIRM') {
          return await handleConfirm(command, { submit, readProjection });
        }
        if (command.kind === 'S5_GROUP_EXECUTE') {
          return await handleExecute(
            command,
            { submit, readProjection },
            { waitMs: config.projectionWaitMs ?? DEFAULT_PROJECTION_WAIT_MS },
          );
        }
        return await handleStatus(command, { submit, readProjection });
      } catch (error) {
        return laneFail(command.requestId, 'CORE_TRANSPORT', [
          brokerDiagnostic(
            'CORE_UNREACHABLE',
            'core',
            `the single Core authority is unreachable; the S5 journey fails closed: ${
              error instanceof Error ? error.message : 'seam transport failed'
            }`,
          ),
        ]);
      }
    },
  };
}

interface LanePorts {
  readonly submit: (command: {
    readonly commandType: string;
    readonly aggregateId: string;
    readonly requestId: string;
    readonly expectedRevision: number | undefined;
    readonly correlation: Record<string, unknown>;
    readonly payload: Record<string, unknown>;
  }) => Promise<SeamResponse>;
  readonly readProjection: (aggregateId: string) => Promise<SeamResponse | undefined>;
}

async function handlePrepare(
  command: S5LaneCommandShape & { readonly kind: 'S5_GROUP_PREPARE' },
  ports: LanePorts,
): Promise<BrokerResponse> {
  const decoded = decodePreparePayload(command.payload);
  if (!decoded.ok) {
    return laneFail(command.requestId, 'LANE_DECODE', decoded.diagnostics);
  }
  const prepare = decoded.value;
  let pageOrigin: string;
  try {
    pageOrigin = new URL(prepare.pageUrl).origin;
  } catch {
    return laneFail(command.requestId, 'LANE_DECODE', [
      brokerDiagnostic('MALFORMED_REQUIRED_FIELD', 's5.pageUrl', 'the page URL has no parseable origin'),
    ]);
  }
  const identity = s5IdentityFor({
    pageUrl: prepare.pageUrl,
    hrefs: prepare.members.map((member) => member.href),
  });
  // Existing aggregate? An idempotent re-prepare converges; a different tuple
  // under the same identity is impossible (the identity derives from the
  // tuple), so a duplicate submit can only converge or be rejected by Core.
  let revision: number | undefined;
  const existingView = projectionViewOf(await ports.readProjection(identity.contractId));
  if (existingView !== undefined) {
    revision = revisionOf(existingView);
  }
  const submitted = await ports.submit({
    commandType: 'SUBMIT_CONTRACT',
    aggregateId: identity.contractId,
    requestId: `s5-submit-${command.requestId}`.slice(0, 128),
    expectedRevision: revision,
    correlation: { contractId: identity.contractId },
    payload: s5DraftContract({
      contractId: identity.contractId,
      collectionIdentity: identity.collectionIdentity,
      pageOrigin,
    }),
  });
  if (submitted.outcome !== 'ACCEPTED') {
    // A converged duplicate submit can also surface as a typed rejection
    // (idempotent prior acceptance); re-read the projection before failing.
    const view = projectionViewOf(await ports.readProjection(identity.contractId));
    if (view === undefined) {
      return laneFail(command.requestId, 'CORE_SUBMIT', [
        brokerDiagnostic(
          'CORE_UNREACHABLE',
          'contract',
          'Core refused the S5 draft contract and no projection exists for it',
        ),
      ]);
    }
    revision = revisionOf(view);
  } else {
    revision = submitted.currentRevision ?? revisionOf(projectionViewOf(await ports.readProjection(identity.contractId)));
  }
  const frozen = await ports.submit({
    commandType: 'PREPARE_S5_PAGE_GROUP',
    aggregateId: identity.contractId,
    requestId: `s5-prepare-${command.requestId}`.slice(0, 128),
    expectedRevision: revision,
    correlation: { snapshotId: identity.snapshotId },
    payload: {
      snapshotId: identity.snapshotId,
      pageOrigin,
      provenanceKey: `tab-${String(prepare.tabId)}/frame-0/${prepare.pageUrl}/-/-`,
      members: prepare.members.map((member) => ({ href: member.href, text: member.text })),
    },
  });
  const prepareRejected = mustAccept(command.requestId, 'CORE_SUBMIT', frozen);
  if (prepareRejected !== undefined) {
    return prepareRejected;
  }
  const view = projectionViewOf(await ports.readProjection(identity.contractId));
  const facts = view?.['s5PreparedGroup'] as Record<string, unknown> | undefined;
  if (facts === undefined) {
    return laneFail(command.requestId, 'CORE_PROJECTION', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'projection.s5PreparedGroup',
        'Core froze the page group but the projection carries no frozen facts',
      ),
    ]);
  }
  return {
    kind: 'S5_RESULT',
    requestId: command.requestId,
    phase: 'PREPARED',
    contractId: identity.contractId,
    facts: {
      prepareId: facts['prepareId'],
      snapshotId: identity.snapshotId,
      pageOrigin,
      members: facts['members'],
      observedTupleDigest: facts['observedTupleDigest'],
    },
  } as BrokerResponse;
}

async function handleConfirm(
  command: S5LaneCommandShape & { readonly kind: 'S5_GROUP_CONFIRM' },
  ports: LanePorts,
): Promise<BrokerResponse> {
  const payload = command.payload;
  const unknownConfirm = rejectUnknownFields('S5_GROUP_CONFIRM', payload);
  if (unknownConfirm !== undefined) {
    return laneFail(command.requestId, 'LANE_DECODE', unknownConfirm);
  }
  const contractId = requireBoundedId(payload, 'contractId');
  if (!contractId.ok) return laneFail(command.requestId, 'LANE_DECODE', contractId.diagnostics);
  const prepareId = requireBoundedId(payload, 'prepareId');
  if (!prepareId.ok) return laneFail(command.requestId, 'LANE_DECODE', prepareId.diagnostics);
  const snapshotId = requireBoundedId(payload, 'snapshotId');
  if (!snapshotId.ok) return laneFail(command.requestId, 'LANE_DECODE', snapshotId.diagnostics);
  const selected = requireMemberIds(payload);
  if (!selected.ok) return laneFail(command.requestId, 'LANE_DECODE', selected.diagnostics);
  const decisionToken = payload['decisionToken'];
  if (typeof decisionToken !== 'string' || decisionToken !== `user-confirm:${contractId.value}`) {
    return laneFail(command.requestId, 'LANE_DECODE', [
      brokerDiagnostic(
        'ISSUE_DECISION_REQUIRED',
        's5.decisionToken',
        'an explicit user confirmation decision token bound to THIS contract (user-confirm:<contractId>) is mandatory; there is no automatic confirm path',
      ),
    ]);
  }
  const digest = s5SelectionTupleDigest({
    contractId: contractId.value,
    snapshotId: snapshotId.value,
    prepareId: prepareId.value,
    selectedMemberIds: selected.value,
  });
  const view = projectionViewOf(await ports.readProjection(contractId.value));
  const revision = revisionOf(view);
  const preparedFacts = view?.['s5PreparedGroup'] as Record<string, unknown> | undefined;
  if (preparedFacts === undefined || preparedFacts['prepareId'] !== prepareId.value) {
    return laneFail(command.requestId, 'CORE_PROJECTION', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'projection.s5PreparedGroup',
        'no frozen Core page group matches this prepare; confirmation fails closed',
      ),
    ]);
  }
  // BEGIN: mint the single-use connection-bound Core challenge.
  const begin = await ports.submit({
    commandType: 'CONFIRM_S5_PAGE_GROUP',
    aggregateId: contractId.value,
    requestId: `s5-begin-${command.requestId}`.slice(0, 128),
    expectedRevision: revision,
    correlation: { snapshotId: snapshotId.value },
    payload: {
      phase: 'BEGIN',
      snapshotId: snapshotId.value,
      prepareId: prepareId.value,
      selectedMemberIds: [...selected.value],
      displayedTupleDigest: digest,
    },
  });
  if (begin.outcome !== 'ACCEPTED') {
    const rejectedResponse = mustAccept(command.requestId, 'CORE_SUBMIT', begin);
    if (rejectedResponse !== undefined) {
      return rejectedResponse;
    }
    return laneFail(command.requestId, 'CORE_SUBMIT', [
      brokerDiagnostic('S5_LANE_REJECTED', 'confirm.begin', 'the S5 confirm BEGIN was not accepted'),
    ]);
  }
  const challenge = begin.s5PrivateChallenge;
  if (challenge === undefined) {
    return laneFail(command.requestId, 'CORE_SUBMIT', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'confirm.begin.challenge',
        'the S5 confirm BEGIN response carried no private challenge (idempotent replay never re-emits the token); start a fresh confirm',
      ),
    ]);
  }
  // COMMIT: consume the challenge atomically with the durable Core confirm.
  const commit = await ports.submit({
    commandType: 'CONFIRM_S5_PAGE_GROUP',
    aggregateId: contractId.value,
    requestId: `s5-commit-${command.requestId}`.slice(0, 128),
    expectedRevision: revision,
    correlation: { snapshotId: snapshotId.value },
    payload: {
      phase: 'COMMIT',
      snapshotId: snapshotId.value,
      prepareId: prepareId.value,
      selectedMemberIds: [...selected.value],
      displayedTupleDigest: digest,
      confirmationChallenge: challenge.value,
    },
  });
  const commitRejected = mustAccept(command.requestId, 'CORE_SUBMIT', commit);
  if (commitRejected !== undefined) {
    return commitRejected;
  }
  const confirmedView = projectionViewOf(await ports.readProjection(contractId.value));
  const confirmed = confirmedView?.['s5ConfirmedGroup'] as Record<string, unknown> | undefined;
  if (confirmed === undefined) {
    return laneFail(command.requestId, 'CORE_PROJECTION', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'projection.s5ConfirmedGroup',
        'Core committed the confirmation but the projection carries no confirmed facts',
      ),
    ]);
  }
  return {
    kind: 'S5_RESULT',
    requestId: command.requestId,
    phase: 'CONFIRMED',
    contractId: contractId.value,
    facts: { ...confirmed },
  } as BrokerResponse;
}

async function handleExecute(
  command: S5LaneCommandShape & { readonly kind: 'S5_GROUP_EXECUTE' },
  ports: LanePorts,
  options: { readonly waitMs: number },
): Promise<BrokerResponse> {
  const payload = command.payload;
  const unknownExecute = rejectUnknownFields('S5_GROUP_EXECUTE', payload);
  if (unknownExecute !== undefined) {
    return laneFail(command.requestId, 'LANE_DECODE', unknownExecute);
  }
  const contractId = requireBoundedId(payload, 'contractId');
  if (!contractId.ok) return laneFail(command.requestId, 'LANE_DECODE', contractId.diagnostics);
  const confirmedGroupId = requireBoundedId(payload, 'confirmedGroupId');
  if (!confirmedGroupId.ok) {
    return laneFail(command.requestId, 'LANE_DECODE', confirmedGroupId.diagnostics);
  }
  const snapshotId = requireBoundedId(payload, 'snapshotId');
  if (!snapshotId.ok) return laneFail(command.requestId, 'LANE_DECODE', snapshotId.diagnostics);
  const view = projectionViewOf(await ports.readProjection(contractId.value));
  const revision = revisionOf(view);
  const confirmed = view?.['s5ConfirmedGroup'] as Record<string, unknown> | undefined;
  if (confirmed === undefined || confirmed['confirmedGroupId'] !== confirmedGroupId.value) {
    return laneFail(command.requestId, 'CORE_PROJECTION', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'projection.s5ConfirmedGroup',
        'no confirmed Core page group matches this execution; execute fails closed',
      ),
    ]);
  }
  // An idempotent re-execute of an already-registered intent is rejected by
  // Core (single durable intent per lineage) — treat a projection that
  // already carries an execution state as convergence, not an error.
  const executed = await ports.submit({
    commandType: 'EXECUTE_S5_COLLECTION',
    aggregateId: contractId.value,
    requestId: `s5-exec-${command.requestId}`.slice(0, 128),
    expectedRevision: revision,
    correlation: { snapshotId: snapshotId.value },
    payload: {
      snapshotId: snapshotId.value,
      confirmedGroupId: confirmedGroupId.value,
    },
  });
  if (executed.outcome !== 'ACCEPTED') {
    const alreadyRunning =
      projectionViewOf(await ports.readProjection(contractId.value))?.['lineage'] !== undefined;
    if (!alreadyRunning) {
      const rejectedResponse = mustAccept(command.requestId, 'CORE_SUBMIT', executed);
      if (rejectedResponse !== undefined) {
        return rejectedResponse;
      }
    }
  }
  // Bounded poll of the authoritative per-member + aggregate terminal.
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const current = projectionViewOf(await ports.readProjection(contractId.value));
    const lineage = current?.['lineage'] as Record<string, unknown> | undefined;
    const terminal = current?.['terminal'];
    if (current !== undefined && terminal !== undefined) {
      return {
        kind: 'S5_RESULT',
        requestId: command.requestId,
        phase: 'TERMINAL',
        contractId: contractId.value,
        facts: {
          terminal,
          members: current['s5Members'] ?? [],
          lineageStatus: lineage?.['status'],
        },
      } as BrokerResponse;
    }
    if (
      current !== undefined &&
      (lineage?.['status'] === 'CANCELLED' || lineage?.['status'] === 'TERMINAL')
    ) {
      return {
        kind: 'S5_RESULT',
        requestId: command.requestId,
        phase: 'TERMINAL',
        contractId: contractId.value,
        facts: {
          terminal: null,
          members: current['s5Members'] ?? [],
          lineageStatus: lineage?.['status'],
          detail: 'the lineage closed without a projected terminal (cancelled or driver-refused); no terminal is invented',
        },
      } as BrokerResponse;
    }
    if (Date.now() >= deadline) {
      return {
        kind: 'S5_RESULT',
        requestId: command.requestId,
        phase: 'RUNNING',
        contractId: contractId.value,
        facts: {
          members: current?.['s5Members'] ?? [],
          lineageStatus: lineage?.['status'],
          detail: 'the bounded projection wait elapsed before a terminal; the durable execution continues in Core — poll status',
        },
      } as BrokerResponse;
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECTION_POLL_MS));
  }
}

async function handleStatus(
  command: S5LaneCommandShape & { readonly kind: 'S5_GROUP_STATUS' },
  ports: LanePorts,
): Promise<BrokerResponse> {
  const unknownStatus = rejectUnknownFields('S5_GROUP_STATUS', command.payload);
  if (unknownStatus !== undefined) {
    return laneFail(command.requestId, 'LANE_DECODE', unknownStatus);
  }
  const contractId = requireBoundedId(command.payload, 'contractId');
  if (!contractId.ok) return laneFail(command.requestId, 'LANE_DECODE', contractId.diagnostics);
  const current = projectionViewOf(await ports.readProjection(contractId.value));
  if (current === undefined) {
    return laneFail(command.requestId, 'CORE_PROJECTION', [
      brokerDiagnostic(
        'S5_LANE_REJECTED',
        'projection',
        'no Core projection exists for this contract id',
      ),
    ]);
  }
  const terminal = current['terminal'];
  const lineage = current['lineage'] as Record<string, unknown> | undefined;
  return {
    kind: 'S5_RESULT',
    requestId: command.requestId,
    phase: 'STATUS',
    contractId: contractId.value,
    facts: {
      terminal: terminal ?? null,
      members: current['s5Members'] ?? [],
      lineageStatus: lineage?.['status'] ?? null,
    },
  } as BrokerResponse;
}

/** Response-kind discriminants of the installed S5 lane (for type narrowing). */
export function isS5LaneResponse(value: BrokerResponse): value is S5LaneResponse {
  return value.kind === 'S5_RESULT' || value.kind === 'S5_REJECTED';
}
