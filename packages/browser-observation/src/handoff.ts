/**
 * T010 observation handoff (frozen L2 §6.4, PRD §29).
 *
 * Hands observations to Core contracts as provenance-bound evidence inputs
 * without granting page/content privilege. Two rules bind every handoff:
 *
 * 1. Provenance must be complete — an unprovenanced observation can never be
 *    promoted into a handoff at all (fail closed).
 * 2. The handoff envelope passes the exit-sink redactor: raw secret material
 *    is replaced with redaction markers before anything leaves the
 *    browser/broker secret zone toward Core-durable sinks (PRD §29, C21).
 *
 * The envelope carries canonical vocabulary only (an optional opaque
 * AuthorizationContextRef); the semantic typing of the observation into a
 * canonical EvidenceRecord claim remains Core's decision at integration.
 */

import { evidenceRecord, makeEvidenceId, type EvidenceRecord } from '@xdownload/domain-contracts';
import { bDiagnostic, bFail, bOk, type BrowserDiagnostic, type BrowserResult } from './result.ts';
import { redactForSink } from './sinkRedaction.ts';
import { observationProvenanceKey, type ObservationRecord } from './observation.ts';

export interface ObservationHandoff {
  readonly kind: ObservationRecord['kind'];
  readonly provenanceKey: string;
  readonly origin: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly capturedAtMs: number;
  readonly authority: 'EVIDENCE_INPUT_ONLY';
  /** Canonical opaque reference recorded alongside as context, never raw secrets. */
  readonly authorizationContextRef?: string;
}

export interface HandoffOptions {
  readonly authorizationContextRef?: string;
}

/**
 * Build the Core handoff envelope for one observation. Fails closed when
 * provenance is incomplete (unprovenanced promotion) and redacts the payload
 * through the exit-sink redactor before returning.
 */
export function buildObservationHandoff(
  record: ObservationRecord,
  options: HandoffOptions = {},
): BrowserResult<ObservationHandoff> {
  const diagnostics: BrowserDiagnostic[] = [];
  const provenance = record.provenance;
  if (
    typeof provenance.tabId !== 'number' ||
    typeof provenance.frameId !== 'number' ||
    typeof provenance.origin !== 'string' ||
    provenance.origin.length === 0
  ) {
    diagnostics.push(
      bDiagnostic(
        'UNPROVENANCED_OBSERVATION',
        'observation.provenance',
        'an observation without complete tab/frame/origin provenance cannot be promoted into a handoff',
        'L2-inv11',
      ),
    );
  }
  if (record.authority !== 'EVIDENCE_INPUT_ONLY') {
    diagnostics.push(
      bDiagnostic(
        'PRIVILEGE_ESCALATION_REJECTED',
        'observation.authority',
        'observation records are evidence inputs and can never be re-labeled as authority',
        'L2-inv11',
      ),
    );
  }
  if (
    options.authorizationContextRef !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(options.authorizationContextRef)
  ) {
    diagnostics.push(
      bDiagnostic(
        'OBSERVATION_MALFORMED',
        'handoff.authorizationContextRef',
        'handoff carries only well-formed opaque AuthorizationContextRef values',
        'PRD-§29',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return bFail(diagnostics);
  }
  const redactedPayload = redactForSink(record.payload) as Readonly<Record<string, string>>;
  const handoff: ObservationHandoff = {
    kind: record.kind,
    provenanceKey: observationProvenanceKey(record),
    origin: provenance.origin,
    payload: redactedPayload,
    capturedAtMs: record.capturedAtMs,
    authority: 'EVIDENCE_INPUT_ONLY',
    ...(options.authorizationContextRef === undefined
      ? {}
      : { authorizationContextRef: options.authorizationContextRef }),
  };
  return bOk(Object.freeze(handoff));
}

/**
 * Canonical evidence candidate for NETWORK_OBSERVATION kind only: browser
 * request observations map onto `TRANSFER_OBSERVATION` evidence typed as a
 * suggestion-grade claim. The candidate can never serve as an independent
 * validation oracle (SUGGESTIVE certainty keeps it below oracle grade), so
 * observations remain evidence inputs, never self-certifying authority.
 * Core owns the final claim typing decision at integration.
 */
export function networkObservationEvidenceCandidate(
  record: ObservationRecord,
): BrowserResult<EvidenceRecord> {
  if (record.kind !== 'NETWORK_OBSERVATION') {
    return bFail([
      bDiagnostic(
        'OBSERVATION_MALFORMED',
        'observation.kind',
        'only NETWORK_OBSERVATION has a canonical evidence candidate mapping',
      ),
    ]);
  }
  if (!record.provenance.requestRef) {
    return bFail([
      bDiagnostic(
        'UNPROVENANCED_OBSERVATION',
        'observation.provenance.requestRef',
        'request-bound evidence requires request provenance',
        'L2-inv11',
      ),
    ]);
  }
  const evidenceId = makeEvidenceId(`obs-${record.observationId}`);
  if (!evidenceId.ok) {
    return bFail(
      evidenceId.diagnostics.map((d) => ({
        code: d.code as BrowserDiagnostic['code'],
        path: `observation.${d.path}`,
        message: d.message,
      })),
    );
  }
  const candidate = evidenceRecord({
    evidenceId: evidenceId.value,
    claimType: 'RESOURCE_IDENTITY',
    claimSubject: { kind: 'RESOURCE', ref: record.provenance.requestRef },
    sourceType: 'TRANSFER_OBSERVATION',
    provenance: {
      sourceIdentity: `browser-tab-${record.provenance.tabId}-frame-${record.provenance.frameId}-${record.provenance.origin}`,
    },
    independenceFromDiscovery: 'INDEPENDENT',
    scope: { domain: 'AUTHORIZATION' },
    certaintyClass: 'SUGGESTIVE',
  });
  return bOk(candidate);
}
