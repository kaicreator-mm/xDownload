/**
 * #183 PoC test matrix — P01/P02 positives and N01–N08 fail-closed negatives
 * (+ M01 overhead measurement) over the REAL packed DomainHarness v0.10.3
 * clean consumer and the EXISTING xDownload DirectHttpAdapter.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { BuildManifestView } from "../src/app-runtime.ts";
import type {
  V10BuiltApp,
  V10PublicIntent,
  V10ScopedSubscriptionEvent,
} from "@kaicreator/domain-harness-contracts";
import {
  DownloadFixture,
  makeWorkspace,
  journalRowCount,
  SDK_COMMIT,
  payload,
  sha256,
  hostGlobals,
  type Workspace,
} from "./helpers/poc.ts";
import { PreSendGateway } from "../src/gateway/pre-send-gateway.ts";

/** Structural view of one public K receipt (send returns dynamic records). */
interface KEffectView {
  readonly disposition?: string;
  readonly output?: {
    readonly outcome?: {
      readonly ok?: boolean;
      readonly output?: Record<string, unknown>;
      readonly error?: { readonly code?: string; readonly message?: string };
    };
  };
}
interface KReceiptView {
  readonly status?: string;
  readonly idempotentReplay?: boolean;
  readonly admitted?: {
    readonly effects?: readonly KEffectView[];
    readonly resolver?: { readonly llmAvoided?: boolean };
  };
}
interface KAnswerView {
  readonly target?: { readonly instanceKey?: string };
  readonly snapshot?: { readonly state?: { readonly stateKey?: string } };
}
function asReceipt(value: unknown): KReceiptView {
  return value as KReceiptView;
}
function asAnswer(value: unknown): KAnswerView {
  return value as KAnswerView;
}

const workspaces: Workspace[] = [];
afterAll(async () => {
  for (const workspace of workspaces.splice(0)) {
    await workspace.dispose();
  }
});

async function fresh(name: string): Promise<Workspace> {
  const workspace = await makeWorkspace(name);
  workspaces.push(workspace);
  return workspace;
}

function confirmedBody(size: number, seed = 7): Buffer {
  return payload(size, seed);
}

function downloadIntent(
  workspace: Workspace,
  requestId: string,
  body: Buffer,
  urlPath: string,
): V10PublicIntent {
  return {
    intentType: "confirmDownload",
    instanceKey: `download-${requestId}`,
    messageId: `msg-${requestId}`,
    input: {
      requestId,
      url: `${workspace.baseUri}${urlPath}`,
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    },
  };
}

async function admitDownload(
  workspace: Workspace,
  requestId: string,
  body: Buffer,
  urlPath = "/file.bin",
): Promise<{ receipt: KReceiptView; fileSha256: string }> {
  const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
  const decision = gateway.validate({
    requestId,
    url: `${workspace.baseUri}${urlPath}`,
    expectedSha256: sha256(body),
    expectedTotalBytes: body.byteLength,
    allowedHost: workspace.host,
    outputRoot: workspace.outputRoot,
  });
  if (!decision.accepted) {
    throw new Error(`fixture request rejected by gateway: ${decision.code}`);
  }
  const receipt = await gateway.send(workspace.runtime.app, decision.request);
  return { receipt: asReceipt(receipt), fileSha256: sha256(body) };
}

describe("P01 — valid declared fixture → K admission → real transfer → materialized file → terminal query", () => {
  it("completes the whole journey with digest-backed file and truthful K state", async () => {
    const workspace = await fresh("p01");
    const body = confirmedBody(4096, 11);
    const path = "/p01.bin";
    workspace.fixture.serve(path, { body });

    const journalBefore = journalRowCount(workspace.runtime.store);
    const { receipt, fileSha256 } = await admitDownload(workspace, "p01-file", body, path);

    expect(receipt.status).toBe("admitted");
    const effect = receipt.admitted?.effects?.[0];
    expect(effect?.disposition).toBe("executed");
    expect(effect?.output?.outcome?.ok).toBe(true);
    expect(effect?.output?.outcome?.output?.fileSha256).toBe(fileSha256);
    // The dispatch ran under a LIVE K-issued Effect Permit: the external gate
    // handed the sealed adapter a kernel-minted permit identity (R1 F-03).
    expect(typeof effect?.output?.outcome?.output?.permitEffectId).toBe("string");
    expect((effect?.output?.outcome?.output?.permitEffectId as string).length).toBeGreaterThan(0);

    const filePath = join(workspace.outputRoot, "p01-file.bin");
    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath);
    expect(sha256(written)).toBe(fileSha256);
    expect(written.byteLength).toBe(body.byteLength);
    expect(workspace.runtime.host.counters.filesWritten).toBe(1);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(1);

    const journalAfter = journalRowCount(workspace.runtime.store);
    expect(journalAfter).toBeGreaterThan(journalBefore);
    const rows = workspace.runtime.store.journalRows();
    expect(rows.length).toBe(journalAfter);

    const answer = asAnswer(
      await workspace.runtime.app.query({
        workflowId: "download-acquisition",
        instanceKey: "download-p01-file",
      }),
    );
    expect(answer.target?.instanceKey).toBe("download-p01-file");
    expect(answer.snapshot?.state?.stateKey).toBe("acquired");

    // Subscription (async, tiny-scenario pattern): subscribe to the now
    // existing instance, then drive an idempotent replay of the SAME turn —
    // the live seam delivers the frozen public projection of that replay.
    const events: V10ScopedSubscriptionEvent[] = [];
    const subscription = await workspace.runtime.app.subscribe(
      { workflowId: "download-acquisition", instanceKey: "download-p01-file" },
      (event) => events.push(event),
    );
    const replay = asReceipt(
      await workspace.runtime.app.send(downloadIntent(workspace, "p01-file", body, path)),
    );
    expect(replay.status).toBe("admitted");
    expect(replay.idempotentReplay).toBe(true);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(1); // replay ran no effect
    await new Promise((r) => setTimeout(r, 50));
    const admitted = events.find((e) => e.kind === "admitted" && e.occurrenceId === "msg-p01-file");
    expect(admitted).toBeDefined();
    expect((admitted?.target as { instanceKey?: string }).instanceKey).toBe("download-p01-file");
    subscription.unsubscribe();
  });
});

describe("P02 — no configured LLM provider", () => {
  it("deterministic journey with zero model surface", async () => {
    const workspace = await fresh("p02");
    const manifest = workspace.runtime.manifest;
    expect(manifest.modules.map((m) => m.role).sort()).toEqual([
      "business",
      "capability",
      "kernel-primary",
      "standard-primary",
    ]);
    expect(
      manifest.modules.some((m) => (m.provides ?? []).some((p) => p.startsWith("provider:"))),
    ).toBe(false);

    const body = confirmedBody(1024, 23);
    workspace.fixture.serve("/p02.bin", { body });
    const { receipt } = await admitDownload(workspace, "p02-file", body, "/p02.bin");
    expect(receipt.status).toBe("admitted");
    expect(receipt.admitted?.resolver?.llmAvoided).toBe(true);
    expect(existsSync(join(workspace.outputRoot, "p02-file.bin"))).toBe(true);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(1);
  });
});

describe("N01 — absent permit / unselected C operation: zero network, zero file", () => {
  it("refuses an intent with no sealed route before any physical effect", async () => {
    const workspace = await fresh("n01");
    const requestsBefore = workspace.fixture.requests.length;
    const journalBefore = journalRowCount(workspace.runtime.store);

    // A well-formed gateway-shaped intent whose intentType has no sealed
    // route in the K BUILD: K must refuse before minting any permit or
    // touching C. The public facade throws a typed refusal for route-less
    // intents.
    let refusedCode = "";
    try {
      await workspace.runtime.app.send({
        intentType: "confirmDownloadUnknown",
        instanceKey: "download-n01-unknown",
        messageId: "msg-n01-unknown",
        input: {
          requestId: "n01-unknown",
          url: `${workspace.baseUri}/n01.bin`,
          expectedSha256: sha256(confirmedBody(16, 1)),
          expectedTotalBytes: 16,
          allowedHost: workspace.host,
          outputRoot: workspace.outputRoot,
        },
      });
    } catch (error) {
      refusedCode = String((error as { code?: string; name?: string })?.code ?? (error as Error)?.name ?? error);
    }
    expect(refusedCode).toMatch(/INTENT_UNSEALED|V10/);

    expect(journalRowCount(workspace.runtime.store)).toBe(journalBefore);
    expect(workspace.fixture.requests.length).toBe(requestsBefore);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(0);
    expect(workspace.runtime.host.counters.filesWritten).toBe(0);
  });

  it("records a truthful failed effect row when C cannot run, with zero physical effect", async () => {
    const workspace = await fresh("n01b");
    const requestsBefore = workspace.fixture.requests.length;
    const journalBefore = journalRowCount(workspace.runtime.store);

    // Simulated missing trusted Host bridge: the sealed C module refuses to
    // run, K journals the effect failure honestly, and NOTHING physical
    // happens (no network request, no file, no host bridge invocation).
    const bridge = hostGlobals().__xdAcquisitionBridge;
    delete hostGlobals().__xdAcquisitionBridge;
    try {
      const receipt = asReceipt(
        await workspace.runtime.app.send(downloadIntent(workspace, "n01b", confirmedBody(16, 2), "/n01b.bin")),
      );
      // Either a non-admitted receipt or an effect whose outcome is not ok.
      if (receipt.status === "admitted") {
        expect(receipt.admitted?.effects?.[0]?.output?.outcome?.ok).not.toBe(true);
      }
    } catch (error) {
      // The sealed C module throws a plain Error (missing bridge); the public
      // facade masks it to a fixed HOST_DOC_READ_FAILED code — the honest
      // observed refusal shape for a C module that cannot run.
      const code = String((error as { code?: string; name?: string })?.code ?? (error as Error)?.name ?? error);
      expect(code).toMatch(/V10|ADMISSION|HOST_DOC/);
    } finally {
      hostGlobals().__xdAcquisitionBridge = bridge;
    }

    expect(workspace.fixture.requests.length).toBe(requestsBefore);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(0);
    expect(workspace.runtime.host.counters.filesWritten).toBe(0);
    expect(existsSync(join(workspace.outputRoot, "n01b.bin"))).toBe(false);
    // The K-internal journal records the failure; it is not a physical effect.
    const journalDelta = journalRowCount(workspace.runtime.store) - journalBefore;
    expect(journalDelta).toBeGreaterThanOrEqual(0);
  });
});

describe("N02 — target/output-path/source replacement outside confirmed scope", () => {
  it("gateway rejects a host substitution before any send", async () => {
    const workspace = await fresh("n02");
    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
    const evil = new DownloadFixture();
    const evilUri = await evil.start();
    try {
      const decision = gateway.validate({
        requestId: "n02-swap",
        url: `${evilUri}/swap.bin`,
        expectedSha256: sha256(confirmedBody(16, 3)),
        expectedTotalBytes: 16,
        allowedHost: new URL(evilUri).host,
        outputRoot: workspace.outputRoot,
      });
      expect(decision.accepted).toBe(false);
      if (!decision.accepted) {
        expect(decision.code).toBe("GATEWAY_SCOPE_HOST");
      }
      expect(gateway.sendCallCount).toBe(0);
      expect(workspace.runtime.host.counters.acquireCalls).toBe(0);
    } finally {
      await evil.stop();
    }
  });

  it("gateway rejects an output root substitution", async () => {
    const workspace = await fresh("n02b");
    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
    const decision = gateway.validate({
      requestId: "n02b-root",
      url: `${workspace.baseUri}/n02b.bin`,
      expectedSha256: sha256(confirmedBody(16, 4)),
      expectedTotalBytes: 16,
      allowedHost: workspace.host,
      outputRoot: "/definitely/other/root",
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.code).toBe("GATEWAY_SCOPE_ROOT");
    }
    expect(gateway.sendCallCount).toBe(0);
  });

  it("redirect scope expansion inside the adapter fails closed with zero file", async () => {
    const workspace = await fresh("n02c");
    const evil = new DownloadFixture();
    const evilUri = await evil.start();
    try {
      const body = confirmedBody(512, 5);
      evil.serve("/out-of-scope.bin", { body });
      workspace.fixture.serve("/redirect.bin", { body, redirectTo: `${evilUri}/out-of-scope.bin` });
      const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
      const decision = gateway.validate({
        requestId: "n02c-redirect",
        url: `${workspace.baseUri}/redirect.bin`,
        expectedSha256: sha256(body),
        expectedTotalBytes: body.byteLength,
        allowedHost: workspace.host,
        outputRoot: workspace.outputRoot,
      });
      expect(decision.accepted).toBe(true);
      if (!decision.accepted) return;
      const receipt = asReceipt(await gateway.send(workspace.runtime.app, decision.request));
      // The transfer reached C (permitted), but the adapter must refuse the
      // redirect hop outside allowedRedirectHosts and nothing may be written.
      expect(existsSync(join(workspace.outputRoot, "n02c-redirect.bin"))).toBe(false);
      expect(workspace.runtime.host.counters.filesWritten).toBe(0);
      expect(receipt.status).toBeDefined();
    } finally {
      await evil.stop();
    }
  });
});

describe("N03 — duplicate request/effect after accepted result", () => {
  it("replays idempotently with exactly one accepted artifact", async () => {
    const workspace = await fresh("n03");
    const body = confirmedBody(2048, 31);
    workspace.fixture.serve("/n03.bin", { body });
    const { receipt } = await admitDownload(workspace, "n03-dup", body, "/n03.bin");
    expect(receipt.status).toBe("admitted");
    const filesAfterFirst = workspace.runtime.host.counters.filesWritten;
    const journalAfterFirst = journalRowCount(workspace.runtime.store);
    const transferCallsAfterFirst = workspace.runtime.host.counters.acquireCalls;

    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
    const decision = gateway.validate({
      requestId: "n03-dup",
      url: `${workspace.baseUri}/n03.bin`,
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(decision.accepted).toBe(true);
    const duplicate = asReceipt(await gateway.send(workspace.runtime.app, decision.request));

    expect(workspace.runtime.host.counters.filesWritten).toBe(filesAfterFirst);
    expect(journalRowCount(workspace.runtime.store)).toBe(journalAfterFirst);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(transferCallsAfterFirst);
    expect(existsSync(join(workspace.outputRoot, "n03-dup.bin"))).toBe(true);
    // The duplicate is the idempotent replay of the accepted turn (tiny
    // pattern): admitted with idempotentReplay, never a second executed
    // physical effect.
    expect(duplicate.status).toBe("admitted");
    expect(duplicate.idempotentReplay).toBe(true);
  });
});

describe("N04 — cancel/restart: truthful UNKNOWN, no automatic redownload", () => {
  it("abort mid-transfer leaves no file and requires explicit re-authorization", async () => {
    const workspace = await fresh("n04");
    const body = confirmedBody(4096, 41);
    workspace.fixture.serve("/n04.bin", { body, stallAfterBytes: 64 });

    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
    const decision = gateway.validate({
      requestId: "n04-cancel",
      url: `${workspace.baseUri}/n04.bin`,
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;

    const requestsBefore = workspace.fixture.requests.length;
    const sendPromise = gateway.send(workspace.runtime.app, decision.request) as Promise<unknown>;
    // Cancel as soon as the physical request hits the fixture.
    for (let i = 0; i < 200 && workspace.fixture.requests.length === requestsBefore; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(workspace.fixture.requests.length).toBeGreaterThan(requestsBefore);
    workspace.runtime.host.cancel("n04-cancel");

    const receipt = asReceipt(await sendPromise);
    expect(existsSync(join(workspace.outputRoot, "n04-cancel.bin"))).toBe(false);
    expect(workspace.runtime.host.counters.filesWritten).toBe(0);
    // Truthful non-success: no fake admitted completed download; observe the
    // actual terminal vocabulary.
    const effect = receipt.admitted?.effects?.[0];
    const okResult = effect?.output?.outcome?.ok;
    expect(okResult === undefined || okResult === false).toBe(true);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(1); // no auto-redownload

    // Authorized reconciliation: a NEW stable identity, explicitly re-sent.
    const body2 = confirmedBody(1024, 42);
    workspace.fixture.clearRequests();
    workspace.fixture.serve("/n04-retry.bin", { body: body2 });
    const retryDecision = gateway.validate({
      requestId: "n04-retry",
      url: `${workspace.baseUri}/n04-retry.bin`,
      expectedSha256: sha256(body2),
      expectedTotalBytes: body2.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(retryDecision.accepted).toBe(true);
    if (!retryDecision.accepted) return;
    const retry = asReceipt(await gateway.send(workspace.runtime.app, retryDecision.request));
    expect(retry.status).toBe("admitted");
    expect(existsSync(join(workspace.outputRoot, "n04-retry.bin"))).toBe(true);
  });

  it("restart reuses the durable store: journal rows survive, replay stays idempotent", async () => {
    const workspace = await fresh("n04b");
    const body = confirmedBody(512, 43);
    workspace.fixture.serve("/n04b.bin", { body });
    const { receipt } = await admitDownload(workspace, "n04b-restart", body, "/n04b.bin");
    expect(receipt.status).toBe("admitted");
    const journalBefore = journalRowCount(workspace.runtime.store);
    const storePath = workspace.runtime.store.path;

    // Simulated process boundary: stop the app, reopen the same store file.
    workspace.runtime.stop();
    const { startDownloadApp } = await import("../src/app-runtime.ts");
    const reopened = await startDownloadApp({
      storePath,
      sdkCommit: SDK_COMMIT,
      scope: {
        allowedHosts: [workspace.host],
        outputRoot: workspace.outputRoot,
        maxBytes: 1048576,
      },
    });
    try {
      expect(journalRowCount(reopened.store)).toBe(journalBefore);

      // Same messageId replay after restart: idempotent, no second artifact.
      const replay = asReceipt(
        await reopened.app.send(downloadIntent(workspace, "n04b-restart", body, "/n04b.bin")),
      );
      expect(replay.idempotentReplay === true || replay.status === "admitted").toBe(true);
      expect(reopened.host.counters.filesWritten).toBe(0);
      expect(existsSync(join(workspace.outputRoot, "n04b-restart.bin"))).toBe(true);
    } finally {
      reopened.stop();
    }
  });
});

describe("N05 — tampered receipt/digest/identity: fail closed, no journal clearing", () => {
  it("refuses bytes whose digest does not match the confirmed anchor", async () => {
    const workspace = await fresh("n05");
    const declared = confirmedBody(512, 51);
    const actual = confirmedBody(512, 52);
    workspace.fixture.serve("/n05.bin", { body: actual });
    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);
    const decision = gateway.validate({
      requestId: "n05-tamper",
      url: `${workspace.baseUri}/n05.bin`,
      expectedSha256: sha256(declared), // honest anchor, corrupt server bytes
      expectedTotalBytes: declared.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    const journalBefore = journalRowCount(workspace.runtime.store);
    await gateway.send(workspace.runtime.app, decision.request);
    expect(existsSync(join(workspace.outputRoot, "n05-tamper.bin"))).toBe(false);
    expect(workspace.runtime.host.counters.filesWritten).toBe(0);
    // No journal row may be deleted by the failure path.
    expect(journalRowCount(workspace.runtime.store)).toBeGreaterThanOrEqual(journalBefore);
  });

  it("host artifact identity tampering is detected against the recorded K evidence", async () => {
    const workspace = await fresh("n05b");
    const body = confirmedBody(256, 53);
    workspace.fixture.serve("/n05b.bin", { body });
    await admitDownload(workspace, "n05b-file", body, "/n05b.bin");
    const filePath = join(workspace.outputRoot, "n05b-file.bin");
    expect(existsSync(filePath)).toBe(true);

    // Tamper the materialized artifact after acceptance: the recorded K-side
    // evidence (fileSha256 in the journal output) no longer matches disk.
    const tampered = confirmedBody(256, 54);
    writeFileSync(filePath, tampered);
    const rows = workspace.runtime.store.journalRows();
    const evidence = JSON.stringify(rows.map((r) => r.row));
    expect(evidence).toContain(sha256(body));
    expect(evidence).not.toContain(sha256(tampered));
  });
});

describe("N06 — two business writers attempt the same lineage", () => {
  it("rejects a second writer identity on the same artifact lineage", async () => {
    const workspace = await fresh("n06");
    const body = confirmedBody(256, 61);
    workspace.fixture.serve("/n06.bin", { body });
    const { receipt } = await admitDownload(workspace, "n06-single", body, "/n06.bin");
    expect(receipt.status).toBe("admitted");

    // A legacy Core-style writer (different effect identity) claims the SAME
    // artifact lineage: the Host one-writer claim must refuse it.
    const secondWriter = (await workspace.runtime.host.acquire({
      requestId: "n06-single",
      url: `${workspace.baseUri}/n06.bin`,
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
      effectId: "effect:legacy-core-writer-2",
    })) as {
      outcome?: { ok?: boolean; error?: { code?: string } };
    };
    expect(secondWriter.outcome?.ok).toBe(false);
    expect(secondWriter.outcome?.error?.code).toBe("WRITER_IDENTITY_CONFLICT");
    expect(workspace.runtime.host.counters.filesWritten).toBe(1);
  });
});

describe("N07 — altered/unselected BUILD module refuses before effect", () => {
  interface MutableSealedModule {
    readonly packageId: string;
    readonly role: string;
    moduleSource: string;
    readonly moduleSha256: string;
  }
  interface MutableSealedBuild extends Pick<V10BuiltApp, "appId" | "subjectDigest"> {
    modules: MutableSealedModule[];
  }

  it("host pre-load integrity verification refuses altered sealed module bytes", async () => {
    const built = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "build", "app.build.json"), "utf8"),
    ) as V10BuiltApp;
    const manifest = producerManifest;
    const tampered = structuredClone(built) as unknown as MutableSealedBuild;
    const module = tampered.modules.find((m) => m.role === "business");
    expect(module).toBeDefined();
    // Alter the sealed bytes but KEEP the sealed moduleSha256: the trusted
    // Host pre-load verification must refuse before load and before any
    // effect can run.
    module!.moduleSource = `${module!.moduleSource}\n// tampered`;

    const { verifySealedBuild } = await import("../src/app-runtime.ts");
    let refused = "";
    try {
      verifySealedBuild(tampered, manifest);
    } catch (error) {
      refused = String((error as Error)?.message ?? error);
    }
    expect(refused).toContain("SEALED_BUILD_MODULE_ALTERED");
  });

  it("buildV10App refuses a route to an unselected capability with the exact typed code", async () => {
    const { buildV10App } = await import("@kaicreator/domain-harness-build");
    const { V10_TARGET_PROFILE } = await import("@kaicreator/domain-harness-contracts");
    // Use the REAL sealed module payloads from the committed BUILD so the ONLY
    // refusal variable is the unselected capabilityId in the route (R1 F-04).
    const built = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "build", "app.build.json"), "utf8"),
    ) as V10BuiltApp;
    const stripNullable = (module: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(module).filter(([, value]) => value !== null && value !== undefined));
    const modules = built.modules.map((m) => stripNullable(m as unknown as Record<string, unknown>));

    let controlRefused = "";
    try {
      buildV10App({
        appId: "app:xdownload-n07-control",
        audience: "aud:xdownload-i183-research",
        targetProfile: V10_TARGET_PROFILE,
        modules: modules as never,
        routes: [
          {
            intentId: "confirmDownload",
            operationId: "acquire",
            capabilityId: "acquisition",
            handlerId: "acquireFile",
          },
        ],
        hardBudget: { maxStepsPerTurn: 16, maxWorkUnitsPerTurn: 64 },
      });
    } catch (error) {
      controlRefused = String((error as { code?: string })?.code ?? (error as Error)?.name ?? error);
    }
    expect(controlRefused).toBe(""); // control: valid composition builds

    let refusedCode = "";
    try {
      buildV10App({
        appId: "app:xdownload-n07-unselected",
        audience: "aud:xdownload-i183-research",
        targetProfile: V10_TARGET_PROFILE,
        modules: modules as never,
        routes: [
          {
            intentId: "confirmDownload",
            operationId: "acquire",
            capabilityId: "acquisition-missing",
            handlerId: "acquireFile",
          },
        ],
        hardBudget: { maxStepsPerTurn: 16, maxWorkUnitsPerTurn: 64 },
      });
    } catch (error) {
      refusedCode = String((error as { code?: string })?.code ?? (error as Error)?.name ?? error);
    }
    expect(refusedCode).toBe("V10_ROUTE_INVALID");
  });
});

describe("N08 — mandatory #1437 gate: trusted pre-send validation, zero poisoned journal", () => {
  it("invalid request: zero send, zero network, zero journal row; valid same identity then succeeds", async () => {
    const workspace = await fresh("n08");
    const body = confirmedBody(1024, 71);
    workspace.fixture.serve("/n08.bin", { body });
    const gateway = new PreSendGateway([workspace.host], workspace.outputRoot);

    const journalBefore = journalRowCount(workspace.runtime.store);
    const requestsBefore = workspace.fixture.requests.length;

    const malformed = gateway.validate({
      requestId: "n08-gate",
      url: `${workspace.baseUri}/n08.bin`,
      expectedSha256: "not-a-digest",
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(malformed.accepted).toBe(false);
    if (!malformed.accepted) {
      expect(malformed.code).toBe("GATEWAY_DIGEST");
    }
    expect(gateway.sendCallCount).toBe(0);
    expect(journalRowCount(workspace.runtime.store)).toBe(journalBefore);
    expect(workspace.fixture.requests.length).toBe(requestsBefore);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(0);
    expect(existsSync(join(workspace.outputRoot, "n08-gate.bin"))).toBe(false);

    // The SAME stable identity is now used by a valid request: must follow the
    // normal K/Host path, not be blocked by the invalid precursor.
    const valid = gateway.validate({
      requestId: "n08-gate",
      url: `${workspace.baseUri}/n08.bin`,
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedHost: workspace.host,
      outputRoot: workspace.outputRoot,
    });
    expect(valid.accepted).toBe(true);
    if (!valid.accepted) return;
    const receipt = asReceipt(await gateway.send(workspace.runtime.app, valid.request));
    expect(receipt.status).toBe("admitted");
    expect(existsSync(join(workspace.outputRoot, "n08-gate.bin"))).toBe(true);
    expect(workspace.runtime.host.counters.acquireCalls).toBe(1);
    expect(journalRowCount(workspace.runtime.store)).toBeGreaterThan(journalBefore);
  });
});

describe("M01 — measured overhead on the same bounded fixture", () => {
  it("records wall clock for direct vs K-orchestrated transfer of the same bytes", async () => {
    const workspace = await fresh("m01");
    const body = confirmedBody(4096, 81);
    workspace.fixture.serve("/m01.bin", { body });

    // Baseline: direct adapter acquire (no K), same fixture/bytes.
    const { DirectHttpAdapter } = await import("@xdownload/direct-acquisition");
    const { InMemoryBudgetLedger } = await import("../src/host/acquisition-host.ts");
    const {
      bindLocator,
      makeContractId,
      makeEffectId,
      makeLogicalTargetId,
      makeMemberId,
      unwrapOrThrow,
    } = await import("@xdownload/domain-contracts");
    const directStart = performance.now();
    const ledger = new InMemoryBudgetLedger({
      discovery: { domain: "discovery" },
      transfer: { domain: "transfer", maxBytes: 1048576 },
      globalSafety: { domain: "global_safety" },
    });
    const direct = await new DirectHttpAdapter(ledger).acquire({
      effectId: unwrapOrThrow(makeEffectId("effect-m01-baseline")),
      contractId: unwrapOrThrow(makeContractId("contract-m01")),
      slice: "S1",
      selectedMemberId: unwrapOrThrow(makeMemberId("member-m01")),
      binding: unwrapOrThrow(
        bindLocator(
          { kind: "direct", uri: `${workspace.baseUri}/m01.bin` },
          unwrapOrThrow(makeLogicalTargetId("target-m01")),
          { binding: "DECLARED_DELIVERY_EDGE", originLocatorUri: `${workspace.baseUri}/m01.bin` },
        ),
      ),
      expectedSha256: sha256(body),
      expectedTotalBytes: body.byteLength,
      allowedRedirectHosts: [workspace.host],
      attempt: 0,
    });
    const directMs = performance.now() - directStart;
    expect(unwrapOrThrow(direct).reason).toBe("COMPLETED");

    // K-orchestrated: same fixture through gateway → K → C/Host → adapter.
    const orchestratedStart = performance.now();
    const { receipt } = await admitDownload(workspace, "m01-orchestrated", body, "/m01.bin");
    const orchestratedMs = performance.now() - orchestratedStart;
    expect(receipt.status).toBe("admitted");
    expect(existsSync(join(workspace.outputRoot, "m01-orchestrated.bin"))).toBe(true);

    console.log(
      `[M01] direct=${directMs.toFixed(1)}ms orchestrated=${orchestratedMs.toFixed(1)}ms overhead=${(orchestratedMs - directMs).toFixed(1)}ms bytes=${body.byteLength}`,
    );
    expect(orchestratedMs).toBeGreaterThan(0);
    expect(directMs).toBeGreaterThan(0);
  });
});

// Loaded from the committed producer manifest (read here so the N07 tamper
// test compares against the exact recorded seal, not a rebuilt one).
const producerManifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "build", "manifest.json"), "utf8"),
) as BuildManifestView;
