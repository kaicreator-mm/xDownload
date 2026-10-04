/**
 * T010 scoped authorization capability (frozen L2 invariant 12/13, ADR-005,
 * PRD §17/§29).
 *
 * A broker-side capability is an exact binding record:
 * (origin, target, contract, snapshot, provenance[, partition]) + expiry +
 * revocation state + the confirmed requested-scope key, mapped to exactly one
 * opaque `AuthorizationContextRef`. The ref is the only thing that ever
 * leaves the broker; raw reusable secret material is never part of a
 * capability record and never serialized (the v0.1.0 broker stores binding
 * and lifecycle state only — session material remains in the browser context,
 * recorded F1 choice).
 *
 * Successor binding rule (EXECUTION_CONTRACT): any semantic change to the
 * bound tuple — new contract/snapshot identity, changed provenance chain,
 * changed partition — requires a new issue decision bound to the successor
 * identity. Capabilities are never silently re-bound in place.
 */

import {
  makeAuthorizationContextRef,
  type AuthorizationContextRef,
} from '@xdownload/domain-contracts';
import {
  brokerDiagnostic,
  brokerFail,
  brokerOk,
  type BrokerDiagnostic,
  type BrokerResult,
} from './result.ts';

/** Partition context: binding context where browser state is partition-aware. */
export type PartitionContext = string | undefined;

export interface CapabilityBinding {
  /** Exact observed origin the capability is bound to. */
  readonly origin: string;
  /** Exact logical target identity (branded `LogicalTargetId`). */
  readonly target: string;
  /** Exact contract identity (branded `ContractId`). */
  readonly contract: string;
  /** Exact snapshot identity (branded `SnapshotId`). */
  readonly snapshot: string;
  /** Exact observation provenance chain identity. */
  readonly provenanceChain: string;
  /** Partition context when the browser state is partition-aware. */
  readonly partition: PartitionContext;
  /** Identity key of the confirmed requested scope at issue time (never rewritten). */
  readonly requestedScopeKey: string;
}

export interface IssueRequest {
  readonly binding: CapabilityBinding;
  /** Positive time-to-live in milliseconds; expiry is mandatory (least authority). */
  readonly ttlMs: number;
  /**
   * Explicit issue decision token. Issuing is an authorized decision (user
   * confirmation / explicit re-issue decision) — never an internal recovery
   * step. The broker rejects issue attempts without a decision token.
   */
  readonly issueDecisionToken: string;
}

export interface CapabilityView {
  /** Opaque reference; the only capability identity that ever leaves the broker. */
  readonly ref: AuthorizationContextRef;
  readonly binding: CapabilityBinding;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

/** Broker-internal record: same fields as the view plus lifecycle state. Never serialized with anything secret-bearing. */
export interface BrokerCapabilityRecord {
  readonly ref: AuthorizationContextRef;
  readonly binding: CapabilityBinding;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly revoked: boolean;
}

export interface Clock {
  readonly nowMs: () => number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

const BINDING_KEYS: readonly string[] = [
  'origin',
  'target',
  'contract',
  'snapshot',
  'provenanceChain',
  'partition',
  'requestedScopeKey',
] as const;

/** Structural decode of an issue binding from (privileged but untrusted-shape) input. */
export function decodeCapabilityBinding(value: unknown): BrokerResult<CapabilityBinding> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return brokerFail([
      brokerDiagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'binding',
        'capability binding must be an object',
      ),
    ]);
  }
  const record = value as Record<string, unknown>;
  const diagnostics: BrokerDiagnostic[] = [];
  for (const key of Object.keys(record)) {
    if (!BINDING_KEYS.includes(key)) {
      diagnostics.push(
        brokerDiagnostic(
          'UNKNOWN_FIELD',
          `binding.${key}`,
          'unknown field at the capability binding boundary; fail closed',
          'L2-inv13',
        ),
      );
    }
  }
  const required: ReadonlyArray<readonly [string, unknown]> = [
    ['origin', record['origin']],
    ['target', record['target']],
    ['contract', record['contract']],
    ['snapshot', record['snapshot']],
    ['provenanceChain', record['provenanceChain']],
    ['requestedScopeKey', record['requestedScopeKey']],
  ];
  for (const [key, field] of required) {
    if (typeof field !== 'string' || field.length === 0) {
      diagnostics.push(
        brokerDiagnostic(
          'MISSING_REQUIRED_FIELD',
          `binding.${key}`,
          'exact binding requires this field as a non-empty string',
          'L2-inv13',
        ),
      );
    }
  }
  const partition = record['partition'];
  if (partition !== undefined && (typeof partition !== 'string' || partition.length === 0)) {
    diagnostics.push(
      brokerDiagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'binding.partition',
        'partition context must be a non-empty string when present',
        'L2-inv13',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return brokerFail(diagnostics);
  }
  const binding: CapabilityBinding = {
    origin: record['origin'] as string,
    target: record['target'] as string,
    contract: record['contract'] as string,
    snapshot: record['snapshot'] as string,
    provenanceChain: record['provenanceChain'] as string,
    partition: partition as PartitionContext,
    requestedScopeKey: record['requestedScopeKey'] as string,
  };
  return brokerOk(Object.freeze(binding));
}

/** Deep, exact binding comparison; any single-field difference is a mismatch. */
export function bindingsExactMatch(a: CapabilityBinding, b: CapabilityBinding): boolean {
  return (
    a.origin === b.origin &&
    a.target === b.target &&
    a.contract === b.contract &&
    a.snapshot === b.snapshot &&
    a.provenanceChain === b.provenanceChain &&
    a.partition === b.partition &&
    a.requestedScopeKey === b.requestedScopeKey
  );
}

/** Per-field mismatch labels for the binding matrix diagnostics. */
export function bindingMismatchField(
  a: CapabilityBinding,
  b: CapabilityBinding,
): string | undefined {
  if (a.origin !== b.origin) return 'origin';
  if (a.target !== b.target) return 'target';
  if (a.contract !== b.contract) return 'contract';
  if (a.snapshot !== b.snapshot) return 'snapshot';
  if (a.provenanceChain !== b.provenanceChain) return 'provenanceChain';
  if (a.partition !== b.partition) return 'partition';
  if (a.requestedScopeKey !== b.requestedScopeKey) return 'requestedScopeKey';
  return undefined;
}

/** Project the truthful status of a record at a point in time. */
export function capabilityStatus(
  record: BrokerCapabilityRecord,
  nowMs: number,
): CapabilityView['status'] {
  if (record.revoked) {
    return 'REVOKED';
  }
  return nowMs >= record.expiresAtMs ? 'EXPIRED' : 'ACTIVE';
}

/** Allocate a fresh opaque AuthorizationContextRef (broker-local uniqueness). */
export function allocateAuthorizationContextRef(
  brokerScope: string,
  seq: number,
  nowMs: number,
): BrokerResult<AuthorizationContextRef> {
  return makeAuthorizationContextRef(`${brokerScope}/${seq.toString(36)}@${nowMs.toString(36)}`);
}
