/**
 * T09 installer composition, integrity and clean-install tests (issue #258).
 *
 * Real package, real bytes: the suite builds the actual dist (the same
 * orchestrator `pnpm build` runs), composes the installer from it and checks
 * the acceptance contract end to end:
 *
 * - package contents audit runs over the exact bytes before composition;
 * - every artifact identity re-verifies against the COPIED payload
 *   (package identity readback across the compose boundary);
 * - SHA256SUMS is a correct, deterministic hash manifest of the closed tree;
 * - the composed installer re-verifies with the SHIPPED verifier script
 *   (spawned as a real process) and refuses tampered trees;
 * - rebuild reproducibility: two composes from the same dist produce
 *   byte-identical archives and manifests;
 * - the archive is a real zip: extracted with the platform unzip (tar) and
 *   byte-compared against the composed tree;
 * - clean install from the payload: the packaged install entry binds, reads
 *   back and uninstalls against a throwaway registry host name (Windows,
 *   machine restored as found).
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPackageBuild } from '../package.ts';
import { REPO_ROOT } from '../build-config.ts';
import { canonicalContentHash } from '../identity.ts';
import {
  assertInstallerHostTuple,
  assertSelectedRuntimePresent,
  composeInstaller,
  installerDirName,
  installerZipName,
  INSTALLER_CONTENT_VERSION,
  type ComposeResult,
} from '../../installers/compose-installer.ts';

const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts', 'install-host');
/**
 * Suite-level gate: everything that consumes a REAL composeInstaller()
 * product is only meaningful on the selected tuple's build host. On any
 * other platform (e.g. the linux CI carrier) the whole group SKIPS — the
 * P2 fail-closed gates correctly refuse to compose there, and a refusal
 * must surface as SKIP, never as a red suite. Pure-logic tests (the tuple
 * gate assertions, whole-tree build determinism) stay outside the gate and
 * run on every platform.
 */
const IS_WIN32 = process.platform === 'win32';

let distRoot = '';
let outRoot = '';
let result: ComposeResult;

describe.skipIf(!IS_WIN32)(
  'T09 installer composition, integrity, clean install and process exit (selected windows-x64 tuple)',
  () => {
    beforeAll(async () => {
      distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-dist-'));
      outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-out-'));
      await runPackageBuild(distRoot);
      result = composeInstaller({
        distDir: distRoot,
        outDir: outRoot,
        version: INSTALLER_CONTENT_VERSION,
      });
    }, 240_000);

    afterAll(() => {
      fs.rmSync(distRoot, { recursive: true, force: true });
      fs.rmSync(outRoot, { recursive: true, force: true });
    });

    const INSTALLER_ROOT = (): string =>
      path.join(outRoot, installerDirName(INSTALLER_CONTENT_VERSION));
    const TOP_LEVEL_EXPECTED = [
      'INSTALL.txt',
      'SHA256SUMS',
      'installer-identity.json',
      'install.cmd',
      'status.cmd',
      'uninstall.cmd',
      'verify.cmd',
      'verify-installer.mjs',
      'payload',
    ] as const;

    describe('T09 installer composition (real dist)', () => {
      it('composes the exact closed tree from the audited dist', () => {
        const topLevel = fs
          .readdirSync(INSTALLER_ROOT(), { withFileTypes: true })
          .map((entry) => entry.name)
          .sort();
        expect(topLevel).toEqual([...TOP_LEVEL_EXPECTED].sort());
        const payloadTop = fs.readdirSync(path.join(INSTALLER_ROOT(), 'payload')).sort();
        const distTop = fs.readdirSync(distRoot).sort();
        expect(payloadTop).toEqual(distTop);
      });

      it('copies the user install scripts verbatim from scripts/install-host', () => {
        for (const script of ['install.cmd', 'uninstall.cmd', 'status.cmd', 'verify.cmd']) {
          expect(fs.readFileSync(path.join(INSTALLER_ROOT(), script), 'utf8')).toBe(
            fs.readFileSync(path.join(SCRIPTS_DIR, script), 'utf8'),
          );
        }
        expect(fs.readFileSync(path.join(INSTALLER_ROOT(), 'INSTALL.txt'), 'utf8')).toBe(
          fs.readFileSync(path.join(SCRIPTS_DIR, 'INSTALL.txt'), 'utf8'),
        );
        expect(fs.readFileSync(path.join(INSTALLER_ROOT(), 'verify-installer.mjs'), 'utf8')).toBe(
          fs.readFileSync(path.join(SCRIPTS_DIR, 'verify-installer.mjs'), 'utf8'),
        );
      });

      it('records and re-verifies every artifact identity across the compose boundary', () => {
        const identityDir = path.join(distRoot, 'identity');
        for (const file of fs.readdirSync(identityDir)) {
          if (!file.endsWith('.json')) continue;
          const identity = JSON.parse(fs.readFileSync(path.join(identityDir, file), 'utf8')) as {
            artifact: string;
            contentHash: string;
          };
          expect(result.payloadContentHashes[identity.artifact]).toBe(identity.contentHash);
          // The shipped identity sidecar travels with the payload.
          const shipped = JSON.parse(
            fs.readFileSync(path.join(INSTALLER_ROOT(), 'payload', 'identity', file), 'utf8'),
          ) as { contentHash: string };
          expect(shipped.contentHash).toBe(identity.contentHash);
        }
        expect(Object.keys(result.payloadContentHashes).sort()).toEqual([
          'cli',
          'core',
          'extension',
          'native-host',
        ]);
      });

      it('writes a correct deterministic SHA256SUMS manifest', () => {
        const sums = fs.readFileSync(path.join(INSTALLER_ROOT(), 'SHA256SUMS'), 'utf8');
        const lines = sums.split('\n').filter((line) => line.length > 0);
        // Subjects: every file of the tree except the two manifest-apparatus
        // sidecars (SHA256SUMS cannot list itself; the identity covers the set).
        const expectedSubjects = walkFiles(INSTALLER_ROOT()).filter(
          (file) => file !== 'SHA256SUMS' && file !== 'installer-identity.json',
        );
        expect(lines).toHaveLength(expectedSubjects.length);
        let previous = '';
        for (const line of lines) {
          const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
          expect(match, line).not.toBeNull();
          const relative = match![2] as string;
          expect(relative > previous, `SHA256SUMS must be sorted ascending at ${relative}`).toBe(
            true,
          );
          previous = relative;
          expect(expectedSubjects).toContain(relative);
          const bytes = fs.readFileSync(path.join(INSTALLER_ROOT(), relative));
          expect(match![1]).toBe(createHash('sha256').update(bytes).digest('hex'));
        }
        // The manifest apparatus itself is deliberately unlisted.
        expect(lines.some((line) => line.includes('SHA256SUMS'))).toBe(false);
        expect(lines.some((line) => line.includes('installer-identity.json'))).toBe(false);
      });

      it('binds the exact source revision and version into the installer identity', () => {
        const identity = JSON.parse(
          fs.readFileSync(path.join(INSTALLER_ROOT(), 'installer-identity.json'), 'utf8'),
        ) as {
          contentVersion: string;
          contentHash: string;
          tuple: { os: string; arch: string };
          payloadContentHashes: Record<string, string>;
          sourceRevision: { sha: string };
          toolchain: readonly { name: string; version: string; source: string }[];
        };
        expect(identity.contentVersion).toBe(INSTALLER_CONTENT_VERSION);
        expect(identity.tuple).toEqual({ os: 'windows', arch: 'x64' });
        expect(identity.sourceRevision.sha).toBe(result.identity.sourceRevision.sha);
        expect(identity.payloadContentHashes).toEqual(result.payloadContentHashes);
        // contentHash == canonical hash over exactly the SHA256SUMS file set.
        const listed = fs
          .readFileSync(path.join(INSTALLER_ROOT(), 'SHA256SUMS'), 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => {
            const [sha, file] = line.split('  ') as [string, string];
            const bytes = fs.readFileSync(path.join(INSTALLER_ROOT(), file));
            return { path: file, sha256: sha, bytes: bytes.byteLength };
          });
        expect(identity.contentHash).toBe(canonicalContentHash(listed));
        expect(result.identity.contentHash).toBe(identity.contentHash);
      });

      it('mints every shipped timestamp from the one deterministic commit time', () => {
        // Controller-found defect, fixed: the payload identity sidecars used to
        // carry the BUILD wall clock, so every fresh build re-hashed the whole
        // installer. Sidecars and installer identity now share the source
        // revision's commit time.
        const identity = JSON.parse(
          fs.readFileSync(path.join(INSTALLER_ROOT(), 'installer-identity.json'), 'utf8'),
        ) as { generatedAt: string };
        expect(identity.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
        for (const artifact of ['cli', 'core', 'extension', 'native-host']) {
          const sidecar = JSON.parse(
            fs.readFileSync(
              path.join(INSTALLER_ROOT(), 'payload', 'identity', `${artifact}.json`),
              'utf8',
            ),
          ) as { generatedAt: string; sourceRevision: { sha: string } };
          expect(sidecar.generatedAt, artifact).toBe(identity.generatedAt);
        }
      });

      it('binds a DECLARED-ONLY toolchain identity (no environment probing)', () => {
        // Controller-found determinism defect, fixed: the identity toolchain must
        // come from repo declarations so the same HEAD composes to the same
        // installer bytes on any host, whatever pnpm/node sit on its PATH.
        const identity = JSON.parse(
          fs.readFileSync(path.join(INSTALLER_ROOT(), 'installer-identity.json'), 'utf8'),
        ) as { toolchain: readonly { name: string; version: string; source: string }[] };
        expect(identity.toolchain).toEqual([
          { name: 'node', version: '24.21.0', source: 'declared' },
          { name: 'pnpm', version: '12.8.1', source: 'declared' },
          { name: 'esbuild', version: '0.25.12', source: 'declared' },
        ]);
      });
    });

    describe('T09 shipped verifier (real process readback)', () => {
      function runVerifier(root: string): { status: number; stdout: string; stderr: string } {
        const run = spawnSync(process.execPath, [path.join(root, 'verify-installer.mjs'), root], {
          encoding: 'utf8',
          timeout: 60_000,
        });
        return {
          status: run.status ?? -1,
          stdout: run.stdout ?? '',
          stderr: run.stderr ?? '',
        };
      }

      it('verifies the freshly composed installer (exit 0, PASS)', () => {
        const outcome = runVerifier(INSTALLER_ROOT());
        expect(outcome.stderr).toBe('');
        expect(outcome.status).toBe(0);
        expect(outcome.stdout).toContain('PASS');
        expect(outcome.stdout).toContain(result.identity.contentHash);
      });

      it('refuses a tampered payload byte (exit 2, typed failure)', () => {
        const tamperedRoot = path.join(outRoot, 'tampered');
        fs.cpSync(INSTALLER_ROOT(), tamperedRoot, { recursive: true });
        const target = path.join(tamperedRoot, 'payload', 'cli', 'xdownload-cli.js');
        fs.writeFileSync(target, `${fs.readFileSync(target, 'utf8')}\n// tampered`, 'utf8');
        const outcome = runVerifier(tamperedRoot);
        expect(outcome.status).toBe(2);
        expect(outcome.stderr).toContain('hash mismatch for payload/cli/xdownload-cli.js');
        fs.rmSync(tamperedRoot, { recursive: true, force: true });
      });

      it('refuses an extra unlisted file (exit 2, closed tree)', () => {
        const extraRoot = path.join(outRoot, 'extra');
        fs.cpSync(INSTALLER_ROOT(), extraRoot, { recursive: true });
        fs.writeFileSync(path.join(extraRoot, 'payload', 'cli', 'evidence-leak.txt'), 'x', 'utf8');
        const outcome = runVerifier(extraRoot);
        expect(outcome.status).toBe(2);
        expect(outcome.stderr).toContain('unlisted file present');
        fs.rmSync(extraRoot, { recursive: true, force: true });
      });
    });

    describe('T09 rebuild reproducibility', () => {
      it('recomposes byte-identical manifests and archives from the same dist', () => {
        const secondOut = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-out2-'));
        try {
          const second = composeInstaller({
            distDir: distRoot,
            outDir: secondOut,
            version: INSTALLER_CONTENT_VERSION,
          });
          const firstRoot = INSTALLER_ROOT();
          const secondRoot = second.installerRoot;
          expect(fs.readFileSync(path.join(firstRoot, 'SHA256SUMS'), 'utf8')).toBe(
            fs.readFileSync(path.join(secondRoot, 'SHA256SUMS'), 'utf8'),
          );
          const firstZip = fs.readFileSync(result.zipPath);
          const secondZip = fs.readFileSync(second.zipPath);
          expect(secondZip.equals(firstZip), 'archives must be byte-identical').toBe(true);
          expect(second.zipSha256).toBe(result.zipSha256);
          // The identity sidecars differ only in generatedAt (never hashed).
          const strip = (root: string): string => {
            const identity = JSON.parse(
              fs.readFileSync(path.join(root, 'installer-identity.json'), 'utf8'),
            ) as Record<string, unknown>;
            delete identity['generatedAt'];
            return JSON.stringify(identity);
          };
          expect(strip(firstRoot)).toBe(strip(secondRoot));
        } finally {
          fs.rmSync(secondOut, { recursive: true, force: true });
        }
      }, 240_000);
    });

    describe('T09 deterministic archive (real container readback)', () => {
      it('carries exactly the installer tree with fixed timestamps', () => {
        const zip = fs.readFileSync(result.zipPath);
        // Walk the central directory: every entry is STORE-mode with the fixed
        // DOS timestamp 1980-01-01 and names arrive sorted with no duplicates.
        const names: string[] = [];
        let offset = zip.length - 22;
        // Locate EOCD from the tail (no zip64 entries are ever written).
        for (; offset >= 0; offset -= 1) {
          if (zip.readUInt32LE(offset) === 0x06054b50) break;
        }
        expect(offset).toBeGreaterThanOrEqual(0);
        const entryCount = zip.readUInt16LE(offset + 10);
        let centralOffset = zip.readUInt32LE(offset + 16);
        for (let index = 0; index < entryCount; index += 1) {
          expect(zip.readUInt32LE(centralOffset)).toBe(0x02014b50);
          expect(zip.readUInt16LE(centralOffset + 10), 'STORE mode').toBe(0);
          expect(zip.readUInt16LE(centralOffset + 12), 'fixed DOS time 00:00:00').toBe(0);
          expect(zip.readUInt16LE(centralOffset + 14), 'fixed DOS date 1980-01-01').toBe(0x0021);
          const nameLength = zip.readUInt16LE(centralOffset + 28);
          names.push(zip.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength));
          centralOffset += 46 + nameLength;
        }
        const wrap = `${installerDirName(INSTALLER_CONTENT_VERSION)}/`;
        const expected = walkFiles(INSTALLER_ROOT())
          .map((file) => `${wrap}${file}`)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(names).toEqual(expected);
        expect(result.zipPath.endsWith(installerZipName(INSTALLER_CONTENT_VERSION))).toBe(true);
      });

      it.skipIf(process.platform !== 'win32' || !fs.existsSync(SYSTEM_TAR))(
        'extracts with the platform tool and is byte-identical to the composed tree',
        () => {
          const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-zip-'));
          try {
            const zipDir = path.join(extractRoot, 'zip');
            fs.mkdirSync(zipDir, { recursive: true });
            fs.copyFileSync(result.zipPath, path.join(zipDir, 'pkg.zip'));
            // The System32 bsdtar reads zip containers; the Git Bash GNU tar does not.
            const run = spawnSync(SYSTEM_TAR, ['-xf', 'pkg.zip'], {
              cwd: zipDir,
              encoding: 'utf8',
            });
            expect(run.status, run.stderr).toBe(0);
            const extractedRoot = path.join(zipDir, installerDirName(INSTALLER_CONTENT_VERSION));
            expect(fs.existsSync(extractedRoot)).toBe(true);
            const compare = (left: string, right: string): void => {
              const leftEntries = fs
                .readdirSync(left, { withFileTypes: true })
                .sort((a, b) => (a.name < b.name ? -1 : 1));
              const rightEntries = fs
                .readdirSync(right, { withFileTypes: true })
                .sort((a, b) => (a.name < b.name ? -1 : 1));
              expect(leftEntries.map((entry) => entry.name)).toEqual(
                rightEntries.map((entry) => entry.name),
              );
              for (const entry of leftEntries) {
                const leftFull = path.join(left, entry.name);
                const rightFull = path.join(right, entry.name);
                if (entry.isDirectory()) {
                  compare(leftFull, rightFull);
                } else {
                  expect(
                    fs.readFileSync(leftFull).equals(fs.readFileSync(rightFull)),
                    `${leftFull} must survive the archive round-trip`,
                  ).toBe(true);
                }
              }
            };
            compare(extractedRoot, INSTALLER_ROOT());
          } finally {
            fs.rmSync(extractRoot, { recursive: true, force: true });
          }
        },
      );
    });

    describe.skipIf(process.platform !== 'win32')(
      'T09 clean install from the composed payload (throwaway registry host)',
      () => {
        // Self-healing sweep mirrors the #179 pattern: the throwaway registration
        // is removed before and after; the real host manifest file content is
        // saved and restored so the machine is left exactly as found.
        const SELFTEST_HOST = 'com.xdownload.t09-installer-selftest';
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-home-'));
        const manifestFile = path.join(
          os.homedir(),
          '.xdownload',
          'native-host',
          'com.xdownload.broker.json',
        );
        let manifestAsFound: string | null = null;

        beforeAll(async () => {
          manifestAsFound = fs.existsSync(manifestFile)
            ? fs.readFileSync(manifestFile, 'utf8')
            : null;
          await execReg([
            'delete',
            `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${SELFTEST_HOST}`,
            '/f',
          ]);
        });

        afterAll(async () => {
          await execReg([
            'delete',
            `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${SELFTEST_HOST}`,
            '/f',
          ]);
          if (manifestAsFound !== null) {
            fs.writeFileSync(manifestFile, manifestAsFound, 'utf8');
          }
          fs.rmSync(home, { recursive: true, force: true });
        });

        it('installs, reads back and uninstalls from the composed payload only', async () => {
          const payloadDir = path.join(INSTALLER_ROOT(), 'payload');
          const { performSetup, performStatus, performUninstall, installPaths, parseInstallArgv } =
            await import('../install-host.ts');
          const { probeWindowsRegistration, unregisterWindowsNativeHost } =
            await import('../native-host.ts');
          await unregisterWindowsNativeHost(SELFTEST_HOST);

          const argv = parseInstallArgv(
            [
              'setup',
              '--extension-id',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              '--install-id',
              't09selftest',
              '--user-id',
              't09user',
            ],
            't09user',
          );
          const paths = installPaths(home);
          const setup = await performSetup(argv, paths, payloadDir, SELFTEST_HOST);
          expect(setup.ok, setup.detail).toBe(true);
          expect(setup.registration).toBe('registered');

          // Host registration readback (the acceptance contract).
          const probe = await probeWindowsRegistration(SELFTEST_HOST);
          expect(probe.registered).toBe(true);
          expect(probe.manifestPath).toContain('.xdownload');

          // Status readback: the shipped entry runs as a real process (reads the
          // real user home; only the live exit/JSON shape is asserted there) and
          // the temp-home bound config is read back in-process.
          const statusRun = spawnSync(
            process.execPath,
            [path.join(payloadDir, 'native-host', 'xdownload-install-host.js'), 'status'],
            { encoding: 'utf8', timeout: 60_000 },
          );
          expect(statusRun.status).toBe(0);
          const statusDoc = JSON.parse(statusRun.stdout ?? '{}') as { registered?: boolean };
          expect(typeof statusDoc.registered).toBe('boolean');

          const inProcessStatus = performStatus(paths);
          expect(inProcessStatus.configPresent).toBe(true);
          expect(inProcessStatus.configCore?.installId).toBe('t09selftest');
          expect(inProcessStatus.configCore?.pipeName).toBe(
            '\\\\.\\pipe\\xdownload-core-t09selftest',
          );

          // Single-Core start binding points at the payload core host and the
          // canonical pipe namespace.
          const startScript = fs.readFileSync(paths.coreStartPath, 'utf8');
          expect(startScript).toContain(
            'payload/core/xdownload-core-host.js'.replaceAll('/', path.sep),
          );
          expect(startScript).toContain('\\\\.\\pipe\\xdownload-core-t09selftest');

          // Safe uninstall: registration and per-user files removed, payload untouched.
          const uninstall = await performUninstall(paths, SELFTEST_HOST);
          expect(uninstall.ok).toBe(true);
          const after = await probeWindowsRegistration(SELFTEST_HOST);
          expect(after.registered).toBe(false);
          expect(fs.existsSync(paths.installDir)).toBe(false);
          expect(fs.existsSync(path.join(INSTALLER_ROOT(), 'payload'))).toBe(true);
          void inProcessStatus;
        });
      },
    );

    // ------------------------------------------------------------------ helpers

    /** The Windows-shipped bsdtar (reads zip); the Git Bash GNU tar cannot. */
    const SYSTEM_TAR = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

    function walkFiles(root: string, prefix = ''): string[] {
      const found: string[] = [];
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          found.push(...walkFiles(path.join(root, entry.name), relative));
        } else {
          found.push(relative);
        }
      }
      return found;
    }

    async function execReg(args: readonly string[]): Promise<void> {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)('reg', args, { windowsHide: true }).catch(() => undefined);
    }

    // ------------------------- T09 P1: packaged host honors its exit contract

    const EXIT_ORIGIN = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/';

    interface ExitProbeCore {
      readonly port: number;
      close(): Promise<void>;
    }

    /** Minimal loopback seam listener answering the echo ACCEPTED response. */
    function startExitProbeCore(): Promise<ExitProbeCore> {
      const sockets: net.Socket[] = [];
      const server = net.createServer((socket) => {
        sockets.push(socket);
        let buffered = Buffer.alloc(0);
        socket.on('data', (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const declared = buffered.readUInt32BE(0);
            if (buffered.length - 4 < declared) return;
            const envelope = JSON.parse(
              buffered.subarray(4, 4 + declared).toString('utf8'),
            ) as Record<string, unknown>;
            buffered = buffered.subarray(4 + declared);
            const answer = {
              schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
              kind: 'response',
              route: 'v0.2',
              inReplyTo: envelope['requestId'],
              outcome: 'ACCEPTED',
              acceptance: {
                requestId: envelope['requestId'],
                aggregateId: envelope['aggregateId'],
                revision: 0,
                converged: false,
              },
            };
            const body = Buffer.from(JSON.stringify(answer), 'utf8');
            const header = Buffer.alloc(4);
            header.writeUInt32BE(body.length, 0);
            socket.write(Buffer.concat([header, body]));
          }
        });
      });
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve({
            port: (server.address() as net.AddressInfo).port,
            close: () =>
              new Promise((resolveClose) => {
                for (const socket of sockets) socket.destroy();
                server.close(() => resolveClose());
              }),
          });
        });
      });
    }

    function nmFrameFor(message: unknown): Buffer {
      const encoded = Buffer.from(JSON.stringify(message), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(encoded.length, 0);
      return Buffer.concat([header, encoded]);
    }

    function awaitExit(child: ChildProcess, timeoutMs = 15_000): Promise<number> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('packaged broker did not exit within bounds (event loop held?)')),
          timeoutMs,
        );
        child.once('exit', (code) => {
          clearTimeout(timer);
          resolve(code ?? -1);
        });
      });
    }

    /** Wait for the first complete NM frame on the child's stdout. */
    function awaitFirstFrame(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
      return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        const timer = setTimeout(
          () => reject(new Error('no broker answer arrived in time')),
          timeoutMs,
        );
        child.stdout?.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const declared = buffer.readUInt32LE(0);
            if (buffer.length - 4 < declared) break;
            if (buffer.length >= 4 + declared) {
              clearTimeout(timer);
              resolve();
              return;
            }
          }
        });
      });
    }

    describe.skipIf(process.platform !== 'win32')(
      'T09 P1 packaged native-host process exit (real bundle, real loopback Core)',
      () => {
        // The P1 defect this guards: the relay's pooled seam socket is ref'd, so
        // without an explicit close the packaged broker stayed alive indefinitely
        // after stdin EOF once it had served one v0.2 frame (one zombie holding a
        // Core connection per browser port). The exit contract is "0 clean
        // (stdin closed)".
        let core: ExitProbeCore;
        let configPath = '';

        beforeAll(async () => {
          core = await startExitProbeCore();
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-t09-exit-'));
          configPath = path.join(dir, 'broker-config.json');
          fs.writeFileSync(
            configPath,
            JSON.stringify({
              allowedOrigins: [EXIT_ORIGIN],
              core: {
                host: '127.0.0.1',
                port: core.port,
                installId: 'install-001',
                userId: 'user-001',
              },
            }),
            'utf8',
          );
        });

        afterAll(async () => {
          await core.close();
          if (configPath !== '') {
            fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
          }
        });

        function spawnPackagedBroker(): ChildProcess {
          return spawn(
            process.execPath,
            [
              path.join(distRoot, 'native-host', 'xdownload-broker-host.js'),
              '--config',
              configPath,
              EXIT_ORIGIN,
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] },
          );
        }

        it('exits 0 within bounds after serving one v0.2 frame and stdin EOF', async () => {
          const child = spawnPackagedBroker();
          try {
            child.stdin?.write(
              nmFrameFor({
                schemaIdentity: { schema: 'xdownload.core-seam', version: '1.3.0' },
                kind: 'command',
                route: 'v0.2',
                commandType: 'DOMAIN_APP_SEND',
                peer: {
                  installId: 'install-001',
                  userId: 'user-001',
                  surface: 'BROWSER_EXTENSION',
                },
                requestId: 'exit-1',
                aggregateId: 'ln-0001',
                issuedAt: '2026-11-01T00:00:00.000Z',
                payload: { intent: { requestId: 'exit-1', lineageId: 'ln-0001' } },
              }),
            );
            await awaitFirstFrame(child);
            child.stdin?.end();
            expect(await awaitExit(child)).toBe(0);
          } finally {
            child.kill();
          }
        }, 30_000);

        it('exits 0 on plain stdin EOF with no v0.2 traffic (control)', async () => {
          const child = spawnPackagedBroker();
          try {
            child.stdin?.end();
            expect(await awaitExit(child)).toBe(0);
          } finally {
            child.kill();
          }
        }, 30_000);
      },
    );

    it('accepts a real dist built on the selected tuple (runtime present)', () => {
      expect(() => assertSelectedRuntimePresent(distRoot)).not.toThrow();
    });
  },
);

// --------------------------------- T09 P2: composer tuple fail-closed gates

describe('T09 P2 composer tuple gates (fail-closed, no stripped installers)', () => {
  it('refuses a host outside the selected win32-x64 tuple with a typed error', () => {
    expect(() => assertInstallerHostTuple('linux', 'x64')).toThrow(
      /refusing to compose the windows-x64 installer on a linux-x64 host/u,
    );
    expect(() => assertInstallerHostTuple('win32', 'arm64')).toThrow(/win32-arm64 host/u);
    expect(() => assertInstallerHostTuple('darwin', 'x64')).toThrow(/fail-closed/u);
    // The selected tuple itself composes.
    expect(() => assertInstallerHostTuple('win32', 'x64')).not.toThrow();
  });

  it('refuses a dist missing the declared vendored native runtime', () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-t09-p2-'));
    try {
      fs.mkdirSync(path.join(fake, 'cli'), { recursive: true });
      fs.writeFileSync(path.join(fake, 'cli', 'xdownload-cli.js'), '// stripped dist', 'utf8');
      const failure = (): unknown => assertSelectedRuntimePresent(fake);
      expect(failure).toThrow(
        /missing the vendored native runtime of the selected win32-x64 tuple/u,
      );
      expect(failure).toThrow(/refusing to compose a stripped installer/u);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });
});

/** Module-level tree walker for the platform-independent suites. */
function walkFiles(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walkFiles(path.join(root, entry.name), relative));
    } else {
      found.push(relative);
    }
  }
  return found;
}

describe('T09 dist rebuild determinism (whole-tree, two real builds)', () => {
  // The installer hashes EVERY payload byte. This is the regression guard for
  // the controller-found defect class: any wall-clock or environment byte
  // anywhere under dist/ shows up here as a cross-build difference.
  it('two independent runPackageBuild calls emit byte-identical trees', async () => {
    // Self-contained (both trees built here) so the guard runs on EVERY
    // platform: on non-selected hosts the vendoring is honestly skipped on
    // both sides and the bundles must still match byte for byte.
    const firstDist = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-dist1-'));
    const secondDist = fs.mkdtempSync(path.join(os.tmpdir(), 'xdownload-t09-dist2-'));
    try {
      await runPackageBuild(firstDist);
      await runPackageBuild(secondDist);
      const firstFiles = walkFiles(firstDist).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const secondFiles = walkFiles(secondDist).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(secondFiles).toEqual(firstFiles);
      for (const relative of firstFiles) {
        expect(
          fs
            .readFileSync(path.join(secondDist, relative))
            .equals(fs.readFileSync(path.join(firstDist, relative))),
          `${relative} must be byte-identical across independent builds`,
        ).toBe(true);
      }
    } finally {
      fs.rmSync(firstDist, { recursive: true, force: true });
      fs.rmSync(secondDist, { recursive: true, force: true });
    }
  }, 240_000);
});
