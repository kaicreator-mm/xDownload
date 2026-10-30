import { describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  currentSeamSchemaIdentity,
  decodeSeamEnvelope,
  decodeSeamResponse,
  EXPECTED_PEER,
  peer,
  requestId,
  seamDiagnostic,
  seamFail,
  seamOk,
  type CoreSeamServerOptions,
} from './helpers.ts';
import { validateConfirmedIntent } from '@xdownload/download-domain-app';
import { v02JobProjectionFixture } from '../../domain-contracts/test/fixtures/v0.2-job-projection.ts';

function makeServer(options: Omit<CoreSeamServerOptions, 'expectedPeer'> = {}) {
  const created = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, ...options });
  if (!created.ok) throw new Error('Core seam construction failed');
  return created.value;
}

function rawV02Query(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'query',
    route: 'v0.2',
    queryType: 'READ_JOB_PROJECTION',
    peer: peer(),
    requestId: requestId(),
    aggregateId: v02JobProjectionFixture.lineageId,
    issuedAt: '2026-10-30T00:00:00Z',
    ...overrides,
  };
}

const validIntent = {
  requestId: 'req-v02-001',
  lineageId: 'lineage-001',
  targetRef: 'target-opaque-001',
  outputRootScope: 'C:\\downloads',
  allowedOperation: 'acquisition.acquire',
  slice: 'S1',
  caller: { actor: 'cli', sessionRef: 'session-001' },
};

function rawV02Command(
  intent: unknown = validIntent,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    route: 'v0.2',
    commandType: 'DOMAIN_APP_SEND',
    peer: peer(),
    requestId: 'req-v02-001',
    aggregateId: 'lineage-001',
    issuedAt: '2026-10-30T00:00:00Z',
    payload: { intent },
    ...overrides,
  };
}

describe('v0.2 Core seam route', () => {
  it('requires the explicit v0.2 route for the job projection query', () => {
    const missing = rawV02Query();
    delete missing['route'];
    const missingResult = decodeSeamEnvelope(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.some((item) => item.code === 'ROUTE_REQUIRED')).toBe(true);
    }

    const unknown = decodeSeamEnvelope(rawV02Query({ route: 'v0.3' }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.diagnostics.some((item) => item.code === 'UNSUPPORTED_ROUTE')).toBe(true);
    }

    const wrongQuery = decodeSeamEnvelope(rawV02Query({ queryType: 'READ_PROJECTION' }));
    expect(wrongQuery.ok).toBe(false);
    if (!wrongQuery.ok) {
      expect(wrongQuery.diagnostics.some((item) => item.code === 'ROUTE_QUERY_MISMATCH')).toBe(
        true,
      );
    }
  });

  it('keeps the legacy READ_PROJECTION envelope compatible without a route field', () => {
    const legacy = {
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
      kind: 'query',
      queryType: 'READ_PROJECTION',
      peer: peer(),
      requestId: requestId(),
      aggregateId: 'contract-legacy-001',
      issuedAt: '2026-10-30T00:00:00Z',
    };
    const decoded = decodeSeamEnvelope(legacy);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect('route' in decoded.value).toBe(false);
      expect(decoded.value.kind).toBe('query');
    }
  });

  it('reads a validated v0.2 job projection through the typed read-only provider', () => {
    let requestedLineage: string | undefined;
    const server = makeServer({
      jobProjectionProvider: {
        read(lineageId) {
          requestedLineage = lineageId;
          return seamOk(v02JobProjectionFixture);
        },
      },
    });
    const response = server.handleFrame(JSON.stringify(rawV02Query()));
    expect(requestedLineage).toBe(v02JobProjectionFixture.lineageId);
    expect(response.outcome).toBe('PROJECTION');
    expect(response.route).toBe('v0.2');
    const decodedResponse = decodeSeamResponse(response);
    expect(decodedResponse.ok).toBe(true);
    if (!decodedResponse.ok) return;
    expect(decodedResponse.value.route).toBe('v0.2');
    expect(decodedResponse.value.projection).toEqual(v02JobProjectionFixture);
  });

  it('canonical-decodes v0.2 job projection responses at the client boundary', () => {
    const response = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      route: 'v0.2',
      inReplyTo: requestId(),
      outcome: 'PROJECTION',
      projection: v02JobProjectionFixture,
    };
    const decoded = decodeSeamResponse(response);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.projection).toEqual(v02JobProjectionFixture);
    expect(Object.isFrozen(decoded.value.projection)).toBe(true);
  });

  it('rejects missing, unknown-field and semantically invalid v0.2 response projections', () => {
    const response = (projection?: unknown) => ({
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'response',
      route: 'v0.2',
      inReplyTo: requestId(),
      outcome: 'PROJECTION',
      ...(projection === undefined ? {} : { projection }),
    });

    const missing = decodeSeamResponse(response());
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(
        missing.diagnostics.some((item) => item.code === 'MALFORMED_REQUIRED_FIELD'),
      ).toBe(true);
    }

    const unknownField = decodeSeamResponse(
      response({ ...v02JobProjectionFixture, surfaceOnlyStatus: 'DONE' }),
    );
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.diagnostics.some((item) => item.code === 'UNKNOWN_FIELD')).toBe(true);
    }

    const invalidProgress = decodeSeamResponse(
      response({
        ...v02JobProjectionFixture,
        progress: { transferredBytes: 101, totalBytes: { kind: 'KNOWN', bytes: 100 } },
      }),
    );
    expect(invalidProgress.ok).toBe(false);
    if (!invalidProgress.ok) {
      expect(
        invalidProgress.diagnostics.some((item) => item.code === 'INVALID_RESULT_COMBINATION'),
      ).toBe(true);
    }
  });

  it('preserves legacy projection responses without the explicit v0.2 route', () => {
    const legacyProjection = { legacyStatus: 'RUNNING', providerExtension: true };
    const decoded = decodeSeamResponse({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
      kind: 'response',
      inReplyTo: requestId(),
      outcome: 'PROJECTION',
      projection: legacyProjection,
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.route).toBeUndefined();
      expect(decoded.value.projection).toEqual(legacyProjection);
    }
  });

  it('fails closed when the v0.2 projection provider is absent or unavailable', () => {
    const noProvider = makeServer().handleFrame(JSON.stringify(rawV02Query()));
    expect(noProvider.outcome).toBe('REJECTED');
    expect(noProvider.route).toBe('v0.2');
    expect(noProvider.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_UNAVAILABLE');

    const refused = makeServer({
      jobProjectionProvider: {
        read() {
          return seamFail([
            seamDiagnostic(
              'LINEAGE_OWNER_AMBIGUOUS',
              'lineageOwner',
              'both ownership facts cannot be established',
            ),
          ]);
        },
      },
    }).handleFrame(JSON.stringify(rawV02Query()));
    expect(refused.outcome).toBe('REJECTED');
    expect(refused.diagnostics?.[0]?.code).toBe('LINEAGE_OWNER_AMBIGUOUS');
  });

  it('rejects malformed or misbound job projections before returning them', () => {
    const mismatch = makeServer({
      jobProjectionProvider: {
        read() {
          return seamOk({ ...v02JobProjectionFixture, lineageId: 'another-lineage' });
        },
      },
    }).handleFrame(JSON.stringify(rawV02Query()));
    expect(mismatch.diagnostics?.[0]?.code).toBe('JOB_PROJECTION_BINDING_MISMATCH');

    const malformed = makeServer({
      jobProjectionProvider: {
        read() {
          return seamOk({ ...v02JobProjectionFixture, surfaceOnlyStatus: 'DONE' });
        },
      },
    }).handleFrame(JSON.stringify(rawV02Query()));
    expect(malformed.diagnostics?.[0]?.code).toBe('UNKNOWN_FIELD');
  });

  it('requires the v0.2 command route and the existing exact-key intent validator', () => {
    const noRoute = rawV02Command();
    delete noRoute['route'];
    const noRouteResult = decodeSeamEnvelope(noRoute);
    expect(noRouteResult.ok).toBe(false);
    if (!noRouteResult.ok) {
      expect(noRouteResult.diagnostics.some((item) => item.code === 'ROUTE_REQUIRED')).toBe(true);
    }

    const noValidator = makeServer().handleFrame(JSON.stringify(rawV02Command()));
    expect(noValidator.outcome).toBe('REJECTED');
    expect(noValidator.diagnostics?.[0]?.code).toBe('V02_INTENT_VALIDATOR_UNAVAILABLE');

    const server = makeServer({ v02IntentDecoder: validateConfirmedIntent });
    const acceptedShape = decodeSeamEnvelope(rawV02Command());
    expect(acceptedShape.ok).toBe(true);
    const response = server.handleFrame(JSON.stringify(rawV02Command()));
    expect(response.outcome).toBe('REJECTED');
    expect(response.diagnostics?.[0]?.code).toBe('V02_COMMAND_ROUTE_UNAVAILABLE');
    expect(server.inspectProjection('lineage-001')).toBeUndefined();
  });

  it('rejects widened and misbound intents before the v0.2 command route can send', () => {
    const server = makeServer({ v02IntentDecoder: validateConfirmedIntent });
    const widened = server.handleFrame(
      JSON.stringify(
        rawV02Command({
          ...validIntent,
          extraScope: 'widened',
        }),
      ),
    );
    expect(widened.outcome).toBe('REJECTED');
    expect(widened.diagnostics?.[0]?.code).toBe('SCOPE_WIDENING_REFUSED');

    const misbound = server.handleFrame(
      JSON.stringify(rawV02Command(validIntent, { aggregateId: 'different-lineage' })),
    );
    expect(misbound.outcome).toBe('REJECTED');
    expect(misbound.diagnostics?.[0]?.code).toBe('V02_COMMAND_BINDING_MISMATCH');
    expect(server.inspectProjection('lineage-001')).toBeUndefined();
    expect(server.inspectProjection('different-lineage')).toBeUndefined();
  });

  it('requires schema 1.3.0 for the v0.2 route while accepting historical major-1 queries', () => {
    const oldRoute = rawV02Query({
      schemaIdentity: { schema: 'xdownload.core-seam', version: '1.2.0' },
    });
    const decoded = decodeSeamEnvelope(oldRoute);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.diagnostics.some((item) => item.code === 'UNSUPPORTED_ENVELOPE_VERSION')).toBe(
        true,
      );
    }
  });
});
