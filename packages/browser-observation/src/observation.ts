/**
 * T010 provenance-bound observation record and its handoff into the
 * privileged extension context (frozen L2 §6.4).
 *
 * An observation is a provenance-bound evidence input. It is never direct
 * authority: privileged use requires a broker-issued capability with exact
 * binding, and observation-derived evidence can never self-certify a claim
 * (frozen L2 invariants 5/6).
 */

import { bDiagnostic, bFail, bOk, type BrowserResult } from './result.ts';
import { type ObservationKind, type ObservationMessage } from './messageGate.ts';
import type { ObservationProvenance } from './provenance.ts';

/** Evidence-input marker: carried on every observation so no consumer can mistake it for authority. */
export const OBSERVATION_AUTHORITY_MARKER = 'EVIDENCE_INPUT_ONLY' as const;

export interface ObservationRecord {
  readonly observationId: string;
  readonly kind: ObservationKind;
  readonly provenance: ObservationProvenance;
  readonly payload: Readonly<Record<string, string>>;
  readonly capturedAtMs: number;
  readonly authority: typeof OBSERVATION_AUTHORITY_MARKER;
}

export interface RecordObservationOptions {
  readonly observationId: string;
  readonly capturedAtMs: number;
}

/**
 * Turn an already-gated untrusted message into an observation record.
 * Records are frozen: observation semantics cannot be mutated in place.
 */
export function recordObservation(
  message: ObservationMessage,
  options: RecordObservationOptions,
): BrowserResult<ObservationRecord> {
  if (message.boundary !== 'CONTENT_SCRIPT') {
    return bFail([
      bDiagnostic('OBSERVATION_MALFORMED', 'observation', 'observation requires a gated message'),
    ]);
  }
  const record: ObservationRecord = {
    observationId: options.observationId,
    kind: message.kind,
    provenance: message.provenance,
    payload: message.payload,
    capturedAtMs: options.capturedAtMs,
    authority: OBSERVATION_AUTHORITY_MARKER,
  };
  return bOk(Object.freeze(record));
}

/** Stable provenance identity for evidence binding and dedup. */
export function observationProvenanceKey(record: ObservationRecord): string {
  const p = record.provenance;
  const request = p.requestRef === undefined ? '-' : p.requestRef;
  const partition = p.partition === undefined ? '-' : p.partition;
  return `${p.tabId}/${p.frameId}/${p.origin}/${request}/${partition}`;
}
