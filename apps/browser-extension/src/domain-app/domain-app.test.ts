/**
 * v0.2 T08 pure-function verification — node:test, no browser runtime.
 *
 * Covers the four frozen verification axes: constructor field whitelist,
 * unauthorized-field rejection, tampered-payload rejection and host-check
 * failure rejection. The real Windows browser/native session proof is
 * explicitly T15 validation and is NOT exercised here (NOT_RUN in this lane).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CORE_SEAM_SCHEMA_ID,
  currentSeamSchemaIdentity,
  type SeamResponse,
} from '@xdownload/core-seam';

import {
  AUTHORIZATION_PAYLOAD_FIELDS,
  buildAuthorizationPayload,
  gateConfirmedAuthorization,
  authorizeBoundedSubmission,
  buildNativeHostCheckRequest,
  evaluateNativeHostCheck,
  NATIVE_HOST_CHECK_COMMAND_TYPE,
  NATIVE_HOST_CHECK_SURFACE,
  type BrowserAuthorizationAction,
  type ConfirmationIdentity,
} from './index.ts';

const SHA = 'a'.repeat(64);
const ROOT = 'C:/tmp/authorized-root';
const IDENTITY: ConfirmationIdentity = { requestId: 'req-001', lineageId: 'lineage-001' };
const CONTEXT = {
  installId: 'install-001',
  userId: 'user-001',
  requestId: 'req-check-001',
  now: () => '2026-10-29T00:00:00.000Z',
};

function baseAction(): BrowserAuthorizationAction {
  return {
    targetRef: 'ref:target-001',
    outputRootScope: ROOT,
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: SHA,
    declaredBytes: 1024,
    caller: { actor: 'browser-extension', sessionRef: 'session-browser-001' },
  };
}

/** A sealed payload through the real constructor (all optional fields set). */
function sealedPayload() {
  return buildAuthorizationPayload(IDENTITY, baseAction());
}

function acceptedHostResponse(request: { requestId: string; aggregateId: string }): SeamResponse {
  return {
    schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: '1.2.0' },
    kind: 'response',
    inReplyTo: request.requestId as SeamResponse['inReplyTo'],
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: request.requestId as SeamResponse['inReplyTo'],
      aggregateId: request.aggregateId,
      revision: 1,
      converged: false,
    },
  };
}

describe('authorization payload constructor — field whitelist', () => {
  it('emits exactly the frozen whitelist (no browser context field exists)', () => {
    const payload = sealedPayload();
    assert.deepEqual(
      Object.keys(payload).sort(),
      [...AUTHORIZATION_PAYLOAD_FIELDS].sort(),
    );
    assert.deepEqual([...AUTHORIZATION_PAYLOAD_FIELDS].sort(), [
      'allowedOperation',
      'caller',
      'declaredBytes',
      'digestAnchor',
      'lineageId',
      'outputRootScope',
      'requestId',
      'slice',
      'targetRef',
    ]);
  });

  it('copies confirmation fields verbatim and omits absent optionals', () => {
    const full = sealedPayload();
    assert.equal(full.requestId, 'req-001');
    assert.equal(full.lineageId, 'lineage-001');
    assert.equal(full.targetRef, 'ref:target-001');
    assert.equal(full.outputRootScope, ROOT);
    assert.equal(full.allowedOperation, 'acquisition.acquire');
    assert.equal(full.slice, 'S1');
    assert.equal(full.digestAnchor, SHA);
    assert.equal(full.declaredBytes, 1024);
    assert.deepEqual(full.caller, { actor: 'browser-extension', sessionRef: 'session-browser-001' });

    const leanAction = baseAction();
    const lean = buildAuthorizationPayload(IDENTITY, {
      ...leanAction,
      digestAnchor: undefined,
      declaredBytes: undefined,
    });
    assert.equal('digestAnchor' in lean, false);
    assert.equal('declaredBytes' in lean, false);
  });

  it('the sealed payload is frozen and carries no index signature escape hatch', () => {
    const payload = sealedPayload();
    assert.equal(Object.isFrozen(payload), true);
    assert.equal(Object.isFrozen(payload.caller), true);
    assert.throws(() => {
      (payload as unknown as Record<string, unknown>).allowedOperation = 'media.acquire';
    }, TypeError);
  });
});

describe('unauthorized-field rejection (no scope widening)', () => {
  it('never copies browser context (cookies/tabs/history) into the payload', () => {
    const polluted = Object.assign(baseAction(), {
      cookies: 'SESS=secret',
      tabs: [{ id: 1, url: 'http://127.0.0.1:1/evil' }],
      pageHistory: ['http://127.0.0.1:2/'],
    });
    (polluted.caller as unknown as Record<string, unknown>).history = 'visited-pages';
    const payload = buildAuthorizationPayload(IDENTITY, polluted);
    for (const forbidden of ['cookies', 'tabs', 'pageHistory', 'history']) {
      assert.equal(forbidden in payload, false, `${forbidden} must never reach the payload`);
    }
    assert.deepEqual(payload.caller, {
      actor: 'browser-extension',
      sessionRef: 'session-browser-001',
    });
  });

  it('the gate refuses unknown payload fields with SCOPE_WIDENING_REFUSED', () => {
    const widened = { ...sealedPayload(), extraScope: 'http://127.0.0.1:1/evil' };
    const decision = gateConfirmedAuthorization(widened);
    assert.equal(decision.authorized, false);
    if (!decision.authorized) {
      assert.equal(decision.diagnostics[0]?.code, 'SCOPE_WIDENING_REFUSED');
      assert.equal(decision.diagnostics[0]?.path, 'extraScope');
    }
  });

  it('the gate refuses a raw URL as targetRef (LOCATOR_SUBSTITUTION_REJECTED)', () => {
    const decision = gateConfirmedAuthorization({
      ...sealedPayload(),
      targetRef: 'http://127.0.0.1:8080/file.bin',
    });
    assert.equal(decision.authorized, false);
    if (!decision.authorized) {
      assert.equal(decision.diagnostics[0]?.code, 'LOCATOR_SUBSTITUTION_REJECTED');
    }
  });

  it('the gate passes canonical T01 rejection codes through verbatim', () => {
    const decision = gateConfirmedAuthorization({ ...sealedPayload(), slice: 'S2' });
    assert.equal(decision.authorized, false);
    if (!decision.authorized) {
      assert.equal(decision.diagnostics[0]?.code, 'MALFORMED_REQUIRED_FIELD');
      assert.equal(decision.diagnostics[0]?.path, 'slice');
    }
  });
});

describe('tampered-payload rejection', () => {
  it('accepts the untampered payload and freezes the confirmed intent', () => {
    const decision = gateConfirmedAuthorization(sealedPayload());
    assert.equal(decision.authorized, true);
    if (decision.authorized) {
      assert.equal(Object.isFrozen(decision.intent), true);
      assert.equal(decision.intent.requestId, 'req-001');
    }
  });

  it('refuses tampered digest anchors, sizes and output roots', () => {
    assert.equal(gateConfirmedAuthorization({ ...sealedPayload(), digestAnchor: 'not-hex' }).authorized, false);
    const oversize = { ...sealedPayload(), declaredBytes: 1_099_511_627_777 };
    assert.equal(gateConfirmedAuthorization(oversize).authorized, false);
    assert.equal(
      gateConfirmedAuthorization({ ...sealedPayload(), outputRootScope: 'C:/tmp/../secrets' }).authorized,
      false,
    );
    assert.equal(
      gateConfirmedAuthorization({ ...sealedPayload(), outputRootScope: 'relative/root' }).authorized,
      false,
    );
  });

  it('refuses a stripped required field (missing is not omission)', () => {
    const stripped: Record<string, unknown> = { ...sealedPayload() };
    delete stripped['targetRef'];
    const decision = gateConfirmedAuthorization(stripped);
    assert.equal(decision.authorized, false);
    if (!decision.authorized) {
      assert.equal(decision.diagnostics[0]?.code, 'MISSING_REQUIRED_FIELD');
      assert.equal(decision.diagnostics[0]?.path, 'targetRef');
    }
  });

  it('refuses non-object and malformed candidates', () => {
    assert.equal(gateConfirmedAuthorization(null).authorized, false);
    assert.equal(gateConfirmedAuthorization('intent').authorized, false);
    assert.equal(gateConfirmedAuthorization([sealedPayload()]).authorized, false);
  });
});

describe('native-host check request construction', () => {
  it('builds a core-seam-aligned command envelope with the sealed intent as payload', () => {
    const intent = sealedPayload();
    const result = buildNativeHostCheckRequest(intent, CONTEXT);
    assert.equal(result.ok, true);
    if (result.ok) {
      const request = result.request;
      assert.deepEqual(request.schemaIdentity, currentSeamSchemaIdentity());
      assert.equal(request.schemaIdentity.schema, CORE_SEAM_SCHEMA_ID);
      assert.equal(request.kind, 'command');
      assert.equal(request.commandType, NATIVE_HOST_CHECK_COMMAND_TYPE);
      assert.equal(NATIVE_HOST_CHECK_COMMAND_TYPE, 'SUBMIT_CONTRACT');
      assert.deepEqual(request.peer, {
        installId: 'install-001',
        userId: 'user-001',
        surface: NATIVE_HOST_CHECK_SURFACE,
      });
      assert.equal(NATIVE_HOST_CHECK_SURFACE, 'BROWSER_EXTENSION');
      assert.equal(request.requestId, 'req-check-001');
      assert.equal(request.aggregateId, intent.requestId);
      assert.equal(request.expectedRevision, 0);
      assert.equal(request.issuedAt, '2026-10-29T00:00:00.000Z');
      assert.equal(request.payload, intent);
    }
  });

  it('fails closed on identities rejected by the seam id rules', () => {
    const intent = sealedPayload();
    assert.equal(buildNativeHostCheckRequest(intent, { ...CONTEXT, requestId: 'bad id!' }).ok, false);
    assert.equal(buildNativeHostCheckRequest(intent, { ...CONTEXT, installId: '' }).ok, false);
    assert.equal(buildNativeHostCheckRequest(intent, { ...CONTEXT, userId: 'bad user!' }).ok, false);
  });
});

describe('native-host check evaluation — every failure refuses the submission', () => {
  const intent = sealedPayload();
  const request = buildNativeHostCheckRequest(intent, CONTEXT);
  assert.ok(request.ok);
  if (!request.ok) throw new Error('unreachable');
  const envelope = request.request;

  it('accepts a well-formed, bound ACCEPTED host answer', () => {
    const decision = evaluateNativeHostCheck(envelope, acceptedHostResponse(envelope));
    assert.equal(decision.accepted, true);
    if (decision.accepted) {
      assert.equal(decision.response.outcome, 'ACCEPTED');
    }
  });

  it('refuses an ABSENT host answer (fail-closed: no answer is never a pass)', () => {
    for (const absent of [undefined, null]) {
      const decision = evaluateNativeHostCheck(envelope, absent);
      assert.equal(decision.accepted, false);
      if (!decision.accepted) {
        assert.equal(decision.reason, 'HOST_RESPONSE_ABSENT');
      }
    }
  });

  it('refuses malformed answers and unsupported seam major versions', () => {
    const garbage = evaluateNativeHostCheck(envelope, { nope: true });
    assert.equal(garbage.accepted, false);
    if (!garbage.accepted) assert.equal(garbage.reason, 'HOST_RESPONSE_MALFORMED');

    const wrongMajor = acceptedHostResponse(envelope);
    const future = {
      ...wrongMajor,
      schemaIdentity: { schema: CORE_SEAM_SCHEMA_ID, version: '2.0.0' },
    };
    const futureDecision = evaluateNativeHostCheck(envelope, future);
    assert.equal(futureDecision.accepted, false);
    if (!futureDecision.accepted) assert.equal(futureDecision.reason, 'HOST_RESPONSE_MALFORMED');

    const noAcceptance = { ...acceptedHostResponse(envelope), acceptance: undefined };
    const noAcceptanceDecision = evaluateNativeHostCheck(envelope, noAcceptance);
    assert.equal(noAcceptanceDecision.accepted, false);
    if (!noAcceptanceDecision.accepted) assert.equal(noAcceptanceDecision.reason, 'HOST_RESPONSE_MALFORMED');
  });

  it('refuses answers bound to a different request or aggregate', () => {
    const unbound = { ...acceptedHostResponse(envelope), inReplyTo: 'req-other-001' };
    const decision = evaluateNativeHostCheck(envelope, unbound);
    assert.equal(decision.accepted, false);
    if (!decision.accepted) assert.equal(decision.reason, 'HOST_RESPONSE_UNBOUND');

    const rebound = acceptedHostResponse(envelope);
    const reboundAcceptance = { ...rebound.acceptance, aggregateId: 'req-other-001' };
    const reboundDecision = evaluateNativeHostCheck(envelope, {
      ...rebound,
      acceptance: reboundAcceptance,
    });
    assert.equal(reboundDecision.accepted, false);
    if (!reboundDecision.accepted) assert.equal(reboundDecision.reason, 'HOST_RESPONSE_UNBOUND');
  });

  it('refuses an explicit rejection and passes the host diagnostics through', () => {
    const rejected = {
      ...acceptedHostResponse(envelope),
      outcome: 'REJECTED' as const,
      acceptance: undefined,
      diagnostics: [{ code: 'ADMISSION_REJECTED' as const, path: 'payload', message: 'host check unsatisfied' }],
    };
    const decision = evaluateNativeHostCheck(envelope, rejected);
    assert.equal(decision.accepted, false);
    if (!decision.accepted) {
      assert.equal(decision.reason, 'HOST_CHECK_REJECTED');
      assert.equal(decision.diagnostics?.[0]?.code, 'ADMISSION_REJECTED');
      assert.equal(decision.diagnostics?.[0]?.message, 'host check unsatisfied');
    }
  });

  it('refuses any non-ACCEPTED command outcome (e.g. a PROJECTION frame)', () => {
    const projection = {
      ...acceptedHostResponse(envelope),
      outcome: 'PROJECTION' as const,
      projection: { some: 'aggregate' },
    };
    const decision = evaluateNativeHostCheck(envelope, projection);
    assert.equal(decision.accepted, false);
    if (!decision.accepted) assert.equal(decision.reason, 'HOST_OUTCOME_UNEXPECTED');
  });
});

describe('bounded submission pipeline — stage ordering and fail-closed refusals', () => {
  it('admits only gate-passing, request-buildable, host-accepted candidates', () => {
    const decision = authorizeBoundedSubmission(sealedPayload(), CONTEXT, undefined);
    assert.equal(decision.outcome, 'REFUSED_AT_HOST');
    assert.ok(decision.outcome === 'REFUSED_AT_HOST' && decision.reason === 'HOST_RESPONSE_ABSENT');

    const admitted = authorizeBoundedSubmission(
      sealedPayload(),
      CONTEXT,
      // the real request is rebuilt inside the pipeline; bind to its identity
      acceptedHostResponse({ requestId: 'req-check-001', aggregateId: 'req-001' }),
    );
    assert.equal(admitted.outcome, 'ADMITTED');
    if (admitted.outcome === 'ADMITTED') {
      assert.equal(admitted.intent.requestId, 'req-001');
      assert.equal(admitted.request.requestId, 'req-check-001');
      assert.equal(admitted.hostResponse.outcome, 'ACCEPTED');
    }
  });

  it('refuses at the gate before anything else when the payload is widened', () => {
    const decision = authorizeBoundedSubmission(
      { ...sealedPayload(), cookies: 'SESS=secret' },
      CONTEXT,
      acceptedHostResponse({ requestId: 'req-check-001', aggregateId: 'req-001' }),
    );
    assert.equal(decision.outcome, 'REFUSED_AT_GATE');
    assert.ok(
      decision.outcome === 'REFUSED_AT_GATE' && decision.diagnostics[0]?.code === 'SCOPE_WIDENING_REFUSED',
    );
  });

  it('refuses at request construction when the request identity breaks the seam id rules', () => {
    const decision = authorizeBoundedSubmission(
      sealedPayload(),
      { ...CONTEXT, requestId: 'not a valid id' },
      acceptedHostResponse({ requestId: 'req-check-001', aggregateId: 'req-001' }),
    );
    assert.equal(decision.outcome, 'REFUSED_AT_REQUEST');
  });
});
