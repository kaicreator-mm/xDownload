/**
 * v0.2.1 T05 — the extension's v0.2 submission lane (ordered journey, fake
 * ports). Pins the fail-closed ordering and the boundary discipline:
 *
 * - positive: gate → (no permission machinery for the empty requirement
 *   set) → v0.2 envelope over the ONE trusted NM boundary → bound ACCEPTED;
 * - every negative refuses BEFORE the transport when possible, and the
 *   transport answers refuse with typed actionable codes (host absent /
 *   timeout / broker rejection / seam rejection / route mismatch);
 * - origin authority: a navigated-away tab voids the selection;
 * - permission: requested ONLY when required; a denial cancels before any
 *   send;
 * - malformed targets (raw locator substitution, smuggled fields) never
 *   reach the transport;
 * - outcomes never echo the confirmed intent (no cookie/credential surface
 *   — the payload whitelist has no field for browser context at all);
 * - status reads render the Core-owned projection verbatim (UNKNOWN stays
 *   UNKNOWN).
 *
 * The real Chromium + installed Host session is T13 validation and stays
 * NOT_RUN in this lane.
 */
import { describe, expect, it } from 'vitest';
import { currentSeamSchemaIdentity, type SeamResponse } from '@xdownload/core-seam';
import type { DownloadJobProjection } from '@xdownload/domain-contracts';
import {
  decodeV02AddDownloadGesture,
  decodeV02JobStatusQuery,
  runV02Status,
  runV02Submit,
  V02_LANE_REFUSALS,
  type V02FrameAnswer,
  type V02LanePorts,
} from '../src/background/v02-lane.ts';
import {
  V02_SUBMISSION_REQUIRED_ORIGINS,
  decideSubmissionPermission,
  permissionRationale,
} from '../src/domain-app/index.ts';
import { CORE_SEAM_SCHEMA_ID } from '@xdownload/core-seam';

const PAGE_URL = 'http://127.0.0.1:43181/v02/page';
const ACTION = {
  targetRef: 'ref:target-001',
  outputRootScope: 'C:/tmp/authorized-root',
  allowedOperation: 'acquisition.acquire',
  slice: 'S1' as const,
  caller: { actor: 'browser-extension', sessionRef: 'popup-v02' },
};

function validGesture() {
  return {
    kind: 'V02_ADD_DOWNLOAD',
    tabId: 42,
    pageUrl: PAGE_URL,
    action: ACTION,
  };
}

function schemaVersion() {
  return currentSeamSchemaIdentity().version;
}

function v02AcceptedFor(request: { requestId: string; aggregateId: string }): SeamResponse {
  return {
    schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaVersion() },
    kind: 'response',
    route: 'v0.2',
    inReplyTo: request.requestId as SeamResponse['inReplyTo'],
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: request.requestId,
      aggregateId: request.aggregateId,
      revision: 0,
      converged: false,
    } as SeamResponse['acceptance'],
  };
}

function projectionOf(status: DownloadJobProjection['status']): DownloadJobProjection {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    lineageId: 'lineage-001',
    owner: 'new-k',
    status,
    attempts: [{ attemptId: 'attempt-1', sequence: 1, status: 'UNKNOWN' }],
    currentAttemptId: 'attempt-1',
  };
}

/** Deterministic fake ports; every interaction is recorded for assertions. */
function fakePorts(overrides: Partial<V02LanePorts> = {}): {
  ports: V02LanePorts;
  sent: unknown[];
  permissionRequests: string[][];
} {
  const sent: unknown[] = [];
  const permissionRequests: string[][] = [];
  const ports: V02LanePorts = {
    async ensureRouteContext() {
      return {
        installId: 'install-001',
        userId: 'user-001',
        now: () => '2026-10-31T00:00:00.000Z',
      };
    },
    allocateIdentity() {
      return { requestId: 'req-001', lineageId: 'lineage-001' };
    },
    allocateRequestId() {
      return 'v02q-001';
    },
    async getTabUrl() {
      return PAGE_URL;
    },
    async grantedOrigins() {
      return [];
    },
    async requestOrigins(origins) {
      permissionRequests.push([...origins]);
      return false;
    },
    async sendSeamFrame(frame) {
      sent.push(frame);
      return {
        kind: 'FRAME',
        message: v02AcceptedFor(frame as { requestId: string; aggregateId: string }),
      };
    },
    ...overrides,
  };
  return { ports, sent, permissionRequests };
}

describe('v02 lane — positive submission', () => {
  it('submits one bound v0.2 DOMAIN_APP_SEND over the trusted boundary and renders the acceptance', async () => {
    const { ports, sent, permissionRequests } = fakePorts();
    const outcome = await runV02Submit(validGesture(), ports);
    expect(outcome.outcome).toBe('ADMITTED');
    if (outcome.outcome !== 'ADMITTED') return;
    expect(outcome.lineageId).toBe('lineage-001');
    expect(outcome.requestId).toBe('req-001');
    expect(outcome.acceptance).toEqual({
      requestId: 'req-001',
      aggregateId: 'lineage-001',
      revision: 0,
      converged: false,
    });
    // Exactly one frame crossed, and it is the explicit v0.2 envelope with
    // the sealed intent bound to the envelope identity.
    expect(sent.length).toBe(1);
    const frame = sent[0] as Record<string, unknown>;
    expect(frame['kind']).toBe('command');
    expect(frame['route']).toBe('v0.2');
    expect(frame['commandType']).toBe('DOMAIN_APP_SEND');
    expect(frame['requestId']).toBe('req-001');
    expect(frame['aggregateId']).toBe('lineage-001');
    // The empty requirement set must never touch the permission machinery
    // (request only when required — and nothing is required here).
    expect(permissionRequests.length).toBe(0);
  });

  it('the outcome never echoes the confirmed intent (no credential/cookie surface)', async () => {
    const { ports } = fakePorts();
    const outcome = await runV02Submit(validGesture(), ports);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('ref:target-001');
    expect(serialized).not.toContain('authorized-root');
    expect(serialized).not.toContain('intent');
  });
});

describe('v02 lane — origin authority', () => {
  it('cancels when the tab navigated away from the observed page URL (nothing sent)', async () => {
    const { ports, sent } = fakePorts({
      async getTabUrl() {
        return 'http://127.0.0.1:43181/v02/other-page';
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    expect(outcome.outcome).toBe('REFUSED');
    if (outcome.outcome !== 'REFUSED') return;
    expect(outcome.code).toBe(V02_LANE_REFUSALS.ORIGIN_MISMATCH);
    expect(sent.length).toBe(0);
  });

  it('cancels when the tab exposes no trustworthy http(s) origin', async () => {
    const { ports, sent } = fakePorts({
      async getTabUrl() {
        return 'chrome://settings';
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe(V02_LANE_REFUSALS.ORIGIN_UNAVAILABLE);
    expect(sent.length).toBe(0);
  });

  it('the malformed-target negatives never reach the transport', async () => {
    // A raw URL as the "targetRef" is exactly the locator-substitution the
    // canonical gate refuses (verbatim diagnostics, nothing sent).
    const rawLocator = await runV02Submit(
      { ...validGesture(), action: { ...ACTION, targetRef: 'https://evil.example/file.bin' } },
      fakePorts().ports,
    );
    expect(rawLocator.outcome).toBe('REFUSED');
    if (rawLocator.outcome !== 'REFUSED') return;
    expect(rawLocator.code).toBe(V02_LANE_REFUSALS.INTENT_REFUSED);
    expect(
      rawLocator.diagnostics?.some((entry) => entry.code === 'LOCATOR_SUBSTITUTION_REJECTED'),
    ).toBe(true);
    // A smuggled extra action field fails closed at the decoder.
    const smuggled = await runV02Submit(
      {
        ...validGesture(),
        action: { ...ACTION, cookies: 'document.cookie' },
      },
      fakePorts().ports,
    );
    expect(smuggled.outcome).toBe('REFUSED');
    if (smuggled.outcome !== 'REFUSED') return;
    expect(smuggled.code).toBe(V02_LANE_REFUSALS.MESSAGE_MALFORMED);
    // An unknown top-level field fails closed too.
    const unknownField = await runV02Submit(
      { ...validGesture(), pageContent: '<html>' },
      fakePorts().ports,
    );
    if (unknownField.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(unknownField.code).toBe(V02_LANE_REFUSALS.MESSAGE_MALFORMED);
  });

  it('the decoder refuses non-object payloads and forged kinds', () => {
    expect(decodeV02AddDownloadGesture(null).ok).toBe(false);
    expect(
      decodeV02AddDownloadGesture({ ...validGesture(), kind: 'S2_SELECT_ATTACHMENT' }).ok,
    ).toBe(false);
    expect(decodeV02AddDownloadGesture({ ...validGesture(), tabId: -1 }).ok).toBe(false);
    expect(decodeV02AddDownloadGesture({ ...validGesture(), pageUrl: 'ftp://x/y' }).ok).toBe(false);
    const status = decodeV02JobStatusQuery({ kind: 'V02_JOB_STATUS', lineageId: 'lineage-001' });
    expect(status.ok).toBe(true);
    expect(
      decodeV02JobStatusQuery({ kind: 'V02_JOB_STATUS', lineageId: 'x', smuggled: 1 }).ok,
    ).toBe(false);
  });
});

describe('v02 lane — permission decision', () => {
  it('requests host access ONLY when a requirement is declared and ungranted; denial cancels before any send', async () => {
    const { ports, sent, permissionRequests } = fakePorts();
    const denied = await runV02Submit(validGesture(), ports, {
      permissionRequirements: ['https://example.com/*'],
    });
    expect(denied.outcome).toBe('REFUSED');
    if (denied.outcome !== 'REFUSED') return;
    expect(denied.code).toBe(V02_LANE_REFUSALS.PERMISSION_DENIED);
    expect(permissionRequests).toEqual([['https://example.com/*']]);
    expect(sent.length).toBe(0);
  });

  it('does not re-prompt when the required origin is already granted', async () => {
    const { ports, sent, permissionRequests } = fakePorts({
      async grantedOrigins() {
        return ['https://example.com/*'];
      },
    });
    const outcome = await runV02Submit(validGesture(), ports, {
      permissionRequirements: ['https://example.com/*'],
    });
    expect(outcome.outcome).toBe('ADMITTED');
    expect(permissionRequests.length).toBe(0);
    expect(sent.length).toBe(1);
  });

  it('the decision module never widens beyond the declared requirement', () => {
    expect(V02_SUBMISSION_REQUIRED_ORIGINS).toEqual([]);
    expect(decideSubmissionPermission([], [])).toEqual({ kind: 'NOT_REQUIRED' });
    expect(decideSubmissionPermission(['https://a/*'], ['https://a/*'])).toEqual({
      kind: 'GRANTED',
    });
    const needed = decideSubmissionPermission(['https://a/*', 'https://b/*'], ['https://a/*']);
    expect(needed).toEqual({ kind: 'REQUEST_NEEDED', origins: ['https://b/*'] });
    expect(permissionRationale([])).toContain('No extra browser permission');
    expect(permissionRationale(['https://a/*'])).toContain('denying it cancels the action');
  });
});

describe('v02 lane — trusted Host answer classes (fail closed)', () => {
  it('a disconnected host refuses with the actionable absence code', async () => {
    const { ports, sent } = fakePorts({
      async sendSeamFrame(frame) {
        sent.push(frame);
        return { kind: 'DISCONNECTED' } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe(V02_LANE_REFUSALS.HOST_ABSENT);
    expect(outcome.detail).toContain('Nothing was submitted');
    expect(sent.length).toBe(1); // the frame crossed, but no effect was admitted
  });

  it('a timed-out host refuses without an implicit pass', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame() {
        return { kind: 'TIMEOUT' } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe(V02_LANE_REFUSALS.HOST_TIMEOUT);
  });

  it('a broker-level rejection passes the typed reasons through verbatim (bounded)', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame() {
        return {
          kind: 'BROKER_REJECTION',
          reasons: [{ message: 'unknown broker command kind; fail closed' }],
        } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe(V02_LANE_REFUSALS.HOST_CARRIER_REJECTED);
    expect(outcome.detail).toContain('unknown broker command kind; fail closed');
  });

  it('a seam rejection passes the verbatim diagnostics through', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame() {
        return {
          kind: 'FRAME',
          message: {
            schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaVersion() },
            kind: 'response',
            route: 'v0.2',
            inReplyTo: 'req-001',
            outcome: 'REJECTED',
            diagnostics: [
              {
                code: 'CONTRACT_BINDING_MISMATCH',
                path: 'intent.allowedOperation',
                message: 'route refused this operation before any effect',
              },
            ],
          },
        } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe('HOST_CHECK_REJECTED');
    expect(outcome.diagnostics?.[0]?.code).toBe('CONTRACT_BINDING_MISMATCH');
  });

  it('a legacy-routed ACCEPTED answer never admits the v0.2 send (route echo binding)', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame(frame) {
        const accepted = v02AcceptedFor(frame as { requestId: string; aggregateId: string });
        return { kind: 'FRAME', message: { ...accepted, route: undefined } } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Submit(validGesture(), ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe('HOST_ROUTE_MISMATCH');
  });
});

describe('v02 lane — status reads', () => {
  it('renders the Core-owned projection verbatim (UNKNOWN stays UNKNOWN)', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame() {
        return {
          kind: 'FRAME',
          message: {
            schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaVersion() },
            kind: 'response',
            route: 'v0.2',
            inReplyTo: 'v02q-001',
            outcome: 'PROJECTION',
            projection: projectionOf('UNKNOWN'),
          },
        } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Status('lineage-001', ports);
    expect(outcome.outcome).toBe('PROJECTION');
    if (outcome.outcome !== 'PROJECTION') return;
    expect(outcome.projection.status).toBe('UNKNOWN');
    expect(outcome.projection.owner).toBe('new-k');
    expect(outcome.projection.progress).toBeUndefined();
  });

  it('a failed status read keeps the typed refusal (no fabricated status)', async () => {
    const { ports } = fakePorts({
      async sendSeamFrame() {
        return {
          kind: 'FRAME',
          message: {
            schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaVersion() },
            kind: 'response',
            route: 'v0.2',
            inReplyTo: 'v02q-001',
            outcome: 'REJECTED',
            diagnostics: [
              {
                code: 'JOB_PROJECTION_UNAVAILABLE',
                projection: 'projection',
                message: 'no v0.2 job projection exists for this lineage',
              },
            ],
          },
        } as V02FrameAnswer;
      },
    });
    const outcome = await runV02Status('lineage-001', ports);
    if (outcome.outcome !== 'REFUSED') throw new Error('must refuse');
    expect(outcome.code).toBe('HOST_QUERY_REJECTED');
    expect(outcome.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_UNAVAILABLE');
  });
});
