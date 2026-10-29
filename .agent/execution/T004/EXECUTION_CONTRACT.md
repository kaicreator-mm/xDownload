# T004 Execution Contract — core command/query authority boundary

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #23, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T004` / Issue `#23`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- Freeze checkpoint: `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- JIT branch: `task/v0.1.0-t004-core-command-query-boundary`
- Dependency completion: `T002/#21` closed `state:done`, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (PR #52); code baseline independent, no stacking beyond this dependency
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T004_core-command-query-boundary.md@b3b6bdd6f47f0e6908222c8fe9e42dc69ad31f36`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `high`; L3: `required`
- Validation scope (frozen): Contract compatibility, malformed/oversized input rejection, peer authorization and transport restart. Concern-level only; version-level visible Validation is owned by T020–T023.

## Owned write boundary

T004 owns only the Core command/query server/client seam: the versioned local command/query contract (envelope), wire compatibility, peer authentication/authorization, strict input bounds, idempotent command/observation acceptance semantics and lifecycle-independent client behavior, plus the directly necessary package/workspace wiring and tests.

The exact base is a TypeScript/pnpm monorepo. `packages/domain-contracts` (T002) already provides the canonical domain vocabulary (`DomainGateway`, branded ids, fail-closed decoders, `DomainValidationResult` diagnostics, schema identity/versioning). T004 builds the local command/query seam on top of that layer and must consume — not duplicate or fork — its decode/validate semantics. The Builder may create the minimal package(s) under the existing `packages/*` workspace seam needed to satisfy T004, and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

### Forbidden scope

Do not implement or redesign:

- Desktop UI, CLI adapter or Browser extension/broker surfaces (T013/T014/T016 lanes) — T004 proves they *can be clients*, it does not build them;
- persistence/database/recovery implementation (T005) or any authoritative store writer;
- scheduler/concurrency/budget-ledger engine (T006);
- evidence/validation/result projector domain semantics (T007);
- transfer/media/discovery engines (T008/T009);
- browser secret broker or credential storage, and any raw browser-secret export path;
- AI/model execution or Recipe interpretation;
- packaging/release/platform qualification;
- public REST API, MCP server, SDK or remote/server mode (frozen PRD §6.4 defers these);
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Specifically forbidden by the Frozen Task Pack: no competing mutable authority, no unrestricted fallback IPC, no raw browser-secret export, no surface-owned budget/result state. Do not bypass Native Messaging `allowed_origins` with an unrestricted local IPC fallback (frozen L2 §6.4/§12). Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T004 Task Pack to make implementation easier.

## Required public semantic outputs

The implementation must provide one Core-owned, versioned local command/query seam sufficient for later Desktop/CLI/Browser adapter tasks (T013/T014/T016) to become clients without owning Core lifetime, and for T015 to integrate without redesign. At minimum:

1. A versioned command/query envelope with explicit schema identity/version at the wire boundary, compatible with Frozen L2 §6.3 command transaction facts — at minimum it carries command/idempotency identity, expected/current revision, the command type/payload and provenance/audit-correlation fields (contract/snapshot/effect lineage references).
2. Transport-neutral command/query server and client ports (frozen L2 invariant 19 / ADR-012: exact production IPC transport remains replaceable) plus one concrete local loopback/IPC transport implementation chosen under F1, with the choice and its bounds recorded.
3. Idempotent acceptance semantics: duplicate submission of the same idempotent command identity does not silently create another acquisition/effect (frozen L2 §6.8); the same idempotency identity with a different payload rejects; revision mismatches reject.
4. Strict input bounds: declared schema/size bounds on all command/query messages enforced before authority transition, with typed rejection diagnostics and no secret leakage (frozen L2 §12 candidate controls).
5. Peer authentication/authorization appropriate to same-install/same-user local operation: peers without authorization reject fail-closed; no anonymous/unrestricted transport path coexists with the authorized one.
6. Lifecycle-independent client behavior: client submit/reconnect survives Core restart and Core restart does not duplicate accepted commands; late commands arriving after a lineage is terminal are recorded/rejected as late, never rewriting terminal truth (frozen L2 §11); CLI/browser/Desktop clients never own Core lifetime (frozen L2 §9 architecture-driving facts).
7. A projection read side through which surfaces read Core-owned projections; no per-surface status derivation and no surface-owned budget/result state (frozen L2 §6.7/§10).
8. Commands/observations decode their payloads into canonical `@xdownload/domain-contracts` values through the existing fail-closed boundary; the seam adds no competing domain vocabulary.

## Required invariants / invalid states

Fail closed when any of the following occurs; these must be rejectable at the seam:

- unknown/incompatible envelope schema version silently reinterpreted;
- malformed envelope, unknown command discriminant, or missing required correlation identity accepted;
- payload exceeding declared size/bounds processed instead of rejected before authority transition;
- unauthorized or unauthenticated peer admitted to any authority-affecting command;
- duplicate idempotency identity with differing payload silently deduplicated or re-executed;
- command attempting to expand/narrow confirmed `requested_scope`, add continuation authority, or mutate a confirmed `SelectionSnapshot` without successor identity (frozen PRD §8; frozen L2 §10);
- command operating outside the original failed-member identity domain presented as retry (frozen L2 §11.1 rule 6);
- command payload carrying raw reusable secret material (cookie/token/password/signed-URL secret) as ordinary state;
- command claiming budget/result authority for surface-local mutation (frozen Task Pack forbidden scope);
- restart/reconnect replaying already-accepted commands as new external effects (frozen L2 §11; ADR-010 idempotent acceptance/reconciliation, never exactly-once);
- a client obtaining different cancellation/retry precedence than another surface (frozen L2 §11.1 rule 7: single authority across surfaces).

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming and internal file decomposition under `packages/*`;
- the concrete local transport mechanism (loopback socket, pipe, in-process channel for tests, etc.) provided peer authorization and input bounds remain enforced and ADR-012 replaceability is preserved — production platform/daemon lifecycle and IPC freeze remain downstream decisions (frozen L2 §6.9);
- envelope encoding (e.g. JSON framing) and framing/bounds constants, declared and tested;
- peer identity/authorization mechanism appropriate to same-install/same-user operation on the development host;
- internal handler registry/dispatch layout, as long as authority stays Core-owned;
- whether the projection read side reuses `DomainGateway` directly or wraps it, provided one canonical semantic source remains clear.

These choices must not weaken or reinterpret the required invariants. If the chosen transport cannot satisfy same-install/same-user peer authorization, stop and route as architecture contradiction — do not ship an unauthenticated path.

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

T004 concern Validation is separate from this prep task and must additionally prove the T004 test/oracle matrix on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T004 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust/runtime boundaries (e.g. a transport that cannot authorize local peers, or a required unrestricted fallback path).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T004. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
