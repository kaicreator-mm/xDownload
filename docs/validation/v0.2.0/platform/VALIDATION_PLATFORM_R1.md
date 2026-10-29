# VALIDATION_PLATFORM_R1 — v0.2.0 freeze T17 (validation-platform, Issue #217)

- Validator: `zcode:xd-v02-t17-validator-agent` (independent Validator, v0.2.0 freeze)
- Worktree: `xd-v02-t17-validator`, branch `task/v02-t17`, HEAD at validation time
  `7fa7210` (`build(v02-T13): final manifests, exports facade, packaging
  normalization ledger (#213)`) — the exact candidate commit.
- Date: 2026-10-29
- Scope: pack acceptance — clean packed v0.10.3 public SDK consumer over actual
  package bytes/hash, Node 24 + claimed platform physical package smoke,
  reproducible exact-candidate evidence. Write set: this directory only.
- Cross-referenced independent evidence: #183 SDK pack receipts
  (`xd-i183-builder/experiments/domain-app-download/evidence/e01-sdk-pack/`,
  `PACK_EVIDENCE.md` + `sha256.json`), T13 packaging ledger
  (`packages/download-domain-app/README.md` at the candidate commit).

## Verdict: PASS

All pack-acceptance checks pass on real commands with real exit codes. The
known artifact-class boundaries (raw `node` refuses TS under `node_modules`;
bundle-tier runtime-relative reads require staging the installed bytes) were
reproduced and are recorded as boundaries, not failures — consistent with the
T13 honest tiering and with the acceptance definition of this task.

---

## 1. SDK byte identity (vendored v0.10.3 candidate vs #183 receipts) — PASS

Candidate bytes: `packages/download-domain-app/vendor/sdk/*.tgz` at `7fa7210`.

```
$ cd packages/download-domain-app/vendor/sdk && sha256sum *.tgz
c04c5ee24f20e420e73da9bb7a8d43d1d44248bdfa45990b2cd2f3101adca5b5  kaicreator-domain-harness-build-0.10.2-rc.0.tgz       EXIT=0
859c55e1a3da61c551cb97c245f4ad02bca680710e8ff045e43fcbd33d052238  kaicreator-domain-harness-contracts-0.10.2-rc.0.tgz
3a0a11391936b8cfcdb4dc81136576ad5dd3f30e278168ae485f10abb275c4b8  kaicreator-domain-harness-host-node-0.10.2-rc.0.tgz
cd716f08f48e8e2715cad71e07294339c4e1682ccb312838cb8f10036ede59d6  kaicreator-domain-harness-microkernel-0.10.2-rc.0.tgz
```

Hash matrix vs `e01-sdk-pack/sha256.json` (#183 independent evidence):

| tarball | candidate sha256 | #183 receipt sha256 | match |
| --- | --- | --- | --- |
| domain-harness-build-0.10.2-rc.0.tgz | `c04c5ee24f20…adca5b5` | `c04c5ee24f20…adca5b5` | YES |
| domain-harness-contracts-0.10.2-rc.0.tgz | `859c55e1a3da…d052238` | `859c55e1a3da…d052238` | YES |
| domain-harness-host-node-0.10.2-rc.0.tgz | `3a0a11391936…b275c4b8` | `3a0a11391936…b275c4b8` | YES |
| domain-harness-microkernel-0.10.2-rc.0.tgz | `cd716f08f48e…6ede59d6` | `cd716f08f48e…6ede59d6` | YES |

4/4 byte-identical. In-repo checksum manifests:

```
$ sha256sum -c packages/download-domain-app/vendor/sdk/SHA256SUMS.txt   (repo root)
  4 lines OK                                                            EXIT=0
$ cd packages/download-domain-app/src/business/payloads && sha256sum -c SHA256SUMS
  3 lines OK (dist/kernel-mechanism-v1.mjs, dist/standard-sdk-v1.mjs,
  dist/workflow-router.mjs)                                             EXIT=0
```

Cwd note recorded honestly: the payloads `SHA256SUMS` entries are `dist/…`
relative, so the check only passes from the `payloads` directory itself; run
from the package root it fails open/read (EXIT=1). This is a path-sensitivity
of the manifest, not a byte mismatch — the payload files exist and verify.

Sealed-payload identity inside the packed artifact is proven end-to-end by the
smoke below: the installed `kernel-mechanism-v1.mjs` hashes to
`e1ed59556f8b447b5f559302a893738eeae1d272e3a30ac4545fedfb1da8a3e7` — exactly
`POC183_KERNEL_MODULE_SHA256` — and `buildDownloadDomainApp()` over the
installed bytes re-seals the composed standard primary to
`93aad26d2c3118548e2be3eefc0bcb9012e20bd6381077b58fbd1d2f59ce4606` = the #183
PoC manifest value (`buildDownloadDomainApp` throws
`DOWNLOAD_PAYLOAD_SEAL_MISMATCH` on any drift, so PASS here is seal-enforced,
not assert-enforced).

## 2. Packed app tarball + clean consumer install — PASS

Pack (T13 recipe, candidate worktree; artifact written OUTSIDE the repo):

```
$ cd packages/download-domain-app && pnpm pack --pack-destination <tmp>/consumer
package: @xdownload/download-domain-app@0.2.0-alpha.0                   EXIT=0
  49 entries: package.json + README.md + 47 src/** files
  sealed payloads + payloads/SHA256SUMS included; no vendor/, no node_modules
$ sha256sum xdownload-download-domain-app-0.2.0-alpha.0.tgz
8c6c631992a81687db61b9a7de65482cd50376600667caae02a5849d8a5bf58e        EXIT=0
```

Consumer: fresh directory outside the workspace
(`_tmp/xd-v02-t17-validator/consumer`), `packageManager: "pnpm@12.8.1"`
mirroring the workspace pin, direct deps:

- `@xdownload/download-domain-app`: `file:./xdownload-download-domain-app-0.2.0-alpha.0.tgz`
  (the packed bytes above)
- `@xdownload/download-domain-host`: `file:…/xd-v02-t17-validator/packages/download-domain-host`
  (declared because the smoke asserts the host faces; workspace-protocol by
  design — see T13 tiering)

`pnpm-workspace.yaml` override mirror (see section 5 and the pnpm 12 findings
for why the overrides live here, not in package.json): the four
`@kaicreator/domain-harness-*` pins point at the SAME vendored `vendor/sdk`
tarball bytes whose hashes are proven in section 1 (consumer-relative `file:`
paths), plus `file:` directory mirrors for `@xdownload/domain-contracts`,
`@xdownload/direct-acquisition`, `@xdownload/hls-vod-adapter`, and an app
override to the same packed tarball.

```
$ pnpm install
Packages: +9 … added 9, done in 102ms using pnpm v12.8.1               EXIT=0
$ pnpm install   (after declaring the host face as a direct dep)
added, done in 99ms using pnpm v12.8.1                                 EXIT=0
```

Exactly-once resolution — final `node_modules/.pnpm/` has exactly 9 package
entries, one package root per dependency, no duplicates:

```
@kaicreator+domain-harness-_1c47…  => contracts (manifest-verified)
@kaicreator+domain-harness-_4b7e…  => host-node
@kaicreator+domain-harness-_5690…  => build
@kaicreator+domain-harness-_fcd9…  => microkernel
@xdownload+direct-acquisiti_990e…  => direct-acquisition
@xdownload+domain-contracts_d7ae…  => domain-contracts
@xdownload+download-domain-_3256…  => download-domain-host@0.2.0-alpha.0
@xdownload+download-domain-_d42b…  => download-domain-app@0.2.0-alpha.0 (packed tarball)
@xdownload+hls-vod-adapter@_15fd…  => hls-vod-adapter
```

Integrity cross-check — consumer lockfile vs workspace lockfile, the 4 SDK
`sha512` integrity values are identical 4/4:

| package | consumer lock sha512 (prefix) | workspace lock sha512 (prefix) | match |
| --- | --- | --- | --- |
| build | `vjagd3Xfkoi4Mk4NHN7H…` | `vjagd3Xfkoi4Mk4NHN7H…` | YES |
| contracts | `wkBra2fFpFVXuL8O7sOg…` | `wkBra2fFpFVXuL8O7sOg…` | YES |
| host-node | `kF/dUpva+vnFN7prFAbR…` | `kF/dUpva+vnFN7prFAbR…` | YES |
| microkernel | `aoom6vzW7Bscp0j0gUtx…` | `aoom6vzW7Bscp0j0gUtx…` | YES |

## 3. Export-surface smoke over the installed bytes — PASS (12/12)

### 3a. Raw-`node` boundary (known boundary, recorded — NOT a FAIL)

```
$ node --input-type=module -e "await import('@xdownload/download-domain-app')"
code: 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'                     EXIT=1
```

Node 24 refuses type-stripping under `node_modules` — the structural
artifact-class boundary recorded in the T13 ledger. Not a resolution failure:
the exports map resolved `.` to `src/index.ts` first, then Node refused. The
bundler tier is the proven consumption path (below), exactly as T13 concluded.

### 3b. esbuild bundle route (esbuild 0.25.12 — the repo's own TS consumption mechanism)

```
$ node <candidate>/node_modules/esbuild/bin/esbuild smoke-src.mjs \
    --bundle --platform=node --format=esm --outfile=smoke.bundle.mjs
smoke.bundle.mjs  664.6kb                                               EXIT=0 (BUNDLE)
```

Bundling resolves the installed tree strictly through the exports maps — the
app facade (`.`), all three host subpaths (`./direct`, `./media`,
`./media/permit`), and the app package's internal sibling-relative host
imports (they resolve inside the consumer's `.pnpm` mirror geometry, where the
host entry nests beside the app entry).

Runtime-relative reads require staging the installed bytes beside the bundle
(same relocation class T13 recorded for `readSealedText`; also applies to the
SDK build package's `resolveEmittedAcornPath`, candidates
`<bundleDir>/generated/acorn.js` or `<bundleDir>/../dist/generated/acorn.js`).
Staged verbatim FROM THE INSTALLED TREE:

| file | sha256 |
| --- | --- |
| payloads/dist/kernel-mechanism-v1.mjs | `e1ed59556f8b447b5f559302a893738eeae1d272e3a30ac4545fedfb1da8a3e7` (= `POC183_KERNEL_MODULE_SHA256`) |
| payloads/dist/standard-sdk-v1.mjs | `dec042cacee70a8762b693f02b80ce14844b52bdf12969ff2250c7013c67c8bf` |
| payloads/dist/workflow-router.mjs | `d9f9c33f08951aacebe1648fb44554ecacb70db6292f02367035d99ea1c112b5` |
| business-download.mjs | `4c609dc1024dde4be04983b934b0736da53c3e5e2b49235aa43dad82890d2f37` |
| capability-acquisition-stub.mjs | `37f5cd6bb1516cbec7bbeed1dbcc6b18546f474649b855e28539036a6bee6eb4` |
| generated/acorn.js (SDK build pkg `dist/generated/`) | `fcc0f872458c16ec224c202de4bdf49c01be03f707394e3897176084bf4a5373` |

```
$ node smoke.bundle.mjs
PASS facade APP_ID/BUILD_ID/AUDIENCE identity
PASS #183 seal constants present
PASS facade export surface presence
PASS buildDownloadDomainApp over installed bytes: 4 modules
PASS verifySealedModules passes over installed bytes
PASS sealed K/S module hashes equal #183 PoC manifest
PASS confirmDownloadRequest seals a valid intent
PASS admission refuses scope widening (unknown field)
PASS admission refuses raw-locator targetRef
PASS host ./direct exports DirectAcquisitionBridge
PASS host ./media exports acquireMediaViaHls (HLS-only)
PASS host ./media/permit exports validateMediaAcquisitionPermit
SMOKE PASS 12/12                                                        EXIT=0
```

The REAL sealed composition runs over the installed bytes: `appId`
`app:xdownload-download-domain-t03`, `buildId` `xdownload-v02-t03-v1`, 4
modules, byte-seal self-check (`verifySealedModules`) and #183 manifest pins
all enforced by the installed code itself.

Smoke-script self-correction recorded honestly: the first bundle run scored
10/12 with two script-side bugs (the script expected `routeWorkflowIntent` on
the facade, which the T13 facade deliberately does not re-export — the facade
"adds nothing"; and it passed the `{built, routes}` wrapper instead of the
inner `built` app to `verifySealedModules`). Both were smoke-script defects,
fixed in the script; no product byte or config changed between the runs.

## 4. Platform facts (claimed platform = Windows; declaration scope = workspace package level)

```
$ node -v      → v24.21.0
$ pnpm -v      → 12.8.1   (packageManager pin of the candidate workspace; the
                            unpinned host fallback observed was 10.34.5)
$ cmd /c ver   → Microsoft Windows [Version 10.0.26300.9711]
$ systeminfo   → Microsoft Windows 11 Pro, 10.0.26300 Build 26300, x64 PC
$ uname -srm   → MINGW64_NT-10.0-26300 3.6.10.x86_64 (Git Bash)
```

Scope statement: the v0.2.0 candidate has NO terminal/desktop installable
artifacts (T13 boundary fact), so the Windows platform claim is exercised at
the level the candidate actually declares — workspace package level. The
declarations verified on this platform: app/host `engines.node >= 24` (satisfied
by v24.21.0), SDK tarballs `engines.node >= 24.0.0`; exports maps
(`.`, `./src/contracts/index.ts`, `./direct`, `./media`, `./media/permit`)
resolve and consume on Windows paths. `@kaicreator/domain-harness-host-node`
declares an OPTIONAL peer `better-sqlite3` — not installed (consistent with
the T13 DECIDED-no SQLite driver disposition); the consumer tree required
ZERO install scripts (no native builds).

Runtime findings recorded for the freeze (platform/toolchain facts, discovered
by this validation):

1. **pnpm@12 no longer reads `package.json` `pnpm.overrides`** (warning: "The
   'pnpm' field in package.json is no longer read"). Overrides MUST live in
   `pnpm-workspace.yaml` — the candidate workspace already uses the correct
   form. Negative probe live-recorded: with the overrides ignored, resolution
   fell through to the npm registry and failed
   `ERR_PNPM_FETCH_404 @xdownload/domain-contracts` (EXIT=1) — a direct
   demonstration that no registry fallback exists for these private packages.
2. **`dir:` overrides are not resolvable** under pnpm 12.8.1
   (`ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`, EXIT=1); `file:` directory
   paths work and record `{type: directory}` in the lockfile. Consumer mirror
   accordingly uses `file:` everywhere.

## 5. No-registry fallback recheck — PASS

```
$ grep -nE "@kaicreator/" <consumer>/pnpm-lock.yaml | grep -v "file:"
  (no output)                                                           EXIT=1  (zero matches)
$ grep -cE "resolution:.*(https?://|registry)" <consumer>/pnpm-lock.yaml
  0                                                                     (zero registry-typed resolutions)
$ grep -nE "@kaicreator/domain-harness-[a-z]+@" pnpm-lock.yaml \
    | grep -vE "file:packages/download-domain-app/vendor/sdk/"
  (no output)                                                           EXIT=1  (zero matches, workspace lock)
```

Every `@kaicreator/*` resolution in BOTH lockfiles is a `file:` vendored
tarball; every `@xdownload/*` resolution is `file:` (tarball or directory).
No registry URL resolves any package of the frozen graph. The 404 negative
probe (section 4, finding 1) confirms the failure mode is fail-closed, not
silent fallback.

## Honest tiering

- PROVEN: 4/4 vendored SDK tarballs byte-identical to the #183 receipts;
  in-repo SHA256SUMS clean for SDK (4/4) and payloads (3/3); app packs per the
  T13 recipe (49 entries, sealed payloads included, no vendor/node_modules);
  clean consumer installs under the pinned pnpm 12.8.1 with exactly one
  `.pnpm` package root per dependency and lockfile integrities equal to the
  workspace lock (4/4); export surface (facade + 3 host subpaths) bundles and
  executes over the installed bytes; the real sealed #183 composition
  re-seals and self-verifies from the consumer; no-registry resolution holds
  in both lockfiles and fails closed when attempted.
- KNOWN BOUNDARIES (recorded, not FAIL; same class as the T13 ledger):
  raw-`node` execution of the packed raw-TS artifacts (Node 24
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); bundling relocates
  runtime-relative reads, so the bundle tier stages the installed sealed
  bytes + SDK `generated/acorn.js` beside the bundle; out-of-workspace
  consumption of the host package requires an override mirror
  (workspace-protocol by design).
- NOT_PROVEN (unchanged from T13, outside this task's scope): production
  SQLite-backed stores (DECIDED-no for v0.2.0); terminal/desktop installable
  artifacts (do not exist in this candidate).

Consumer artifacts (tarball, lockfile, smoke sources, staged bytes) live in
`_tmp/xd-v02-t17-validator/consumer` outside the repository; this document is
the only committed artifact of T17.
