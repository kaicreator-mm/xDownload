/**
 * TEST_MATRIX suite `support-slices-s1-s6` plus the adapter-facing gateway
 * port semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  createDomainGateway,
  decodeSupportSliceRef,
  projectForSurface,
  supportSliceRepresentations,
  type EvidenceRecord,
} from '../src/index.ts';
import {
  confirmedCollectionContract,
  decodeOk,
  eid,
  expectCode,
  mid,
  pageRangeScope,
  rawCollectionContract,
  rawSnapshot,
  rawTerminalResult,
} from './helpers.ts';
import { decodeAcquisitionContract, type AcquisitionContract } from '../src/index.ts';

describe('support-slices-s1-s6: canonical representation only', () => {
  it('represents exactly S1–S6 with surface class, continuation and validation layers', () => {
    const slices = supportSliceRepresentations();
    expect(slices.map((slice) => slice.sliceId)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    const byId = new Map(slices.map((slice) => [slice.sliceId, slice]));
    expect(byId.get('S1')!.surfaceClass).toBe('DIRECT_TRANSFER');
    expect(byId.get('S2')!.surfaceClass).toBe('BROWSER_MEDIATED');
    expect(byId.get('S3')!.requiredValidationLayers).toContain('media');
    expect(byId.get('S4')!.requiredValidationLayers).toContain('media');
    expect(byId.get('S5')!.surfaceClass).toBe('COLLECTION');
    expect(byId.get('S5')!.defaultContinuation).toEqual({ kind: 'NONE' });
    expect(byId.get('S5')!.requiredValidationLayers).toContain('membership');
    expect(byId.get('S6')!.surfaceClass).toBe('COLLECTION');
  });

  it('slice representation is data-only: no behavior, browser, transfer, media or persistence', () => {
    for (const slice of supportSliceRepresentations()) {
      expect(slice.representationOnly).toBe(true);
      expect(Object.keys(slice).sort()).toEqual([
        'defaultContinuation',
        'representationOnly',
        'requiredValidationLayers',
        'sliceId',
        'surfaceClass',
        'title',
      ]);
    }
  });

  it('decodes slice refs and fails closed on unknown slice ids', () => {
    expect(decodeOk(decodeSupportSliceRef({ sliceId: 'S4' })).sliceId).toBe('S4');
    expectCode(decodeSupportSliceRef({ sliceId: 'S7' }), 'UNKNOWN_ENUM_VALUE');
    expectCode(decodeSupportSliceRef({ sliceId: 'S1', behavior: 'download()' }), 'UNKNOWN_FIELD');
  });
});

describe('adapter-facing gateway port', () => {
  const gateway = createDomainGateway();

  it('submits contracts through the fail-closed boundary', () => {
    const contract = decodeOk(gateway.submitContract(rawCollectionContract()));
    expect(contract.contractId).toBe('contract-collection-001');
    expectCode(gateway.submitContract({ broken: true }), 'MALFORMED_REQUIRED_FIELD');
  });

  it('confirms snapshots only against the bound confirmed contract', () => {
    const contract = confirmedCollectionContract();
    const snapshot = decodeOk(gateway.confirmSnapshot(rawSnapshot(), contract));
    expect(snapshot.contractId).toBe(contract.contractId);
    // binding mismatch
    expectCode(
      gateway.confirmSnapshot(rawSnapshot({ contractId: 'contract-other-999' }), contract),
      'CONTRACT_BINDING_MISMATCH',
    );
    // draft contracts cannot confirm snapshots
    const draftRaw = rawCollectionContract();
    delete draftRaw['confirmedAt'];
    const draft = decodeOk(decodeAcquisitionContract({ ...draftRaw, status: 'DRAFT' }));
    expectCode(gateway.confirmSnapshot(rawSnapshot(), draft), 'SCOPE_MUTATION');
    // scope binding mismatch
    const otherScopeContract: AcquisitionContract = {
      ...confirmedCollectionContract(),
      requestedScope: pageRangeScope('collection/playlist-001', 1, 2),
    };
    expectCode(gateway.confirmSnapshot(rawSnapshot(), otherScopeContract), 'SCOPE_MUTATION');
  });

  it('appends evidence only after decode validation', () => {
    const evidence: EvidenceRecord = {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      evidenceId: eid('evidence-port-001'),
      claimType: 'TRANSFER',
      claimSubject: { kind: 'EFFECT', ref: 'effect-001' },
      sourceType: 'TRANSFER_OBSERVATION',
      provenance: { sourceIdentity: 'adapter/http-001' },
      independenceFromDiscovery: 'INDEPENDENT',
      scope: { domain: 'SINGLE_RESOURCE_TRANSFER' },
      certaintyClass: 'DECISIVE',
    };
    expect(decodeOk(gateway.appendEvidence(JSON.parse(JSON.stringify(evidence))))).toEqual(
      evidence,
    );
    expectCode(gateway.appendEvidence({ evidenceId: 'nope' }), 'UNKNOWN_ENUM_VALUE');
  });

  it('projects terminal results only when legal combinations hold', () => {
    const result = decodeOk(
      gateway.projectTerminalResult(rawTerminalResult(), {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
        selectedValidationOutcomes: [
          { memberId: mid('member-001'), requiredValidationPassed: true },
        ],
      }),
    );
    expect(projectForSurface(result).contractId).toBe('contract-single-001');
    const illegal = rawTerminalResult({ coverage: 'VERIFIED_COMPLETE' });
    expectCode(
      gateway.projectTerminalResult(illegal, {
        intentType: 'SINGLE_RESOURCE',
        scopeKind: 'single_resource',
        selectedMemberCount: 1,
        selectedValidationOutcomes: [
          { memberId: mid('member-001'), requiredValidationPassed: true },
        ],
      }),
      'INVALID_RESULT_COMBINATION',
    );
  });
});
