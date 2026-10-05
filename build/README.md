# T018 production build/packaging layer

Production build/package integration for the v0.1.0 tuple actually selected and
exercised by this task: **CLI + Core host on Windows x64 / Node 24.21.0**, plus
the **browser-extension package** (built and audited; real-browser behavior
NOT_PROVEN) and **native-host registration wiring** (Windows adapter only).
The desktop shell remains unselected per Frozen L2 §6.9/ADR-012/U9 and the
desktop tuple is recorded NOT_PROVEN — no desktop artifact or installer claim
exists. Platform qualification is owned by T023 on the exact T019 candidate;
nothing here claims it.

## Pipeline

```text
pnpm install --frozen-lockfile        # pinned pnpm 12.8.1 / node 24.21.0
pnpm build                            # node build/package.ts
  → esbuild bundle per artifact (pinned esbuild@0.25.12, MIT)
  → extension manifest copied verbatim; native-host assets for the
    selected platform only (unselected platforms emit nothing)
  → per-artifact identity (source revision + toolchain + content hash)
  → support/NOT_PROVEN matrix copied
  → package-content audit, FAIL-CLOSED (any violation exits 1)
pnpm smoke                            # node build/smoke.ts (real-host evidence)
```

Build outputs live only in git-ignored `dist/` (and `out/` for the
reproducibility check). Nothing is committed from them.

## Artifacts

| Artifact | Output | Contents (allowlist-enforced) |
| --- | --- | --- |
| `cli` | `dist/cli/` | `xdownload-cli.js` (bundled production entry, shebang) + `bin/xdownload` / `bin/xdownload.cmd` launchers |
| `core` | `dist/core/` | `xdownload-core-host.js` — packaged Core host: `createCoreRuntime` (T015) behind the loopback seam transport (T004) |
| `extension` | `dist/extension/` | `manifest.json` (copied verbatim) + exactly the files it references; the audit fails closed on `PACKAGE_MANIFEST_MISMATCH` |
| `native-host` | `dist/native-host/` | `xdownload-broker-host.js` (stdio broker over the T010 package), `broker-config.json` (allowed_origins), manifest template, bin launchers |
| identity | `dist/identity/` | per-artifact name/contentVersion/sourceRevision/toolchain/contentHash/hostTuple |
| matrix | `dist/support-matrix.json` | the support/NOT_PROVEN matrix (copied from `build/support-matrix.json`) |

There are no installer, updater, signing or store artifacts, and none are
claimed. No npm-publishable `package.json` is emitted (the workspace stays
`private`; release identity is T019/T024 scope).

## Content rules (fail-closed audit, `build/audit.ts`)

- `dist/` contains exactly the declared top-level set; every file inside an
  artifact matches its allowlist;
- global denylist: `.agent/**`, `docs/**`, `node_modules/**`, `test/**`,
  `toolchain-smoke*/**`, `*.ts`, `*.map`, `*.md`, `.env*`, `*.pem`, `*.key` —
  development Execution Pack material and secrets can never ship;
- deterministic credential scanner (provider keys, tokens, private keys,
  credential-shaped assignments); any un-allowlisted match fails the build;
- extension package layout must equal the MV3 manifest references exactly —
  a referenced file the build does not emit fails the build
  (`PACKAGE_MANIFEST_MISMATCH`), and so does unreferenced executable payload;
- every artifact identity re-hashes correctly; every `BUILT_AND_SMOKED`
  matrix tuple cites evidence in `build/evidence/` whose `overall` is `PASS`
  — a claim without evidence fails the build (C22/C34).

The audit rules are unit-tested with positive and negative fixtures in
`build/test/` (run by the ordinary `pnpm test:unit` gate); the same audit
additionally runs over the real emitted tree on every `pnpm build`.

## Honest smoke evidence (`pnpm smoke`)

`build/smoke.ts` executes on the actual host and writes structured
command+environment+result JSON to `build/evidence/`:

- `windows-cli-core-clean-install.json` — clean temp environment (only copied
  artifacts, no workspace/node_modules/store residue): CLI help launch,
  typed USAGE error, Core-host readiness, packaged CLI → packaged Core
  `submit`/`status` through the loopback seam, non-blocking
  `needs_user_action` (exit 3), typed `TRANSPORT` failure when Core is
  unreachable (exit 5), durable Core files present.
- `windows-native-host-smoke.json` — packaged stdio broker Native-Messaging
  frame round-trip (typed rejection for an unknown ref), fail-closed refusal
  without a browser-passed origin (exit 2), and the real Windows HKCU
  registration mechanism round-trip (register → verify → unregister, machine
  left as found). The extension↔native handshake inside a real browser was
  NOT executed and stays NOT_PROVEN.
- `build-reproducibility.json` — a second full build into `out/repro`
  produced byte-identical artifacts for all four artifacts (same canonical
  content hashes); any deviation would be recorded here, not hidden.

Anything not executed on a real host is `NOT_PROVEN` in the matrix — never an
invented PASS. A platform blocker would be recorded `BLOCKED`.

## Native-host registration (Windows; selected platform only)

`build/native-host.ts` implements the Chromium Native Messaging registration
for the current user (HKCU `Software\Google\Chrome\NativeMessagingHosts\com.xdownload.broker`
→ absolute path of the filled host manifest). `allowed_origins` is validated
against the exact-origin pattern the broker itself enforces; an empty list
refuses registration (no wildcard, no widening, no fallback IPC — Frozen L2
invariant 14). Unselected platforms (Linux/macOS) emit nothing and appear only
as NOT_PROVEN rows.

The `allowed_origins` list defaults to the placeholder origin mirrored from
the consumed extension sources; an exact origin can be provided at build time
via `XDOWNLOAD_EXTENSION_ORIGINS` (comma-separated, strictly validated). The
real unpacked-extension origin is only knowable once the extension is actually
loaded in a real browser, so the shipped placeholder stays until then and the
browser tuple stays NOT_PROVEN.

## Core host usage

```text
node dist/core/xdownload-core-host.js --root <data-dir> \
  --install-id <peer-install-id> --user-id <peer-user-id> \
  [--host 127.0.0.1] [--port 0]
```

Prints one `xdownload.core-host.ready` JSON document (with the bound loopback
port) and serves the seam until SIGINT/SIGTERM. Exit codes: 0 success/clean
shutdown; 1 usage; 3 `RUNTIME_PREREQUISITE_MISSING` (no `node:sqlite`);
4 `CORE_COMPOSITION_FAILED`; 5 `TRANSPORT_REFUSED` (non-loopback bind).
The CLI (see `apps/cli` usage) connects with matching `--install-id`/
`--user-id`; per-frame authorization stays the seam server's decision.

## Toolchain provenance (FAILURE_MATRIX "build-toolchain-undocumented")

| Tool | Version | License | Provenance / role |
| --- | --- | --- | --- |
| Node.js | 24.21.0 (engines-pinned on base) | MIT | pre-existing base toolchain; build + target runtime (`node:sqlite` availability bounds the shipped runtime) |
| pnpm | 12.8.1 (`packageManager`-pinned on base) | MIT | pre-existing base toolchain; frozen-lockfile installs |
| esbuild | 0.25.12 (exact-pinned root devDependency, NEW in T018) | MIT | https://github.com/evanw/esbuild — the only new build toolchain; already the sole admitted install-script toolchain on the base (`onlyBuiltDependencies`), now also recorded per-package in `allowBuilds` |

esbuild is deliberately pinned at 0.25.x, outside vite 8.3.2's optional peer
range, so the vitest toolchain path is unchanged apart from the recorded
optional-peer link; the unit gates were re-baselined green after the add.
Bundles contain first-party workspace code and Node built-ins only — no
third-party runtime dependency ships, so no third-party license text is
required inside artifacts.
