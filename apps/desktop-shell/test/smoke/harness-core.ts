/**
 * T07 non-installed shell smoke — harness Core process entry.
 *
 * Stands up the REAL seam authority (the same `createCoreSeamServer` +
 * `createLoopbackServerTransport` wiring the packaged Core host uses) as the
 * "existing Core" for the shell to connect to. It carries NO lanes and NO
 * persistence: commands fail closed at the seam exactly as a bare Core
 * would; the READ_PROJECTION path answers peer-authorized rejections for
 * unknown aggregates — which is precisely the truthful "Core answered"
 * signal the shell's liveness probe observes.
 *
 * This harness runs in its OWN process, like the real Core: the shell never
 * composes a per-surface Core authority.
 * Smoke harness only — never packaged, never shipped.
 */

import process from 'node:process';
import {
  createCoreSeamServer,
  createLoopbackServerTransport,
  makePeerInstallId,
  makePeerUserId,
  type ExpectedPeerScope,
} from '@xdownload/core-seam';

interface HarnessArgv {
  readonly host: string;
  readonly port: number;
  readonly installId: string;
  readonly userId: string;
}

function fail(message: string): never {
  process.stderr.write(`harness-core: ${message}\n`);
  process.exit(2);
}

function parseArgv(argv: readonly string[]): HarnessArgv {
  let host = '127.0.0.1';
  let port = 0;
  let installId = '';
  let userId = '';
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      fail('expected --host/--port/--install-id/--user-id value pairs');
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
      default:
        fail(`unknown flag '${flag}'`);
    }
  }
  return { host, port, installId, userId };
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
if (argv.host !== '127.0.0.1' && argv.host !== '::1' && argv.host !== 'localhost') {
  fail(`harness host '${argv.host}' must be loopback`);
}
const expectedPeer: ExpectedPeerScope = {
  installId: install.value,
  userId: user.value,
  allowedSurfaces: ['DESKTOP_UI'],
};

const seam = createCoreSeamServer({ expectedPeer });
if (!seam.ok) {
  fail(`seam composition refused: ${seam.diagnostics.map((d) => d.code).join(', ')}`);
}

const transport = createLoopbackServerTransport({ host: argv.host, port: argv.port });

transport
  .start({
    onFrame: (connection, frame) => {
      connection.send(JSON.stringify(seam.value.handleFrame(frame)));
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
