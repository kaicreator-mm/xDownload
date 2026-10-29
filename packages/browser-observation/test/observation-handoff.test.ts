/**
 * T010 observation records, handoff and exit-sink redaction (TEST_MATRIX
 * suites: observation-provenance-and-scope-non-rewrite,
 * secret-sink-containment; frozen L2 §6.4).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { canServeAsIndependentValidationOracle } from '@xdownload/domain-contracts';
import {
  OBSERVATION_AUTHORITY_MARKER,
  buildObservationHandoff,
  decodeUntrustedContentMessage,
  networkObservationEvidenceCandidate,
  observationProvenanceKey,
  recordObservation,
  redactForSink,
  registerSinkScrubSentinel,
  clearSinkScrubSentinels,
} from '../src/index.ts';

const MESSAGE = {
  boundary: 'CONTENT_SCRIPT',
  kind: 'NETWORK_OBSERVATION',
  provenance: {
    tabId: 3,
    frameId: 1,
    origin: 'https://media.example.org',
    requestRef: 'req-0042',
    partition: 'partition-A',
  },
  payload: { requestUrl: 'https://cdn.example.org/seg-1.ts', requestMethod: 'GET' },
} as const;

function record() {
  const gated = decodeUntrustedContentMessage(MESSAGE);
  if (!gated.ok) throw new Error('fixture message must gate');
  const rec = recordObservation(gated.value, { observationId: 'obs-001', capturedAtMs: 1000 });
  if (!rec.ok) throw new Error('fixture record must build');
  return rec.value;
}

describe('observation records carry complete provenance and stay evidence inputs', () => {
  it('records carry tab/frame/origin/request provenance and the evidence-input marker', () => {
    const rec = record();
    expect(rec.provenance.tabId).toBe(3);
    expect(rec.provenance.frameId).toBe(1);
    expect(rec.provenance.origin).toBe('https://media.example.org');
    expect(rec.provenance.requestRef).toBe('req-0042');
    expect(rec.authority).toBe(OBSERVATION_AUTHORITY_MARKER);
  });

  it('provenance keys are stable and partition-aware', () => {
    const rec = record();
    expect(observationProvenanceKey(rec)).toBe(
      '3/1/https://media.example.org/req-0042/partition-A',
    );
  });

  it('observation-derived evidence stays below oracle grade (never self-certifying authority)', () => {
    const candidate = networkObservationEvidenceCandidate(record());
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.value.certaintyClass).toBe('SUGGESTIVE');
    expect(canServeAsIndependentValidationOracle(candidate.value)).toBe(false);
  });

  it('handoff keeps provenance binding and the evidence-input marker', () => {
    const handoff = buildObservationHandoff(record());
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    expect(handoff.value.provenanceKey).toBe('3/1/https://media.example.org/req-0042/partition-A');
    expect(handoff.value.authority).toBe('EVIDENCE_INPUT_ONLY');
    expect(handoff.value.origin).toBe('https://media.example.org');
  });
});

describe('secret containment at the observation exit sink', () => {
  beforeEach(() => {
    clearSinkScrubSentinels();
  });

  it('redactForSink removes sentinel material planted in a hostile payload before handoff', () => {
    const sentinel = 'SESSsecretvalue0001';
    registerSinkScrubSentinel(sentinel);
    const gated = decodeUntrustedContentMessage({
      boundary: 'CONTENT_SCRIPT',
      kind: 'NETWORK_OBSERVATION',
      provenance: MESSAGE.provenance,
      payload: {
        requestUrl: `https://cdn.example.org/seg-1.ts?session=${sentinel}`,
        requestMethod: 'GET',
      },
    });
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    const rec = recordObservation(gated.value, { observationId: 'obs-002', capturedAtMs: 1001 });
    if (!rec.ok) return;
    const handoff = buildObservationHandoff(rec.value);
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    expect(JSON.stringify(handoff.value)).not.toContain(sentinel);
    expect(JSON.stringify(redactForSink(handoff.value))).not.toContain(sentinel);
  });

  it('handoff never echoes raw-secret-named fields outward', () => {
    const handoff = buildObservationHandoff(record(), {
      authorizationContextRef: 'authctx/local/1@0',
    });
    if (!handoff.ok) throw new Error('handoff must build');
    const serialized = JSON.stringify(handoff.value);
    expect(serialized).not.toMatch(/"cookie"|"token"|"password"|"credential"/);
    expect(serialized).toContain('authctx/local/1@0');
  });

  it('an invalid AuthorizationContextRef cannot be attached to a handoff', () => {
    const bad = buildObservationHandoff(record(), { authorizationContextRef: 'not valid ref!' });
    expect(bad.ok).toBe(false);
  });
});
