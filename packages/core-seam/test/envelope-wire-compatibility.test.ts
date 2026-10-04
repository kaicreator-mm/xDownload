/**
 * TEST_MATRIX suite `wire-contract-compatibility`:
 * - explicit supported schema identity/version at the wire boundary;
 * - known compatible versions decode deterministically;
 * - unknown/incompatible versions fail closed, never silently reinterpret;
 * - envelope carries the L2 §6.3 command transaction facts at the seam;
 * - payloads decode into canonical @xdownload/domain-contracts values through
 *   the existing fail-closed decoders, with no second decoder vocabulary.
 */

import { describe, expect, it } from 'vitest';
import {
  CORE_SEAM_SCHEMA_ID,
  decodeSeamEnvelope,
  encodeSeamEnvelope,
  SUPPORTED_SEAM_MAJOR_VERSIONS,
  createCoreSeamServer,
  EXPECTED_PEER,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  peer,
  requestId,
} from './helpers.ts';
import { decodeAcquisitionContract, type AcquisitionContract } from '@xdownload/domain-contracts';

function server() {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

describe('wire-contract-compatibility: explicit schema identity/version', () => {
  it('every envelope carries an explicit supported seam schema identity at the wire boundary', () => {
    const decoded = decodeSeamEnvelope(
      rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.value.schemaIdentity.schema).toBe(CORE_SEAM_SCHEMA_ID);
    const major = Number(decoded.value.schemaIdentity.version.split('.')[0]);
    expect(SUPPORTED_SEAM_MAJOR_VERSIONS).toContain(major);
  });

  it('a compatible minor version within the supported major decodes deterministically', () => {
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' });
    raw['schemaIdentity'] = { schema: CORE_SEAM_SCHEMA_ID, version: '1.1.0' };
    const first = decodeSeamEnvelope(raw);
    const second = decodeSeamEnvelope(raw);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.value).toStrictEqual(second.value);
    expect(encodeSeamEnvelope(first.value)).toBe(encodeSeamEnvelope(second.value));
  });

  it('an unknown schema id rejects instead of being reinterpreted as the known seam', () => {
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' });
    raw['schemaIdentity'] = { schema: 'some.other.seam', version: '1.0.0' };
    const decoded = decodeSeamEnvelope(raw);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) {
      return;
    }
    expect(decoded.diagnostics.some((d) => d.path === 'schemaIdentity.schema')).toBe(true);
  });

  it('an unsupported major version fails closed with UNSUPPORTED_ENVELOPE_VERSION', () => {
    const raw = rawCommand({ commandType: 'CANCEL_LINEAGE', aggregateId: 'c-1' });
    raw['schemaIdentity'] = { schema: CORE_SEAM_SCHEMA_ID, version: '2.0.0' };
    const decoded = decodeSeamEnvelope(raw);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) {
      return;
    }
    expect(decoded.diagnostics.some((d) => d.code === 'UNSUPPORTED_ENVELOPE_VERSION')).toBe(true);
  });

  it('a malformed version string rejects instead of guessing a version', () => {
    const raw = rawQuery({ aggregateId: 'c-1' });
    raw['schemaIdentity'] = { schema: CORE_SEAM_SCHEMA_ID, version: 'one' };
    const decoded = decodeSeamEnvelope(raw);
    expect(decoded.ok).toBe(false);
  });
});

describe('wire-contract-compatibility: L2 §6.3 command transaction facts at the seam', () => {
  it('command envelopes carry idempotency identity, expected revision, type/payload and lineage correlation', () => {
    const id = requestId();
    const raw = rawCommand({
      commandType: 'SUBMIT_CONTRACT',
      aggregateId: 'contract-single-001',
      payload: rawSingleResourceContract(),
      expectedRevision: 0,
      requestId: id,
      correlation: { contractId: 'contract-single-001' },
    });
    const decoded = decodeSeamEnvelope(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.value.kind !== 'command') {
      return;
    }
    // command/idempotency identity
    expect(decoded.value.requestId).toBe(id);
    // expected/current revision (current is server state; expected is on the wire)
    expect(decoded.value.expectedRevision).toBe(0);
    // command type + payload
    expect(decoded.value.commandType).toBe('SUBMIT_CONTRACT');
    expect(decoded.value.payload).toBeDefined();
    // provenance/audit + lineage correlation references
    expect(decoded.value.issuedAt).toBe('2026-10-04T01:00:00Z');
    expect(decoded.value.correlation.contractId).toBe('contract-single-001');
  });

  it('responses carry the current revision and the accepted lineage revision', () => {
    const s = server();
    const accept = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          expectedRevision: 0,
        }),
      ),
    );
    expect(accept.outcome).toBe('ACCEPTED');
    expect(accept.currentRevision).toBe(1);
    expect(accept.acceptance?.revision).toBe(1);
  });
});

describe('wire-contract-compatibility: payloads decode through the domain boundary only', () => {
  it('a legal contract payload decodes into the same canonical value the domain decoder produces', () => {
    const raw = rawSingleResourceContract();
    const s = server();
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: raw,
        }),
      ),
    );
    expect(response.outcome).toBe('ACCEPTED');
    // The canonical value at the seam is exactly what the existing domain
    // decoder produces from the same wire bytes — one vocabulary, no fork.
    const viaDomain: AcquisitionContract | undefined = (() => {
      const decoded = decodeAcquisitionContract(raw);
      return decoded.ok ? decoded.value : undefined;
    })();
    expect(viaDomain).toBeDefined();
    const projection = s.inspectProjection('contract-single-001');
    expect(projection?.contract.contractId).toBe(viaDomain?.contractId);
    expect(projection?.contract.status).toBe(viaDomain?.status);
  });

  it('a domain-invalid payload surfaces the domain decoder diagnostics verbatim (no second vocabulary)', () => {
    const bad = rawSingleResourceContract({ status: 'MAYBE' });
    const s = server();
    const response = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: bad,
        }),
      ),
    );
    expect(response.outcome).toBe('REJECTED');
    const direct = decodeAcquisitionContract(bad);
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      const codes = direct.diagnostics.map((d) => d.code);
      expect(response.diagnostics?.map((d) => d.code)).toEqual(codes);
    }
  });

  it('authorized peer identity is part of the wire envelope and decodes deterministically', () => {
    const raw = rawCommand({
      commandType: 'CANCEL_LINEAGE',
      aggregateId: 'c-1',
      asPeer: peer('DESKTOP_UI'),
    });
    const decoded = decodeSeamEnvelope(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    if (decoded.value.kind !== 'command' && decoded.value.kind !== 'query') {
      return;
    }
    expect(decoded.value.peer.surface).toBe('DESKTOP_UI');
  });
});
