/**
 * #183 PoC test helpers: bounded local HTTP fixture (node:http, random port,
 * recorded requests) and per-test isolated K workspaces.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDownloadApp, journalRowCount, hostGlobals, type PoCRuntime } from "../../src/app-runtime.ts";

export function payload(size: number, seed = 1): Buffer {
  const bytes = Buffer.alloc(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface ServedFile {
  body: Buffer;
  /** Stall the first response after `stallAfterBytes` bytes until abort. */
  stallAfterBytes?: number;
  /** Respond with a redirect to this absolute URI instead of the body. */
  redirectTo?: string;
}

export class DownloadFixture {
  private server: Server | null = null;
  private files = new Map<string, ServedFile>();
  requests: Array<{ path: string; headers: Record<string, string | undefined> }> = [];

  serve(path: string, file: ServedFile): void {
    this.files.set(path, file);
  }

  clearRequests(): void {
    this.requests = [];
  }

  async start(): Promise<string> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      this.requests.push({ path: url, headers: { ...req.headers } });
      const file = this.files.get((url.split("?")[0] ?? "/"));
      if (file === undefined) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("fixture: not found");
        return;
      }
      if (file.redirectTo !== undefined) {
        res.writeHead(302, { location: file.redirectTo });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(file.body.byteLength),
      });
      if (file.stallAfterBytes === undefined) {
        res.end(file.body);
        return;
      }
      res.write(file.body.subarray(0, file.stallAfterBytes));
      // Never finish: the client must abort for this response to end.
    });
    await new Promise<void>((resolveStart) => {
      this.server!.listen(0, "127.0.0.1", resolveStart);
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("fixture server failed to bind");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (this.server !== null) {
      this.server.closeAllConnections();
      await new Promise<void>((resolveStop, rejectStop) => {
        this.server!.close((error) => (error ? rejectStop(error) : resolveStop()));
      });
      this.server = null;
    }
  }
}

export const SDK_COMMIT = "061376f4a023070f215f9feffad5c24d96d503cb";

export interface Workspace {
  runtime: PoCRuntime;
  outputRoot: string;
  fixture: DownloadFixture;
  baseUri: string;
  host: string;
  dispose(): Promise<void>;
}

export async function makeWorkspace(testName: string): Promise<Workspace> {
  const fixture = new DownloadFixture();
  const baseUri = await fixture.start();
  const host = new URL(baseUri).host;
  const root = mkdtempSync(join(tmpdir(), `xd-i183-${testName}-`));
  const outputRoot = join(root, "out");
  const runtime = await startDownloadApp({
    storePath: join(root, "k-docs.json"),
    sdkCommit: SDK_COMMIT,
    scope: {
      allowedHosts: [host],
      outputRoot,
      maxBytes: 1048576,
    },
  });
  return {
    runtime,
    outputRoot,
    fixture,
    baseUri,
    host,
    async dispose() {
      runtime.stop();
      await fixture.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export { journalRowCount, hostGlobals };
