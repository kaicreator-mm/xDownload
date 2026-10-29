# T008 Execution Contract — direct HTTP/file acquisition + resume/retry/integrity

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #27, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T008` / Issue `#27`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- JIT branch: `task/v0.1.0-t008-direct-http-transfer`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (PR #52) — identical to this base
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T008_direct-http-transfer.md@8e4135d31bf495915f98586ff958415a467e4d52`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`

## Owned write boundary

T008 owns only the S1/S3 direct acquisition execution boundary: the direct HTTP/file transfer adapter behind canonical ports, its transfer/retry/integrity semantics, and task-owned controlled protocol fixtures plus their tests.

The exact base currently has a TypeScript/pnpm monorepo workspace with `packages/*` admitted by `pnpm-workspace.yaml`; `packages/domain-contracts` (T002) exports the canonical domain vocabulary (`DomainGateway`, `ids`, `decode`, `contract`, `snapshot`, `result`, `evidence`, `budget`, `scope`, `slices`, `ports` with `SurfaceCommand`, effect identity and `TerminalResultProjection`). No network/transfer adapter package exists yet. Per the Frozen Task DAG, `T008 ← T002` — the transfer adapter consumes canonical target/effect/budget/evidence ports; it must not create competing domain truth. The Builder may create the minimal direct-acquisition adapter package(s) under the existing `packages/*` workspace seam needed to satisfy T008, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

Per Frozen L2 §6.5, collection discovery resolves/finalizes the frozen target set; it is not the byte-transfer engine. T008 is the byte-transfer engine for frozen single targets only (S1 direct HTTP/HTTPS file, S3 direct media file).

### Forbidden scope

Do not implement or redesign:

- HLS VOD / segment-manifest transfer (that is a distinct adapter lane, Frozen L2 ADR-006/U6; segment/manifest topology is outside S1/S3 single-file model);
- browser-mediated download handoff (S2) or browser extension/native-messaging surfaces;
- collection discovery/frontier/enumeration, pagination or membership resolution;
- persistence/database/recovery ledger implementation, artifact store finalization order;
- Desktop/CLI/UI surfaces and scheduling/concurrency engine;
- authorization secret broker, credential storage or raw-secret handling;
- AI/model execution;
- packaging/release/platform qualification;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T008 Task Pack to make implementation easier.

## Required semantic outputs

The implementation must provide, behind the canonical domain ports established by T002:

1. A `DirectHttpAdapter`-class execution adapter (Frozen L2 §6.5 boundary; ADR-006: direct HTTP and HLS/media are distinct execution adapters behind one acquisition port) that acquires one frozen single target per S1/S3 semantics and emits canonical effect/evidence/validation records — it must not invent its own success semantics (Frozen L2 invariant 17, protocol normalization).
2. Stable logical target identity separate from volatile locators (ADR-011): redirect/CDN/signed-URL changes are locator/provenance facts that may retain identity only when evidence binds the locator to the same frozen logical target (Frozen L2 invariant 4).
3. Safe Range/If-Range resume: preserve/append partial bytes only when representation identity is sufficiently validated (strong validator/`If-Range` where available); if identity cannot be proven or the validator changes incompatibly, restart instead of appending uncertain bytes (Frozen L2 U5/§6.5 HTTP resume/retry candidate rules).
4. Retry within the same logical target/effect lineage, consuming remaining lifecycle budgets (TransferBudget for transfer/retry requests and bytes; GlobalSafetyBudget hard ceiling with highest precedence; Frozen PRD §§15.2–15.4). Retry/restart must not imply budget replenishment and must never redefine scope.
5. Integrity hooks wired to the canonical validation layers as applicable to direct transfer: Transfer Validation (byte/range completeness, response consistency), Format Validation (including rejection of login/error HTML masquerading as target content), Target Validation (acquired resource matches requested/confirmed identity), Media Validation for S3 (expected tracks/media presence); acceptance requires applicable validation (Frozen L2 invariant 18, PRD §22).
6. Controlled, deterministic protocol fixtures/task-owned controlled HTTP server tests covering strong/no validators, range support/change, truncation, retry, redirects, signed-locator refresh, budget consumption, wrong target and corruption — the exact Frozen Task Pack acceptance list. No real third-party network dependency in concern tests.
7. Fail-closed behavior for unsupported/ambiguous identity: a locator change that cannot be provenance-bound to the frozen target fails closed rather than substituting the target; unsupported/ambiguous representation identity forbids append.

## Required invariants / invalid states

Fail closed when any of the following would otherwise occur:

- target substitution because a locator changed (Frozen Task Pack forbidden scope; ADR-011);
- unsafe append without validated representation identity — including resume against a changed validator or with no usable strong validator;
- scope expansion through redirects — a redirect/CDN chain may serve the frozen target's bytes but may not enlarge requested scope or membership;
- truncated/corrupt bytes being projected as accepted/COMPLETE — transfer alone does not make an artifact accepted (Frozen L2 invariant 18; PRD C27: confirmation does not waive validation);
- wrong-target bytes (integrity/identity mismatch) being reported as success;
- retry creating new/replacement membership or escaping the original failed-target lineage (PRD C12), or retry treating budgets as replenished (PRD C13);
- transfer/retry consuming budget through any private path instead of the authoritative ledger seam (Frozen L2 invariant 7, one budget mutation path);
- success before required validation, or single-boolean success semantics replacing the multidimensional canonical result.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- adapter package naming and internal file decomposition under `packages/*`;
- HTTP client mechanism: Node's built-in `fetch`/undici globals, the built-in `node:http`/`node:https` modules, or one narrowly justified new runtime dependency, provided the exact version/license/provenance is recorded and no new Product/L2 authority is implied;
- controlled test server mechanism (e.g. `node:http` listener on localhost) and fixture organization/helper APIs;
- internal representation of representation-identity/validator state, range bookkeeping and integrity digests, provided the canonical vocabulary comes from or aligns with `packages/domain-contracts`;
- how adapter-emitted evidence/validation records are typed against the T002 `Evidence`/`Validation` identities.

These choices must not weaken or reinterpret the required semantics/invariants above.

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

T008 concern Validation is separate from this prep task and must additionally prove the T008 protocol test matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T008 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries.
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5. Do not rewrite it as part of T008. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout (PR #52, merge `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`) and the exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
