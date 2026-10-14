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

import { effectiveCancellation, lineageKeyOf } from '@xdownload/core-scheduler';
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
import type { CoreSeamServer, TargetWitnessReceipt } from '@xdownload/core-seam';
import {
  targetBasisOf,
  targetCertaintyOf,
  type DirectTransferOutcome,
} from '@xdownload/direct-acquisition';
import {
  CoreRuntimeFlowError,
  cancelLineage,
  executeDirectAcquisition,
  attemptIdFor,
  projectLineageResult,
  registerLineage,
  type FlowRuntime,
  type LineageSeed,
} from './flow.ts';
import type { S1TransferAbortHub } from './s1-transfer-abort.ts';

/** Strictly validated delivery facts carried by the S1 execution command. */
export interface S1DirectDelivery {
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  /**
   * Optional independently published digest (#101 R1/F01): enforced as the
   * target identity anchor when supplied; when absent the Target claim uses
   * the REQUESTED_LOCATOR_PROVENANCE basis (C34 — no self-hash oracle).
   */
  readonly expectedSha256?: string;
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
  if (digest !== undefined && (typeof digest !== 'string' || !SHA256_PATTERN.test(digest))) {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'payload.delivery.expectedSha256',
        'expected an omitted field or a lowercase hex SHA-256 digest',
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
  /**
   * The in-flight transfer abort checkpoint (#101 P2-1): when present, the
   * driver registers every fresh transfer so a durably committed user cancel
   * tears the socket down at once. Absent on legacy compositions — the
   * durable cancel cutoff still holds through the post-transfer checkpoints.
   */
  readonly s1TransferAbort?: S1TransferAbortHub;
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
    case 'USER_CANCELLED':
      // The cancellation facts (not validation facts) carry the stop story;
      // the projector derives the truthful USER_CANCELLED terminal from them.
      return {};
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
 * The canonical effect/lineage identity of one S1 direct execution (#101
 * P2-1): derived identically by the driver and the cancel bridge so the
 * durably committed user cancel order always lands on the same frozen
 * lineage. Malformed identities fail closed (never guessed).
 */
export function s1EffectIdentity(input: {
  readonly contractId: string;
  readonly snapshotId: string;
  readonly targetId: string;
}): SeamResult<{ readonly effectId: string; readonly lineageKey: string }> {
  try {
    const effectId = `effect:${input.contractId}:${input.snapshotId}:${input.targetId}`;
    return seamOk({
      effectId,
      lineageKey: s1LineageKey({
        contractId: input.contractId,
        snapshotId: input.snapshotId,
        targetId: input.targetId,
        effectId,
      }),
    });
  } catch {
    return seamFail([
      seamDiagnostic(
        'ENVELOPE_MALFORMED',
        'identity',
        'the S1 execution identity does not form canonical ids',
      ),
    ]);
  }
}

/**
 * Drive one registered S1 direct execution to a Core-derived terminal.
 *
 * Reconcile-first: when the durable ledger already holds the work item
 * (execution ran before a restart, or the intent is being re-driven), no
 * external effect re-executes — the terminal is re-derived from durable
 * truth only. Fresh executions run the canonical direct flow once.
 *
 * Cancellation cutoff (#101 P2-1): a durably committed user cancel order is
 * honored at every checkpoint — before any dispatch (the lineage registers
 * with its cancellation and closes without any transfer), through the
 * adapter's abort signal (the in-flight socket is torn down at once), and
 * after the flow returns (no acceptance/terminal-failure accounting crosses
 * the cutoff). The closure terminal is always the projector's output over
 * durable facts — ADR-013 decides COMPLETE (acceptance already stood) vs
 * USER_CANCELLED — never a fabricated COMPLETED escape.
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
  const identity = s1EffectIdentity({
    contractId: input.contract.contractId,
    snapshotId: payload.snapshotId,
    targetId: input.contract.requestedTarget,
  });
  if (!identity.ok) {
    return identity;
  }
  const { effectId, lineageKey } = identity.value;

  // Replay/restart reconcile: the durable ledger already carries this
  // effect — re-derive the identical terminal from durable truth (the
  // work-item creation timestamp keeps the projection deterministic, #98)
  // and never re-execute the external transfer. The target witness is
  // re-derived from the same durable truth and journaled BEFORE the
  // terminal handover (#113): a kill between the transfer and the witness
  // record still produces the durable witness here, and an identical
  // replay converges.
  const existing = runtime.writer.reader
    .workItems()
    .find((workItem) => workItem.effectId === effectId);
  if (existing !== undefined) {
    const witness = witnessFromDurableTruth(
      runtime,
      witnessInputsOf(input.contract, payload, effectId),
      existing.workItemId,
    );
    if (!witness.ok) {
      return witness;
    }
    const recorded = recordWitnessBeforeTerminal(runtime, input.aggregateId, witness.value);
    if (!recorded.ok) {
      return recorded;
    }
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

  // Cancellation checkpoint before dispatch (L2 §11.1 "cancel before
  // dispatch"): the user cancel order is durably committed at the seam but
  // no durable execution exists yet — register the lineage, record the
  // cancel in BOTH canonical stores, and close truthfully. No transfer, no
  // socket, no fabricated terminal.
  if (seamLineageStatus(runtime, input.aggregateId) === 'CANCELLED') {
    const registered = registerLineage(runtime, seedOf(input.contract, payload), {
      commandId: `s1-direct:${input.contract.contractId}:${payload.snapshotId}:${payload.memberId}`,
      memberId: payload.memberId,
    });
    cancelLineage(runtime, lineageKey, 'CORE_POLICY', registered.workItemId);
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey,
      contract: input.contract,
      payload,
      workItemId: registered.workItemId,
      recordedAt: new Date().toISOString(),
      memberValidated: false,
      stopFacts: {},
    });
  }

  // Fresh execution through the canonical direct flow (register → dispatch →
  // attempt → budgeted adapter transfer → staged → accepted). The transfer
  // runs under the abort checkpoint so a committed user cancel tears the
  // socket down at once (no lingering connection).
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
  const signal = runtime.s1TransferAbort?.register(input.aggregateId);
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
        ...(signal === undefined ? {} : { signal }),
      },
    });
  } catch (error) {
    if (error instanceof CoreRuntimeFlowError) {
      // Typed composition rejection (admission/cutoff/...): no terminal can
      // be derived truthfully; the intent stays registered for reconcile.
      return seamFail([seamDiagnostic('ADMISSION_REJECTED', 'flow', error.message, 'L2-§6.3')]);
    }
    throw error;
  } finally {
    if (signal !== undefined) {
      runtime.s1TransferAbort?.release(input.aggregateId);
    }
  }

  // #113: journal the Core-private target-resolution witness from the actual
  // transfer truth BEFORE any terminal authority handover — including on a
  // failed declared digest (no accepted bytes) and on the cancel-closure
  // path below. Auth walls, unsupported responses, no-progress stops and
  // cancellations record no witness, so the frozen auth/unsupported/cancel
  // tuples stay untouched; provenance-unproven (undeclared redirect/locator
  // substitution) records the distinct (b)-tuple witness instead. A
  // replayed durable attempt (no fresh outcome) derives the witness from
  // durable truth — the same decision table as the reconcile path.
  const witnessInputs = witnessInputsOf(input.contract, payload, effectId);
  const witnessResult =
    flow.transfer === undefined
      ? witnessFromDurableTruth(runtime, witnessInputs, flow.workItemId)
      : seamOk(
          witnessFromTransfer(
            witnessInputs,
            flow.transfer,
            flow.acceptance !== undefined && flow.acceptanceError === undefined,
          ),
        );
  if (!witnessResult.ok) {
    return witnessResult;
  }
  const recordedWitness = recordWitnessBeforeTerminal(
    runtime,
    input.aggregateId,
    witnessResult.value,
  );
  if (!recordedWitness.ok) {
    return recordedWitness;
  }

  // Cancellation checkpoint after the transfer: when the durable user cancel
  // is authoritative, the stop is the user's — no validation-failure or
  // terminal-failure accounting may cross the cutoff, and the closure derives
  // the truthful projector output (COMPLETE only if acceptance already stood
  // before the cancel, per ADR-013).
  const cancelledView = runtime.scheduler.lineageView(flow.lineageKey);
  const cancelled =
    seamLineageStatus(runtime, input.aggregateId) === 'CANCELLED' ||
    (cancelledView !== undefined && effectiveCancellation(cancelledView) !== undefined);
  if (cancelled) {
    cancelLineage(runtime, flow.lineageKey, 'CORE_POLICY', flow.workItemId);
    return projectAndRecord(runtime, {
      aggregateId: input.aggregateId,
      lineageKey: flow.lineageKey,
      contract: input.contract,
      payload,
      workItemId: flow.workItemId,
      recordedAt: workItemCreatedAt(runtime, flow.workItemId),
      memberValidated:
        runtime.recovery.classify(flow.workItemId).lifecycleClass === 'ACCEPTED' &&
        runtime.recovery.classify(flow.workItemId).bytesVerified,
      stopFacts: {},
    });
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

function seedOf(contract: AcquisitionContract, payload: S1DirectExecutionPayload): LineageSeed {
  return {
    contractId: contract.contractId,
    snapshotId: payload.snapshotId,
    targetId: contract.requestedTarget,
    authorizationContextRef: contract.authorizationContextRef,
    budgetProfile: contract.budgetProfile,
    frozenMemberIds: [payload.memberId],
  };
}

// ------------------------------------------------------ #113 target witness

/**
 * The delivery-graph failure reasons that leave the requested-locator
 * provenance unprovable (#103 §2.2 tuple (b)): the attempt stopped inside
 * the delivery graph itself (undeclared redirect / locator substitution) —
 * no reliable requested-locator fact exists. Auth walls, unsupported
 * responses, no-progress and cancellations deliberately record NO witness
 * so the frozen auth/unsupported/cancel tuples stay exactly as they were.
 */
const PROVENANCE_UNPROVEN_REASONS: ReadonlySet<string> = new Set([
  'REDIRECT_SCOPE_EXPANSION',
  'LOCATOR_SUBSTITUTION',
]);

function hostOf(uri: string): string | undefined {
  try {
    return new URL(uri).host;
  } catch {
    return undefined;
  }
}

/** Witness identity inputs shared by both derivation paths (identical rule). */
interface WitnessInputs {
  readonly contractId: string;
  readonly targetId: string;
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly effectId: string;
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  /** True when the frozen delivery declared an independently published digest. */
  readonly declaredPublishedDigest: boolean;
}

function witnessInputsOf(
  contract: AcquisitionContract,
  payload: S1DirectExecutionPayload,
  effectId: string,
): WitnessInputs {
  return {
    contractId: contract.contractId,
    targetId: contract.requestedTarget,
    snapshotId: payload.snapshotId,
    memberId: payload.memberId,
    artifactId: payload.artifactId,
    effectId,
    locatorUri: payload.delivery.locatorUri,
    declaredRedirectHosts: payload.delivery.declaredRedirectHosts,
    declaredPublishedDigest: payload.delivery.expectedSha256 !== undefined,
  };
}

/**
 * The closed receipt shape shared by both derivation paths — only the
 * strict-decoded witness fields, never the internal derivation inputs
 * (e.g. the digest-declaration flag stays out of the durable fact).
 */
function witnessBaseOf(
  inputs: WitnessInputs,
  observedRedirectHosts: readonly string[],
): {
  readonly snapshotId: string;
  readonly memberId: string;
  readonly artifactId: string;
  readonly effectId: string;
  readonly locatorUri: string;
  readonly declaredRedirectHosts: readonly string[];
  readonly observedRedirectHosts: readonly string[];
  readonly transferAttempted: true;
} {
  return {
    snapshotId: inputs.snapshotId,
    memberId: inputs.memberId,
    artifactId: inputs.artifactId,
    effectId: inputs.effectId,
    locatorUri: inputs.locatorUri,
    declaredRedirectHosts: [...inputs.declaredRedirectHosts],
    observedRedirectHosts,
    transferAttempted: true,
  };
}

/**
 * Derive the target witness from the ACTUAL transfer truth (fresh attempt,
 * #113): bytes arrived through the adapter's fail-closed declared delivery
 * graph ⇒ the requested locator provenance is RESOLVED — even when the
 * bytes then failed the declared publisher digest or other validation and
 * nothing was accepted. The publisher-digest anchor is recorded as
 * DECISIVE only when the transfer's bytes were durably ACCEPTED with the
 * declared anchor; every other resolution rests on the PROBATIVE
 * provenance basis (C34 — never a self-certifying byte oracle). A witness
 * recorded here is journaled BEFORE any terminal authority handover.
 */
function witnessFromTransfer(
  inputs: WitnessInputs,
  outcome: DirectTransferOutcome,
  accepted: boolean,
): TargetWitnessReceipt | undefined {
  const bytesArrived = outcome.bytes !== undefined && outcome.bytes.length > 0;
  const observedHosts = outcome.locatorChain
    .map((hop) => hostOf(hop.locator.uri))
    .filter((host): host is string => host !== undefined);
  const base = witnessBaseOf(inputs, [...new Set(observedHosts)]);
  if (bytesArrived) {
    // DECISIVE publisher-anchor truth requires durable acceptance of the
    // digest-matched bytes; anything else resolves on provenance alone —
    // identical to the durable-truth decision for the same state.
    const basis =
      accepted && inputs.declaredPublishedDigest
        ? ({ basis: 'PUBLISHED_SHA256', certaintyClass: 'DECISIVE' } as const)
        : ({ basis: 'REQUESTED_LOCATOR_PROVENANCE', certaintyClass: 'PROBATIVE' } as const);
    return {
      ...base,
      status: 'RESOLVED',
      basis: basis.basis,
      certaintyClass: basis.certaintyClass,
    };
  }
  if (PROVENANCE_UNPROVEN_REASONS.has(outcome.reason)) {
    return {
      ...base,
      status: 'PROVENANCE_UNPROVEN',
      unprovenReason: outcome.reason,
    };
  }
  return undefined;
}

/**
 * Re-derive the identical witness from DURABLE TRUTH ONLY (restart/
 * reconcile paths, #113): the same decision table as `witnessFromTransfer`
 * over the staged artifact row, the recovery classification and the durable
 * terminal-failure reason — so a kill before the witness record still
 * journals the witness before the re-derived terminal, and an identical
 * replay converges byte-for-byte while a changed basis rejects.
 */
function witnessFromDurableTruth(
  runtime: S1DriveRuntime,
  inputs: WitnessInputs,
  workItemId: string,
): SeamResult<TargetWitnessReceipt | undefined> {
  const artifact = runtime.writer.reader
    .artifacts(workItemId)
    .find((row) => row.artifactId === inputs.artifactId);
  if (artifact !== undefined) {
    let provenance: {
      readonly locatorChain?: readonly string[];
      readonly targetEvidence?: { readonly basis?: string; readonly certaintyClass?: string };
    };
    try {
      provenance = JSON.parse(artifact.provenanceJson) as typeof provenance;
    } catch (error) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'targetWitness.provenance',
          `the staged artifact provenance is not decodable; no witness can be derived from it: ${String(error)}`,
        ),
      ]);
    }
    const observedHosts = (provenance.locatorChain ?? [])
      .map((uri) => hostOf(uri))
      .filter((host): host is string => host !== undefined);
    // DECISIVE publisher-anchor truth requires durable acceptance of the
    // digest-matched bytes; anything else resolves on provenance alone —
    // identical to the fresh decision for the same durable state.
    const classification = runtime.recovery.classify(workItemId);
    const accepted = classification.lifecycleClass === 'ACCEPTED' && classification.bytesVerified;
    const stagedBasis = provenance.targetEvidence?.basis;
    const basis =
      accepted && stagedBasis === 'PUBLISHED_SHA256'
        ? ({ basis: 'PUBLISHED_SHA256', certaintyClass: 'DECISIVE' } as const)
        : ({ basis: 'REQUESTED_LOCATOR_PROVENANCE', certaintyClass: 'PROBATIVE' } as const);
    return seamOk({
      ...witnessBaseOf(inputs, [...new Set(observedHosts)]),
      status: 'RESOLVED',
      basis: basis.basis,
      certaintyClass: basis.certaintyClass,
    });
  }
  // Recover the delivery-graph failure from the FIRST durable scheduler
  // effect outcome. The control fact is committed before the witness journal
  // append; on SIGKILL inside that window no staged artifact or terminal
  // failure row exists yet, so a ledger-only lookup silently lost tuple (b).
  const lineageKey = s1LineageKey({
    contractId: inputs.contractId,
    snapshotId: inputs.snapshotId,
    targetId: inputs.targetId,
    effectId: inputs.effectId,
  });
  const outcome = runtime.scheduler.durableEffectOutcome(lineageKey, attemptIdFor(workItemId));
  const effectReason =
    outcome?.outcome === 'FAILED' ? outcome.failureCategory : undefined;
  if (effectReason !== undefined && PROVENANCE_UNPROVEN_REASONS.has(effectReason)) {
    const originHost = hostOf(inputs.locatorUri);
    return seamOk({
      ...witnessBaseOf(inputs, originHost === undefined ? [] : [originHost]),
      status: 'PROVENANCE_UNPROVEN',
      unprovenReason: effectReason,
    });
  }
  const failure = runtime.writer.reader
    .facts(workItemId)
    .find((fact) => fact.kind === 'TERMINAL_FAILURE');
  if (failure !== undefined) {
    let reason: unknown;
    try {
      reason = failure.payloadJson === undefined ? undefined : JSON.parse(failure.payloadJson);
    } catch {
      reason = undefined;
    }
    const failureReason =
      typeof reason === 'object' && reason !== null
        ? (reason as Record<string, unknown>)['reason']
        : undefined;
    if (typeof failureReason === 'string' && PROVENANCE_UNPROVEN_REASONS.has(failureReason)) {
      const originHost = hostOf(inputs.locatorUri);
      return seamOk({
        ...witnessBaseOf(inputs, originHost === undefined ? [] : [originHost]),
        status: 'PROVENANCE_UNPROVEN',
        unprovenReason: failureReason,
      });
    }
  }
  return seamOk(undefined);
}

/**
 * Journal the witness BEFORE terminal authority (idempotent): an already
 * recorded identical witness converges, a conflicting one rejects (the
 * recorded resolution fact is immutable), and a journal durability failure
 * propagates so the drive can never hand over a terminal without the
 * durable witness (#113 acceptance 1).
 */
function recordWitnessBeforeTerminal(
  runtime: S1DriveRuntime,
  aggregateId: string,
  witness: TargetWitnessReceipt | undefined,
): SeamResult<void> {
  if (witness === undefined) {
    return seamOk(undefined);
  }
  const existing = runtime.seam.targetWitnessFor(aggregateId);
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(witness)) {
    return seamOk(undefined);
  }
  const recorded = runtime.seam.recordTargetWitness(aggregateId, witness);
  return recorded.ok ? seamOk(undefined) : recorded;
}

function workItemCreatedAt(runtime: S1DriveRuntime, workItemId: string): string {
  const workItem = runtime.writer.reader.workItems().find((item) => item.workItemId === workItemId);
  return workItem?.createdAt ?? new Date().toISOString();
}

/** The seam lineage status for one aggregate (undefined when unknown). */
function seamLineageStatus(
  runtime: S1DriveRuntime,
  aggregateId: string,
): 'ACTIVE' | 'CANCELLED' | 'TERMINAL' | undefined {
  return runtime.seam.inspectProjection(aggregateId)?.lineage.status;
}

/**
 * Derive the terminal through the T007 projector and hand it to the seam.
 *
 * The recording port follows the seam lineage authority: an ACTIVE lineage
 * records through `recordExecutedTerminal`; a CANCELLED lineage (durably
 * committed user cancel) closes through `closeCancelledLineage` with the
 * projector's cutoff decision (ADR-013); an already-TERMINAL lineage
 * converges without rewriting terminal truth. A validated member first
 * persists its secret-free typed Target evidence receipt (#101 P2-2) so the
 * identity basis is durable before terminal authority is handed over.
 */
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
  const status = seamLineageStatus(runtime, input.aggregateId);
  if (status === 'TERMINAL') {
    // Terminal truth already recorded (a racing completion won): converge.
    return seamOk(undefined);
  }
  if (status === 'CANCELLED') {
    // Re-assert the durable cancel in BOTH canonical stores (idempotent) so
    // the projector's cutoff facts are complete even when the cancel bridge
    // could not run (e.g. restart replay of the journaled cancel).
    cancelLineage(runtime, input.lineageKey, 'CORE_POLICY', input.workItemId);
  }
  if (input.memberValidated) {
    // #101 P2-2: persist the secret-free typed Target evidence basis +
    // certainty with the exact artifact/effect identity BEFORE terminal
    // authority is handed over. The basis re-derives deterministically from
    // the frozen delivery facts (the same rule the adapter applied at
    // transfer time), and the digest is the durably accepted byte truth.
    const basis = targetBasisOf({ expectedSha256: input.payload.delivery.expectedSha256 });
    const digest = runtime.store.observe(input.payload.artifactId).observedDigest;
    if (digest === undefined) {
      return seamFail([
        seamDiagnostic(
          'ADMISSION_REJECTED',
          'targetEvidence.artifactSha256',
          'a validated member has no observable digest-bound bytes; the target evidence receipt cannot be established',
        ),
      ]);
    }
    const recorded = runtime.seam.recordTargetEvidence(input.aggregateId, {
      artifactId: input.payload.artifactId,
      effectId: `effect:${input.contract.contractId}:${input.payload.snapshotId}:${input.contract.requestedTarget}`,
      artifactSha256: digest,
      basis,
      certaintyClass: targetCertaintyOf(basis),
    });
    if (!recorded.ok) {
      return recorded;
    }
  }
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
  if (status === 'CANCELLED') {
    return runtime.seam.closeCancelledLineage(input.aggregateId, projected.value.result);
  }
  return runtime.seam.recordExecutedTerminal(input.aggregateId, projected.value.result);
}
