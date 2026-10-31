# xDownload v0.2.1 — Agent integration contract (English)

> **Candidate documentation, NOT a release qualification.** Bound to version/v0.2.1 baseline 56f9e16d8d7afb29b2a493c07bdf4f886a0bf445. Chinese user guide: [README.zh-CN.md](../user/README.zh-CN.md). Any final candidate SHA must be re-tested rather than borrowing a previous PASS.

## Project authority and execution boundaries

- ADS v4.18 GitHub is the task/review truth source. The frozen v0.2.1 DAG has **22 tasks and 63 native dependencies**; source writers need a fresh accepted **single-writer JIT Claim** and exact Task Pack write set. Do not modify frozen Product/L2/DAG, silently mark tasks complete, substitute builder self-review for independent approval, or merge main before release qualification.
- **One Core process owns exactly one DomainHarness K composition** and the authoritative lineage. CLI, browser extension and Electron UI remain thin clients; a standalone S4 fixture K is not another production authority. T02's single-K composition is authoritative for new lineages, while established old-Core lineages keep their existing owner.
- Host network/filesystem effects require a real Kernel permit and trusted target registry. A browser URL, cookie, signature, human selection or model proposal is **not** executable authorization. Never copy raw browser credentials to K/model/logs or expand user-confirmed scope.
- UNKNOWN is not empty/success; submit acceptance is not acquisition completion. Recover from Core durable facts, never from UI guesses. Retry only the same authorized lineage, respecting remaining budgets, validators and duplicate-effect protection.
- DomainHarness v0.10.3 is a **Git source tag and pinned provenance**, not an npm published v0.10.3. Verify vendored tarball identities against qualified source/receipts; do not silently upgrade it.

## CLI syntax and truthful output

Canonical code: apps/cli/src/args.ts, apps/cli/src/main.ts, apps/cli/src/domain-app-commands.ts, apps/cli/src/render.ts. Repository toolchain is pinned to Node 24.21.0 / pnpm 12.8.1.

~~~text
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli/xdownload-cli.js help
~~~

Examples derived from the current source grammar (placeholders MUST be replaced; **NOT yet tested against the final installed artifact**):

~~~text
node dist/cli/xdownload-cli.js status --contract <contract-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 status --lineage <lineage-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 wait --lineage <lineage-id> --timeout-ms 30000 --poll-ms 200 --install-id <install-id> --user-id <user-id> --port <core-port>
~~~

An actual Windows --pipe-name may replace the local --port only when its install namespace exactly matches the Core; never fall back from a rejected pipe to TCP. Explicit --route v0.2 admits argv verbs submit, status, wait, cancel and batch; it rejects download/media/hls/confirm/retry. **An admitted verb does not promise that Core admits its intent**: the currently implemented K route can refuse direct, cancel or other unsupported operations. Do not retry on the legacy route to hide refusal. For submit, supply an already trusted, bounded confirmed intent via --file/--stdin; do not invent authorization facts.

CLI writes exactly one JSON document to stdout and human diagnostics to stderr. Exit codes from source:
- **0** command accepted / successful terminal result (inspect JSON for actual meaning).
- **1** usage/payload rejection; **2** typed Core rejection; **3** user action required.
- **4** terminal non-success; **5** transport/connection failure; **6** bounded wait timeout.

Preserve receipt codes, raw status, UNKNOWN totals and null fields. No fabricated percent, ETA, file path or success. Interpret the actual status rather than treating exit 0 from submit as a downloaded artifact.

## Packaging and installed Windows flow

Selected installer tuple: **Windows x64 + Node 24**. Build the audited dist and compose it on the selected platform only:

~~~text
corepack pnpm build
node installers/compose-installer.ts --version 0.2.1
~~~

The composer fails closed when the selected native runtime or host tuple is absent. The composed package includes SHA256SUMS, verify.cmd, install.cmd, uninstall.cmd, status.cmd, INSTALL.txt, a pinned identity manifest and the payload. First run verify.cmd and require PASS. Real Chromium extension ID is user-supplied from chrome://extensions, never guessed/placeholder; install.cmd --extension-id <real-id> binds the current-user HKCU Native Messaging registration and single Core named-pipe identity, refusing overwrites. status.cmd reads the binding; upgrades uninstall first. No Linux/macOS installer, updater, code signing or store claim.

Trustworthy tests of the source, a loopback fixture or a standalone S4 Kernel do **not** prove real installed Browser/Host, Electron, actual OS permission failures or G0/G1 human effort. The historical build/support-matrix.json is scoped v0.2.0 evidence and cannot be copied forward as a v0.2.1 release verdict.

## Independent Task/validation workflow

Before source work: read issue, frozen Task Pack + blob, native blocked_by on both ends, live version branch HEAD, competing claims and the task-specific allowed_write_set. Accept one CAS-style Claim, create a JIT branch based on an exact version commit, and keep other lanes' files untouched.

Before a PR is mergeable: compare **40-character exact HEAD/tree** with the frozen base; enumerate the entire diff against its exclusive write set; record Node/pnpm versions, exact input SHA, complete test commands and exit codes, clean worktree and local Docker **Woodpecker** pipeline URL + full per-step evidence. Do not use GitHub Actions as the project gate. Independent reviewer must not have authored the candidate. No historical CI status or unrelated test PASS may substitute.

Required installed/human lanes after implementation:
- **T12 #261**: installed CLI v0.2 route, status/wait/cancel/retry/batch, stable JSON and exit codes. Explicit CF-1 regression path apps/cli/test/headless-authority.test.ts; run pnpm exec vitest run apps/cli/test/headless-authority.test.ts and record exact artifact SHA / environment / EXIT=0.
- **T13 #262**: real Chromium MV3 + installed Native Messaging Host; allow/deny, origin mismatch, missing Host and secret non-disclosure.
- **T14 #263**: packaged Electron/Desktop lifecycle, secure IPC, real user journey and refusal states.
- **T15 #264**: authorized real S4 HLS VOD, explicit rendition, FFmpeg/ffprobe, real readback and honest unsupported cases.
- **T16 #265**: real Windows x64 installation, status, upgrade/uninstall, native runtime, OS permissions, package hashes, re-install readbacks.
- **T17 #266**: actual human G0/G1 comparative effort data; do not fabricate users, timings or baseline.

Only after qualified installed evidence can **T18 Candidate Freeze → T19 Hidden → T20 Closure → T21 RQ → T22 main integration** proceed per the 63-edge DAG. T10's example commands are source-checked candidates; T12/T16 must execute them against the final package and record actual outcomes before declaring the documentation acceptance proven. Fail closed on missing logs, missing real OS checks or any unverified release condition.
