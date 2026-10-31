/**
 * T08 desktop download-manager document tests — the pure Core-projection →
 * manager-row mapping (no transport, no DOM):
 *
 * - URL decode is fail-closed (bounded http(s), no control characters);
 * - the structured single-resource intent is the user's structured input
 *   only (the canonical confirmation flow routes it);
 * - rows render projection facts VERBATIM: absent facts are null, terminal
 *   dimensions are verbatim, and retry availability mirrors the adapter's
 *   own deriveRetryDomain predicate exactly;
 * - NOTHING derives a total, percentage or ETA (there is no byte sample on
 *   the legacy lane, and the mapping never invents one).
 */

import { describe, expect, it } from 'vitest';
import type { SeamProjectionView } from '@xdownload/core-seam';
import {
  decodeManagerUrl,
  MANAGER_MAX_URL_LENGTH,
  projectLegacyJobRow,
  revealHintFor,
  singleResourceUrlIntent,
  type ManagerJobRow,
} from '../src/manager-documents.ts';
import { deriveRetryDomain } from '../src/view-model.ts';

describe('decodeManagerUrl', () => {
  it('accepts bounded http(s) URLs', () => {
    for (const good of ['https://example.com/media/stream.m3u8', 'http://127.0.0.1:8000/file']) {
      const decoded = decodeManagerUrl(good);
      expect(decoded.ok, good).toBe(true);
    }
  });

  it('refuses non-http schemes, control characters and oversized input', () => {
    for (const hostile of [
      'ftp://example.com/x',
      'file:///C:/x',
      'not a url',
      '',
      undefined,
      42,
      `https://example.com/${'a'.repeat(MANAGER_MAX_URL_LENGTH)}`,
      'https://example.com/a\nb',
      'https://example.com/a\tb',
      'https://example.com/a\x00b',
    ]) {
      const decoded = decodeManagerUrl(hostile);
      expect(decoded.ok, JSON.stringify(hostile) ?? 'undefined').toBe(false);
    }
  });
});

describe('singleResourceUrlIntent', () => {
  it('builds the structured single-resource input for one URL', () => {
    const intent = singleResourceUrlIntent('https://example.com/a.mp4');
    expect(intent.ok).toBe(true);
    if (intent.ok) {
      expect(intent.value.intentType).toBe('SINGLE_RESOURCE');
      expect(intent.value.targetRef).toBe('https://example.com/a.mp4');
      expect(intent.value.requestedScope.kind).toBe('single_resource');
      if (intent.value.requestedScope.kind === 'single_resource') {
        expect(intent.value.requestedScope.targetId).toBe('https://example.com/a.mp4');
      }
      expect(intent.value.continuationScope).toEqual({ kind: 'NONE' });
      expect(intent.value.automationMode).toBe('ASSISTED');
      // The authorization context is an opaque reference — never secret material.
      expect(intent.value.authorizationContextRef).toMatch(/^authctx\//);
    }
  });
});

/** Minimal legacy projection view fixture. */
function legacyView(overrides: {
  selectedMemberIds?: string[];
  retriedMemberIds?: string[];
  failedMemberCount?: number;
  selectedMemberCount?: number;
  terminalRequestFulfillment?: 'COMPLETE' | 'PARTIAL';
}): SeamProjectionView {
  const selected = overrides.selectedMemberIds ?? ['member-001'];
  return {
    schemaIdentity: { schema: 'xdownload.core-seam', version: '1.0.0' },
    contract: {
      contractId: 'contract-desktop-ab12cd34-000001',
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      revision: 4,
    },
    snapshot: {
      snapshotId: 'snapshot-desktop-ab12cd34-000003',
      contractId: 'contract-desktop-ab12cd34-000001',
      selectedMemberIds: selected,
      createdAt: '2026-10-31T09:00:00Z',
    },
    lineage: {
      status: 'ACTIVE',
      failedMemberCount: overrides.failedMemberCount ?? 0,
      failedMemberIds: [],
      retriedMemberIds: overrides.retriedMemberIds ?? [],
    },
    ...(overrides.selectedMemberCount === undefined
      ? {}
      : { selectedMemberCount: overrides.selectedMemberCount }),
    ...(overrides.terminalRequestFulfillment === undefined
      ? {}
      : {
          terminal: {
            schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
            contractId: 'contract-desktop-ab12cd34-000001',
            requestFulfillment: overrides.terminalRequestFulfillment,
            targetResolution: 'RESOLVED',
            selectionAcquisition: 'ACQUIRED',
            coverage:
              overrides.terminalRequestFulfillment === 'COMPLETE'
                ? 'VERIFIED_COMPLETE'
                : 'INSUFFICIENT',
            stopReason: 'NATURAL_END',
            validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
            recordedAt: '2026-10-31T09:00:00Z',
          },
        }),
  } as SeamProjectionView;
}

describe('projectLegacyJobRow', () => {
  it('a missing projection renders the truthful absent row (nulls, never zeros)', () => {
    const row = projectLegacyJobRow({
      lineageId: 'contract-desktop-ab12cd34-000001',
      view: null,
      destination: null,
    });
    expect(row.present).toBe(false);
    expect(row.contractStatus).toBeNull();
    expect(row.revision).toBeNull();
    expect(row.lineageStatus).toBeNull();
    expect(row.selectedMemberCount).toBeNull();
    expect(row.terminal).toBeNull();
    expect(row.retry).toEqual({
      available: false,
      reason: 'NO_CORE_PROJECTION_AVAILABLE',
    });
  });

  it('rows carry the projection facts verbatim, including an absent member count', () => {
    const row = projectLegacyJobRow({
      lineageId: 'contract-desktop-ab12cd34-000001',
      view: legacyView({}),
      destination: 'C:/downloads',
    });
    expect(row.present).toBe(true);
    expect(row.contractStatus).toBe('CONFIRMED');
    expect(row.revision).toBe(4);
    expect(row.lineageStatus).toBe('ACTIVE');
    // The projection exposes no selectedMemberCount here — the row says null,
    // never 0 (an absent fact is rendered absent, not invented).
    expect(row.selectedMemberCount).toBeNull();
    expect(row.destination).toBe('C:/downloads');
  });

  it('the projected selected-member count renders verbatim when Core exposes it', () => {
    const row = projectLegacyJobRow({
      lineageId: 'contract-desktop-ab12cd34-000001',
      view: legacyView({ selectedMemberCount: 7 }),
      destination: null,
    });
    expect(row.selectedMemberCount).toBe(7);
  });

  it('the terminal renders all six dimensions verbatim; no success boolean exists', () => {
    const row: ManagerJobRow = projectLegacyJobRow({
      lineageId: 'contract-desktop-ab12cd34-000001',
      view: legacyView({ terminalRequestFulfillment: 'PARTIAL' }),
      destination: null,
    });
    expect(row.terminal).not.toBeNull();
    if (row.terminal !== null) {
      expect(row.terminal.requestFulfillment).toBe('PARTIAL');
      expect(row.terminal.coverage).toBe('INSUFFICIENT');
      expect(row.terminal.validationSummary).toEqual({
        status: 'ALL_PASSED',
        passedCount: 1,
        failedCount: 0,
      });
    }
    expect('successful' in row).toBe(false);
  });
});

describe('retry availability mirrors deriveRetryDomain exactly', () => {
  it("no failed members → ineligible with the adapter's own reason", () => {
    const row = projectLegacyJobRow({
      lineageId: 'x',
      view: legacyView({ failedMemberCount: 0 }),
      destination: null,
    });
    const domain = deriveRetryDomain({
      selectedMemberIds: ['member-001'],
      retriedMemberIds: [],
      failedMemberCount: 0,
    });
    expect(row.retry.available).toBe(false);
    if (domain.kind === 'UNAVAILABLE') {
      expect(row.retry.reason).toBe(domain.reason);
    }
    expect(row.retry.reason).toBe('NO_FAILED_MEMBERS');
  });

  it('all members failed → the determined domain is retryable', () => {
    const row = projectLegacyJobRow({
      lineageId: 'x',
      view: legacyView({ failedMemberCount: 1 }),
      destination: null,
    });
    expect(row.retry).toEqual({ available: true, reason: null });
  });

  it('a partial failure with unexposed identities → ineligible, never guessed', () => {
    const view = legacyView({
      selectedMemberIds: ['member-001', 'member-002', 'member-003'],
      failedMemberCount: 1,
      retriedMemberIds: [],
    });
    const row = projectLegacyJobRow({ lineageId: 'x', view, destination: null });
    const domain = deriveRetryDomain({
      selectedMemberIds: ['member-001', 'member-002', 'member-003'],
      retriedMemberIds: [],
      failedMemberCount: 1,
    });
    expect(domain.kind).toBe('UNAVAILABLE');
    expect(row.retry.available).toBe(false);
    expect(row.retry.reason).toBe('FAILED_IDENTITIES_NOT_EXPOSED_BY_PROJECTION');
  });
});

describe('revealHintFor', () => {
  it('offers reveal only for a COMPLETE row with a known destination', () => {
    const base = projectLegacyJobRow({
      lineageId: 'x',
      view: legacyView({ terminalRequestFulfillment: 'COMPLETE' }),
      destination: 'C:/downloads',
    });
    expect(revealHintFor(base)).toBe(true);
    expect(revealHintFor({ ...base, destination: null })).toBe(false);
    const partial = projectLegacyJobRow({
      lineageId: 'x',
      view: legacyView({ terminalRequestFulfillment: 'PARTIAL' }),
      destination: 'C:/downloads',
    });
    expect(revealHintFor(partial)).toBe(false);
    expect(revealHintFor({ ...partial, present: false })).toBe(false);
  });
});
