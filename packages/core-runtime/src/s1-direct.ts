/**
 * #101 first slice — S1 Core-executed direct acquisition driver behind the
 * one narrowly typed `EXECUTE_S1_DIRECT_ACQUISITION` seam command.
 *
 * The seam's synchronous authority apply only registers one durable
 * execution intent (journaled with the command, replayed on restart); this
 * driver performs the REAL HTTP transfer strictly after the accepted-command
 * journal commit, through the canonical T008 direct port and the canonical
 * T015 flow (register → dispatch → attempt → budgeted transfer → staged →
 * materialized → finalized → accepted → scheduler acceptance), then derives
 * the terminal result exclusively through the T007 projector over durable
 * facts and hands it to the seam via `recordExecutedTerminal`.
 *
 * Truthfulness rules (mirroring the #95 S2 lane):
 * - an accepted submitted contract is never acquisition success: a truthful
 *   execution failure (digest/transfer/format/target/budget) records the
 *   failed member + a durable terminal failure and derives a FAILED terminal;
 * - restart replay never re-downloads an accepted artifact: the driver
 *   reconciles from the durable work item and re-derives the identical
 *   terminal (the durable work-item creation timestamp makes the projection
 *   deterministic across replays, #98 discipline);
 * - a driver failure never invents terminal truth: the intent stays
 *   registered so the next composition reconcile can re-drive it.
 */

import { lineageKeyOf } from '@xdownload/core-scheduler';
import {
  bindLocator,
  makeContractId,
  makeEffectId,
  makeLogicalTargetId,
  makeMemberId,
  makeSnapshotId,
  unwrapOrThrow,
  type AcquisitionContract,
} from '@xdownload/domain-contracts';
import { seamDiagnostic, seamFail, seamOk, type SeamResult } from '@xdownload/core-seam';
import type { CoreSeamServer } from '@xdownload/core-seam';
import type { DirectTransferOutcome } from '@xdownload/direct-acquisition';
import {
  CoreRuntimeFlowError,
  executeDirectAcquisition,
  projectLineageResult,
  type FlowRuntime,
} from './flow.ts';

/** Strictly validated delivery facts carried by the S1 execution command. */
export interface S1DirectDelivery {
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  readonly expectedSha256: string;
  readonly expectedContentTypePrefix?: string;
  readonly expectedTotalBytes?: number;
}

export interface S1DirectExecutionPayload {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly delivery: S1DirectDelivery;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Decode the S1 execution payload (defense in depth — the seam already
 * validated it at the authority boundary before registering the intent).
 */
export function decodeS1DirectPayload(payload: unknown): SeamResult<S1DirectExecutionPayload> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload', 'S1 payload must be an object'),
    ]);
  }
  const record = payload as Record<string, unknown>;
  const snapshot = makeSnapshotId(
    typeof record['snapshotId'] === 'string' ? record['snapshotId'] : '',
  );
  if (!snapshot.ok) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.snapshotId',
        'not a canonical snapshot identity',
      ),
    ]);
  }
  const member = makeMemberId(typeof record['memberId'] === 'string' ? record['memberId'] : '');
  if (!member.ok) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.memberId', 'not a canonical member identity'),
    ]);
  }
  const delivery = record['delivery'];
  if (typeof delivery !== 'object' || delivery === null || Array.isArray(delivery)) {
    return seamFail([
      seamDiagnostic('ENVELOPE_MALFORMED', 'payload.delivery', 'delivery must be an object'),
    ]);
  }
  const deliveryRecord = delivery as Record<string, unknown>;
  const locatorUri = deliveryRecord['locatorUri'];
  if (typeof locatorUri !== 'string' || locatorUri.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.locatorUri',
        'must be a non-empty string',
      ),
    ]);
  }
  const digest = deliveryRecord['expectedSha256'];
  if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedSha256',
        'must be a lowercase hex SHA-256 digest',
      ),
    ]);
  }
  const hosts = deliveryRecord['declaredRedirectHosts'];
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.declaredRedirectHosts',
        'must be a non-empty array',
      ),
    ]);
  }
  for (const host of hosts) {
    if (typeof host !== 'string' || host.length === 0) {
      return seamFail([
        seamDiagnostic(
          'ENVELOPE_MALFORMED',
          'payload.delivery.declaredRedirectHosts',
          'entries must be non-empty strings',
        ),
      ]);
    }
  }
  const prefix = deliveryRecord['expectedContentTypePrefix'];
  if (prefix !== undefined && (typeof prefix !== 'string' || prefix.length === 0)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedContentTypePrefix',
        'must be a non-empty string',
      ),
    ]);
  }
  const total = deliveryRecord['expectedTotalBytes'];
  if (total !== undefined && (typeof total !== 'number' || !Number.isInteger(total) || total < 0)) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedTotalBytes',
        'must be a non-negative integer',
      ),
    ]);
  }
  return seamOk({
    snapshotId: snapshot.value,
    memberId: member.value,
    artifactId: typeof record['artifactId'] === 'string' ? record['artifactId'] : '',
    delivery: {
      locatorUri,
      declaredRedirectHosts: hosts as readonly string[],
      expectedSha256: digest,
      ...(prefix === undefined ? {} : { expectedContentTypePrefix: prefix }),
      ...(total === undefined ? {} : { expectedTotalBytes: total }),
    },
  });
}

/** The runtime pieces the S1 driver composes (flow + projection + seam completion ports). */
export type S1DriveRuntime = FlowRuntime & {
  readonly seam: CoreSeamServer;
};

/** Map a truthful adapter failure reason onto projector stop facts. */
function stopFactsOf(outcome: DirectTransferOutcome | undefined): Record<string, boolean> {
  if (outcome === undefined) {
    return {};
  }
  switch (outcome.reason) {
    case 'AUTH_REQUIRED':
      return { authRequired: true };
    case 'TRUNCATED':
    case 'NO_PROGRESS':
      return { noProgress: true };
    case 'TRANSFER_BUDGET_EXHAUSTED':
      return { transferBudgetExhausted: true };
    case 'GLOBAL_SAFETY_EXHAUSTED':
      return { globalSafetyLimit: true };
    case 'COMPLETED':
      return outcome.allApplicableValidationPassed ? {} : { validationFailed: true };
    default:
      return { validationFailed: true };
  }
}

function s1LineageKey(input: {
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

/**
 * Drive one registered S1 direct execution to a Core-derived terminal.
 *
 * Reconcile-first: when the durable ledger already holds the work item
 * (execution ran before a restart, or the intent is being re-driven), no
 * external effect re-executes — the terminal is re-derived from durable
 * truth only. Fresh executions run the canonical direct flow once.
 */
export async function driveS1DirectExecution(
  runtime: S1DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly contract: AcquisitionContract;
    readonly payload: unknown;
  },
): Promise<SeamResult<void>> {
  const decoded = decodeS1DirectPayload(input.payload);
  if (!decoded.ok) {
    return seamFail(decoded.diagnostics);
  }
  const payload = decoded.value;
  if (input.contract.intentType !== 'SINGLE_RESOURCE') {
    return seamFail([
      seamDiagnostic(
        'ADMISSION_REJECTED',
        'contract.intentType',
        'the S1 direct driver serves SINGLE_RESOURCE contracts only',
        'PRD-§28 S1',
      ),
    ]);
  }
  const effectId = `effect:${input.contract.contractId}:${payload.snapshotId}:${input.contract.requestedTarget}`;
  const lineageKey = s1LineageKey({
    contractId: input.contract.contractId,
    snapshotId: payload.snapshotId,
    targetId: input.contract.requestedTarget,
    effectId,
  });

  // Replay/restart reconcile: the durable ledger already carries this
  // effect — re-derive the identical terminal from durable truth (the
  // work-item creation timestamp keeps the projection deterministic, #98)
  // and never re-execute the external transfer.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey,
      contract: input.contract,
      payload,
      workItemId: existing.workItemId,
      recordedAt: existing.createdAt,
      memberValidated:
        runtime.recovery.classify(existing.workItemId).lifecycleClass === 'ACCEPTED' &&
        runtime.recovery.classify(existing.workItemId).bytesVerified,
      stopFacts: {},
    });
  }

  // Fresh execution through the canonical direct flow (register → dispatch →
  // attempt → budgeted adapter transfer → staged → accepted).
  const bound = bindLocator(
    { kind: 'direct', uri: payload.delivery.locatorUri },
    input.contract.requestedTarget,
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: payload.delivery.locatorUri,
    },
  );
  if (!bound.ok) {
    return seamFail(
      bound.diagnostics.map((d) => seamDiagnostic(d.code, d.path, d.message, d.invariant)),
    );
  }
  let flow;
  try {
    flow = await executeDirectAcquisition(runtime, {
      contractId: input.contract.contractId,
      snapshotId: payload.snapshotId,
      targetId: input.contract.requestedTarget,
      authorizationContextRef: input.contract.authorizationContextRef,
      budgetProfile: input.contract.budgetProfile,
      frozenMemberIds: [payload.memberId],
      commandId: `s1-direct:${input.contract.contractId}:${payload.snapshotId}:${payload.memberId}`,
      memberId: payload.memberId,
      artifactId: payload.artifactId,
      transfer: {
        effectId: unwrapOrThrow(makeEffectId(effectId)),
        contractId: input.contract.contractId,
        slice: 'S1',
        selectedMemberId: unwrapOrThrow(makeMemberId(payload.memberId)),
        binding: bound.value,
        expectedSha256: payload.delivery.expectedSha256,
        ...(payload.delivery.expectedContentTypePrefix === undefined
          ? {}
          : { expectedContentTypePrefix: payload.delivery.expectedContentTypePrefix }),
        ...(payload.delivery.expectedTotalBytes === undefined
          ? {}
          : { expectedTotalBytes: payload.delivery.expectedTotalBytes }),
        allowedRedirectHosts: payload.delivery.declaredRedirectHosts,
        attempt: 0,
      },
    });
  } catch (error) {
    if (error instanceof CoreRuntimeFlowError) {
      // Typed composition rejection (admission/cutoff/...): no terminal can
      // be derived truthfully; the intent stays registered for reconcile.
      return seamFail([seamDiagnostic('ADMISSION_REJECTED', 'flow', error.message, 'L2-§6.3')]);
    }
    throw error;
  }

  // Truthful failure accounting: an unvalidated member records its durable
  // terminal failure and enters the failed-member retry domain (C12).
  const classification = runtime.recovery.classify(flow.workItemId);
  const memberValidated =
    classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
  if (!memberValidated) {
    runtime.writer.recordTerminalFailure(
      flow.workItemId,
      flow.transfer?.reason ?? flow.acceptanceError?.code ?? 'NETWORK_FAILURE',
    );
    runtime.seam.recordFailedMembers(input.aggregateId, [payload.memberId]);
  }
  const workItem = runtime.writer.reader
    .workItems()
    .find((item) => item.workItemId === flow.workItemId);
  return projectAndRecord(runtime, {
    aggregateId: input.aggregateId,
    lineageKey: flow.lineageKey,
    contract: input.contract,
    payload,
    workItemId: flow.workItemId,
    recordedAt: workItem?.createdAt ?? new Date().toISOString(),
    memberValidated,
    stopFacts: stopFactsOf(flow.transfer),
  });
}

/** Derive the terminal through the T007 projector and hand it to the seam. */
function projectAndRecord(
  runtime: S1DriveRuntime,
  input: {
    readonly aggregateId: string;
    readonly lineageKey: string;
    readonly contract: AcquisitionContract;
    readonly payload: S1DirectExecutionPayload;
    readonly workItemId: string;
    readonly recordedAt: string;
    readonly memberValidated: boolean;
    readonly stopFacts: Record<string, boolean>;
  },
): SeamResult<void> {
  const projected = projectLineageResult(runtime, {
    lineageKey: input.lineageKey,
    contractId: input.contract.contractId,
    snapshotId: input.payload.snapshotId,
    intentType: 'SINGLE_RESOURCE',
    scopeKind: 'single_resource',
    requestedMemberIds: [input.payload.memberId],
    recordedAt: input.recordedAt,
    enumeration: { kind: 'NOT_APPLICABLE' },
    ...(Object.keys(input.stopFacts).length === 0 ? {} : { stopFacts: input.stopFacts }),
  });
  if (!projected.ok) {
    return seamFail(
      projected.diagnostics.map((d) => seamDiagnostic(d.code, d.path, d.message, d.invariant)),
    );
  }
  return runtime.seam.recordExecutedTerminal(input.aggregateId, projected.value.result);
}
