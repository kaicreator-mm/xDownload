/**
 * TEST_MATRIX suite `transport-restart-and-lifecycle-independence`:
 * - client submit survives Core restart; after restart the client reconnects
 *   and re-submits with the same identity without duplicating effects;
 * - a late command arriving after a lineage is terminal is recorded/rejected
 *   as late and never rewrites terminal truth (frozen L2 §11);
 * - CLI/browser/Desktop-shaped clients submit and read through the seam
 *   without owning Core lifetime (frozen L2 §9);
 * - cancellation/retry commands from different surfaces resolve through the
 *   same Core transition with one precedence (frozen L2 §11.1 rule 7).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  createSeamClient,
  stampPeer,
  decodeSeamEnvelope,
  type CoreSeamServer,
  type SeamServerTransport,
} from './helpers.ts';
import {
  EXPECTED_PEER,
  peer,
  queryEnvelope,
  rawCommand,
  rawQuery,
  rawSingleResourceContract,
  rawTerminalResult,
} from './helpers.ts';

const running: SeamServerTransport[] = [];

afterEach(async () => {
  for (const transport of running.splice(0)) {
    await transport.stop();
  }
});

function server(journal?: ReturnType<typeof createInMemorySeamJournal>): CoreSeamServer {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER, journal });
  if (!result.ok) {
    throw new Error('server construction failed');
  }
  return result.value;
}

async function startLoopback(s: CoreSeamServer): Promise<{ host: string; port: number }> {
  const transport = createLoopbackServerTransport({ host: '127.0.0.1', port: 0 });
  running.push(transport);
  return transport.start({
    onFrame: (connection, frame) => {
      const response = s.handleFrame(frame);
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  });
}

describe('lifecycle independence: clients never own Core lifetime', () => {
  it('closing a client leaves the Core serving other clients', async () => {
    const s = server();
    const target = await startLoopback(s);
    const clientTransport = createLoopbackClientTransport();
    const client = createSeamClient({ transport: clientTransport, target, peer: peer('CLI') });
    const submit = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }) as never,
        peer('CLI'),
      ),
    );
    expect(submit.outcome).toBe('ACCEPTED');
    await client.close();
    // Core lifetime is unaffected by client teardown.
    const other = createSeamClient({
      transport: createLoopbackClientTransport(),
      target,
      peer: peer('DESKTOP_UI'),
    });
    const read = await other.submitQuery(
      queryEnvelope(rawQuery({ aggregateId: 'contract-single-001', asPeer: peer('DESKTOP_UI') })),
    );
    expect(read.outcome).toBe('PROJECTION');
    await other.close();
  });

  it('the client API exposes no Core start/stop authority', () => {
    const clientTransport = createLoopbackClientTransport();
    const client = createSeamClient({
      transport: clientTransport,
      target: { host: '127.0.0.1', port: 1 },
      peer: peer(),
    });
    const api = Object.keys(client).sort();
    expect(api).toStrictEqual(['close', 'submitCommand', 'submitQuery']);
  });
});

describe('Core restart with a live client: reconnect + re-submit, no duplicate effects', () => {
  it('submit → restart → reconnect → re-submit same identity converges', async () => {
    const journal = createInMemorySeamJournal();
    const firstServer = server(journal);
    const firstTarget = await startLoopback(firstServer);
    void firstTarget;
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: firstTarget,
      peer: peer('CLI'),
      maxReconnectAttempts: 2,
    });
    const command = stampPeer(
      rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: 'contract-single-001',
        payload: rawSingleResourceContract(),
        requestId: 'req-restart-001',
      }) as never,
      peer('CLI'),
    );
    const firstResponse = await client.submitCommand(command);
    expect(firstResponse.outcome).toBe('ACCEPTED');
    await client.close();

    // Core restart: same journal, brand-new server + endpoint.
    const restartedServer = server(journal);
    const restartedTarget = await startLoopback(restartedServer);
    const reconnected = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: restartedTarget,
      peer: peer('CLI'),
    });
    // Same identity re-submission after restart: converged, not duplicated.
    const resubmitted = await reconnected.submitCommand(command);
    expect(resubmitted.outcome).toBe('ACCEPTED');
    expect(resubmitted.acceptance?.converged).toBe(true);
    expect(resubmitted.acceptance?.revision).toBe(firstResponse.acceptance?.revision);
    expect(restartedServer.acceptedCommandCount).toBe(1);
    await reconnected.close();
  });

  it('a client request issued against a dead endpoint reconnects to the restarted Core', async () => {
    const journal = createInMemorySeamJournal();
    const firstServer = server(journal);
    // The first endpoint dies below; only its journal carries over.
    await startLoopback(firstServer);
    // Pre-accept through the first instance so the restarted one converges.
    firstServer.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          requestId: 'req-restart-002',
        }),
      ),
    );
    // Stop the first Core: the old endpoint is dead.
    const stopped = running.splice(0);
    for (const transport of stopped) {
      await transport.stop();
    }
    const restartedServer = server(journal);
    const restartedTarget = await startLoopback(restartedServer);
    const client = createSeamClient({
      transport: createLoopbackClientTransport(),
      target: restartedTarget,
      peer: peer('BROWSER_EXTENSION'),
    });
    const response = await client.submitCommand(
      stampPeer(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
          requestId: 'req-restart-002',
        }) as never,
        peer('BROWSER_EXTENSION'),
      ),
    );
    // Same identity from a different surface after restart: one lineage.
    expect(response.outcome).toBe('ACCEPTED');
    expect(response.acceptance?.converged).toBe(true);
    expect(restartedServer.acceptedCommandCount).toBe(1);
    await client.close();
  });
});

describe('late commands after a lineage is terminal never rewrite terminal truth (L2 §11)', () => {
  it('cancel after terminal result is rejected as LATE_COMMAND and the projection is unchanged', () => {
    const s = server();
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    const terminal = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'PROJECT_TERMINAL_RESULT',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          payload: {
            result: rawTerminalResult({ contractId: 'contract-single-001' }),
            selectedValidationOutcomes: [
              { memberId: 'target-file-001', requiredValidationPassed: true },
            ],
          },
        }),
      ),
    );
    expect(terminal.outcome).toBe('ACCEPTED');
    const before = s.inspectProjection('contract-single-001');
    const late = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'CANCEL_LINEAGE',
          aggregateId: 'contract-single-001',
          expectedRevision: 2,
        }),
      ),
    );
    expect(late.outcome).toBe('REJECTED');
    expect(late.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
    const after = s.inspectProjection('contract-single-001');
    expect(after).toStrictEqual(before);
    expect(after?.terminal?.stopReason).toBe('NONE');
  });

  it('retry after terminal is recorded/rejected as late as well', () => {
    const s = server();
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'SUBMIT_CONTRACT',
          aggregateId: 'contract-single-001',
          payload: rawSingleResourceContract(),
        }),
      ),
    );
    s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'PROJECT_TERMINAL_RESULT',
          aggregateId: 'contract-single-001',
          expectedRevision: 1,
          payload: {
            result: rawTerminalResult({ contractId: 'contract-single-001' }),
            selectedValidationOutcomes: [
              { memberId: 'target-file-001', requiredValidationPassed: true },
            ],
          },
        }),
      ),
    );
    const late = s.handleFrame(
      JSON.stringify(
        rawCommand({
          commandType: 'RETRY_FAILED_MEMBERS',
          aggregateId: 'contract-single-001',
          expectedRevision: 2,
          payload: { memberIds: ['member-001'] },
        }),
      ),
    );
    expect(late.outcome).toBe('REJECTED');
    expect(late.diagnostics?.[0]?.code).toBe('LATE_COMMAND');
  });
});

describe('one precedence across surfaces (L2 §11.1 rule 7)', () => {
  it('cancels from Desktop and CLI resolve through the same Core order regardless of arrival order', () => {
    const runOnce = (firstSurface: 'CLI' | 'DESKTOP_UI', secondSurface: 'CLI' | 'DESKTOP_UI') => {
      const s = server();
      s.handleFrame(
        JSON.stringify(
          rawCommand({
            commandType: 'SUBMIT_CONTRACT',
            aggregateId: 'contract-single-001',
            payload: rawSingleResourceContract(),
          }),
        ),
      );
      const first = s.handleFrame(
        JSON.stringify(
          rawCommand({
            commandType: 'CANCEL_LINEAGE',
            aggregateId: 'contract-single-001',
            expectedRevision: 1,
            requestId: `req-cancel-${firstSurface}`,
            asPeer: peer(firstSurface),
          }),
        ),
      );
      const second = s.handleFrame(
        JSON.stringify(
          rawCommand({
            commandType: 'CANCEL_LINEAGE',
            aggregateId: 'contract-single-001',
            expectedRevision: 2,
            requestId: `req-cancel-${secondSurface}`,
            asPeer: peer(secondSurface),
          }),
        ),
      );
      return { first, second, projection: s.inspectProjection('contract-single-001') };
    };
    const cliFirst = runOnce('CLI', 'DESKTOP_UI');
    const desktopFirst = runOnce('DESKTOP_UI', 'CLI');
    // Both orders end in the identical Core-owned state: one cancel order,
    // no surface-local precedence.
    expect(cliFirst.first.outcome).toBe('ACCEPTED');
    expect(cliFirst.second.outcome).toBe('ACCEPTED');
    expect(desktopFirst.first.outcome).toBe('ACCEPTED');
    expect(desktopFirst.second.outcome).toBe('ACCEPTED');
    expect(cliFirst.projection?.lineage.status).toBe('CANCELLED');
    expect(desktopFirst.projection?.lineage.status).toBe('CANCELLED');
    expect(cliFirst.projection?.lineage.cancelOrder).toBe(1);
    expect(desktopFirst.projection?.lineage.cancelOrder).toBe(1);
    expect(cliFirst.projection).toStrictEqual(desktopFirst.projection);
  });
});

describe('surfaces as clients at the port level', () => {
  it('decoded envelopes from all three surface shapes traverse the same seam', () => {
    const s = server();
    for (const surface of ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'] as const) {
      const contractId = `contract-${surface.toLowerCase()}-001`;
      const raw = rawCommand({
        commandType: 'SUBMIT_CONTRACT',
        aggregateId: contractId,
        payload: rawSingleResourceContract({
          contractId,
          requestedTarget: `target-${surface.toLowerCase()}-001`,
        }),
        requestId: `req-surface-${surface}`,
        asPeer: peer(surface),
      });
      const decoded = decodeSeamEnvelope(raw);
      expect(decoded.ok).toBe(true);
      const response = s.handleFrame(JSON.stringify(raw));
      expect(response.outcome).toBe('ACCEPTED');
    }
  });
});
