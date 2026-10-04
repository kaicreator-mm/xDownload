# T013 Execution Contract — CLI adapter (thin command/query surface)

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #32, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T013` / Issue `#32`
- Integration base: `version/v0.1.0@f5ac137f94438a591fd6781c5b758be6c375233a`
- Base tree: `e9acfb8020befa669a87f074a6789f754d9ca81e`
- JIT branch: `task/v0.1.0-t013-cli-adapter`
- Dependency completion: `T004/#23` closed at merge `a2d4e67dbe30475e5aacb919511ea8b64e5ff7f2`; `T007/#26` closed at merge `8a87797ca21d9603fd8bd6be35dec1169f9ad97e`
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T013_cli-adapter.md@b8f335d09b4a0aa4608fb755b6a1745e1ace29c0` @ freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F2_ENGINEERING_DISCRETION`
- Review: `recommended`; risk: `medium`; L3: `recommended`

## Owned write boundary

T013 owns only the CLI surface: CLI parsing/presentation/client behavior and CLI-specific tests/docs.

The exact base is a TypeScript/pnpm monorepo. `pnpm-workspace.yaml` admits `packages/*` and `apps/*`; `apps/browser-extension/` already exists as the precedent app seam; frozen L2 §8's logical responsibility map places the CLI at `apps/cli/` as a "command/query adapter". The Builder may create the minimal CLI app/package under the existing `apps/*` workspace seam to satisfy T013, and may make narrowly necessary root workspace dependency/script/config wiring directly required by it (see IMPLEMENTATION_MAP for the two known wiring gaps: `apps/*/test/**` is not in `tsconfig.json` `include` and `apps/*/test/**/*.test.ts` is not in `vitest.config.ts` `include`).

The CLI MUST consume Core capability only through `@xdownload/core-seam` (command/query client, T004) with canonical payload vocabulary from `@xdownload/domain-contracts` (T002/T007). The CLI is a thin adapter: it submits commands and reads projections; it never owns lifecycle truth (frozen L2 invariant 2).

### Forbidden scope

Do not implement or redesign:

- any private lifecycle store, scheduler, budget, selection or result semantics (frozen pack "Forbidden scope");
- Core-side truth of any kind: no surface-side status derivation, no rewritable terminal truth, no second writer path — the seam server owns ALL authority transitions;
- any dependency of CLI operation on Desktop UI lifetime (frozen L2 invariant: "CLI must not depend on Desktop UI lifetime");
- hidden scope broadening in defaults: default flags/config must never enlarge `requested_scope`, add continuation authority, alter budget/authorization semantics or auto-confirm selection;
- a private transport/authority channel bypassing the seam peer authorization and declared bounds; the production IPC transport decision remains downstream (frozen L2 §6.9) — T013 consumes the T004 transport ports, and may use the loopback transport for concern tests, without freezing it as the production transport;
- persistence/database/recovery, crawler/discovery, transfer/media, scheduler, auth-secret broker, AI/model execution, packaging/release implementations;
- Desktop or Browser extension behavior;
- any mutation of `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T013 Task Pack.

## Required surface semantic outputs

The implementation must prove, at CLI level:

1. **Direct submission with acceptance/result separation** (PRD §27): CLI exposes submit acceptance (SeamResponse `ACCEPTED` with `requestId`/revision) separately from the final acquisition result (terminal `PROJECT_TERMINAL_RESULT` projection). Submit exit success does not mean final task success; wait-mode final exit semantics reflect final request/selection result.
2. **Batch input**: multiple targets/requests submitted in one invocation, with per-item identity/correlation preserved so partial failure is reportable per item without merging results.
3. **Machine-readable status**: golden output carrying the exact PRD §27 required field set (`contract_id`, `intent_type`, `requested_scope`, `continuation_scope`, `snapshot_id?`, `requested_count_if_known`, `auth_accessible_count_if_known`, `resolved_count`, `selected_count`, `validated_success_count`, `RequestFulfillmentStatus`, `TargetResolutionStatus`, `SelectionAcquisitionStatus`, `CoverageStatus`, `StopReason`, `needs_user_action`), projected verbatim from Core-owned `READ_PROJECTION` views — never locally derived.
4. **Non-interactive bounded behavior** (PRD §27): non-interactive mode cannot block indefinitely on confirmation; when confirmation is required it returns a bounded machine-readable `NEEDS_USER_ACTION` state instead.
5. **Cancel/retry routing**: cancellation and failed-member retry are routed as `CANCEL_LINEAGE` / `RETRY_FAILED_MEMBERS` commands through the same seam transition Desktop/Browser use — no surface-local precedence, no private retry bookkeeping.
6. **Exit/diagnostics projection**: stable, documented exit behavior that projects `SeamDiagnostic`/`ValidationDiagnostic` rejections truthfully (codes/messages preserved, not reinterpreted); a `REJECTED` outcome must never exit as success; `needs_user_action` and non-success statuses must be visible rather than silently approximated.
7. **Headless operation**: the CLI operates without Desktop UI; Core lifetime is not a CLI-owned authority prerequisite — consistent with the T004 client contract ("never starts/stops the Core as an authority prerequisite").
8. **Truthful presentation**: resolved scope displayed before acquisition starts (PRD §384-area rule); verified-empty scope renders as no-match ("No matching resources in the requested scope (verified)"), never as download success (PRD §742-area rule).

## Required invariants / invalid states

The CLI must never:

- cache authoritative state as a side channel; projections are read-only renderable views (frozen L2 §10: "read caches are disposable and never become authority");
- derive per-surface status or locally synthesize any PRD §27 field that the projection does not carry;
- present submit acceptance as final task success, or normalize `REJECTED`/non-success statuses into success;
- block indefinitely in non-interactive mode on confirmation, or fabricate confirmation locally;
- enlarge/narrow scope, add continuation, or change authorization/budget semantics through defaults, retry or batch handling;
- hold a private lifecycle store/scheduler/budget/selection/result state competing with Core;
- reuse a peer identity, seam schema version or transport path that bypasses per-frame peer authorization or declared `SEAM_MESSAGE_LIMITS`;
- reconnect with a different idempotent identity — reconnection re-submits with the SAME `requestId` so the seam idempotency gate converges duplicates (T004 client contract, ADR-010);
- depend on Desktop UI lifetime for any CLI function.

Fail closed when: the seam response carries an unsupported/incompatible schema identity; a required projection field is absent (render absence, do not invent values); input is malformed (typed usage/parse error, non-success exit); or a command is answered with typed diagnostics (project them; do not swallow).

## F2 implementation choices left open

Under `F2_ENGINEERING_DISCRETION` the Builder may choose, inside the frozen semantics:

- CLI entry naming/location under `apps/*` (`apps/cli/` is the frozen L2 logical slot, not a mandated path);
- argument grammar (subcommands/flags), help text and documentation format;
- exact machine-readable serialization shape (e.g. JSON layout) as long as the PRD §27 required fields are present and stable/golden-tested;
- human-readable output format and verbosity;
- the numeric exit-code table (PRD §27 freezes the semantics — submit vs final, `NEEDS_USER_ACTION` bounded, wait-mode final reflects final request/selection result — not the numbers);
- batch input mechanism (file/stdin/line-delimited/JSONL) and per-item failure presentation;
- wait/poll/subscribe UX over `READ_PROJECTION` for wait-mode;
- CLI package/dependency choices (e.g. an arg parser) only with exact package/version/license/provenance recorded; Node built-ins (`node:util` `parseArgs`, `node:net` via the seam transports) on the pinned Node `24.21.0` require nothing new;
- concern-test harness composition (in-process seam server + loopback transport, as `packages/core-seam/test/transport-loopback.test.ts` already demonstrates).

These choices must not weaken or reinterpret Frozen Product/L2 semantics or the T004/T007 consumption contracts.

## Verification commands available on the exact base

The T001 toolchain provides the durable root gates:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ci:verify
```

T013 concern Validation is separate from this prep task and must additionally prove the T013 TEST_MATRIX on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T013 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.
- `CONTRACT_MISMATCH`: the seam/contract does not expose what T013 must surface — route to the T004/T007 owner, not a CLI fork (frozen pack Merge/routing rule); never build a CLI-local compatibility shim over a mismatch.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

`.agent/execution/T013/` is JIT-pack evidence/guidance only — never product content, never implementation source. If the Builder finds a normative override rule that truly conflicts with the durable execution facts above, treat it as an authority contradiction rather than silently choosing one.
