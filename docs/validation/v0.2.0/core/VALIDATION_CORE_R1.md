# xDownload v0.2.0 — T14 Core Durability Validation Receipt R1

```
TASK=v02-T14 (validation-core, Issue #214)
VALIDATION_CORE=PASS            (core concern scope, all five acceptance legs)
CANDIDATE_HEAD=7fa721053aeb2c48ce7b1c150ef71ea94e15e09d
CANDIDATE_TREE=5b6e1faa2c4d1510c2df4078125d3af049b9f3f4
BRANCH=task/v02-t14
OPERATOR_ID=zcode:xd-v02-t14-validator-agent
ENV=Node v24.21.0 / win32 x64 10.0.26300 (Windows, Git Bash + GNU coreutils 8.32)
WRITE_SET=docs/validation/v0.2.0/core/** only (zero source changes; `git status` at validation start: clean)
```

Independent Validator evidence for the frozen Task Pack T14: "Actual Node24/Windows
source-bound K/Host, accepted file digest, fail-closed unknown/reconcile, no double
grant; test commands and real EXIT." Everything below ran on the exact candidate tree
`7fa721053aeb2c48ce7b1c150ef71ea94e15e09d` (T13 freeze head), real Node 24 on real
Windows, through the public facade `@xdownload/download-domain-app` — no mock was
substituted for any authority path, and no implementation source was touched.

## 0. Environment facts

| Fact | Value |
| --- | --- |
| node | v24.21.0 (`.nvmrc`=24.21.0, satisfied) |
| OS | win32 x64, Windows build 10.0.26300 |
| shell / tools | Git Bash; `sha256sum` (GNU coreutils) 8.32 |
| candidate | `7fa721053aeb2c48ce7b1c150ef71ea94e15e09d`, tree `5b6e1faa2c4d1510c2df4078125d3af049b9f3f4`, branch `task/v02-t14`, worktree clean at start |
| dependencies | pre-installed workspace (`node_modules` present; no install performed by the Validator, no lockfile change) |
| source access | exclusively via `@xdownload/download-domain-app` public facade (`assembleDownloadRuntime`, `submitConfirmedDownload`, `FileCasDocStore`, `LineageLedger`, `LineageLedgerError`) |

## 1. Command + EXIT matrix (all real commands, real exits)

### V1 — crash/restart durable replay over the real K composition (T11)

Command (repo root):

```
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v01-crash-restart-replay.test.ts
```

**EXIT=0** — 4 tests / 4 pass / 0 fail (log: `evidence/v01-run.log`).

Driver `v01-crash-restart-replay.test.ts` (+ cross-process probe `child-readback.mjs`),
over real temp-dir files and a real `127.0.0.1` node:http fixture on a random port:

- **P** one real K journey `intent → T01 gate → K permit → sealed direct C → pinned T04
  bridge → real socket → digest-backed file`: `status=completed`; terminal evidence
  `fileSha256` reproduces the served body; the artifact is really on disk with those bytes
  (re-read + re-hash); the dispatch ran under a live kernel-minted `permitEffectId`; the
  durable store holds exactly 1 `effect-permit:` and 1 `effect-journal:` document.
- **R1** REAL process boundary: `runtime.stop()`, then a SECOND node process re-opens the
  durable store file — raw bytes (`JSON.parse` of the file) and the public
  `FileCasDocStore` reopen path agree on the full key set and observe exactly the pre-stop
  journal rows (byte-for-byte JSON equality) and permits; child exit 0 asserted.
- **R2** reopen over the SAME store file (fresh `assembleDownloadRuntime`): journal/permit
  rows survive verbatim; an idempotent replay of the settled occurrence returns
  `status=replayed` with ZERO new effects, proven three ways (reopened bridge counters
  0/0, real socket request count unchanged, journal/permit families still exactly 1/1);
  artifact bytes unchanged, no second artifact.
- **R3** direct public `FileCasDocStore` reopen over the same file sees the same durable state.

### V2 — truthful UNKNOWN/reconcile (T09) + honest abort (T11)

Command:

```
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v02-unknown-reconcile-abort.test.ts
```

**EXIT=0** — 5 tests / 5 pass / 0 fail (log: `evidence/v02-run.log`).

- **U1** T09 UNKNOWN book is APPEND-ONLY: two `recordUnknownEffect` appends survive a
  fresh `LineageLedger.open` over the same durable file with `resolution=null`,
  `resolvedAt=null` unchanged (no auto-clear, no auto-replay); the owning claim also
  survives.
- **U2** the ONLY pending→resolved transition is explicit `resolveUnknownEffect` with a
  NEW authorization grant: the record is stamped (`resolution`, `resolvedAt`,
  `resolvedWithAuthorization`) and KEPT (`includeResolved` still 2); empty grant refused
  typed `LINEAGE_AUTHORIZATION_REQUIRED`; second resolve refused
  `UNKNOWN_ALREADY_RESOLVED`; unknown id refused `UNKNOWN_NOT_FOUND`.
- **U3** the resolution survives another reopen; the book never shrank; history is
  append-only: 2× `unknown-recorded` + 1× `unknown-resolved`.
- **A1** T11 mid-flight caller abort (real stalled socket, abort on first observed byte
  range): truthful non-completion — `status=failed`, `aborted=true`,
  `error.code=USER_CANCELLED`, terminal `phase=terminal` with `outcome.ok=false`; no
  artifact on disk; `filesWritten=0`; exactly one bridge attempt (`acquireCalls=1`) and
  one real socket request (no auto-retry); no journal row claims success.
- **A2** a NEW authorized submission under a fresh identity completes with its own
  artifact — the caller's explicit decision; the aborted occurrence was never
  auto-redownloaded (exactly 2 socket requests total).

### V3 — sealed integrity (T03 payloads / T13 vendor SDK / tamper rejection)

| Command (location) | EXIT | Result |
| --- | --- | --- |
| `sha256sum -c packages/download-domain-app/vendor/sdk/SHA256SUMS.txt` (repo root) | **0** | 4/4 vendored SDK tarballs `OK` (`evidence/v03-vendor-shasums.log`) |
| `sha256sum -c SHA256SUMS` (in `packages/download-domain-app/src/business/payloads`) | **0** | 3/3 sealed payload files `OK` (`evidence/v03-payloads-shasums.log`) |
| `node --experimental-transform-types --test --test-name-pattern "refuses altered sealed module bytes" packages/download-domain-app/src/business/composition.test.ts` | **0** | tamper rejection re-run: `verifySealedModules` throws `SEALED_BUILD_MODULE_ALTERED` on altered bytes; clean build verifies (`evidence/v03-tamper-reject.log`) |
| `node --experimental-transform-types --test --test-name-pattern "on-disk payload files still hash" packages/download-domain-app/src/business/composition.test.ts` | **0** | on-disk payload hashes equal the committed SHA256SUMS lines (`evidence/v03-payload-test.log`) |

### V4 — no double grant (T11 exactly-one permit/journal + T09 dual-writer refusal)

Command:

```
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v04-no-double-grant.test.ts
```

**EXIT=0** — 3 tests / 3 pass / 0 fail (log: `evidence/v04-run.log`).

- **G1a** one occurrence mints exactly ONE durable `effect-permit:` document (keyed by the
  minted `permitEffectId`) and ONE `effect-journal:` row; an idempotent replay of the same
  messageId adds NONE (permit/journal keys unchanged, bridge `acquireCalls` stays 1, real
  socket stays 1 request).
- **G1b** a SECOND, separately authorized occurrence mints its OWN permit and journal row
  (2 distinct permits, 2 rows, 2 dispatches, 2 requests): grants are per-occurrence —
  never shared, never reused, never collapsed.
- **G2** T09 one writer per lineage: a second writer identity is refused typed
  `WRITER_IDENTITY_CONFLICT` (the U02/N06 PoC code); a foreign release is refused the same
  way; ownership survives a reopen (`state=owned`, same writer); a legacy writer cannot
  claim a fresh lineage and a new-K-owned lineage cannot be re-registered as legacy
  (`LINEAGE_PARTITION_VIOLATION` both ways); the new K cannot claim a recorded v0.1
  lineage (default partition, no migration).

### V5 — full lane test suites re-run at the candidate head

| Lane | Command | EXIT | Summary |
| --- | --- | --- | --- |
| download-domain-app (13 `*.test.ts`, T01/T03/T05/T09/T11/T12) | `node --experimental-transform-types --test $(find packages/download-domain-app/src -name "*.test.ts" \| sort)` | **0** | 121 tests / 121 pass / 0 fail (`evidence/v05-lane-domain-app.log`) |
| download-domain-host (2 `*.test.ts`, T04/media) | `node --experimental-transform-types --test $(find packages/download-domain-host/src -name "*.test.ts" \| sort)` | **0** | 20 tests / 20 pass / 0 fail (`evidence/v05-lane-domain-host.log`) |
| T10 harness (tests/domain-app) | `node tests/domain-app/run.mjs` | **0** (`HARNESS_EXIT=0`) | 37 tests / 37 pass / 0 fail (`evidence/v05-lane-t10-harness.log`) |
| vitest unit lane (packages/*/test + apps/*/test + build/test) | `./node_modules/.bin/vitest run` | **1** | 191 files: 190 passed, 1 failed; tests: 2042 passed, 1 failed, 1 skipped, 3 todo (`evidence/v05-lane-vitest-unit.log`) |
| — failing file isolated | `./node_modules/.bin/vitest run apps/cli/test/headless-authority.test.ts` | **1** | deterministic: 1 failed / 4 passed (`evidence/v05-cli-headless-isolated.log`) |

**V5 is NOT all-green and is not recorded as PASS.** The one failure is:

```
FAIL apps/cli/test/headless-authority.test.ts > headless operation >
  CLI source imports only Node built-ins and the seam/contract packages
AssertionError: forbidden import '@xdownload/download-domain-app/src/contracts/index.ts'
  in domain-app-commands.ts: expected false to be true
```

Attribution (the Validator's findings, from git history, not from any builder's claim):

- Deterministic static import-allowlist scan — reproduced in isolation (EXIT=1); not a
  load flake.
- Pre-existing at the exact candidate: `apps/cli/src/domain-app-commands.ts:29` imports
  the deep specifier and `apps/cli/test/headless-authority.test.ts:26` allowlists only
  `node:` / `@xdownload/core-seam` / `@xdownload/domain-contracts`; `git show f795e9e`
  (v0.2 T07 merge) proves both files already carried this exact conflict at T07
  integration — it is not introduced by T13 or by this validation.
- It is a CLI-lane (T07) surface-consistency defect, OUTSIDE the T14 core concern scope:
  every behavior test in that file passes (5/5 on behavior; only the import-prefix scan
  fails), and no core lane is affected.

**Carried finding for T18 (candidate freeze reconciliation):** the `version/v0.2.0`
candidate carries one deterministic, pre-existing, non-core test failure in the
apps/cli authority-allowlist scan. T18 must either admit it with an explicit owner
decision or require a CLI-lane fix; this Validator did not modify any source to mask it.

### V6 — physical SQLite CAS leg probe (honest NOT_PROVEN record)

Command: `node docs/validation/v0.2.0/core/drivers/sqlite-leg-probe.mjs` — **EXIT=0**
(observed-as-expected; log `evidence/v06-sqlite-leg-probe.log`):

```
better-sqlite3 resolve: NOT resolvable (MODULE_NOT_FOUND)
openSqliteCasStore fail-closed: code=HOST_STORE_DRIVER_UNAVAILABLE
OBSERVED_AS_EXPECTED: the physical SQLite CAS leg is unavailable and fails closed
```

## 2. Item verdicts (per frozen acceptance leg)

| # | Acceptance leg | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Actual Node24/Windows source-bound K/Host | **PASS** | V1 drivers: real journey over the sealed BUILD loaded via the SDK public `load`, pinned T04 bridge, real socket, Node v24.21.0 / win32; EXIT=0 |
| 2 | Accepted file digest | **PASS** | V1 P: terminal `fileSha256`/`bytesWritten` reproduce the served body and the artifact re-read from disk reproduces both; V3 payload/vendor `sha256sum -c` EXIT=0; lane N4 digest-anchor refusal re-verified in V5 (121/121 domain-app) |
| 3 | Fail-closed unknown/reconcile | **PASS** | V2 U1–U3: append-only book survives reopen with zero auto-clear/replay; explicit typed resolution only, exactly once, new-grant-required; unresolved record stays honestly pending; A1: abort settles truthfully non-completed, no success laundering |
| 4 | No double grant | **PASS** | V4 G1a/G1b/G2: exactly one permit/journal per occurrence, replay adds none, second occurrence gets its own grant; T09 dual-writer refused typed `WRITER_IDENTITY_CONFLICT`, ownership survives reopen, generation partition holds both directions |
| 5 | Test commands and real EXIT | **PASS with one recorded non-core FAIL** | V5 matrix: all four core lanes EXIT=0 (121+20+37 tests) and all T14 drivers EXIT=0; the vitest unit lane carries ONE deterministic pre-existing apps/cli import-allowlist failure (EXIT=1) — recorded, attributed, and carried to T18, not washed |

**VALIDATION_CORE=PASS** — every acceptance leg of the T14 core concern is proven on the
exact candidate with real commands and real exits.

## 3. NOT_PROVEN / carried forward (honest boundaries)

- **SQLite cross-process CAS leg: NOT_PROVEN.** `better-sqlite3` (^12) is not installed
  anywhere in this workspace (lockfile lists it only as the SDK's optional peer); the SDK
  `openSqliteCasStore` fails CLOSED typed (`HOST_STORE_DRIVER_UNAVAILABLE`) — probe
  evidence in V6. The durable legs proven above (V1/V2/V4) run on the atomic plain-file
  CAS (`FileCasDocStore` / `PlainFileLineageStore`: whole-document temp+rename,
  revision-checked), which is **single-process-safe by construction**. Cross-process
  CONCURRENT writers are not claimed by that store; the V1 "second process" leg proves
  cross-process READ-BACK of durable bytes after a real stop, not multi-writer locking.
  This is exactly the boundary the T09/T13 decision files record; no validation result
  here upgrades it.
- **T09 dual-writer enforcement is ledger-semantics authority** (typed refusals on one
  durable document), not file-locking; within its documented single-process durability
  boundary it is fully proven (V4 G2).
- **V5 CLI-lane finding** (Section "V5"): one deterministic pre-existing failure, outside
  core scope, carried to T18 with the attribution above.

## 4. Validator independence and write-set statement

- The Validator is a separate agent context from every implementation builder; the
  verdicts above are based solely on commands executed on the candidate tree in this
  worktree, with logs retained under `docs/validation/v0.2.0/core/evidence/`.
- Write set: `docs/validation/v0.2.0/core/**` only (this receipt, the archived drivers in
  `drivers/`, and the raw logs in `evidence/`). No implementation source, manifest,
  lockfile, or test file was modified (`git status` clean before runs; diff contains only
  this directory).

## 5. Archived driver manifest (sha256)

```
652dc9327f7219074c04116c66566baf2f7581e18e296201e6ced8dffab4932c  drivers/child-readback.mjs
9b2b9e8618efb855749bc2fdbbe0ab6f4ca6f8e7a2fbe21fc153bf306e4f4b48  drivers/sqlite-leg-probe.mjs
1a1597fcfafb4bcb208b938c6506f6ea488ee153cf4894c799794ecdf925e8b2  drivers/v01-crash-restart-replay.test.ts
cdbcf3d8e851548de42ccb6bd75bf8e5a520e7ca4ad4f5603184e1ff357a4cb8  drivers/v02-unknown-reconcile-abort.test.ts
c6e1dcba05880b083d3c2c0f120e6e6a9c5c009db4e88746870ee28b5b995cef  drivers/v04-no-double-grant.test.ts
```

Reproduce: from the repo root at `7fa721053aeb2c48ce7b1c150ef71ea94e15e09d` with
Node 24 and the workspace installed —

```
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v01-crash-restart-replay.test.ts
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v02-unknown-reconcile-abort.test.ts
node --experimental-transform-types --test docs/validation/v0.2.0/core/drivers/v04-no-double-grant.test.ts
sha256sum -c packages/download-domain-app/vendor/sdk/SHA256SUMS.txt
(cd packages/download-domain-app/src/business/payloads && sha256sum -c SHA256SUMS)
node docs/validation/v0.2.0/core/drivers/sqlite-leg-probe.mjs
```
