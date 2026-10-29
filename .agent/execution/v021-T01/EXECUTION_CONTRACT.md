# T01 Execution Contract — Canonical contracts and Core seam protocol

## 1. Authority and exact subject

- Parent planning issue: #248.
- Canonical Task Issue: #250 (task_id=v021-T01).
- Frozen Task DAG: blob ecb2e31088c9e3895fad042401f737938c37628a.
- Frozen Task Pack: blob c0cbed29ffa1a47cad5aed288aa262dd0dd549a8, referenced by the immutable path/ref in MANIFEST.
- Product/L2/DAG review subject: 07af78c3abee741196ff566a7f21fdfe15d71da7.
- Native dependency readback R2: docs/implementation/v0.2.1/TASK_ISSUE_MATERIALIZATION_R2.md; 22/22 blocked_by and reciprocal blocking GETs; 63/63 exact in each direction.
- Integration branch: version/v0.2.1@c29af4a4b89123997d03d5566ebe09ba83855fb0.
- JIT task branch: task/v0.2.1-t01-canonical-contracts-core-seam, created from the exact integration SHA above.
- Builder write set: only packages/domain-contracts/** and packages/core-seam/**.

This Execution Pack is subordinate to the frozen Task Pack. It narrows implementation choices; it cannot change Product/L2 semantics, Task acceptance, dependencies, review policy, or write authority.

## 2. Frozen Task Pack requirements (verbatim)

- Depends on: none. Risk: critical. Review: required.
- Exclusive write set: packages/domain-contracts/**; packages/core-seam/**.
- Output: stable job/attempt/progress/error projections; known-vs-unknown totals; explicit v0.2 command/query route; no-widening intent validation; typed refusal for ambiguous lineage owner.
- Acceptance: deterministic schema tests, malformed/unknown-field negatives, old protocol compatibility, and cross-surface parity fixtures.
- Forbidden: no runtime composition, scheduler, persistence, UI or transfer implementation.

## 3. Currentness and admission readback

At pack generation:

- Issue #250 is open and state:planned; its native blocked_by list is empty.
- The frozen DAG confirms T01 has no predecessor. T01 is the only initial dependency-ready task. T11 is blocked by T01 and is not ready.
- The native DAG was independently read in both directions: 63/63 exact blocked_by, 63/63 exact reciprocal blocking; no missing, extra, duplicate or one-sided edges.
- version/v0.2.1 and main are both still at c29af4a4b89123997d03d5566ebe09ba83855fb0.
- No T01 comments, accepted Claim, or existing T01 task branch were present before this JIT branch was created.
- The execution-pack branch is separate from the Builder branch so scheduler-owned .agent/execution/** artifacts do not enter the Task PR or widen the Builder write set.

### Project override currentness

The repository's A1/manual protocol and v4.assurance.default=manual-minimum are retained. The old Stage 2.4 / version/v0.1.0 integration snapshot in .dev-standard/PROJECT_OVERRIDES.md is stale for this release's branch and materialization facts; those facts are superseded by the exact v0.2.1 Freeze Receipt R1, Task Issue Materialization R2 and the current native GitHub DAG. This Task does not amend the override file because it is outside the frozen write set.

A1 manual protocol is in force: no assurance reducer/controller or machine Assurance Plan v2 record is declared by the project. The manual assurance floor is exactly the Task Pack's critical-risk, required independent Review and deterministic test acceptance; this pack adds no assurance reduction and no new gate.

## 4. Reuse before implementation

The following existing contracts are authoritative and MUST be reused rather than forked:

1. packages/domain-contracts/src/result.ts: multidimensional terminal result vocabulary; do not add a success boolean.
2. packages/domain-contracts/src/scope.ts and contract.ts: exact domain scope/continuation validation and unknown-field rejection.
3. packages/core-seam/src/envelope.ts: closed command/query envelope, explicit seam schema identity, fail-closed unknown-field handling and legacy query protocol.
4. packages/core-seam/src/projection.ts: Core-owned immutable aggregate projection; do not make surfaces status authorities.
5. packages/download-domain-app/src/contracts/intent.ts (read-only): existing validateConfirmedIntent exact-key no-widening contract; do not duplicate or modify it from this Task.
6. packages/download-domain-app/src/migration/lineage-ledger.ts (read-only): existing old-core/new-k partition, single-writer claim semantics and typed LineageLedgerError; do not modify this package from T01.
7. packages/core-scheduler/src/machine.ts and scheduler.ts (read-only): existing lineage state, attempt identities and outcome facts.
8. apps/cli/src/domain-app-status.ts, apps/desktop/src/projection-decode.ts and apps/desktop/src/view-model.ts (read-only): existing surface vocabulary/verification; do not move status derivation into adapters.

The missing v0.2.1 contract surface is the stable cross-version job/attempt/progress/error projection and explicit v0.2 route at the Core seam, including a typed refusal when lineage ownership is ambiguous.

## 5. Implementation requirements

### 5.1 Domain projection contracts

Add pure, exported, strictly decoded domain contracts in packages/domain-contracts/** for:

- Job projection: stable opaque job/lineage identity, resolved owner, current lifecycle state, current attempt reference, progress projection and optional typed terminal/error facts.
- Attempt projection: stable attempt identity, ordinal/sequence where authoritative, lifecycle state, start/finish facts when known, and typed error/terminal facts.
- Progress projection: actual transferred byte count plus a discriminated total:
  - KNOWN with a validated non-negative safe integer total; or
  - UNKNOWN with no numeric total.
- Error projection: stable bounded error code/message and a closed error category or source code. Do not infer retryability from message text or surface heuristics.
- Lineage owner resolution: explicit RESOLVED old-core/new-k owner, or typed REFUSED with a stable reason such as LINEAGE_OWNER_AMBIGUOUS / LINEAGE_OWNER_CONFLICT.

Do not create a second lifecycle vocabulary that conflicts with TerminalResult, Core scheduler states or the existing Domain App effect envelope. Reuse existing literals where they have the same semantics.

Progress rules:
- Unknown total is not zero and is never represented by a fabricated percentage or ETA.
- Percentage, if projected, is present only when total is known and the denominator is valid; it is not a success/completion signal.
- Never infer total bytes from a response body, file size estimate or a previous attempt.
- Do not add ETA unless an existing authoritative Core source supplies it; this Task's projection omits ETA.

### 5.2 Core seam route

Add an explicit v0.2 route discriminator to command/query envelopes in an additive, backward-compatible way:

- Legacy envelopes without the new route field continue to decode and behave semantically as before.
- The v0.2 job-projection query is only valid with the explicit v0.2 route.
- Unknown route values, unknown query discriminants and v0.2-only query without its route reject typed before any state/journal/effect.
- Preserve the existing READ_PROJECTION route unchanged.
- Expose a typed job-projection provider port and typed query response/refusal in core-seam; no runtime composition is added here.
- If no provider is installed, the new query fails closed with a typed unavailable result; it must not fabricate an empty job or fall back to the legacy projection.

A minor seam schema version bump is permitted only if required by the additive wire contract. Preserve decoding of supported historical major-1 frames and explicitly test the exact supported compatibility floor.

### 5.3 No-widening and lineage owner boundary

- Reuse the existing validateConfirmedIntent no-widening behavior; do not add a competing Domain App intent decoder.
- Ensure the new v0.2 seam route passes only through the canonical domain decoder/typed port. Unknown fields and widened scope must reject before command acceptance, journal write or external effect.
- If old-core and new-k owner facts conflict, or ownership cannot be uniquely resolved, return a typed refusal. Never guess a default owner to resolve conflicting evidence; never allow both owners to write one lineage.
- The existing default partition for a genuinely unregistered lineage remains the existing owner policy. This Task does not rewrite migration policy or transfer ownership.

### 5.4 Tests and evidence

- Add deterministic domain schema tests for valid and invalid Job/Attempt/Progress/Error/Owner-resolution projections.
- Add malformed, missing-field, wrong-type, negative-number, overflow and unknown-field cases.
- Add known-total and unknown-total fixtures; prove unknown is not zero and no percentage/ETA is emitted.
- Add explicit v0.2 route positives and missing/unknown route negatives.
- Preserve old envelope decode/encode behavior for historical v1.0–v1.2 messages.
- Add a shared cross-surface parity fixture consumed by domain-contracts and core-seam tests; verify the exact same canonical status/progress/error facts survive both decoders.
- Re-run the existing no-widening contract tests and lineage-ledger typed conflict tests read-only as regression evidence.
- Do not modify tests under apps/** or packages/download-domain-app/**; their existing parity/intent tests may be run read-only.

## 6. Explicit non-goals

No Core composition, scheduler, persistence schema, journal, transfer engine, Host/installer, Electron UI, Browser extension, CLI output, packaging, release, or version-closure changes. No package manifest or lockfile change. No external model/API calls. No real network download or filesystem side effect. No change to v0.1.0/v0.2.0 history or main.

## 7. Execution and validation environment

- Repository toolchain: Node 24.21.0, pnpm 12.8.1 (exactly from root package.json).
- Local model execution environment currently has Node 22 and no GitHub network route; it is not a valid project test environment.
- The implementation can be authored through the GitHub source integration, but acceptance tests must run on the user's Windows Node 24 environment or a project-authorized runner. Until the exact task branch SHA is tested there, task-check-green=NOT_RUN.
- Full root verification command: pnpm run ci:verify.
- Scoped contract/seam verification: pnpm exec vitest run packages/domain-contracts/test packages/core-seam/test.
- Relevant read-only regressions: pnpm exec vitest run packages/download-domain-app/src/contracts/contract.test.ts packages/download-domain-app/src/migration/lineage-ledger.test.ts apps/cli/test/status-parity.test.ts (adjust only if the exact paths are not included by the current root Vitest config; do not move files).

## 8. Stop conditions

Stop and request a scoped authority decision rather than broadening the Task if:
- implementing the v0.2 route requires changing any path outside the frozen write set;
- the existing public Domain App contract cannot express the required intent without widening;
- old-core/new-k ownership cannot be resolved from the current authoritative facts;
- the seam would need to own scheduler/persistence/transfer state;
- the test fixture cannot be made deterministic without a real Host/network effect;
- an acceptance requirement conflicts with the frozen Product/L2 semantics.
