/**
 * v0.2 T01 — C Operation identities, route-table grammar and the external
 * effect envelope contract (frozen L2 A05: `accepted`/`running` are not
 * terminal; only a typed terminal outcome settles an effect).
 *
 * Pure additive contract layer; owns no runtime dispatch, no permit logic and
 * no Host ports. The selected Kernel consumes the sealed declaration data.
 */
import {
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { SHA256_PATTERN, validateArtifactPath } from './intent.ts';

/** The v0.2 C operation vocabulary (frozen; extended only by L2 amendment). */
export const DOWNLOAD_OPERATIONS = ['acquisition.acquire', 'media.acquire'] as const;
export type DownloadOperationId = (typeof DOWNLOAD_OPERATIONS)[number];

export type EffectClass = 'none' | 'idempotent' | 'non-idempotent';

/** Sealed C operation declaration (mirrors the BUILD capability binding). */
export interface OperationDeclaration {
  readonly operationId: string;
  readonly capabilityId: string;
  readonly handlerId: string;
  readonly effectClass: EffectClass;
  readonly externalEffect: boolean;
}

/** Route row binding a sealed intent type to a declared C operation. */
export interface OperationRouteRow {
  readonly intentId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly handlerId: string;
}

/**
 * Validate a route table against the sealed declarations. A route naming an
 * undeclared capability/handler/operation is a binding mismatch and refuses
 * before anything can dispatch.
 */
export function validateRouteTable(
  routes: readonly OperationRouteRow[],
  declarations: readonly OperationDeclaration[],
): DomainValidationResult<readonly OperationRouteRow[]> {
  if (!Array.isArray(routes) || routes.length === 0) {
    return fail([diagnostic('CONTRACT_BINDING_MISMATCH', 'routes', 'route table must be a non-empty array')]);
  }
  const declared = new Map(declarations.map((d) => [d.operationId, d]));
  for (const row of routes) {
    if (
      typeof row !== 'object' ||
      row === null ||
      typeof row.intentId !== 'string' ||
      typeof row.operationId !== 'string' ||
      typeof row.capabilityId !== 'string' ||
      typeof row.handlerId !== 'string' ||
      row.intentId.length === 0 ||
      row.operationId.length === 0 ||
      row.capabilityId.length === 0 ||
      row.handlerId.length === 0
    ) {
      return fail([
        diagnostic('CONTRACT_BINDING_MISMATCH', 'routes', 'every route row needs bounded intent/operation/capability/handler ids'),
      ]);
    }
    if (!DOWNLOAD_OPERATIONS.includes(row.operationId as DownloadOperationId)) {
      return fail([
        diagnostic(
          'CONTRACT_BINDING_MISMATCH',
          'routes',
          `route names operation ${row.operationId} outside the frozen v0.2 operation vocabulary`,
        ),
      ]);
    }
    const declaration = declared.get(row.operationId);
    if (declaration === undefined) {
      return fail([
        diagnostic(
          'CONTRACT_BINDING_MISMATCH',
          'routes',
          `route intent ${row.intentId} names capability ${row.capabilityId} which is not sealed in this composition`,
        ),
      ]);
    }
    if (
      declaration.capabilityId !== row.capabilityId ||
      declaration.handlerId !== row.handlerId
    ) {
      return fail([
        diagnostic(
          'CONTRACT_BINDING_MISMATCH',
          'routes',
          `route for ${row.operationId} does not match the sealed capability/handler binding`,
        ),
      ]);
    }
  }
  return ok([...routes]);
}

/** Typed phase grammar returned by every external effect adapter (A05). */
export type EffectEnvelope =
  | { readonly phase: 'accepted'; readonly externalRef: string }
  | { readonly phase: 'running'; readonly externalRef: string }
  | {
      readonly phase: 'terminal';
      readonly externalRef: string;
      readonly outcome: { readonly ok: true; readonly output: Record<string, unknown> } | {
        readonly ok: false;
        readonly error: { readonly code: string; readonly message: string };
      };
    };

/**
 * Normalize an unknown adapter return into the envelope grammar. Pending
 * phases carry no outcome (a fake accepted/running ACK can never become
 * success); terminal outcomes must be exactly typed.
 */
export function normalizeEffectEnvelope(raw: unknown): DomainValidationResult<EffectEnvelope> {
  if (typeof raw !== 'object' || raw === null) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'envelope', 'effect envelope must be a plain object')]);
  }
  const record = raw as Record<string, unknown>;
  const externalRef = record.externalRef;
  if (typeof externalRef !== 'string' || externalRef.length === 0) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'externalRef', 'envelope requires a bounded externalRef')]);
  }
  if (record.phase === 'accepted' || record.phase === 'running') {
    return ok({ phase: record.phase, externalRef } as EffectEnvelope);
  }
  if (record.phase !== 'terminal') {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'phase', "phase must be 'accepted' | 'running' | 'terminal'")]);
  }
  const outcome = record.outcome;
  if (typeof outcome !== 'object' || outcome === null) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'outcome', 'terminal envelope requires an outcome record')]);
  }
  const outcomeRecord = outcome as Record<string, unknown>;
  if (outcomeRecord.ok === true) {
    const output = outcomeRecord.output;
    if (typeof output !== 'object' || output === null) {
      return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'outcome.output', 'ok terminal outcome carries a plain output record')]);
    }
    return ok({ phase: 'terminal', externalRef, outcome: { ok: true, output: output as Record<string, unknown> } });
  }
  if (outcomeRecord.ok !== false) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'outcome.ok', 'terminal outcome.ok must be boolean')]);
  }
  const error = outcomeRecord.error;
  if (
    typeof error !== 'object' ||
    error === null ||
    typeof (error as Record<string, unknown>).code !== 'string' ||
    typeof (error as Record<string, unknown>).message !== 'string'
  ) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outcome.error', 'failed terminal outcome carries a typed {code, message} error'),
    ]);
  }
  const errorRecord = error as { code: string; message: string };
  return ok({
    phase: 'terminal',
    externalRef,
    outcome: { ok: false, error: { code: errorRecord.code, message: errorRecord.message } },
  });
}

/** Bounded materialized-artifact evidence returned by a trusted Host writer. */
export interface MaterializedEvidence {
  readonly fileSha256: string;
  readonly bytesWritten: number;
  readonly artifactPath: string;
  readonly stopReason: string;
}

/**
 * Validate materialized evidence against the confirmed root and digest
 * grammar: digest must be lowercase 64-hex, bytes a positive safe integer,
 * and the path must stay inside the authorized root.
 */
export function validateMaterializedEvidence(
  evidence: unknown,
  outputRootScope: string,
): DomainValidationResult<MaterializedEvidence> {
  if (typeof evidence !== 'object' || evidence === null) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'evidence', 'materialized evidence must be a plain object')]);
  }
  const record = evidence as Record<string, unknown>;
  const fileSha256 = record.fileSha256;
  if (typeof fileSha256 !== 'string' || !SHA256_PATTERN.test(fileSha256)) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'fileSha256', 'fileSha256 must be lowercase 64-hex')]);
  }
  const bytesWritten = record.bytesWritten;
  if (typeof bytesWritten !== 'number' || !Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'bytesWritten', 'bytesWritten must be a positive safe integer')]);
  }
  const stopReason = record.stopReason;
  if (typeof stopReason !== 'string' || stopReason.length === 0 || stopReason.length > 64) {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'stopReason', 'stopReason must be a bounded terminal token')]);
  }
  const pathCheck = validateArtifactPath(outputRootScope, typeof record.artifactPath === 'string' ? record.artifactPath : '');
  if (!pathCheck.ok) return pathCheck;
  return ok({ fileSha256, bytesWritten, artifactPath: pathCheck.value, stopReason });
}
