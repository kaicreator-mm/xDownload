/**
 * T011 TEST_MATRIX suite `s5-s6-slice-semantics` — engine behavior conforms
 * to the frozen S5/S6 slice declarations (PRD §28): supported membership
 * relations only, provenance-bound delivery, truthful failure, layer
 * contracts respected without implementing the validators.
 */
import { describe, expect, it } from 'vitest';
import { supportSliceRepresentations } from '@xdownload/domain-contracts';
import {
  assertSliceCollectionConformance,
  collectionSliceFailureDeclaration,
  isProvenanceBoundCollectionDelivery,
} from '../src/index.ts';
import { confirmedCurrentPageContract, confirmedPlaylistContract } from './fixtures.ts';

describe('frozen S5/S6 slice declarations are the behavior contract', () => {
  it('S5 is the current-page collection slice with default continuation NONE and 5 required layers', () => {
    const slices = supportSliceRepresentations();
    const s5 = slices.find((slice) => slice.sliceId === 'S5');
    expect(s5).toBeDefined();
    expect(s5?.surfaceClass).toBe('COLLECTION');
    expect(s5?.defaultContinuation).toEqual({ kind: 'NONE' });
    expect(s5?.requiredValidationLayers).toEqual([
      'membership',
      'target',
      'transfer',
      'format',
      'coverage',
    ]);
    expect(s5?.representationOnly).toBe(true);
  });

  it('S5: confirmed current-page contract with snapshot basis conforms', () => {
    const contract = confirmedCurrentPageContract();
    const conformance = assertSliceCollectionConformance('S5', contract);
    expect(conformance.ok).toBe(true);
    if (conformance.ok) {
      expect(conformance.value.sliceId).toBe('S5');
    }
  });

  it('S5: non-current-page scope and non-snapshot basis are rejected', () => {
    const playlist = confirmedPlaylistContract();
    const wrongScope = assertSliceCollectionConformance('S5', playlist);
    expect(wrongScope.ok).toBe(false);
    if (!wrongScope.ok) {
      expect(wrongScope.diagnostics.some((d) => d.invariant === 'PRD-§28')).toBe(true);
    }
  });

  it('S5: missing required layer contracts are rejected without implementing validators', () => {
    const contract = confirmedCurrentPageContract({
      validationPolicy: { requiredLayers: ['membership'] },
    });
    const conformance = assertSliceCollectionConformance('S5', contract);
    expect(conformance.ok).toBe(false);
    if (!conformance.ok) {
      const layerDiagnostics = conformance.diagnostics.filter(
        (d) => d.code === 'MISSING_REQUIRED_FIELD',
      );
      expect(layerDiagnostics.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('S6: explicit collection identity with a deterministic supported relation conforms', () => {
    const contract = confirmedPlaylistContract();
    const conformance = assertSliceCollectionConformance('S6', contract);
    expect(conformance.ok).toBe(true);
  });

  it('S6: page-range scope on the supported template also conforms', () => {
    const contract = confirmedPlaylistContract(
      {
        contractId: 'contract-s6-range',
        requestedScope: {
          kind: 'collection_page_range',
          collectionIdentity: 'collection/playlist-042',
          fromPage: 1,
          toPage: 2,
        },
      },
      { kind: 'NONE' },
    );
    // collection_page_range keeps the explicit CollectionIdentity and the
    // SUPPORTED_TEMPLATE membership relation — S6-conformant.
    const conformance = assertSliceCollectionConformance('S6', contract);
    expect(conformance.ok).toBe(true);
  });

  it('S6: missing explicit collection identity or unsupported membership basis is rejected', () => {
    const current = assertSliceCollectionConformance('S6', confirmedCurrentPageContract());
    expect(current.ok).toBe(false);
    const wrongBasis = assertSliceCollectionConformance(
      'S6',
      confirmedPlaylistContract(
        { membershipBasis: { basis: 'CONFIRMED_PAGE_SNAPSHOT' } },
        { kind: 'NONE' },
      ),
    );
    expect(wrongBasis.ok).toBe(false);
    if (!wrongBasis.ok) {
      expect(
        wrongBasis.diagnostics.some((d) => d.message.includes('deterministic supported relation')),
      ).toBe(true);
    }
  });
});

describe('collection delivery provenance and truthful failure declarations', () => {
  it('member delivery provenance bindings are exactly the declared collection bindings', () => {
    expect(isProvenanceBoundCollectionDelivery('MEMBER_DELIVERY_EDGE')).toBe(true);
    expect(isProvenanceBoundCollectionDelivery('DECLARED_DELIVERY_EDGE')).toBe(true);
    expect(isProvenanceBoundCollectionDelivery('SELECTED_RESOURCE_PROVENANCE')).toBe(true);
  });

  it('failure to close requested continuation is TRUNCATED-or-UNKNOWN, never silent success', () => {
    const truncated = collectionSliceFailureDeclaration({
      closedRequestedContinuation: false,
      membersResolved: 7,
    });
    expect(truncated.status).toBe('TRUNCATED');
    expect(truncated.truthful).toBe(true);
    const unknown = collectionSliceFailureDeclaration({
      closedRequestedContinuation: false,
      membersResolved: 0,
    });
    expect(unknown.status).toBe('UNKNOWN');
    const closed = collectionSliceFailureDeclaration({
      closedRequestedContinuation: true,
      membersResolved: 9,
    });
    expect(closed.status).toBe('CLOSED');
  });
});
