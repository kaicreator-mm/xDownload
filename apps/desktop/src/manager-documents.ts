/**
 * v0.2.1 T08 desktop download-manager documents — the pure Core-projection →
 * manager-row mapping shared by the desktop shell (T08 renderer/main).
 *
 * Discipline (frozen T08 acceptance):
 * - Every field is a VERBATIM projection of Core-owned facts. An absent
 *   projection fact renders as `null` (absent) — never as 0, "0%", a
 *   fabricated total, an ETA or any derived completion claim.
 * - There is deliberately NO byte progress, percentage or ETA on the legacy
 *   lane: the legacy seam projection carries no authoritative byte sample,
 *   so the manager displays none (no fabricated total/ETA).
 * - Retry availability is derived by the adapter's own `deriveRetryDomain`
 *   facts (the exact predicate `DesktopUiAdapter.retryFailed()` enforces);
 *   the hint is presentation only — Core re-decides every routed retry.
 * - Terminal results render all six dimensions verbatim; there is no success
 *   boolean and no UI-derived completion.
 */

import type { SeamProjectionView } from '@xdownload/core-seam';
import { makeLogicalTargetId } from '@xdownload/domain-contracts';
import { diagnostic, fail } from '@xdownload/domain-contracts';
import type { DomainValidationResult } from '@xdownload/domain-contracts';
import { deriveRetryDomain } from './view-model.ts';
import type { DesktopIntentInput } from './payloads.ts';

/** Upper bound for one user-supplied download URL (fail closed beyond it). */
export const MANAGER_MAX_URL_LENGTH = 2048;

/** True when the value carries whitespace or C0/Del control characters. */
function hasWhitespaceOrControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Decode one user-supplied download URL for the desktop add flow: http(s)
 * only, bounded, no control characters or whitespace (the same class of
 * locator the Core's own logical-target grammar carries). Returns the raw
 * string; the canonical id decode happens in the contract payload builder.
 */
export function decodeManagerUrl(raw: unknown): DomainValidationResult<string> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MANAGER_MAX_URL_LENGTH) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'url',
        `url must be a non-empty string of at most ${MANAGER_MAX_URL_LENGTH} characters`,
      ),
    ]);
  }
  if (hasWhitespaceOrControlCharacter(raw)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'url',
        'url must not contain control characters or whitespace',
      ),
    ]);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'url', 'url is not a valid URL')]);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'url', 'only http(s) download URLs are admissible'),
    ]);
  }
  if (parsed.hostname.length === 0) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'url', 'url has no host')]);
  }
  return { ok: true, value: raw };
}

/** The single-resource draft facts: one candidate, no ambiguity by construction. */
export const SINGLE_RESOURCE_WORKFLOW_FACTS = {
  ambiguousMaterialMemberIds: [],
  candidateCount: 1,
  autoEvidenceSufficient: false,
} as const;

/** The local authorization-context reference of the desktop surface (opaque, not secret). */
export const DESKTOP_LOCAL_AUTHORIZATION_CONTEXT_REF = 'authctx/local-desktop';

/**
 * Build the structured single-resource intent for one decoded URL. This is
 * the user's structured intent INPUT only — nothing is routed until the
 * canonical confirmation interaction confirms it.
 */
export function singleResourceUrlIntent(url: string): DomainValidationResult<DesktopIntentInput> {
  const targetId = makeLogicalTargetId(url);
  if (!targetId.ok) {
    return targetId;
  }
  return {
    ok: true,
    value: {
      targetRef: url,
      intentType: 'SINGLE_RESOURCE',
      requestedScope: { kind: 'single_resource', targetId: targetId.value },
      continuationScope: { kind: 'NONE' },
      automationMode: 'ASSISTED',
      authorizationContextRef: DESKTOP_LOCAL_AUTHORIZATION_CONTEXT_REF,
    },
  };
}

/** One manager job row: pure projection of one lineage's Core facts. */
export interface ManagerJobRow {
  /** Opaque Core lineage/contract identity (never a URL or path). */
  readonly lineageId: string;
  /** The seam lane this row is read from (v0.2.1 desktop adds are legacy). */
  readonly lane: 'legacy';
  /**
   * True when a Core projection was read for this lineage. False rows render
   * the truthful "no projection available" state — never a guessed status.
   */
  readonly present: boolean;
  /** Verbatim contract status word, or null when no projection exists. */
  readonly contractStatus: string | null;
  /** Verbatim aggregate revision, or null when no projection exists. */
  readonly revision: number | null;
  /** Verbatim lineage status word, or null when no projection exists. */
  readonly lineageStatus: string | null;
  /** Projected selected-member count; null when Core does not expose it. */
  readonly selectedMemberCount: number | null;
  /** Projected failed-member count; null when no projection exists. */
  readonly failedMemberCount: number | null;
  /** Projected retried-member identities (verbatim; may be empty). */
  readonly retriedMemberIds: readonly string[];
  /** The projected terminal result, all six dimensions verbatim; else null. */
  readonly terminal: ManagerTerminalSummary | null;
  /** Retry availability hint derived ONLY from the projected facts above. */
  readonly retry: { readonly available: boolean; readonly reason: string | null };
  /**
   * Whether the user-chosen destination for this row is known to the shell
   * (session-scoped locator for reveal; never a Core fact, never fabricated
   * into any Core payload).
   */
  readonly destination: string | null;
}

/** All six terminal dimensions rendered verbatim (no success boolean). */
export interface ManagerTerminalSummary {
  readonly requestFulfillment: string;
  readonly targetResolution: string;
  readonly selectionAcquisition: string;
  readonly coverage: string;
  readonly stopReason: string;
  readonly validationSummary: {
    readonly status: string;
    readonly passedCount: number;
    readonly failedCount: number;
  };
  readonly recordedAt: string;
}

/**
 * Project one legacy seam projection view into a manager row. `view === null`
 * (no projection read, e.g. Core unreachable or lineage unknown to Core)
 * renders the truthful absent state; nothing is invented for it.
 */
export function projectLegacyJobRow(input: {
  readonly lineageId: string;
  readonly view: SeamProjectionView | null;
  readonly destination: string | null;
}): ManagerJobRow {
  const view = input.view;
  if (view === null) {
    return {
      lineageId: input.lineageId,
      lane: 'legacy',
      present: false,
      contractStatus: null,
      revision: null,
      lineageStatus: null,
      selectedMemberCount: null,
      failedMemberCount: null,
      retriedMemberIds: [],
      terminal: null,
      retry: { available: false, reason: 'NO_CORE_PROJECTION_AVAILABLE' },
      destination: input.destination,
    };
  }
  const terminal = view.terminal === undefined ? null : { ...terminalSummary(view.terminal) };
  const retryDomain = deriveRetryDomain({
    selectedMemberIds: view.snapshot?.selectedMemberIds ?? [],
    retriedMemberIds: view.lineage.retriedMemberIds,
    failedMemberCount: view.lineage.failedMemberCount,
  });
  return {
    lineageId: input.lineageId,
    lane: 'legacy',
    present: true,
    contractStatus: view.contract.status,
    revision: view.contract.revision,
    lineageStatus: view.lineage.status,
    selectedMemberCount: view.selectedMemberCount ?? null,
    failedMemberCount: view.lineage.failedMemberCount,
    retriedMemberIds: [...view.lineage.retriedMemberIds],
    terminal,
    retry:
      retryDomain.kind === 'DETERMINED'
        ? { available: true, reason: null }
        : { available: false, reason: retryDomain.reason },
    destination: input.destination,
  };
}

/** Verbatim six-dimension summary of a projected terminal result. */
function terminalSummary(
  terminal: NonNullable<SeamProjectionView['terminal']>,
): ManagerTerminalSummary {
  return {
    requestFulfillment: terminal.requestFulfillment,
    targetResolution: terminal.targetResolution,
    selectionAcquisition: terminal.selectionAcquisition,
    coverage: terminal.coverage,
    stopReason: terminal.stopReason,
    validationSummary: {
      status: terminal.validationSummary.status,
      passedCount: terminal.validationSummary.passedCount,
      failedCount: terminal.validationSummary.failedCount,
    },
    recordedAt: terminal.recordedAt,
  };
}

/**
 * Whether the projected row state justifies OFFERING the reveal action.
 * Presentation hint only: the shell main re-reads a FRESH projection and
 * re-decides authoritatively when reveal is actually invoked.
 */
export function revealHintFor(row: ManagerJobRow): boolean {
  return (
    row.present &&
    row.terminal !== null &&
    row.terminal.requestFulfillment === 'COMPLETE' &&
    row.destination !== null
  );
}
