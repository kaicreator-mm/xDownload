/**
 * v0.2 T12 — test-only support for the S2/S5/S6 slice journey tests.
 *
 * NOT a test file: this module registers no tests and is imported exclusively
 * by the *.test.ts files colocated in this lane. It carries the T11
 * precedent's real localhost fixture (random port, per-path behavior,
 * recorded requests) and one direct-runtime workspace factory — the same
 * zero-mock discipline as the T11 composition matrix: real assembled K
 * runtime, real pinned T04 bridge, real 127.0.0.1 bytes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleDownloadRuntime,
  type DownloadRuntime,
  type TargetRefSeed,
} from '../composition/runtime.ts';

export type Behavior = (request: IncomingMessage, response: ServerResponse) => void;

export class LocalHttpFixture {
  private readonly server: Server;
  private readonly behaviors = new Map<string, Behavior>();
  readonly requests: string[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((request: IncomingMessage, response: ServerResponse) => {
      this.requests.push(request.url ?? '/');
      const behavior = this.behaviors.get((request.url ?? '/').split('?')[0] ?? '/');
      if (behavior === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('fixture: no behavior');
        return;
      }
      behavior(request, response);
    });
  }

  on(path: string, behavior: Behavior): void {
    this.behaviors.set(path, behavior);
  }

  serveBytes(path: string, body: Uint8Array): void {
    this.on(path, (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      });
      response.end(Buffer.from(body));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolveStart) => {
      this.server.listen(0, '127.0.0.1', () => resolveStart());
    });
    this.port = (this.server.address() as { port: number }).port;
  }

  get host(): string {
    return `127.0.0.1:${String(this.port)}`;
  }

  uri(path: string): string {
    return `http://127.0.0.1:${String(this.port)}${path}`;
  }

  requestCount(path: string): number {
    return this.requests.filter((recorded) => recorded === path).length;
  }

  get totalRequests(): number {
    return this.requests.length;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolveStop, rejectStop) => {
      this.server.close((error) => (error === undefined ? resolveStop() : rejectStop(error)));
    });
  }
}

/** Declared registry seed: opaque handle → fixture path (resolved at assembly). */
export interface SliceSeedPlan {
  readonly handle: string;
  readonly path: string;
}

export interface SliceWorkspace {
  readonly root: string;
  readonly outputRoot: string;
  readonly storePath: string;
  readonly fixture: LocalHttpFixture;
  readonly runtime: DownloadRuntime;
  dispose(): Promise<void>;
}

/**
 * Assemble one direct-runtime workspace over the shared fixture with the
 * declared seeds registered BEFORE assembly (the registry is consumed by the
 * trusted composition at assembly time, like the T11 matrix does).
 */
export async function makeSliceWorkspace(
  name: string,
  fixture: LocalHttpFixture,
  seedPlans: readonly SliceSeedPlan[],
): Promise<SliceWorkspace> {
  const root = mkdtempSync(join(tmpdir(), `xd-v02-t12-${name}-`));
  const outputRoot = join(root, 'out');
  const storePath = join(root, 'k-docs.json');
  const seeds: TargetRefSeed[] = seedPlans.map((plan) => ({
    handle: plan.handle,
    record: { uri: fixture.uri(plan.path), allowedRedirectHosts: [fixture.host] },
  }));
  const runtime = await assembleDownloadRuntime({ storePath, targetRefs: seeds });
  return {
    root,
    outputRoot,
    storePath,
    fixture,
    runtime,
    async dispose(): Promise<void> {
      runtime.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
