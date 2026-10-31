/**
 * v0.2.1 T05 — the explicit Domain App v0.2 route builders (pure units).
 *
 * Pins the browser-side half of the cutover to the frozen seam grammar:
 * - the v0.2 DOMAIN_APP_SEND envelope (route/kind/commandType/payload
 *   binding, envelope identity == intent identity, no legacy-only fields);
 * - the v0.2 READ_JOB_PROJECTION query envelope;
 * - the fail-closed answer halves (absent/malformed/unbound/rejected/
 *   unexpected/route-mismatch/projection negatives all refuse).
 *
 * The real Chromium + installed Host session is T13 validation and stays
 * NOT_RUN in this lane.
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_SEAM_SCHEMA_ID,
  currentSeamSchemaIdentity,
  type SeamResponse,
} from '@xdownload/core-seam';
import type { DownloadJobProjection } from '@xdownload/domain-contracts';
import {
  buildAuthorizationPayload,
  buildV02DomainAppSend,
  buildV02JobProjectionQuery,
  evaluateV02ProjectionAnswer,
  evaluateV02SendAnswer,
  type ConfirmationIdentity,
  type V02RouteContext,
} from '../src/domain-app/index.ts';

const IDENTITY: ConfirmationIdentity = { requestId: 'req-001', lineageId: 'lineage-001' };
const ACTION = {
  targetRef: 'ref:target-001',
  outputRootScope: 'C:/tmp/authorized-root',
  allowedOperation: 'acquisition.acquire',
  slice: 'S1' as const,
  caller: { actor: 'browser-extension', sessionRef: 'session-browser-001' },
};
const CONTEXT: V02RouteContext = {
  installId: 'install-001',
  userId: 'user-001',
  now: () => '2026-10-31T00:00:00.000Z',
};

function sealedIntent() {
  return buildAuthorizationPayload(IDENTITY, ACTION);
}

function schemaIdentity() {
  return currentSeamSchemaIdentity();
}

function v02Accepted(request: { requestId: string; aggregateId: string }): SeamResponse {
  return {
    schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaIdentity().version },
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
    lineageId: IDENTITY.lineageId,
    owner: 'new-k',
    status,
    attempts: [
      {
        attemptId: 'attempt-1',
        sequence: 1,
        status: status === 'QUEUED' ? 'UNKNOWN' : status,
      },
    ],
    currentAttemptId: 'attempt-1',
  };
}

function projectionAnswer(
  request: { requestId: string; aggregateId: string },
  projection: unknown,
): SeamResponse {
  return {
    schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaIdentity().version },
    kind: 'response',
    route: 'v0.2',
    inReplyTo: request.requestId as SeamResponse['inReplyTo'],
    outcome: 'PROJECTION',
    projection,
  };
}

describe('v0.2 DOMAIN_APP_SEND envelope grammar', () => {
  it('carries the explicit v0.2 route, the closed command vocabulary and the sealed intent', () => {
    const built = buildV02DomainAppSend(sealedIntent(), CONTEXT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.kind).toBe('command');
    expect(built.request.route).toBe('v0.2');
    expect(built.request.commandType).toBe('DOMAIN_APP_SEND');
    expect(built.request.payload).toEqual({ intent: sealedIntent() });
    expect(built.request.peer.surface).toBe('BROWSER_EXTENSION');
    expect(built.request.peer.installId).toBe('install-001');
    expect(built.request.peer.userId).toBe('user-001');
    expect(built.request.issuedAt).toBe('2026-10-31T00:00:00.000Z');
  });

  it('binds the envelope identity to the intent identity (seam binding rule)', () => {
    const built = buildV02DomainAppSend(sealedIntent(), CONTEXT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.requestId).toBe('req-001');
    expect(built.request.aggregateId).toBe('lineage-001');
  });

  it('carries no legacy-only envelope fields (no expectedRevision, no correlation)', () => {
    const built = buildV02DomainAppSend(sealedIntent(), CONTEXT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect('expectedRevision' in built.request).toBe(false);
    expect('correlation' in built.request).toBe(false);
  });

  it('fails closed on a requestId the seam id rules reject', () => {
    const intent = buildAuthorizationPayload(
      { requestId: '-not-a-seam-token', lineageId: 'lineage-001' },
      ACTION,
    );
    const built = buildV02DomainAppSend(intent, CONTEXT);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('requestId');
  });

  it('fails closed on malformed peer identities (no frame is produced)', () => {
    const badInstall = buildV02DomainAppSend(sealedIntent(), { ...CONTEXT, installId: '' });
    expect(badInstall.ok).toBe(false);
    const badUser = buildV02DomainAppSend(sealedIntent(), { ...CONTEXT, userId: '' });
    expect(badUser.ok).toBe(false);
  });
});

describe('v0.2 READ_JOB_PROJECTION query envelope grammar', () => {
  it('carries the explicit v0.2 query route bound to the lineage', () => {
    const built = buildV02JobProjectionQuery('lineage-001', 'v02q-1', CONTEXT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.kind).toBe('query');
    expect(built.request.route).toBe('v0.2');
    expect(built.request.queryType).toBe('READ_JOB_PROJECTION');
    expect(built.request.aggregateId).toBe('lineage-001');
    expect(built.request.peer.surface).toBe('BROWSER_EXTENSION');
  });

  it('fails closed on a malformed query requestId or lineage-side peer identity', () => {
    expect(buildV02JobProjectionQuery('lineage-001', '', CONTEXT).ok).toBe(false);
    expect(buildV02JobProjectionQuery('lineage-001', 'v02q-1', { ...CONTEXT, userId: '' }).ok).toBe(
      false,
    );
  });
});

describe('v0.2 send answer evaluation (fail-closed matrix)', () => {
  const built = buildV02DomainAppSend(sealedIntent(), CONTEXT);
  if (!built.ok) throw new Error('fixture envelope must build');
  const request = built.request;

  it('accepts a bound, v0.2-routed ACCEPTED admission', () => {
    const check = evaluateV02SendAnswer(request, v02Accepted(request));
    expect(check.accepted).toBe(true);
    if (!check.accepted) return;
    expect(check.response.acceptance?.requestId).toBe('req-001');
    expect(check.response.acceptance?.aggregateId).toBe('lineage-001');
  });

  it('refuses an absent answer (absence is never an implicit pass)', () => {
    expect(evaluateV02SendAnswer(request, undefined).accepted).toBe(false);
    const refused = evaluateV02SendAnswer(request, null);
    expect(refused.accepted).toBe(false);
    if (refused.accepted) return;
    expect(refused.reason).toBe('HOST_RESPONSE_ABSENT');
  });

  it('refuses a malformed or unsupported-major answer', () => {
    const malformed = evaluateV02SendAnswer(request, { nonsense: true });
    expect(malformed.accepted).toBe(false);
    if (malformed.accepted) return;
    expect(malformed.reason).toBe('HOST_RESPONSE_MALFORMED');
    const unsupportedMajor = evaluateV02SendAnswer(request, {
      ...v02Accepted(request),
      schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: '2.0.0' },
    });
    expect(unsupportedMajor.accepted).toBe(false);
  });

  it('refuses an answer bound to another request (no cross-request admission)', () => {
    const unbound = { ...v02Accepted(request), inReplyTo: 'req-other' };
    const check = evaluateV02SendAnswer(request, unbound);
    expect(check.accepted).toBe(false);
    if (check.accepted) return;
    expect(check.reason).toBe('HOST_RESPONSE_UNBOUND');
  });

  it('refuses an explicit host rejection and passes the diagnostics through verbatim', () => {
    const rejection: SeamResponse = {
      schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaIdentity().version },
      kind: 'response',
      route: 'v0.2',
      inReplyTo: request.requestId as SeamResponse['inReplyTo'],
      outcome: 'REJECTED',
      diagnostics: [
        { code: 'LINEAGE_OWNER_CONFLICT', path: 'lineageOwner', message: 'owned elsewhere' },
      ],
    };
    const check = evaluateV02SendAnswer(request, rejection);
    expect(check.accepted).toBe(false);
    if (check.accepted) return;
    expect(check.reason).toBe('HOST_CHECK_REJECTED');
    expect(check.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_CONFLICT');
  });

  it('refuses a legacy-routed answer to a v0.2 send (route echo binding)', () => {
    const legacyAnswer = { ...v02Accepted(request), route: undefined };
    const check = evaluateV02SendAnswer(request, legacyAnswer);
    expect(check.accepted).toBe(false);
    if (check.accepted) return;
    expect(check.reason).toBe('HOST_ROUTE_MISMATCH');
  });

  it('refuses an ACCEPTED answer whose acceptance record is missing or re-bound', () => {
    const noAcceptance = { ...v02Accepted(request), acceptance: undefined };
    const missing = evaluateV02SendAnswer(request, noAcceptance);
    expect(missing.accepted).toBe(false);
    if (!missing.accepted) expect(missing.reason).toBe('HOST_RESPONSE_MALFORMED');
    const rebound = {
      ...v02Accepted(request),
      acceptance: {
        requestId: 'req-other',
        aggregateId: 'lineage-001',
        revision: 0,
        converged: false,
      },
    };
    const bound = evaluateV02SendAnswer(request, rebound);
    expect(bound.accepted).toBe(false);
    if (!bound.accepted) expect(bound.reason).toBe('HOST_RESPONSE_UNBOUND');
  });
});

describe('v0.2 job projection answer evaluation (fail-closed matrix)', () => {
  const built = buildV02JobProjectionQuery('lineage-001', 'v02q-1', CONTEXT);
  if (!built.ok) throw new Error('fixture query must build');
  const query = built.request;

  it('accepts a bound, well-formed Core-owned projection verbatim', () => {
    const check = evaluateV02ProjectionAnswer(
      query,
      projectionAnswer(query, projectionOf('RUNNING')),
    );
    expect(check.accepted).toBe(true);
    if (!check.accepted) return;
    expect(check.projection.status).toBe('RUNNING');
    expect(check.projection.owner).toBe('new-k');
    expect(check.projection.lineageId).toBe('lineage-001');
  });

  it('accepts an explicit UNKNOWN projection verbatim (never guessed into success)', () => {
    const check = evaluateV02ProjectionAnswer(
      query,
      projectionAnswer(query, projectionOf('UNKNOWN')),
    );
    expect(check.accepted).toBe(true);
    if (!check.accepted) return;
    expect(check.projection.status).toBe('UNKNOWN');
  });

  it('refuses absent, malformed and unbound answers (the shared seam discipline)', () => {
    expect(evaluateV02ProjectionAnswer(query, undefined).accepted).toBe(false);
    const malformed = evaluateV02ProjectionAnswer(query, 'not-a-response');
    if (!malformed.accepted) expect(malformed.reason).toBe('HOST_RESPONSE_MALFORMED');
    const unbound = { ...projectionAnswer(query, projectionOf('RUNNING')), inReplyTo: 'other' };
    const bound = evaluateV02ProjectionAnswer(query, unbound);
    if (!bound.accepted) expect(bound.reason).toBe('HOST_RESPONSE_UNBOUND');
  });

  it('refuses a query rejection with the verbatim seam diagnostics', () => {
    const rejection: SeamResponse = {
      schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: schemaIdentity().version },
      kind: 'response',
      route: 'v0.2',
      inReplyTo: query.requestId as SeamResponse['inReplyTo'],
      outcome: 'REJECTED',
      diagnostics: [
        {
          code: 'JOB_PROJECTION_UNAVAILABLE',
          path: 'projection',
          message: 'no v0.2 job projection exists for this lineage',
        },
      ],
    };
    const check = evaluateV02ProjectionAnswer(query, rejection);
    expect(check.accepted).toBe(false);
    if (check.accepted) return;
    expect(check.reason).toBe('HOST_QUERY_REJECTED');
    expect(check.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_UNAVAILABLE');
  });

  it('refuses a non-PROJECTION outcome; a malformed projection document fails at the seam decode layer', () => {
    const wrongOutcome = {
      ...projectionAnswer(query, projectionOf('RUNNING')),
      outcome: 'ACCEPTED',
    };
    const unexpected = evaluateV02ProjectionAnswer(query, wrongOutcome);
    if (!unexpected.accepted) expect(unexpected.reason).toBe('HOST_OUTCOME_UNEXPECTED');
    // The seam response decoder already decodes a v0.2 PROJECTION payload,
    // so a malformed document refuses as a malformed seam response — one
    // layer earlier than this evaluator's PROJECTION_MALFORMED defense.
    const broken = evaluateV02ProjectionAnswer(query, projectionAnswer(query, { junk: true }));
    if (!broken.accepted) expect(broken.reason).toBe('HOST_RESPONSE_MALFORMED');
  });

  it('refuses a projection belonging to a different lineage (aggregate binding)', () => {
    const foreign = projectionOf('RUNNING');
    const other: DownloadJobProjection = { ...foreign, lineageId: 'lineage-other' };
    const check = evaluateV02ProjectionAnswer(query, projectionAnswer(query, other));
    expect(check.accepted).toBe(false);
    if (check.accepted) return;
    expect(check.reason).toBe('HOST_RESPONSE_UNBOUND');
    expect(check.detail).toContain('lineage-other');
  });
});
