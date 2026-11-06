/**
 * T07 non-installed shell smoke — harness Core process entry.
 *
 * Stands up the REAL seam authority (the same `createCoreSeamServer` +
 * `createLoopbackServerTransport` wiring the packaged Core host uses) as the
 * "existing Core" for the shell to connect to. It carries NO lanes. Its only
 * durability is the accepted-command journal port (R8: in-memory, per
 * process) so the durable S1 job index the desktop manager reads stays
 * servable exactly as on a real Core; beyond that journal, commands fail
 * closed at the seam exactly as a bare Core would; the READ_PROJECTION path
 * answers peer-authorized rejections for unknown aggregates — which is
 * precisely the truthful "Core answered" signal the shell's liveness probe
 * observes.
 *
 * This harness runs in its OWN process, like the real Core: the shell never
 * composes a per-surface Core authority.
 *
 * Test-only terminal fixtures (v0.2.2 U06): `--fixture COMPLETE|FAILED`
 * injects a schema-valid `PROJECT_TERMINAL_RESULT` for the exact submitted
 * lineage through the SAME seam only after the real submit was ACCEPTED,
 * and requires the Core response to be ACCEPTED. `--fixture CANCELLED`
 * performs no injection (the driver exercises the real renderer Cancel
 * control). Omitting `--fixture` (or `ACTIVE`) preserves the original
 * bare ACTIVE behavior byte-for-byte, including stdout.
 * Smoke harness only — never packaged, never shipped.
 */

import process from 'node:process';
import {
  createCoreSeamServer,
  createInMemorySeamJournal,
  createLoopbackServerTransport,
  currentSeamSchemaIdentity,
  makePeerInstallId,
  makePeerUserId,
  type ExpectedPeerScope,
} from '@xdownload/core-seam';

type Fixture = 'ACTIVE' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

interface HarnessArgv {
  readonly host: string;
  readonly port: number;
  readonly installId: string;
  readonly userId: string;
  readonly fixture: Fixture;
  readonly fixtureRequested: boolean;
}

function fail(message: string): never {
  process.stderr.write(`harness-core: ${message}\n`);
  process.exit(2);
}

function parseFixture(value: string): Fixture {
  if (value === 'ACTIVE' || value === 'COMPLETE' || value === 'FAILED' || value === 'CANCELLED') {
    return value;
  }
  fail(`unknown --fixture '${value}' (expected ACTIVE|COMPLETE|FAILED|CANCELLED)`);
}

function parseArgv(argv: readonly string[]): HarnessArgv {
  let host = '127.0.0.1';
  let port = 0;
  let installId = '';
  let userId = '';
  let fixture: Fixture = 'ACTIVE';
  let fixtureRequested = false;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      fail('expected --host/--port/--install-id/--user-id/--fixture value pairs');
    }
    switch (flag) {
      case '--host':
        host = value;
        break;
      case '--port':
        port = Number.parseInt(value, 10);
        if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
          fail(`invalid --port '${value}'`);
        }
        break;
      case '--install-id':
        installId = value;
        break;
      case '--user-id':
        userId = value;
        break;
      case '--fixture':
        fixture = parseFixture(value);
        fixtureRequested = true;
        break;
      default:
        fail(`unknown flag '${flag}'`);
    }
  }
  return { host, port, installId, userId, fixture, fixtureRequested };
}

const argv = parseArgv(process.argv.slice(2));
const install = makePeerInstallId(argv.installId);
if (!install.ok) {
  fail(`invalid --install-id '${argv.installId}'`);
}
const user = makePeerUserId(argv.userId);
if (!user.ok) {
  fail(`invalid --user-id '${argv.userId}'`);
}
// Narrowed once at top level: hoisted closures below cannot rely on flow
// narrowing of the discriminated union.
const peerInstallId = install.value;
const peerUserId = user.value;
if (argv.host !== '127.0.0.1' && argv.host !== '::1' && argv.host !== 'localhost') {
  fail(`harness host '${argv.host}' must be loopback`);
}
const expectedPeer: ExpectedPeerScope = {
  installId: peerInstallId,
  userId: peerUserId,
  allowedSurfaces: ['DESKTOP_UI'],
};

// R8: the fixture Core now installs the accepted-command journal port. The
// post-integration WIP manager reads the durable S1 job index (T01
// LIST_S1_JOB_PROJECTIONS); a bare journal-less Core truthfully rejects that
// query (JOB_PROJECTION_UNAVAILABLE) and the renderer refuses to render any
// row. The official in-memory journal implements the same port the packaged
// Core host wires (FileBackedSeamJournal in production): fixture durability is
// per-process, never across restarts — no persistence claim beyond that.
// R8: the S1 direct-acquisition beginner port is the admission gate the
// packaged Core wires to its transfer runtime; absent, EXECUTE_S1_DIRECT_
// ACQUISITION fails closed and the durable S1 index never lists the
// submitted lineage. The fixture registers the port with a deliberately
// no-op begin(): the S1 command is admitted and journaled exactly as in
// production, but no transfer ever starts — zero real downloads and zero
// Native Host calls stay true, and the ACTIVE lineage stays honestly
// in-progress. Terminal lineages still arrive only through the same-seam
// PROJECT_TERMINAL_RESULT injection after real admission, or through the
// real renderer Cancel control.
const seam = createCoreSeamServer({
  expectedPeer,
  journal: createInMemorySeamJournal(),
  s1DirectAcquisition: {
    begin: () => undefined,
  },
});
if (!seam.ok) {
  fail(`seam composition refused: ${seam.diagnostics.map((d) => d.code).join(', ')}`);
}

// Fixture event lines are emitted ONLY when --fixture was explicitly
// requested, so the default ACTIVE harness stdout stays byte-identical to
// the pre-fixture behavior the existing smoke driver parses.
function emitFixtureEvent(event: Record<string, unknown>): void {
  if (argv.fixtureRequested) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

function terminalFixtureCommand(submit: Record<string, unknown>, revision: number): string {
  const aggregateId = String(submit['aggregateId']);
  const payload = submit['payload'] as Record<string, unknown>;
  const scope = payload['requestedScope'] as Record<string, unknown>;
  const targetId = String(scope['targetId']);
  const complete = argv.fixture === 'COMPLETE';
  return JSON.stringify({
    schemaIdentity: currentSeamSchemaIdentity(),
    kind: 'command',
    commandType: 'PROJECT_TERMINAL_RESULT',
    peer: { installId: peerInstallId, userId: peerUserId, surface: 'DESKTOP_UI' },
    requestId: `fixture-terminal-${argv.fixture.toLowerCase()}`,
    aggregateId,
    expectedRevision: revision,
    correlation: {},
    issuedAt: '2026-11-03T00:00:00Z',
    payload: {
      result: {
        schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
        contractId: aggregateId,
        requestFulfillment: complete ? 'COMPLETE' : 'UNSATISFIED',
        targetResolution: complete ? 'RESOLVED' : 'BLOCKED',
        selectionAcquisition: complete ? 'COMPLETE' : 'NOT_STARTED',
        // Single-resource direct intents are NOT_APPLICABLE by contract; the
        // current renderer label for this honest state is recorded by the
        // driver, never upgraded here.
        coverage: 'NOT_APPLICABLE',
        stopReason: complete ? 'NONE' : 'AUTH_FAILED',
        validationSummary: complete
          ? { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 }
          : { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
        recordedAt: '2026-11-03T00:00:00Z',
      },
      ...(complete
        ? { selectedValidationOutcomes: [{ memberId: targetId, requiredValidationPassed: true }] }
        : {}),
    },
  });
}

const transport = createLoopbackServerTransport({ host: argv.host, port: argv.port });

// Accepted SUBMIT_CONTRACT envelopes per aggregate, retained so the
// R8 S1-ordered terminal injection can rebuild the fixture terminal command
// from the original contract payload (the S1 envelope carries no scope).
const submitEnvelopes = new Map<string, Record<string, unknown>>();

transport
  .start({
    onFrame: (connection, frame) => {
      const response = seam.value.handleFrame(frame);
      if (argv.fixtureRequested) {
        const envelope = JSON.parse(frame) as Record<string, unknown>;
        const isSubmit =
          envelope['kind'] === 'command' && envelope['commandType'] === 'SUBMIT_CONTRACT';
        const isS1Execute =
          envelope['kind'] === 'command' &&
          envelope['commandType'] === 'EXECUTE_S1_DIRECT_ACQUISITION';
        if (isSubmit && response.outcome !== 'ACCEPTED') {
          fail(`fixture submit rejected: ${JSON.stringify(response)}`);
        }
        if (isS1Execute && response.outcome !== 'ACCEPTED') {
          fail(`fixture s1 execution rejected: ${JSON.stringify(response)}`);
        }
        if (isSubmit && response.outcome === 'ACCEPTED') {
          submitEnvelopes.set(String(envelope['aggregateId']), envelope);
          emitFixtureEvent({
            event: 'FIXTURE_SUBMIT',
            fixture: argv.fixture,
            aggregateId: envelope['aggregateId'],
            projection: seam.value.inspectProjection(String(envelope['aggregateId'])),
          });
        }
        if (
          isS1Execute &&
          (argv.fixture === 'COMPLETE' || argv.fixture === 'FAILED') &&
          response.outcome === 'ACCEPTED'
        ) {
          // R8: inject only AFTER the S1 execution admission, through the
          // same seam. Production truth: a lineage terminal is recorded only
          // after the accepted EXECUTE_S1 journal commit (the runtime's
          // recordExecutedTerminal path), and the post-rebuild desktop
          // manager lists rows from the durable S1 index — so injecting on
          // the earlier contract acceptance would reject the S1 command
          // (lineage no longer ACTIVE) and the row would never exist.
          const submitEnvelope = submitEnvelopes.get(String(envelope['aggregateId']));
          if (submitEnvelope === undefined) {
            fail(
              `fixture terminal requested for aggregate '${String(envelope['aggregateId'])}' without an accepted submit`,
            );
          }
          const terminalResponse = seam.value.handleFrame(
            terminalFixtureCommand(submitEnvelope, Number(response.currentRevision ?? 1)),
          );
          emitFixtureEvent({
            event: 'FIXTURE_TERMINAL',
            fixture: argv.fixture,
            response: terminalResponse,
          });
          if (terminalResponse.outcome !== 'ACCEPTED') {
            fail(`fixture terminal rejected: ${JSON.stringify(terminalResponse)}`);
          }
        }
      }
      connection.send(JSON.stringify(response));
    },
    onConnectionEnded: () => undefined,
  })
  .then((target) => {
    process.stdout.write(
      `${JSON.stringify({ ready: true, host: target.host, port: target.port })}\n`,
    );
  })
  .catch((error: unknown) => {
    fail(`transport start refused: ${error instanceof Error ? error.message : 'unknown error'}`);
  });

const shutdown = (): void => {
  void transport
    .stop()
    .catch(() => undefined)
    .then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the harness alive for the smoke duration; the driver terminates it.
const keepAlive = setInterval(() => undefined, 60_000);
keepAlive.unref();
