/**
 * xDownload #183 PoC — application Host runtime assembly.
 *
 * Reads the sealed BUILD produced by scripts/build-download-app.mjs, verifies
 * the seal against the producer manifest (N07), installs the trusted
 * acquisition bridge, opens a durable caller-owned store and calls the PUBLIC
 * `load` from the packed @kaicreator/domain-harness-microkernel. Everything
 * below the facade is Host application code; there is no SDK internal import
 * anywhere.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, type DomainApp } from "@kaicreator/domain-harness-microkernel";
import { v10BuildPackageClosureDigest } from "@kaicreator/domain-harness-host-node";
import type { V10BuiltApp } from "@kaicreator/domain-harness-contracts";
import { PlainFileDocStore } from "./store/plain-file-doc-store.mjs";
import {
  AcquisitionHost,
  InMemoryBudgetLedger,
  type AcquisitionScope,
} from "./host/acquisition-host.ts";

export interface SealedModuleView {
  readonly packageId: string;
  readonly role: string;
  readonly moduleSha256: string;
  readonly provides?: readonly string[];
  readonly externalEffect?: boolean;
}

export interface BuildManifestView {
  readonly sourceSha: string;
  readonly subjectDigest: string;
  readonly packageClosureDigest: string;
  readonly modules: readonly SealedModuleView[];
}

interface HostGlobals {
  __xdAcquisitionBridge?: {
    acquire: (payload: Record<string, unknown>, permit?: unknown) => Promise<unknown>;
  };
}

export function hostGlobals(): HostGlobals {
  return globalThis as unknown as HostGlobals;
}

export interface RuntimeOptions {
  readonly storePath: string;
  readonly scope: AcquisitionScope;
  readonly sdkCommit: string;
  readonly now?: () => number;
}

export interface PoCRuntime {
  readonly app: DomainApp;
  readonly store: PlainFileDocStore;
  readonly host: AcquisitionHost;
  readonly manifest: BuildManifestView;
  stop(): void;
}

export async function startDownloadApp(options: RuntimeOptions): Promise<PoCRuntime> {
  const here = fileURLToPath(new URL("../", import.meta.url));
  const built = JSON.parse(readFileSync(join(here, "build", "app.build.json"), "utf8")) as V10BuiltApp;
  const manifest = JSON.parse(readFileSync(join(here, "build", "manifest.json"), "utf8")) as BuildManifestView;
  if (manifest.sourceSha !== options.sdkCommit) {
    throw new Error(`BUILD manifest pins SDK ${manifest.sourceSha}, expected ${options.sdkCommit}`);
  }
  verifySealedBuild(built, manifest);

  const store = new PlainFileDocStore(options.storePath);
  const host = new AcquisitionHost(
    options.scope,
    new InMemoryBudgetLedger(transferProfile(options.scope.maxBytes)),
    join(here, "build", "writer-lock.json"),
  );
  hostGlobals().__xdAcquisitionBridge = {
    acquire: (payload: Record<string, unknown>, permit?: unknown) => host.acquire(payload, permit),
  };

  const tenantId = "tenant:xdownload-i183-poc";
  const deploymentIdentity = {
    deployedAppId: "deploy:xdownload-i183-poc",
    tenantId,
    appId: built.appId,
  };
  const queryAuthority = {
    principal: { actor: "xdownload-poc-host" },
    authorize: (principal: unknown, target: { tenantId?: string }) =>
      Boolean(
        principal &&
          (principal as { actor?: string }).actor === "xdownload-poc-host" &&
          target.tenantId === tenantId,
      ),
  };

  const app = await load(built, {
    store,
    tenantId,
    deploymentIdentity,
    queryAuthority,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    app,
    store,
    host,
    manifest,
    stop() {
      app.stop();
      store.close();
      delete hostGlobals().__xdAcquisitionBridge;
    },
  };
}

export function transferProfile(maxBytes: number) {
  return {
    discovery: { domain: "discovery" },
    transfer: { domain: "transfer", maxBytes },
    globalSafety: { domain: "global_safety" },
  };
}

/** Journal row count straight from the durable store (K-owned docs). */
export function journalRowCount(store: PlainFileDocStore): number {
  return store.count("%effect-journal%");
}

/**
 * Host-side sealed-BUILD integrity check (N07): every sealed module's bytes
 * must still hash to its recorded moduleSha256, and the app's subject +
 * closure digests must equal the producer manifest, BEFORE `load` runs. The
 * v0.10.3 public `load` consumes an ALREADY-TRUSTED prebuilt app and does not
 * re-verify module bytes against the sealed hashes itself — the trusted Host
 * application owns that boundary here and refuses altered/unselected payloads
 * before any effect can exist.
 */
export function verifySealedBuild(
  built: Pick<V10BuiltApp, "subjectDigest" | "modules">,
  manifest: BuildManifestView,
): void {
  if (built.subjectDigest !== manifest.subjectDigest) {
    throw new Error(
      `SEALED_BUILD_SUBJECT_DIGEST_MISMATCH: app ${built.subjectDigest} != manifest ${manifest.subjectDigest}`,
    );
  }
  if (v10BuildPackageClosureDigest(built as V10BuiltApp) !== manifest.packageClosureDigest) {
    throw new Error("SEALED_BUILD_CLOSURE_DIGEST_MISMATCH: recomputed closure digest differs from the manifest");
  }
  const sealed = new Map<string, string>(manifest.modules.map((m) => [m.packageId, m.moduleSha256]));
  for (const module of built.modules) {
    const recorded = sealed.get(module.packageId);
    if (recorded === undefined) {
      throw new Error(`SEALED_BUILD_MODULE_UNSELECTED: ${module.packageId} is not in the producer manifest`);
    }
    const actual = createHash("sha256").update(module.moduleSource, "utf8").digest("hex");
    if (actual !== module.moduleSha256 || actual !== recorded) {
      throw new Error(
        `SEALED_BUILD_MODULE_ALTERED: ${module.packageId} bytes no longer match the sealed moduleSha256`,
      );
    }
  }
}
