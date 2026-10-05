# T018 L3 Reference Pack — packaging and platform integration

Task: `T018` / Issue `#37`  
Bound base: `version/v0.1.0@888ce342b1d170ab4a217e0fff418cd8b0a0a712` (tree `0dcb9b9b4c0013e2e1d8ac3a410439fb9cebb900`)  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select the packaging stack, install a desktop shell by authority, or create any platform-support claim. Frozen L2 §6.9/ADR-012/U9 keep the desktop shell, IPC transport, packaging stack and OS/browser release matrix replaceable; T023 owns platform qualification on the exact T019 candidate — nothing here implies it.

## 1. Tests — highest priority references

### 1.1 Package-content audit as the first executable gate

Primary exact-base test mechanism: `vitest@4.1.11` (already pinned, discovers `packages/*/test/**/*.test.ts` and `apps/*/test/**/*.test.ts` in Node environment).

Highest-ROI executable checks, runnable without any platform host:

- walk the emitted package tree; assert every path matches the declared content rules;
- assert the exclusion set is empty: `.agent/execution/**`, `docs/**`, `packages/toolchain-smoke*/**`, `**/test/**`, dev-only configs;
- assert no file content matches credential-shaped material (provider keys, tokens, cookies) with a deterministic scanner and an allowlist for false positives — the scanner failing closed is the feature;
- assert emitted layout equals `apps/browser-extension/manifest.json` references (every manifest-referenced file exists; no unreferenced executable payload in the extension package);
- assert each artifact's identity sidecar (source revision, toolchain versions, content hash) exists and re-hashes correctly;
- production-closure check: no imported module resolves outside the declared dependency set of the artifact.

Table-driven/parameterized cases keep each rule a stable oracle identity. Keep positive and negative cases adjacent.

### 1.2 Real-host smoke as structured evidence, not unit tests

Build/package smoke, clean install/launch and native-host registration need real hosts. Record them as structured command+environment+result evidence per tuple (scripted where possible), never as faked unit assertions. A missing host/toolchain yields `NOT_EXECUTED`/`BLOCKED` entries — never PASS.

## 2. Contract / interface references

### 2.1 MV3 extension packaging (official platform documentation)

- Chrome for Developers — Manifest V3 overview and service-worker module rules: `https://developer.chrome.com/docs/extensions/develop/concepts/service-workers` (ES module service workers require the manifest `"type": "module"` — exactly what the current manifest declares).
- Native Messaging — host manifest schema, per-OS registration locations (registry on Windows, fixed paths on macOS/Linux) and `allowed_origins` semantics: `https://developer.chrome.com/docs/apps/external_native_message` (mirror: `https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging`).

Key facts the wiring must respect: the host manifest's `allowed_origins` is the platform-enforced extension allow-list (Frozen L2 invariant 14 — never bypassed or widened by packaging); registration file locations differ per OS and the extension cannot create them, so registration wiring is genuinely platform-specific and is proven only on tuples actually hosted.

### 2.2 Node/pnpm production install shapes

- pnpm CLI — `pnpm deploy` (produces a self-contained production install tree for a workspace project, pruned to production deps): `https://pnpm.io/cli/deploy` — a candidate seam for the CLI/packaged-Core tree shape; the exact mechanism remains an F2 choice.
- Node.js single executable applications (official, current-status feature): `https://nodejs.org/api/single-executable-applications.html` — a candidate CLI distribution form; requires the pinned Node 24 toolchain and honest handling of the `node:sqlite` availability bound used by `packages/persistence-ledger`.
- Node `node:sqlite` stability/availability: `https://nodejs.org/api/sqlite.html` — the packaged runtime prerequisite must satisfy it or ship a runtime that does.

License fact: Node.js is MIT-licensed; pnpm is MIT-licensed. Both are already the pinned base toolchain (node `24.21.0` engines, `pnpm@12.8.1` packageManager); T018 does not introduce them.

### 2.3 Package identity contract

Define (data, not prose) per artifact: artifact name, content version, source revision, ordered toolchain list (name@version), content hash (e.g. SHA-256 over canonical file set), and generation host tuple. This identity is what C33 requires: a changed baseline/toolchain cannot silently claim the same identity.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Build from the lockfile, record the toolchain

```text
clean checkout
→ pnpm install --frozen-lockfile (pinned pnpm/node)
→ bundle/compile TS-source workspace exports per artifact
→ emit manifest-matching layout + native-host registration manifests (selected platforms only)
→ run package-content audit (fail closed)
→ emit package identities + support/NOT_PROVEN matrix
```

Every package/app on this base exports raw TS (`./src/index.ts`) with `noEmit` typechecking; the build step is genuinely new and must bundle/compile — there is nothing to "publish" as-is.

### 3.2 Data-driven platform matrix

Encode tuples as data (id, os, browser/shell, build steps, smoke steps, status). Unselected tuples emit nothing at build time and surface only as `NOT_PROVEN`/`BLOCKED` in the matrix — this makes overclaiming structurally hard (C22/C34) and honors "platform blocker is BLOCKED, not invented PASS".

### 3.3 Content rules as allowlists

Prefer explicit per-artifact allowlists over denylists plus a small enumerated exception set. The audit compares emitted reality against the allowlist; any drift fails the build. Keep the AI component's shipped configuration truthful to its frozen optional/experimental state and caller-owned provider deadline (C19; T012 constraint carried through converged-runtime).

### 3.4 Honest degradation preserved through packaging

The packaged CLI/Desktop/extension must keep the sources' typed failure behavior: schema-incompatible or unreachable seam → typed transport error; missing native host registration → authorization unavailable, never simulated. Packaging changes deployment, never semantics.

## 4. Failure handling patterns

Fail closed at packaging boundaries.

### Missing/mismatched outputs

- a manifest-referenced file the build does not emit → build failure, not a shipped gap (the current extension manifest vs unbuilt sources is exactly this trap);
- audit violation (dev material, credential, undeclared file) → build failure with the violating path named.

### Undocumented toolchain / unavailable host

- new toolchain without exact version/license/provenance → `EXECUTION_EVIDENCE_INCOMPLETE`; do not treat the choice as accepted;
- host/toolchain unavailable → `VALIDATION_NOT_EXECUTED` / `state:blocked` with durable evidence; never PASS.

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict (e.g. packaging seems to require bypassing `allowed_origins`) → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- claim pressure for unproven tuples → `PLATFORM_CLAIM_OVERREACH`; record NOT_PROVEN/BLOCKED instead

## 5. Examples / docs mapping to T018 acceptance

| Acceptance concern | Reference pattern | Required T018 proof |
| --- | --- | --- |
| Production build/package smoke | §3.1 pipeline + per-tuple smoke scripts | real-host smoke per claimed tuple from packaged artifacts; Core reachability via seam |
| Clean install/launch | `pnpm deploy`-style pruned tree / SEA-CLI shape (§2.2) | launch with zero workspace residue; typed missing-prereq failure; CLI ⊥ Desktop lifetime |
| Native-host registration | official Native Messaging manifest/registration docs (§2.1) | registration + handshake on selected tuple(s); `allowed_origins` intact; honest degradation otherwise |
| Package-content audit | §1.1 allowlist audit, fail-closed | no `.agent/execution`, frozen docs, smoke packages, fixtures, credentials in shipped output |
| Package identities | §2.3 identity contract | durable name/version/revision/toolchain/hash per artifact |
| support/NOT_PROVEN matrix | §3.2 data-driven tuples | every tuple classified `BUILT_AND_SMOKED` / `NOT_PROVEN` / `BLOCKED(reason)`; no unqualified claims |

## 6. Dependency/version/license facts

### Already pinned on the bound base (root `package.json` / `pnpm-lock.yaml`)

| Tool | Exact version on base | License | T018 role |
| --- | ---: | --- | --- |
| Node.js (engines) | `24.21.0` | MIT | build + target runtime; satisfies `node:sqlite` |
| pnpm (packageManager) | `12.8.1` | MIT | frozen-lockfile installs; `pnpm deploy` candidate seam |
| `typescript` | `5.9.3` | Apache-2.0 | typecheck gate; emits nothing (base `noEmit`) |
| `vitest` | `4.1.11` | MIT | executable audit tests |
| `eslint` / `prettier` | `9.39.5` / `3.9.9` | MIT | gates that must stay green |

### New packaging toolchain

**None is recommended or pinned by this Reference Pack.** No bundler, desktop shell, installer, signing or updater tooling exists on the base. Under `F2_ENGINEERING_DISCRETION` the Builder selects them, records exact package/version/license/provenance, admits install-scripts explicitly (`onlyBuiltDependencies` — today only `esbuild` is admitted, lockfile-present but not a direct product dependency), and keeps every choice subordinate to Frozen Architecture. Library popularity is not an architectural decision.

## 7. Do / Don't

### Do

- build from the pinned lockfile/toolchain and record toolchain identity per artifact;
- emit exactly the manifest-referenced layout and fail closed on gaps;
- make the content audit executable and build-failing;
- keep `allowed_origins`, seam bounds and validation semantics byte-for-byte intact through packaging;
- classify every tuple in the support/NOT_PROVEN matrix, including the ones you did not build;
- keep package identity (revision/toolchain/hash) durable and verifiable.

### Don't

- don't claim OS/browser/shell support beyond actually smoked tuples;
- don't add updater/signing claims (or mechanisms enabled-but-unvalidated) — configured AND validated or silent;
- don't un-private/re-version/semantically modify consumed packages to make packaging easier;
- don't ship `.agent/execution`, frozen docs, smoke packages, fixtures or credentials;
- don't bypass the lockfile or let postinstall scripts run unadmitted;
- don't freeze the T019 release candidate or execute version-level Validation — those are T019/T020–T023.

## 8. Reuse / license risk

Platform documentation above is reference-only; do not copy its text into product source. If a packaging toolchain is introduced, consume it under its own license with exact provenance recorded in the implementation PR. Watch for bundler/shell tooling with copy-left or restrictive clauses when forming distribution artifacts — record, don't assume.

## 9. Validation boundary

This Reference Pack does not prove T018. The later Builder produces an exact candidate; T018 concern Validation must execute the smoke/install/registration/audit matrix on that exact candidate, on real Build Host(s), per `TEST_MATRIX.yaml`; Fresh Independent Review is separately required because the task is `risk:high` and `review:required`. Platform qualification and release claims remain owned by T020–T023 on the exact T019 candidate.
