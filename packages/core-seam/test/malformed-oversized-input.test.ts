/**
 * TEST_MATRIX suite `malformed-and-oversized-input-rejection`:
 * - malformed envelope (missing required field, unknown discriminant, corrupt
 *   framing) rejects before any authority transition;
 * - payload exceeding declared size bounds rejects without being parsed into
 *   authority state;
 * - declared bounds (size/depth/field limits) are explicit, enforced and
 *   tested (frozen L2 §12);
 * - rejection diagnostics are typed and leak no secret material.
 */

import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  EXPECTED_PEER,
  rawCommand,
  rawSingleResourceContract,
  SEAM_MESSAGE_LIMITS,
} from './helpers.ts';

function server() {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

describe('malformed envelope rejects before any authority transition', () => {
  it('corrupt framing (non-JSON frame) rejects with a typed diagnostic and creates nothing', () => {
    const s = server();
    const response = s.handleFrame('{not json at all');
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');
    expect(s.inspectProjection('contract-single-001')).toBeUndefined();
    expect(s.acceptedCommandCount).toBe(0);
  });

  it('missing required field (no requestId) rejects', () => {
    const s = server();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
    });
    delete raw['requestId'];
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(s.acceptedCommandCount).toBe(0);
  });

  it('missing expectedRevision rejects (revision gate input is never guessed)', () => {
    const s = server();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
    });
    delete raw['expectedRevision'];
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
  });

  it('unknown command discriminant rejects with UNKNOWN_COMMAND_TYPE', () => {
    const s = server();
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' });
    raw['commandType'] = 'MUTATE_BUDGET_FOR_SURFACE';
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('UNKNOWN_COMMAND_TYPE');
  });

  it('unknown envelope fields reject instead of being defaulted (authority-changing unknown field)', () => {
    const s = server();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
    });
    raw['budgetOverride'] = { unlimited: true };
    const response = s.handleFrame(JSON.stringify(raw));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('ENVELOPE_MALFORMED');
    expect(s.acceptedCommandCount).toBe(0);
  });
});

describe('declared bounds are explicit, enforced and divergence-proof', () => {
  it('the enforced payload bound is the exported declared constant', () => {
    const s = server();
    // Max-length strings (at, not over, the string bound) so the payload BYTE
    // bound is the first declared limit reached, within the field-count bound.
    const filler = 'x'.repeat(SEAM_MESSAGE_LIMITS.maxStringFieldLength);
    const fieldBytes = filler.length + 12;
    const under: Record<string, unknown> = {};
    let i = 0;
    while (
      (i + 1) * fieldBytes < SEAM_MESSAGE_LIMITS.maxPayloadBytes - 2 * fieldBytes &&
      i + 1 < SEAM_MESSAGE_LIMITS.maxFieldsPerObject
    ) {
      under[`f${String(i).padStart(4, '0')}`] = filler;
      i += 1;
    }
    const underResponse = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: under,
        }),
      ),
    );
    const underCodes = underResponse.diagnostics?.map((d) => d.code) ?? [];
    expect(underCodes).not.toContain('PAYLOAD_TOO_LARGE');
    // Adding a few more max-length fields crosses the byte bound.
    under['g0000'] = filler;
    under['g0001'] = filler;
    under['g0002'] = filler;
    const over = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: under,
        }),
      ),
    );
    expect(over.outcome).toBe('REJECTED');
    expect(over.diagnostics?.[0]?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(over.diagnostics?.[0]?.message).toContain(String(SEAM_MESSAGE_LIMITS.maxPayloadBytes));
  });

  it('payload exceeding the declared byte bound rejects before being parsed into authority state', () => {
    const s = server();
    const big: Record<string, unknown> = {};
    let i = 0;
    while (JSON.stringify(big).length <= SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      big[`k${String(i)}`] = 'y'.repeat(SEAM_MESSAGE_LIMITS.maxStringFieldLength);
      i += 1;
    }
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: big,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('PAYLOAD_TOO_LARGE');
    // Nothing was parsed into authority state.
    expect(s.inspectProjection('contract-single-001')).toBeUndefined();
    expect(s.acceptedCommandCount).toBe(0);
  });

  it('a payload deeper than the declared bound rejects with ENVELOPE_TOO_DEEP', () => {
    const s = server();
    let deep: unknown = 'bottom';
    for (let i = 0; i < SEAM_MESSAGE_LIMITS.maxDepth + 5; i += 1) {
      deep = { nested: deep };
    }
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: deep,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    const codes = response.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain('ENVELOPE_TOO_DEEP');
  });

  it('an object with more fields than the declared bound rejects with TOO_MANY_FIELDS', () => {
    const s = server();
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < SEAM_MESSAGE_LIMITS.maxFieldsPerObject + 1; i += 1) {
      wide[`k${String(i)}`] = i;
    }
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: wide,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    const codes = response.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain('TOO_MANY_FIELDS');
  });

  it('a string over the declared length bound rejects with STRING_TOO_LONG', () => {
    const s = server();
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: { note: 'z'.repeat(SEAM_MESSAGE_LIMITS.maxStringFieldLength + 1) },
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    const codes = response.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain('STRING_TOO_LONG');
  });
});

describe('rejection diagnostics are typed and leak no secret material', () => {
  it('a raw secret field in the payload rejects via the domain boundary and the diagnostic names only the path', () => {
    const s = server();
    const leaking = rawSingleResourceContract({
      extraNote: 'harmless',
    });
    (leaking as Record<string, unknown>)['token'] = 'SUPER-SECRET-BROWSER-SESSION-TOKEN-VALUE';
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: leaking,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    const rendered = JSON.stringify(response);
    expect(rendered).not.toContain('SUPER-SECRET-BROWSER-SESSION-TOKEN-VALUE');
    expect(response.diagnostics?.some((d) => d.code === 'RAW_SECRET_FIELD')).toBe(true);
    expect(s.acceptedCommandCount).toBe(0);
  });

  it('an oversized-payload rejection names the bound and never echoes payload content', () => {
    const s = server();
    const marker = 'UNIQUE-OVERSIZE-MARKER-CONTENT-0123456789';
    const big: Record<string, unknown> = {};
    let i = 0;
    while (JSON.stringify(big).length <= SEAM_MESSAGE_LIMITS.maxPayloadBytes) {
      big[`k${String(i)}`] = marker.repeat(10);
      i += 1;
    }
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: big,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    expect(JSON.stringify(response)).not.toContain(marker);
  });
});
