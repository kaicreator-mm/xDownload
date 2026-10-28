// Reproducible SDK pack for the #183 PoC (E01).
//
// Packs the three selected public DomainHarness SDK packages from an exact
// v0.10.3 Git-source checkout into vendor/ and records SHA256. Run once per
// machine before `npm install ./vendor/*.tgz` inside this directory.
//
// Usage:
//   node scripts/pack-sdk.mjs <path-to-domain-harness-checkout-at-tag>
//
// The checkout must satisfy ALL of:
//   - HEAD == 061376f4a023070f215f9feffad5c24d96d503cb (tag v0.10.3)
//   - `git status --porcelain` empty (packed bytes == tagged tree bytes)
// The script refuses to pack otherwise; there is no registry fallback.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { error as consoleError, log as consoleLog } from "node:console";
import process from "node:process";

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const SDK_COMMIT = "061376f4a023070f215f9feffad5c24d96d503cb";
// name → repo-relative package dir (the build producer lives under tooling/).
const PACKAGES = [
  ["contracts", "packages/contracts"],
  ["microkernel", "packages/microkernel"],
  ["host-node", "packages/host-node"],
  ["build", "tooling/build"],
];

const checkout = process.argv[2];
if (!checkout) {
  consoleError("usage: node scripts/pack-sdk.mjs <domain-harness-checkout>");
  process.exit(2);
}
const repo = resolve(checkout);

const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== SDK_COMMIT) {
  consoleError(`REFUSAL: checkout HEAD ${head} != pinned tag commit ${SDK_COMMIT}`);
  process.exit(3);
}
const status = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" });
if (status.trim().length > 0) {
  consoleError("REFUSAL: checkout is dirty; packed bytes would not be the tagged tree");
  process.exit(4);
}

const outDir = resolve("evidence", "e01-sdk-pack");
mkdirSync(outDir, { recursive: true });

const hashes = {};
for (const [pkg, dir] of PACKAGES) {
  const pkgDir = join(repo, dir);
  execFileSync(npmBin, ["pack", "--pack-destination", outDir], {
    cwd: pkgDir,
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".tgz")) {
    const buf = await import("node:fs").then((m) => m.readFileSync(join(outDir, f)));
    hashes[f] = createHash("sha256").update(buf).digest("hex");
  }
}
writeFileSync(join(outDir, "sha256.json"), JSON.stringify(hashes, null, 2) + "\n");
consoleLog("packed:", JSON.stringify(hashes, null, 2));
