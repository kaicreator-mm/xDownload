/**
 * T008 DirectHttpAdapter — S1/S3 direct HTTP/file byte transfer behind the
 * ADR-006 acquisition port (frozen L2 §6.5).
 *
 * One frozen single target per acquisition; stable logical identity separate
 * from volatile locators (ADR-011); provenance-bound redirect/CDN/signed
 * hops; safe Range/If-Range resume per frozen L2 U5; retry within the same
 * effect lineage consuming remaining lifecycle budgets through the
 * authoritative ledger port (invariant 7); integrity hooks per frozen PRD
 * §22 gate acceptance — transfer alone never completes an artifact
 * (invariant 18). Unsupported/ambiguous identity fails closed.
 */

import {
  assertLocatorTransitionPreservesTarget,
  makeContractId,
  ok,
  type DomainValidationResult,
  type LocatorBinding,
  type LogicalTargetId,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';
import { createHash } from 'node:crypto';
import { classifyRangeResponse, isSha256Hex, observeIdentity, planResume } from './identity.ts';
import { validateFormat, validateMedia, validateTarget, validateTransfer } from './integrity.ts';
import { projectOutcome, rejectRequest } from './projection.ts';
import type { PinnedPublicMediaSourcePolicy } from './public-media-source.ts';
import type {
  DirectTransferOutcome,
  DirectTransferRequest,
  DirectTransferTerminalReason,
  PartialTransferState,
  RepresentationIdentity,
  ResumeDecision,
  TransferBudgetLedgerPort,
  ValidationLayerOutcome,
} from './port.ts';
import { targetBasisOf } from './port.ts';

const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Internal immutable attempt state reduced into a canonical outcome. */
interface AttemptState {
  readonly reason: DirectTransferTerminalReason;
  readonly validations: readonly ValidationLayerOutcome[];
  readonly bytes: Uint8Array | undefined;
  readonly receivedBytes: number;
  readonly resumeDecision: ResumeDecision;
  readonly observedIdentity: RepresentationIdentity;
  readonly locatorChain: readonly LocatorBinding<LogicalTargetId>[];
  readonly targetResolved: boolean;
}

export class DirectHttpAdapter {
  private readonly ledger: TransferBudgetLedgerPort;

  constructor(ledger: TransferBudgetLedgerPort) {
    this.ledger = ledger;
  }

  /**
   * Acquire one frozen single target. Request-shape violations (malformed
   * identity anchors, retry-lineage escapes) are rejected before any
   * transfer happens; every executed attempt projects a truthful outcome.
   */
  async acquire(
    request: DirectTransferRequest,
  ): Promise<DomainValidationResult<DirectTransferOutcome>> {
    return this.acquireWithPolicy(request);
  }

  /**
   * S3 public-file Core-private transfer lane. Callers cannot smuggle a
   * self-attested source profile or bearer locator through this port.
   * This is NOT a Core seam command or a replacement for the protected
   * CLI session/confirmed-candidate journal required by L2 §2.1.
   */
  async acquirePublicS3(
    request: DirectTransferRequest,
    policy: PinnedPublicMediaSourcePolicy,
  ): Promise<DomainValidationResult<DirectTransferOutcome>> {
    if (
      request.slice !== 'S3' ||
      request.locatorRefresher !== undefined ||
      request.expectedSha256 !== undefined
    ) {
      return rejectRequest(
        'MALFORMED_REQUIRED_FIELD',
        's3.publicSource',
        'S3 public-file transfer requires Core-confirmed S3, no refresher and no claimed publisher SHA',
      );
    }
    if (!policy.admitInitial(request.binding.locator.uri).ok) {
      return rejectRequest(
        'MALFORMED_REQUIRED_FIELD',
        's3.publicSource',
        'selected S3 URI is not admitted by Core-pinned public source profile',
      );
    }
    return this.acquireWithPolicy(request, policy);
  }

  private async acquireWithPolicy(
    request: DirectTransferRequest,
    policy?: PinnedPublicMediaSourcePolicy,
  ): Promise<DomainValidationResult<DirectTransferOutcome>> {
    const shape = validateRequestShape(request);
    if (!shape.ok) {
      return shape;
    }

    // Budget preflight: GlobalSafetyBudget has the highest precedence (PRD §15.4).
    const preflight = this.ledger.remaining();
    if (preflight.globalSafety.exhausted) {
      return ok(this.finalize(request, stopState(request, 'GLOBAL_SAFETY_EXHAUSTED')));
    }
    if (preflight.transfer.exhausted) {
      return ok(this.finalize(request, stopState(request, 'TRANSFER_BUDGET_EXHAUSTED')));
    }

    let state: AttemptState;
    try {
      state = await this.run(request, policy);
    } catch {
      // A fired cancellation checkpoint is a truthful user-cancel stop, not
      // infrastructure noise: it terminates the attempt with whatever bytes
      // had already arrived and never becomes a fabricated COMPLETED.
      if (request.signal?.aborted === true) {
        return ok(this.finalize(request, stopState(request, 'USER_CANCELLED')));
      }
      // Infrastructure-level failure (connection refused/reset): truthful
      // no-progress outcome, never an exception-shaped success.
      state = stopState(request, 'NO_PROGRESS');
    }
    return ok(this.finalize(request, state));
  }

  // --- attempt loop -------------------------------------------------------

  private async run(
    request: DirectTransferRequest,
    policy?: PinnedPublicMediaSourcePolicy,
  ): Promise<AttemptState> {
    const locatorChain: LocatorBinding<LogicalTargetId>[] = [request.binding];
    let current = request.binding;
    let refreshedSignedLocator = false;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      // Cancellation checkpoint: a fired user-cancel stop ends the attempt
      // before any further request/hop (no lingering socket, #101 P2-1).
      if (request.signal?.aborted === true) {
        return stopState(request, 'USER_CANCELLED', { chain: locatorChain });
      }
      // Global safety ceiling first, then the transfer domain (PRD §15.4).
      const remaining = this.ledger.remaining();
      if (remaining.globalSafety.exhausted) {
        return stopState(request, 'GLOBAL_SAFETY_EXHAUSTED', { chain: locatorChain });
      }
      if (remaining.transfer.exhausted) {
        return stopState(request, 'TRANSFER_BUDGET_EXHAUSTED', { chain: locatorChain });
      }
      this.chargeRequest(request.attempt);

      const response = await fetch(current.locator.uri, {
        redirect: 'manual',
        headers: requestHeaders(request),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const responseIdentity = observeIdentity(response.headers);

      if (REDIRECT_STATUSES.has(response.status)) {
        const hopResult = followRedirect(current, response.headers.get('location'), request);
        if (!hopResult.ok) {
          await cancelBody(response);
          return hopResult.scopeExpansion
            ? stopState(request, 'REDIRECT_SCOPE_EXPANSION', {
                chain: locatorChain,
                validations: [
                  {
                    layer: 'target',
                    passed: false,
                    code: 'SCOPE_EXPANSION_REJECTED',
                    failure: 'redirect chain left the declared single-target delivery policy',
                  },
                ],
              })
            : stopState(request, 'LOCATOR_SUBSTITUTION', {
                chain: locatorChain,
                validations: [
                  {
                    layer: 'target',
                    passed: false,
                    code: 'LOCATOR_SUBSTITUTION_REJECTED',
                    failure: 'unrelated redirect cannot claim the frozen logical target (C29)',
                  },
                ],
              });
        }
        // Guard every redirect BEFORE another fetch and BEFORE committing
        // its URI into an outcome chain or any persisted evidence. Never
        // return an unapproved signed/secret candidate URI to the caller.
        if (policy !== undefined && !policy.admitRedirect(hopResult.binding.locator.uri).ok) {
          await cancelBody(response);
          return stopState(request, 'REDIRECT_SCOPE_EXPANSION', {
            chain: locatorChain,
            validations: [
              {
                layer: 'target',
                passed: false,
                code: 'SCOPE_EXPANSION_REJECTED',
                failure: 'S3 redirect not in the Core-pinned public source profile',
              },
            ],
          });
        }
        current = hopResult.binding;
        locatorChain.push(current);
        continue;
      }

      if (
        (response.status === 401 || response.status === 403) &&
        request.locatorRefresher !== undefined &&
        !refreshedSignedLocator
      ) {
        refreshedSignedLocator = true;
        await cancelBody(response);
        const refresh = await refreshSignedLocator(request, current);
        if (!refresh.ok) {
          return stopState(request, 'SIGNED_LOCATOR_REFRESH_FAILED', { chain: locatorChain });
        }
        current = refresh.value;
        locatorChain.push(current);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await cancelBody(response);
        return stopState(request, 'AUTH_REQUIRED', {
          chain: locatorChain,
          observedIdentity: responseIdentity,
        });
      }

      if (response.status < 200 || response.status > 299) {
        await cancelBody(response);
        return stopState(request, 'NO_PROGRESS', {
          chain: locatorChain,
          observedIdentity: responseIdentity,
        });
      }

      return await this.readBody(request, response, responseIdentity, locatorChain);
    }

    // Exhausted the bounded hop budget without a final response: an unbounded
    // redirect chain would expand the acquisition path beyond the declared
    // single-target delivery policy.
    return stopState(request, 'REDIRECT_SCOPE_EXPANSION', {
      chain: locatorChain,
      validations: [
        {
          layer: 'target',
          passed: false,
          code: 'SCOPE_EXPANSION_REJECTED',
          failure: `redirect chain exceeded ${String(MAX_REDIRECT_HOPS)} hops`,
        },
      ],
    });
  }

  // --- body transfer ------------------------------------------------------

  private async readBody(
    request: DirectTransferRequest,
    response: Response,
    responseIdentity: RepresentationIdentity,
    locatorChain: readonly LocatorBinding<LogicalTargetId>[],
  ): Promise<AttemptState> {
    const plan = planResume(request.resumeFrom);
    const sentRange = plan.kind === 'VALIDATED_RESUME';
    const recordedStrongETag = sentRange ? plan.strongETag : undefined;
    const classification = classifyRangeResponse(
      sentRange,
      response.status,
      responseIdentity,
      recordedStrongETag,
    );

    if (classification.kind === 'PROTOCOL_VIOLATION') {
      // Unsolicited 206: the response representation identity is ambiguous —
      // fail closed instead of guessing (never append uncertain bytes).
      await cancelBody(response);
      return stopState(request, 'UNSUPPORTED_RESPONSE', {
        chain: locatorChain,
        resumeDecision: { kind: 'SAFE_RESTART', reason: 'PROTOCOL_VIOLATION' },
        observedIdentity: responseIdentity,
        targetResolved: true,
        validations: [
          {
            layer: 'transfer',
            passed: false,
            code: 'PROTOCOL_VIOLATION',
            failure: 'unsolicited 206 partial response; representation identity is ambiguous',
          },
        ],
      });
    }

    const resumeOffset =
      classification.kind === 'APPEND_VALIDATED' && plan.kind === 'VALIDATED_RESUME'
        ? plan.offsetBytes
        : 0;
    const prefix: Uint8Array | undefined =
      classification.kind === 'APPEND_VALIDATED' ? request.resumeFrom?.bytes : undefined;
    // The typed resume decision is the decision that governed this attempt:
    // a planned validated resume that the server confirmed appends; a planned
    // validated resume answered by a new representation restarts; a plan
    // without a strong validator stays a safe restart on the same lineage.
    const resumeFinal: ResumeDecision =
      plan.kind === 'VALIDATED_RESUME'
        ? classification.kind === 'APPEND_VALIDATED'
          ? {
              kind: 'VALIDATED_RESUME',
              offsetBytes: resumeOffset,
              strongETag: recordedStrongETag ?? '',
            }
          : { kind: 'SAFE_RESTART', reason: 'IDENTITY_CHANGED' }
        : plan;

    const read = await this.streamBytes(response, prefix, request.signal);
    if (read.aborted) {
      // The cancellation checkpoint fired mid-body: what arrived stays
      // partial/unaccepted truth — never a completed transfer (P2-1).
      return stopState(request, 'USER_CANCELLED', {
        chain: locatorChain,
        resumeDecision: resumeFinal,
        observedIdentity: responseIdentity,
        targetResolved: true,
        bytes: read.chunks,
        receivedBytes: byteLengthOf(read.chunks),
      });
    }
    if (read.budgetStop !== undefined) {
      return stopState(request, read.budgetStop, {
        chain: locatorChain,
        resumeDecision: resumeFinal,
        observedIdentity: responseIdentity,
        targetResolved: true,
        bytes: read.chunks,
        receivedBytes: byteLengthOf(read.chunks),
        validations: [
          {
            layer: 'transfer',
            passed: false,
            code: 'BUDGET_TRUNCATED',
            failure: 'transfer stopped by budget exhaustion before the body completed',
          },
        ],
      });
    }

    const bytes = concatChunks(read.chunks);
    const contentType = response.headers.get('content-type') ?? undefined;
    const contentRange = response.headers.get('content-range') ?? undefined;

    // Defensive range math: append only at the proven offset — misplaced or
    // Content-Range-less partial responses never merge into the artifact.
    if (response.status === 206) {
      const rangeStart = parseContentRangeStart(contentRange);
      if (rangeStart === undefined) {
        return integrityFailure(request, bytes, locatorChain, resumeFinal, responseIdentity, {
          layer: 'transfer',
          passed: false,
          code: 'MISSING_CONTENT_RANGE',
          failure: '206 response without a parseable Content-Range header',
        });
      }
      if (rangeStart !== resumeOffset) {
        return integrityFailure(request, bytes, locatorChain, resumeFinal, responseIdentity, {
          layer: 'transfer',
          passed: false,
          code: 'RANGE_MISMATCH',
          failure: `206 range starts at ${String(rangeStart)} but the resume offset was ${String(resumeOffset)}`,
        });
      }
    }

    const transferCheck = validateTransfer({
      status: response.status,
      sentRange,
      resumeOffsetBytes: resumeOffset,
      responseIdentity,
      receivedBytes: bytes.byteLength,
      expectedTotalBytes: request.expectedTotalBytes,
      contentRange,
    });
    const formatCheck = validateFormat({
      contentType,
      bodyPrefix: bytes,
      expectedContentTypePrefix: request.expectedContentTypePrefix,
    });
    const targetCheck = validateTarget({
      bytes,
      expectedSha256: request.expectedSha256,
      expectedTotalBytes: request.expectedTotalBytes,
      // Provenance-basis Target facts (C34): the bytes' actual serving URI is
      // the realized chain's last hop; the claim is bound to the declared
      // delivery graph rooted at the user-selected locator.
      servedUri: locatorChain[locatorChain.length - 1]?.locator.uri,
      originUri: request.binding.locator.uri,
      declaredRedirectHosts: request.allowedRedirectHosts,
    });
    const validations: ValidationLayerOutcome[] = [transferCheck, formatCheck, targetCheck];
    if (request.slice === 'S3') {
      validations.push(validateMedia({ bytes, policy: request.mediaPolicy ?? { signatures: [] } }));
      // #150: the untrusted confirmed-candidate byte constraint rejects a
      // mismatched stream but NEVER promotes the Target basis to the
      // publisher-digest anchor (targetBasisOf below only honors
      // expectedSha256, which S3 forbids).
      const constraint = request.byteConstraintSha256;
      if (constraint !== undefined) {
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== constraint) {
          validations.push({
            layer: 'target',
            passed: false,
            code: 'BYTE_CONSTRAINT_MISMATCH',
            failure: `acquired bytes digest ${digest} does not match the user-confirmed byte constraint ${constraint}`,
          });
        }
      }
    }

    const failedValidation = validations.find(
      (check): check is ValidationLayerOutcome & { passed: false } => !check.passed,
    );
    const identity =
      classification.kind === 'APPEND_VALIDATED' && request.resumeFrom !== undefined
        ? request.resumeFrom.identity
        : responseIdentity;

    return {
      reason: failedValidation === undefined ? 'COMPLETED' : failureReason(failedValidation),
      validations,
      bytes,
      receivedBytes: bytes.byteLength,
      resumeDecision: resumeFinal,
      observedIdentity: identity,
      locatorChain,
      targetResolved: true,
    };
  }

  private async streamBytes(
    response: Response,
    prefix: Uint8Array | undefined,
    signal?: AbortSignal,
  ): Promise<{
    chunks: Uint8Array[];
    budgetStop: 'TRANSFER_BUDGET_EXHAUSTED' | 'GLOBAL_SAFETY_EXHAUSTED' | undefined;
    aborted: boolean;
  }> {
    const chunks: Uint8Array[] = prefix !== undefined ? [prefix] : [];
    const reader = response.body?.getReader();
    if (reader === undefined) {
      return { chunks, budgetStop: undefined, aborted: signal?.aborted === true };
    }
    try {
      for (;;) {
        if (signal?.aborted === true) {
          // Checkpoint fired between chunks: tear the stream down at once
          // (reader.cancel closes the connection — no lingering socket).
          await reader.cancel('user cancelled').catch(() => undefined);
          return { chunks, budgetStop: undefined, aborted: true };
        }
        const next = await reader.read();
        if (next.done) {
          break;
        }
        const value = next.value;
        if (value === undefined) {
          continue;
        }
        chunks.push(value);
        const after = this.ledger.consume({
          transferRequests: 0,
          retryTransferRequests: 0,
          bytes: value.byteLength,
        });
        if (after.globalSafety.exhausted || after.transfer.exhausted) {
          // Budget boundary: only stop work when more bytes are still coming;
          // a body that ends exactly at the boundary is a complete transfer.
          let moreBytesComing = false;
          try {
            moreBytesComing = !(await reader.read()).done;
          } catch {
            moreBytesComing = false;
          }
          if (moreBytesComing) {
            await reader.cancel('budget exhausted');
            return {
              chunks,
              budgetStop: after.globalSafety.exhausted
                ? 'GLOBAL_SAFETY_EXHAUSTED'
                : 'TRANSFER_BUDGET_EXHAUSTED',
              aborted: false,
            };
          }
          break;
        }
      }
    } catch {
      // Premature close / connection reset / fired abort signal: return what
      // arrived so Transfer Validation reports the stop truthfully.
      if (signal?.aborted === true) {
        return { chunks, budgetStop: undefined, aborted: true };
      }
    }
    return { chunks, budgetStop: undefined, aborted: false };
  }

  // --- helpers ------------------------------------------------------------

  private chargeRequest(attempt: number): void {
    this.ledger.consume({
      transferRequests: attempt > 0 ? 0 : 1,
      retryTransferRequests: attempt > 0 ? 1 : 0,
      bytes: 0,
    });
  }

  private finalize(request: DirectTransferRequest, state: AttemptState): DirectTransferOutcome {
    const projection = projectOutcome({
      request,
      reason: state.reason,
      validations: state.validations,
      bytesReceived: state.receivedBytes,
      targetResolved: state.targetResolved,
      locatorChainLength: state.locatorChain.length,
    });
    if (!projection.ok) {
      // A rejected canonical projection is a defect, not a transfer outcome;
      // never fabricate a result for it.
      throw new Error(
        `canonical projection rejected: ${projection.diagnostics.map((entry) => entry.code).join(', ')}`,
      );
    }
    return {
      effectId: request.effectId,
      targetId: request.binding.identity,
      slice: request.slice,
      bytes: state.bytes,
      receivedBytes: state.receivedBytes,
      resumeDecision: state.resumeDecision,
      reason: state.reason,
      validations: state.validations,
      allApplicableValidationPassed: projection.value.allApplicableValidationPassed,
      terminalResult: projection.value.terminalResult,
      evidence: projection.value.evidence,
      locatorChain: state.locatorChain,
      observedIdentity: state.observedIdentity,
      targetResolved: state.targetResolved,
      targetBasis: targetBasisOf(request),
    };
  }
}

// --- module-scope helpers -------------------------------------------------

async function refreshSignedLocator(
  request: DirectTransferRequest,
  current: LocatorBinding<LogicalTargetId>,
): Promise<DomainValidationResult<LocatorBinding<LogicalTargetId>>> {
  const refreshed = await request.locatorRefresher?.(current);
  if (refreshed === undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'locatorRefresher',
          message: 'signed-locator refresh produced no binding',
        },
      ],
    };
  }
  // A refresh must re-bind the SAME frozen logical target: a refresher
  // claiming a different identity is target substitution, never accepted.
  if (refreshed.identity !== request.binding.identity) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'locatorRefresher',
          message: 'signed-locator refresh re-bound the locator to a different logical target',
          invariant: 'L2-inv4',
        },
      ],
    };
  }
  // The refreshed locator must additionally descend from the current delivery
  // locator through an allowed provenance binding.
  return assertLocatorTransitionPreservesTarget(current, refreshed.locator, {
    binding: refreshed.provenance.binding,
    originLocatorUri: refreshed.provenance.originLocatorUri,
  });
}

function requestHeaders(request: DirectTransferRequest): Record<string, string> {
  const headers: Record<string, string> = { accept: '*/*' };
  const plan = planResume(request.resumeFrom);
  if (plan.kind === 'VALIDATED_RESUME') {
    headers['range'] = `bytes=${String(plan.offsetBytes)}-`;
    headers['if-range'] = plan.strongETag;
  }
  return headers;
}

type RedirectResolution =
  | { readonly ok: true; readonly binding: LocatorBinding<LogicalTargetId> }
  | {
      readonly ok: false;
      readonly scopeExpansion: boolean;
      readonly diagnostics: readonly ValidationDiagnostic[];
    };

function followRedirect(
  current: LocatorBinding<LogicalTargetId>,
  location: string | null,
  request: DirectTransferRequest,
): RedirectResolution {
  if (location === null || location === '') {
    return {
      ok: false,
      scopeExpansion: false,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'redirect.location',
          message: 'redirect without a location header cannot be provenance-bound',
          invariant: 'C29',
        },
      ],
    };
  }
  let nextUrl: URL;
  try {
    nextUrl = new URL(location, current.locator.uri);
  } catch {
    return {
      ok: false,
      scopeExpansion: true,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'redirect.location',
          message: `redirect location '${location}' is not a resolvable URI inside the declared delivery policy`,
          invariant: 'C29',
        },
      ],
    };
  }
  if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
    return {
      ok: false,
      scopeExpansion: true,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'redirect.location',
          message: `redirect to '${nextUrl.protocol}' leaves the declared single-target delivery policy`,
          invariant: 'C29',
        },
      ],
    };
  }
  if (!request.allowedRedirectHosts.includes(nextUrl.host)) {
    return {
      ok: false,
      scopeExpansion: false,
      diagnostics: [
        {
          code: 'LOCATOR_SUBSTITUTION_REJECTED',
          path: 'redirect.location',
          message: `redirect to undeclared host '${nextUrl.host}' cannot claim the frozen logical target (C29 unrelated redirect)`,
          invariant: 'C29',
        },
      ],
    };
  }
  const transition = assertLocatorTransitionPreservesTarget(
    current,
    { kind: 'redirect', uri: nextUrl.toString() },
    { binding: 'DECLARED_DELIVERY_EDGE', originLocatorUri: current.locator.uri },
  );
  if (!transition.ok) {
    return { ok: false, scopeExpansion: false, diagnostics: transition.diagnostics };
  }
  return { ok: true, binding: transition.value };
}

function validateRequestShape(request: DirectTransferRequest): DomainValidationResult<void> {
  if (request.expectedSha256 !== undefined && !isSha256Hex(request.expectedSha256)) {
    return rejectRequest(
      'MALFORMED_REQUIRED_FIELD',
      'expectedSha256',
      'the published target identity anchor must be a lowercase hex sha-256 digest',
    );
  }
  if (request.byteConstraintSha256 !== undefined) {
    if (!isSha256Hex(request.byteConstraintSha256)) {
      return rejectRequest(
        'MALFORMED_REQUIRED_FIELD',
        'byteConstraintSha256',
        'the S3 confirmed-candidate byte constraint must be a lowercase hex sha-256 digest',
      );
    }
    if (request.slice !== 'S3' || request.expectedSha256 !== undefined) {
      return rejectRequest(
        'MALFORMED_REQUIRED_FIELD',
        'byteConstraintSha256',
        'the untrusted S3 byte constraint never combines with the S1 publisher anchor or non-S3 slices',
      );
    }
  }
  if (!makeContractId(request.contractId).ok) {
    return rejectRequest(
      'MALFORMED_REQUIRED_FIELD',
      'contractId',
      'contractId must be a valid canonical identifier',
    );
  }
  if (request.retryLineage !== undefined) {
    if (
      request.retryLineage.effectId !== request.effectId ||
      request.retryLineage.targetId !== request.binding.identity
    ) {
      return rejectRequest(
        'MEMBERSHIP_DRIFT',
        'retryLineage',
        'retry operates only on the original failed target/effect lineage; replacement targets are rejected (C12)',
        'C12',
      );
    }
  }
  const partial: PartialTransferState | undefined = request.resumeFrom;
  if (partial !== undefined) {
    if (partial.effectId !== request.effectId || partial.targetId !== request.binding.identity) {
      return rejectRequest(
        'MEMBERSHIP_DRIFT',
        'resumeFrom',
        'partial bytes belong to a different effect lineage; unsafe append across lineages is forbidden',
        'L2-inv8',
      );
    }
  }
  return ok(undefined);
}

function parseContentRangeStart(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function byteLengthOf(chunks: readonly Uint8Array[]): number {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  return total;
}

function countCarriedBytes(request: DirectTransferRequest): number {
  return request.resumeFrom?.receivedBytes ?? 0;
}

function failureReason(
  failed: ValidationLayerOutcome & { passed: false },
): DirectTransferOutcome['reason'] {
  switch (failed.layer) {
    case 'transfer':
      return 'TRUNCATED';
    case 'format':
      return 'FORMAT_REJECTED';
    case 'media':
      return 'MEDIA_INVALID';
    case 'target':
      return 'WRONG_TARGET';
  }
}

interface StopExtras {
  readonly bytes?: readonly Uint8Array[] | undefined;
  readonly receivedBytes?: number | undefined;
  readonly chain?: readonly LocatorBinding<LogicalTargetId>[] | undefined;
  readonly resumeDecision?: ResumeDecision | undefined;
  readonly validations?: readonly ValidationLayerOutcome[] | undefined;
  readonly observedIdentity?: RepresentationIdentity | undefined;
  readonly targetResolved?: boolean | undefined;
}

function stopState(
  request: DirectTransferRequest,
  reason: DirectTransferTerminalReason,
  extras: StopExtras = {},
): AttemptState {
  return {
    reason,
    validations: extras.validations ?? [],
    bytes: extras.bytes === undefined ? undefined : concatChunks(extras.bytes),
    receivedBytes: extras.receivedBytes ?? countCarriedBytes(request),
    resumeDecision: extras.resumeDecision ?? planResume(request.resumeFrom),
    observedIdentity: extras.observedIdentity ?? {},
    locatorChain: extras.chain ?? [request.binding],
    targetResolved: extras.targetResolved ?? false,
  };
}

function integrityFailure(
  request: DirectTransferRequest,
  bytes: Uint8Array,
  chain: readonly LocatorBinding<LogicalTargetId>[],
  resumeDecision: ResumeDecision,
  observedIdentity: RepresentationIdentity,
  failed: ValidationLayerOutcome & { passed: false },
): AttemptState {
  return {
    reason: failureReason(failed),
    validations: [failed],
    bytes,
    receivedBytes: bytes.byteLength,
    resumeDecision,
    observedIdentity,
    locatorChain: chain,
    targetResolved: true,
  };
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel();
}
