/**
 * T010 authorization broker: issue / use / revoke / inspect with truthful
 * expiry semantics (frozen L2 invariants 11–14, PRD §16.5/§17/§29).
 *
 * Fail-closed discipline enforced here:
 * - issuance requires an explicit decision token; there is no internal
 *   automatic re-issue on expiry (the classic false-success trap);
 * - `use` accepts only an exact (origin, target, contract, snapshot,
 *   provenance, partition, scope) match — never nearest-match;
 * - expiry yields AUTH_REQUIRED, revocation and binding mismatches yield
 *   AUTH_FAILED — never silent scope/target widening;
 * - only the opaque AuthorizationContextRef is ever returned; recorded
 *   evidence is never retroactively rewritten by revocation.
 */

import { bindingsExactMatch, bindingMismatchField, decodeCapabilityBinding } from './capability.ts';
import {
  allocateAuthorizationContextRef,
  capabilityStatus,
  systemClock,
  type BrokerCapabilityRecord,
  type CapabilityBinding,
  type CapabilityView,
  type Clock,
  type IssueRequest,
} from './capability.ts';
import {
  brokerDiagnostic,
  brokerFail,
  brokerOk,
  type AuthUseOutcome,
  type BrokerDiagnostic,
  type BrokerResult,
} from './result.ts';

export interface UseRequest {
  /** Opaque reference handed out at issue time. */
  readonly ref: string;
  /** The exact current binding tuple the privileged use claims. */
  readonly binding: CapabilityBinding;
}

export interface BrokerOptions {
  readonly clock?: Clock;
  /** Broker scope used to namespace issued refs. */
  readonly brokerScope?: string;
}

export interface AuthBroker {
  /** Issue a new capability from an explicit authorized decision. */
  issue(request: IssueRequest): BrokerResult<CapabilityView>;
  /** Attempt a privileged authorization use against the exact current tuple. */
  use(request: UseRequest): AuthUseOutcome;
  /** Revoke a capability; later uses fail while recorded history stays intact. */
  revoke(ref: string): BrokerResult<'REVOKED'>;
  /** Truthful point-in-time status (no secret material). */
  inspect(ref: string): BrokerResult<CapabilityView>;
}

const DECISION_TOKEN_PATTERN =
  /^user-confirm:[A-Za-z0-9._:@/-]{1,128}$|^explicit-reissue:[A-Za-z0-9._:@/-]{1,128}$/;

export function createAuthBroker(options: BrokerOptions = {}): AuthBroker {
  const clock = options.clock ?? systemClock;
  const brokerScope = options.brokerScope ?? 'authctx/local';
  const records = new Map<string, BrokerCapabilityRecord>();
  let seq = 0;

  function view(record: BrokerCapabilityRecord): CapabilityView {
    return {
      ref: record.ref,
      binding: record.binding,
      issuedAtMs: record.issuedAtMs,
      expiresAtMs: record.expiresAtMs,
      status: capabilityStatus(record, clock.nowMs()),
    };
  }

  return {
    issue(request) {
      const binding = decodeCapabilityBinding(request.binding);
      if (!binding.ok) {
        return brokerFail(binding.diagnostics);
      }
      if (
        typeof request.ttlMs !== 'number' ||
        !Number.isFinite(request.ttlMs) ||
        request.ttlMs <= 0
      ) {
        return brokerFail([
          brokerDiagnostic(
            'MALFORMED_REQUIRED_FIELD',
            'ttlMs',
            'capability time-to-live must be a positive finite number (expiry is mandatory)',
            'L2-inv12',
          ),
        ]);
      }
      if (
        typeof request.issueDecisionToken !== 'string' ||
        !DECISION_TOKEN_PATTERN.test(request.issueDecisionToken)
      ) {
        return brokerFail([
          brokerDiagnostic(
            'ISSUE_DECISION_REQUIRED',
            'issueDecisionToken',
            'issuing a capability requires an explicit user-confirmation or explicit-reissue decision; no internal automatic issue exists',
            'L2-inv12',
          ),
        ]);
      }
      const nowMs = clock.nowMs();
      const ref = allocateAuthorizationContextRef(brokerScope, seq, nowMs);
      if (!ref.ok) {
        return brokerFail(ref.diagnostics);
      }
      seq += 1;
      const record: BrokerCapabilityRecord = {
        ref: ref.value,
        binding: binding.value,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + request.ttlMs,
        revoked: false,
      };
      records.set(ref.value, record);
      return brokerOk(view(record));
    },

    use(request) {
      const decoded = decodeCapabilityBinding(request.binding);
      if (!decoded.ok) {
        return {
          outcome: 'AUTH_FAILED',
          reasons: decoded.diagnostics,
        };
      }
      const record = records.get(request.ref);
      if (record === undefined) {
        return {
          outcome: 'AUTH_FAILED',
          reasons: [
            brokerDiagnostic(
              'CAPABILITY_UNKNOWN',
              'ref',
              'no capability is registered under this AuthorizationContextRef',
              'L2-inv12',
            ),
          ],
        };
      }
      const nowMs = clock.nowMs();
      if (record.revoked) {
        return {
          outcome: 'AUTH_FAILED',
          reasons: [
            brokerDiagnostic(
              'CAPABILITY_REVOKED',
              'ref',
              'this capability has been revoked and is refused for later uses',
              'L2-inv13',
            ),
          ],
        };
      }
      if (nowMs >= record.expiresAtMs) {
        return {
          outcome: 'AUTH_REQUIRED',
          reasons: [
            brokerDiagnostic(
              'CAPABILITY_EXPIRED',
              'ref',
              'the capability has expired; current authorization is insufficient and an explicit new issue decision is required',
              'L2-inv13',
            ),
          ],
        };
      }
      if (!bindingsExactMatch(record.binding, decoded.value)) {
        const reasons: BrokerDiagnostic[] = [
          bindingViolationDiagnostic(record.binding, decoded.value),
        ];
        return { outcome: 'AUTH_FAILED', reasons };
      }
      return { outcome: 'AUTH_GRANTED', ref: record.ref };
    },

    revoke(ref) {
      const record = records.get(ref);
      if (record === undefined) {
        return brokerFail([
          brokerDiagnostic(
            'CAPABILITY_UNKNOWN',
            'ref',
            'no capability is registered under this ref',
          ),
        ]);
      }
      if (!record.revoked) {
        // Revocation is effective for later uses only; recorded evidence and
        // previously projected results are never retroactively rewritten.
        records.set(ref, { ...record, revoked: true });
      }
      return brokerOk('REVOKED' as const);
    },

    inspect(ref) {
      const record = records.get(ref);
      if (record === undefined) {
        return brokerFail([
          brokerDiagnostic(
            'CAPABILITY_UNKNOWN',
            'ref',
            'no capability is registered under this ref',
          ),
        ]);
      }
      return brokerOk(view(record));
    },
  };
}

function bindingViolationDiagnostic(
  bound: CapabilityBinding,
  claimed: CapabilityBinding,
): BrokerDiagnostic {
  const field = bindingMismatchField(bound, claimed);
  if (field === 'requestedScopeKey') {
    return brokerDiagnostic(
      'SCOPE_BINDING_MISMATCH',
      'binding.requestedScopeKey',
      'the confirmed requested scope recorded at issue time is never redefined, enlarged, narrowed or silently rewritten; a different scope requires a successor contract/snapshot and a new issue decision',
      'PRD-§17',
    );
  }
  if (field === 'partition' && bound.partition !== undefined && claimed.partition === undefined) {
    return brokerDiagnostic(
      'PARTITION_CONTEXT_STRIPPED',
      'binding.partition',
      'the capability is bound to a partition-aware browser context and the use attempt carries no partition; partition-stripped reuse fails closed',
      'L2-inv13',
    );
  }
  return brokerDiagnostic(
    'AUTH_BINDING_VIOLATED',
    `binding.${field ?? 'tuple'}`,
    `capability is bound to a different ${field ?? 'tuple'}; cross-origin/unbound/wrong-partition/cross-contract/cross-snapshot reuse fails closed`,
    'L2-inv13',
  );
}
