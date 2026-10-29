/**
 * T011 finite capability vocabulary (PRD §14, L2 §6.6 / ADR-007).
 *
 * Capabilities are enumerated, typed and auditable. The vocabulary is exactly
 * the PRD §14 allowed-tool class: observing the current page/network/player/
 * frames, collecting candidates, scrolling the current page, opening a
 * confirmed member detail and following a declared collection continuation.
 *
 * A capability is never implicit scope authority: `scroll_current_page` may
 * only be planned when the confirmed contract carries a matching explicit
 * continuation scope, and every planned capability stays traceable to the
 * confirmed AcquisitionContract. No capability expresses arbitrary shell,
 * unrestricted JS/filesystem access, cookie/token export, host scanning or
 * recursive navigation — unknown/undeclared capabilities fail closed.
 */

import {
  asRecord,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  requireArrayOfStrings,
  requireLiteral,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from '@xdownload/domain-contracts';

/** The finite PRD §14 capability vocabulary; allowlist-only, never a blocklist. */
export const CAPABILITY_KINDS = [
  'observe_current_page',
  'observe_network',
  'observe_player',
  'observe_frames',
  'collect_candidates',
  'scroll_current_page',
  'open_confirmed_member_detail',
  'follow_declared_collection_continuation',
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CAPABILITY_KIND_LIST: readonly string[] = CAPABILITY_KINDS;

/** Passive observation capabilities; they never navigate and never add members. */
const PASSIVE_CAPABILITIES: readonly CapabilityKind[] = [
  'observe_current_page',
  'observe_network',
  'observe_player',
  'observe_frames',
  'collect_candidates',
];

export function isPassiveCapability(kind: CapabilityKind): boolean {
  return PASSIVE_CAPABILITIES.includes(kind);
}

/**
 * A planned capability. Each capability carries only its declared parameters:
 * continuation capabilities carry the frozen continuation scope they are
 * bound to; member-detail navigation carries the already-frozen member
 * identity it opens (PRD §14: every active navigation is traceable to the
 * confirmed contract).
 */
export type PlannedCapability =
  | { readonly kind: 'observe_current_page' }
  | { readonly kind: 'observe_network' }
  | { readonly kind: 'observe_player' }
  | { readonly kind: 'observe_frames' }
  | { readonly kind: 'collect_candidates' }
  | {
      readonly kind: 'scroll_current_page';
      readonly continuationScopeKind: 'DECLARED_BATCH_COUNT' | 'DECLARED_NATURAL_END';
    }
  | { readonly kind: 'open_confirmed_member_detail'; readonly memberId: string }
  | {
      readonly kind: 'follow_declared_collection_continuation';
      readonly continuationScopeKind: 'DECLARED_BATCH_COUNT' | 'DECLARED_NATURAL_END';
    };

/**
 * Decode a capability list from untrusted input. Any capability outside the
 * finite vocabulary — including anything resembling shell execution,
 * scripting, filesystem access, cookie/token export, host scanning or
 * recursive/crawl navigation — fails closed (ADR-007).
 */
export function decodeCapabilityList(
  value: unknown,
  path: string,
): DomainValidationResult<readonly CapabilityKind[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || !Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', path, 'capability list must be an array of strings'),
    ]);
  }
  const raws = unwrap(requireArrayOfStrings({ value }, 'value', path), diagnostics);
  if (raws === undefined) {
    return fail(diagnostics);
  }
  const capabilities: CapabilityKind[] = [];
  for (const raw of raws) {
    if (typeof raw !== 'string' || !CAPABILITY_KINDS.includes(raw as CapabilityKind)) {
      diagnostics.push(
        diagnostic(
          'UNKNOWN_ENUM_VALUE',
          `${path}[]`,
          `unknown capability '${String(raw)}'; the capability vocabulary is finite and allowlist-only, and cannot express shell/scripting/filesystem/cookie-export/host-scan/recursive navigation`,
          'ADR-007',
        ),
      );
      continue;
    }
    const kind = raw as CapabilityKind;
    if (!capabilities.includes(kind)) {
      capabilities.push(kind);
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(capabilities));
}

/**
 * Decode a raw capability-plan record (untrusted) into planned capabilities.
 * Each entry must be an object with a `kind` from the finite vocabulary and
 * exactly the declared parameters of that kind; anything else fails closed.
 * Member-detail entries are only valid for members of the frozen confirmed
 * membership (`frozenMemberIds`).
 */
export function decodePlannedCapabilities(
  value: unknown,
  frozenMemberIds: readonly string[],
): DomainValidationResult<readonly PlannedCapability[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  if (typeof value !== 'object' || value === null || !Array.isArray(value)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'capabilityPlan', 'capability plan must be an array'),
    ]);
  }
  const frozen = new Set(frozenMemberIds);
  const planned: PlannedCapability[] = [];
  for (const entry of value) {
    const record = unwrap(asRecord(entry, 'capabilityPlan[]'), diagnostics);
    if (record === undefined) {
      continue;
    }
    const kind = record['kind'];
    if (typeof kind !== 'string' || !CAPABILITY_KINDS.includes(kind as CapabilityKind)) {
      diagnostics.push(
        diagnostic(
          'UNKNOWN_ENUM_VALUE',
          'capabilityPlan[].kind',
          `unknown capability '${String(kind)}'; the capability vocabulary is finite and allowlist-only, and cannot express shell/scripting/filesystem/cookie-export/host-scan/recursive navigation`,
          'ADR-007',
        ),
      );
      continue;
    }
    const plannedCapability = unwrap(
      decodePlannedEntry(record, kind as CapabilityKind, frozen),
      diagnostics,
    );
    if (plannedCapability !== undefined) {
      planned.push(plannedCapability);
    }
  }
  if (diagnostics.length > 0) {
    return fail(diagnostics);
  }
  return ok(deepFreeze(planned));
}

const PLANNED_KEYS: Readonly<Record<CapabilityKind, readonly string[]>> = Object.freeze({
  observe_current_page: ['kind'],
  observe_network: ['kind'],
  observe_player: ['kind'],
  observe_frames: ['kind'],
  collect_candidates: ['kind'],
  scroll_current_page: ['kind', 'continuationScopeKind'],
  open_confirmed_member_detail: ['kind', 'memberId'],
  follow_declared_collection_continuation: ['kind', 'continuationScopeKind'],
});

function decodePlannedEntry(
  record: Record<string, unknown>,
  kind: CapabilityKind,
  frozenMemberIds: ReadonlySet<string>,
): DomainValidationResult<PlannedCapability> {
  const diagnostics: ValidationDiagnostic[] = [];
  const known = PLANNED_KEYS[kind]!;
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    diagnostics.push(
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        `capabilityPlan.${kind}`,
        `capability '${kind}' carries undeclared parameters (${unknown.join(', ')}); capabilities carry only their declared parameters`,
        'ADR-007',
      ),
    );
    return fail(diagnostics);
  }
  switch (kind) {
    case 'observe_current_page':
    case 'observe_network':
    case 'observe_player':
    case 'observe_frames':
    case 'collect_candidates':
      return ok(deepFreeze({ kind } as PlannedCapability));
    case 'scroll_current_page':
    case 'follow_declared_collection_continuation': {
      const scopeKind = unwrap(
        requireLiteral(
          record,
          'continuationScopeKind',
          ['DECLARED_BATCH_COUNT', 'DECLARED_NATURAL_END'] as const,
          `capabilityPlan.${kind}`,
        ),
        diagnostics,
      );
      if (scopeKind === undefined) {
        return fail(diagnostics);
      }
      return ok(
        deepFreeze(
          kind === 'scroll_current_page'
            ? { kind, continuationScopeKind: scopeKind }
            : { kind, continuationScopeKind: scopeKind },
        ),
      );
    }
    case 'open_confirmed_member_detail': {
      const memberId = record['memberId'];
      if (typeof memberId !== 'string' || memberId.length === 0) {
        diagnostics.push(
          diagnostic(
            'MALFORMED_REQUIRED_FIELD',
            'capabilityPlan.open_confirmed_member_detail.memberId',
            'member-detail navigation must carry the member identity it opens',
          ),
        );
        return fail(diagnostics);
      }
      if (!frozenMemberIds.has(memberId)) {
        diagnostics.push(
          diagnostic(
            'ADMISSION_REJECTED',
            'capabilityPlan.open_confirmed_member_detail.memberId',
            `member '${memberId}' is not part of the frozen confirmed membership; detail navigation exists only for frozen members`,
            'PRD-§14',
          ),
        );
        return fail(diagnostics);
      }
      return ok(deepFreeze({ kind, memberId }));
    }
    default:
      return fail([diagnostic('UNKNOWN_ENUM_VALUE', 'capabilityPlan[].kind', 'unreachable')]);
  }
}

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}
