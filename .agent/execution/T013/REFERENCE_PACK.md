# T013 L3 Reference Pack — CLI adapter (thin command/query surface)

Task: `T013` / Issue `#32`  
Bound base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select the production IPC transport, freeze a CLI framework, or redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner and in-process seam harness

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`. Root `vitest.config.ts` discovers `packages/*/test/**/*.test.ts`; CLI concern tests under `apps/cli/test/` need the narrow include wiring recorded in IMPLEMENTATION_MAP.

The strongest exact-base pattern is `packages/core-seam/test/transport-loopback.test.ts` (+ `helpers.ts`): it composes `createCoreSeamServer` + loopback server/client transports + `createSeamClient` + `stampPeer` in-process over a real local socket — exactly the harness T013 concern tests need to drive the CLI adapter end-to-end with no Desktop, no browser and no external service.

**Patterns to emulate:**

- golden-fixture tests: run the CLI surface against a fixed projection/response input and assert the full machine-readable document byte-stably;
- table-driven cases (Vitest `test.each`) for exit-code/diagnostics mapping: each `SeamDiagnostic`/`ValidationDiagnostic` code → stable non-success exit;
- acceptance-vs-result cases: same submit produces an acceptance record and later a distinct terminal record; assert both are independently observable;
- batch cases with per-item correlation ids and partial failure;
- cancel/retry routing cases asserting the CLI emits `CANCEL_LINEAGE`/`RETRY_FAILED_MEMBERS` envelopes and converges duplicates on the same `requestId`;
- non-interactive cases asserting bounded `NEEDS_USER_ACTION` output with a timeout guard in the test itself (so a regression to blocking fails the test, not the CI clock).

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`. License fact: MIT at tag `v4.1.11`; already selected by T001, T013 does not introduce it.

### 1.2 CLI-process testing without new frameworks

Where the CLI entry is a real process, Node built-ins suffice on the pinned Node `24.21.0`: spawn the CLI with `node:child_process` and assert stdout/exit code, or structure the entry as a thin shell over a testable adapter function taking parsed input and the `SeamClient`. Prefer the latter; keep process-spawn tests few and golden.

## 2. Contract / interface references

### 2.1 The seam is the API — read T004 before writing T013

Exact-base consumption surface (`packages/core-seam/src/`):

- `client.ts` — `createSeamClient({ transport, target, peer, maxReconnectAttempts })`; `submitCommand`/`submitQuery`/`close()`; reconnect reuses the SAME idempotent identity; never starts/stops Core as an authority prerequisite.
- `envelope.ts` — schema identity `xdownload.core-seam@1.0.0` (majors `[1]`); commands `SUBMIT_CONTRACT`, `CONFIRM_SNAPSHOT`, `CANCEL_LINEAGE`, `RETRY_FAILED_MEMBERS`, `PROJECT_TERMINAL_RESULT`; queries `READ_PROJECTION`; `CommandEnvelope`/`QueryEnvelope`/`SeamResponse` (`ACCEPTED`/`REJECTED`/`PROJECTION`, `acceptance{revision, converged}`, `currentRevision`, `projection`, `diagnostics`).
- `peer.ts` — `SurfaceKind 'CLI'`; `PeerIdentity`; per-frame authorization.
- `bounds.ts` — `SEAM_MESSAGE_LIMITS`; batch/serialization must respect declared limits.
- `projection.ts` — deep-frozen read-only views (`ContractProjectionView`, `SnapshotProjectionView`, `LineageProjectionView`, `SeamProjectionView` with projected terminal result); per-surface status derivation is rejected by design.
- `diagnostics.ts` — `SeamDiagnostic` reusing the `ValidationDiagnostic` shape; payload decode failures surface domain diagnostics verbatim.

Canonical payload vocabulary comes from `@xdownload/domain-contracts` (T002/T007): contract/snapshot/scope/budget types and decoders for building payloads, and `result-projector`/`TerminalResult` semantics behind status rendering. The CLI consumes; it never redefines.

### 2.2 Frozen Product §27 — the CLI contract to satisfy

PRD §27 (plus §6.3, the resolved-scope display rule and the verified-empty rendering rule) fixes: submit acceptance separate from final result; the machine-readable field set; `needs_user_action`; non-interactive bounded `NEEDS_USER_ACTION`; submit exit success ≠ final success; wait-mode final exit reflects final request/selection result. These are the acceptance criteria the golden tests encode.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Thin-adapter flow

```text
argv / batch input (validated, typed errors)
→ canonical payload via @xdownload/domain-contracts decoders (fail closed)
→ CommandEnvelope via createSeamClient (CLI SurfaceKind, idempotent requestId, correlation)
→ SeamResponse: ACCEPTED (record acceptance) | REJECTED (project diagnostics, non-success) | PROJECTION (render)
→ READ_PROJECTION polling/refresh for wait-mode → render PRD §27 fields verbatim → exit per documented table
```

Every arrow is presentation-only; no arrow may create domain state locally.

### 3.2 Render, don't derive

Status text/exit codes are pure functions of the projection + diagnostics. Never compute coverage, success, membership or budget facts in the CLI. If a required field is absent from the projection, render absence — do not infer.

### 3.3 Bounded non-interactive mode

Non-interactive mode treats "confirmation required" as data (`NEEDS_USER_ACTION` + the projection context), not as a prompt. Interactive/wait modes are explicit opt-ins; their waiting is bounded/observable and cancelable.

### 3.4 Idempotent, reconnect-safe submission

Reuse the T004 client as-is. Any CLI-side "retry" of a submit is a resubmission with the same `requestId` (converges at the seam). A CLI-side "retry task" is a `RETRY_FAILED_MEMBERS` command — never local re-execution of members.

## 4. Failure handling patterns

Fail closed at the presentation boundary.

- Typed diagnostics → verbatim (or stable documented lossless) output + stable non-success exit; never reworded into success.
- Unsupported seam version / peer-unauthorized / oversized input → distinct, documented non-success exits; never retried into a bypass.
- Malformed argv/batch input → typed usage errors before any envelope is built.
- Missing projection fields → render absent/unknown; never invent.
- Contradiction/uncertainty: Task Pack wrong/incomplete → `TASK_PACK_DEFECT`; Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`; seam does not expose what the CLI must show → `CONTRACT_MISMATCH_ESCALATED` to the T004/T007 owner (no CLI fork); tooling unavailable → `VALIDATION_NOT_EXECUTED`, never PASS.

## 5. Examples / docs mapping to T013 acceptance

| Acceptance concern | Reference pattern | Required T013 proof |
| --- | --- | --- |
| Golden machine-readable output | PRD §27 field set + deep-frozen projection views | deterministic golden fixtures over fixed projection inputs |
| Acceptance vs final result | `SeamResponse ACCEPTED` + projected `TerminalResult` | both observable separately; exits distinct |
| Stable exit/error behavior | diagnostics → exit table (F2 choice, frozen semantics) | table-driven tests per diagnostic code |
| Batch input | per-item correlation via `requestId`/`correlation` | partial failure isolated per item |
| Cancel/retry routing | `CANCEL_LINEAGE`/`RETRY_FAILED_MEMBERS` envelopes | same Core transition; duplicate convergence; no local precedence |
| Status parity with Core | `READ_PROJECTION` verbatim rendering | CLI output equals projection for the same aggregate |
| Headless operation | seam client without Desktop | CLI functions pass with no Desktop dependency |
| Non-interactive bounded behavior | `NEEDS_USER_ACTION` as data | bounded machine-readable state; no blocking |

## 6. Dependency/version/license facts

### Already pinned and recommended for T013 use

| Package | Exact version on bound base | License | T013 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static typing of the adapter and golden contracts |
| `vitest` | `4.1.11` | MIT | executable concern/golden/negative tests |
| Node built-ins | `24.21.0` pinned via `engines` | Node license | `node:util` `parseArgs`, `node:net` (via T004 transports), `node:process` exit codes — no new runtime dependency required |

### New CLI dependency

**None is recommended or pinned by this Reference Pack.** Under `F2_ENGINEERING_DISCRETION` the Builder may add a narrowly justified CLI dependency (e.g. an arg parser) only with exact package/version/license/provenance recorded; Review must confirm it does not become de facto Product/Architecture authority.

## 7. Do / Don't

### Do

- build on `createSeamClient` and the closed v1 vocabulary unchanged;
- render projections verbatim; keep golden fixtures byte-stable;
- keep exit semantics pure functions of (projection, diagnostics);
- treat `NEEDS_USER_ACTION` as bounded data in non-interactive mode;
- reuse the core-seam in-process loopback harness for concern tests;
- record any new dependency's exact provenance/version/license.

### Don't

- don't implement lifecycle/scheduler/budget/selection/result semantics in the CLI;
- don't invent command/query types, statuses or completion facts;
- don't present acceptance as success or non-success as success;
- don't block non-interactive mode or fabricate confirmation;
- don't let defaults, batch or retry widen scope or add continuation authority;
- don't couple the CLI to Desktop lifetime or freeze the loopback transport as the production transport;
- don't fork a compatibility shim over a seam mismatch — escalate to the T004/T007 owner.

## 8. Reuse / license risk

Risk is low if external material is used as interface/testing/design reference only. Do not copy substantial source from Vitest, TypeScript or CLI libraries into this repository. If a new dependency is introduced, consume it under its package license and record exact provenance in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T013. The later Builder produces an exact candidate; T013 concern Validation must execute the TEST_MATRIX on that exact candidate; Review follows the frozen `review:recommended` policy at `risk:medium`. Version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
