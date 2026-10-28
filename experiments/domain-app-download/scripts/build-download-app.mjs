// xDownload #183 PoC — external BUILD producer.
//
// Seals the download Domain App from:
//   - K/S payload bytes read from an exact v0.10.3 SDK checkout (pinned below,
//     dirty or wrong-commit checkouts are refused);
//   - App-owned B/C module bytes from ../src/modules/;
// via the packed public @kaicreator/domain-harness-build (buildV10App) and
// writes build/app.build.json + build/manifest.json. The runtime consumer
// never sees the SDK checkout again.
//
// Usage: node scripts/build-download-app.mjs <sdk-checkout>
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { error as consoleError, log as consoleLog } from "node:console";
import process from "node:process";
import { V10_TARGET_PROFILE, sha256Hex } from "@kaicreator/domain-harness-contracts";
import { buildV10App } from "@kaicreator/domain-harness-build";
import { v10BuildPackageClosureDigest } from "@kaicreator/domain-harness-host-node";

const SDK_COMMIT = "061376f4a023070f215f9feffad5c24d96d503cb";
const SDK_TREE = "099cdc831aef63befd62aaede7e7a853d1be468f";

const checkout = process.argv[2];
if (!checkout) {
  consoleError("usage: node scripts/build-download-app.mjs <domain-harness-checkout>");
  process.exit(2);
}
const repo = resolve(checkout);
const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== SDK_COMMIT) {
  consoleError(`REFUSAL: checkout HEAD ${head} != pinned v0.10.3 commit ${SDK_COMMIT}`);
  process.exit(3);
}
const tree = execFileSync("git", ["-C", repo, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
if (tree !== SDK_TREE) {
  consoleError(`REFUSAL: checkout tree ${tree} != pinned tree ${SDK_TREE}`);
  process.exit(4);
}
if (execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim() !== "") {
  consoleError("REFUSAL: checkout is dirty");
  process.exit(5);
}

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const kernelSource = readFileSync(join(repo, "domain-packages", "kernel", "basic", "kernel-mechanism-v1.mjs"), "utf8");
const sdkSource = readFileSync(join(repo, "domain-packages", "standard", "basic", "standard-sdk-v1.mjs"), "utf8");
const routerSource = readFileSync(join(repo, "domain-packages", "standard", "basic", "workflow-router.mjs"), "utf8");
const businessSource = readFileSync(join(srcDir, "modules", "business-download.mjs"), "utf8");
const capabilitySource = readFileSync(join(srcDir, "modules", "capability-acquisition.mjs"), "utf8");

// BUILD-style vendored Standard bundle: SDK bytes + the pure WorkflowRouter
// (the same v0.9/v0.10 bridge strategy as the upstream clean-consumer example).
const routerBody = routerSource.replace(/^export /gm, "");
const standardSource = `${sdkSource}
// xDownload #183 PoC BUILD: the pure Standard WorkflowRouter vendored into the
// selected Standard Primary bytes.
const __dhv10RouterBundle = (() => {
${routerBody}
return { routeWorkflowIntent };
})();
export const routeWorkflowIntent = __dhv10RouterBundle.routeWorkflowIntent;
`;

const modules = [
  {
    packageId: "v08-kernel-mechanism@v0.10.0",
    role: "kernel-primary",
    abiVersion: "v08-kernel-abi/1",
    moduleSource: kernelSource,
    moduleSha256: sha256Hex(kernelSource),
    endpoint: "occurrence-runtime",
    provides: ["kernel:occurrence-runtime/1"],
    dependencies: [],
    requires: [],
  },
  {
    packageId: "standard-sdk@v08.1.0.0",
    role: "standard-primary",
    abiVersion: "v08-standard-sdk-abi/1",
    moduleSource: standardSource,
    moduleSha256: sha256Hex(standardSource),
    endpoint: "rule-interpreter",
    provides: ["standard:interpret/1", "standard:route/1"],
    dependencies: [],
    requires: [],
  },
  {
    packageId: "business-download@0.1.0",
    role: "business",
    abiVersion: "v08-business-abi/1",
    moduleSource: businessSource,
    moduleSha256: sha256Hex(businessSource),
    endpoint: "business-policy",
    provides: ["business:policy/1", "intent:confirmDownload"],
    dependencies: [],
    requires: [],
  },
  {
    packageId: "capability-acquisition@0.1.0",
    role: "capability",
    abiVersion: "v08-capability-abi/1",
    moduleSource: capabilitySource,
    moduleSha256: sha256Hex(capabilitySource),
    endpoint: "capability-endpoint",
    provides: ["capability:acquisition/1"],
    capabilityId: "acquisition",
    handlers: [{ operationId: "acquire", handler: "acquireFile" }],
    externalEffect: true,
    dependencies: [],
    requires: [],
  },
];

const routes = [
  {
    intentId: "confirmDownload",
    operationId: "acquire",
    capabilityId: "acquisition",
    handlerId: "acquireFile",
  },
];

const built = buildV10App({
  appId: "app:xdownload-download-poc",
  audience: "aud:xdownload-i183-research",
  targetProfile: V10_TARGET_PROFILE,
  modules,
  routes,
  hardBudget: { maxStepsPerTurn: 16, maxWorkUnitsPerTurn: 64 },
  buildId: "xdownload-i183-poc-v1",
});

const closureDigest = v10BuildPackageClosureDigest(built);
const outDir = join(here, "..", "build");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "app.build.json"), `${JSON.stringify(built, null, 2)}\n`);

const manifest = {
  schema: "xdownload.poc.build-manifest/1",
  app: built.appId,
  buildId: built.buildId,
  sdkSource: {
    repository: "kaicreator-mm/domain-harness",
    tag: "v0.10.3",
    commit: SDK_COMMIT,
    tree: SDK_TREE,
  },
  targetProfile: V10_TARGET_PROFILE,
  subjectDigest: built.subjectDigest,
  packageClosureDigest: closureDigest,
  loadOrder: [...built.loadOrder],
  sourceSha: SDK_COMMIT,
  buildInputSha256: createHash("sha256")
    .update(
      JSON.stringify({
        appId: built.appId,
        buildId: built.buildId,
        modules: modules.map((m) => ({ packageId: m.packageId, moduleSha256: m.moduleSha256, provides: m.provides, externalEffect: m.externalEffect ?? false })),
        routes,
      }),
    )
    .digest("hex"),
  modules: built.modules.map((m) => ({
    packageId: m.packageId,
    role: m.role,
    abiVersion: m.abiVersion,
    moduleSha256: m.moduleSha256,
    bytes: Buffer.byteLength(m.moduleSource, "utf8"),
    externalEffect: m.externalEffect ?? false,
  })),
  routes: built.routes,
};
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
consoleLog(
  JSON.stringify(
    {
      ok: true,
      appId: built.appId,
      subjectDigest: built.subjectDigest,
      packageClosureDigest: closureDigest,
      modules: manifest.modules.length,
      routes: manifest.routes.length,
    },
    null,
    2,
  ),
);
