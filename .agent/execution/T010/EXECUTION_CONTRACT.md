# T010 Execution Contract — browser observation, Native Messaging broker and scoped authorization

Status: `PACK_CURRENT` at generation. This is exact-base HOW guidance subordinate to Issue #29, the Frozen Task Pack, Frozen Product/Architecture and ADS `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## Exact binding

- Task: `T010` / Issue `#29`
- Integration base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`
- Base tree: `c9f41e851e3224c27ab05ea9bdda7e754ebf41c9`
- JIT branch: `task/v0.1.0-t010-browser-observation-auth-broker`
- Dependency completion: `T002/#21` closed, merge commit `c813d3a1f2afea7bd3f99de1d01321904f5fbdd5` (canonical domain contracts available as `packages/domain-contracts`)
- Frozen Task Pack: `docs/implementation/v0.1.0/task-packs/T010_browser-observation-auth-broker.md@6a8505d2001009cd64ca63b80ecb97d51ec9a71f` @ freeze checkpoint `40bc80abc16012a42cb396a1aa3b6a6752daf061`
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`
- Review: `required`; risk: `critical`; L3: `required`
- Preferred executor: Local Builder with real Chromium/native host

## Owned write boundary

T010 owns only the browser/security/auth boundary: extension observation/handoff, native host/broker, auth capability issue/use/revoke, and browser-specific task tests.

The exact base has a TypeScript/pnpm monorepo with `packages/domain-contracts` (T002 canonical contracts, including opaque `AuthorizationContextRef` identity and `DomainGateway`/surface ports) and T001 toolchain packages. No browser extension package, no native host/broker package and no Core runtime exist yet. The Builder may create the minimal new package(s) under the existing `packages/*` workspace seam needed to satisfy T010 (extension source/native-host source may additionally need an app-level seam, e.g. under `apps/*` which `pnpm-workspace.yaml` already admits), and may make narrowly necessary root workspace dependency/script/config wiring when directly required by that package and its tests.

### Forbidden scope

Do not implement or redesign:

- unrestricted cookie/token export or any raw-secret export path;
- any fallback around Native Messaging `allowed_origins` (no unrestricted local IPC fallback when Native Messaging is rejected);
- page/content-script privilege: content-script input is untrusted and cannot invoke privileged native/auth actions;
- arbitrary navigation/crawl or any arbitrary URL frontier;
- claims of unsupported browser/OS tuples (no Firefox/Safari or Windows/macOS registration/packaging claims — L2 proves Chromium 144/Linux only);
- production credential-vault design, extension-store distribution/signing/update;
- persistence/database/recovery, scheduler, transfer/media adapters, Recipe interpreter, AI adapter, Desktop/CLI surfaces — other tasks own them;
- Product, Architecture, Task DAG or Frozen Task Pack semantics.

Do not mutate `docs/planning/`, Frozen PRD/L2, `TASK_DAG.md`, `TASK_PACKS.json` or the T010 Task Pack to make implementation easier.

## Required semantic outputs

The implementation must provide the browser/auth seam such that later integration (T016) can consume it without inventing competing truth. At minimum:

1. **Browser observation/handoff**: privileged extension context that observes current-page/network/player context with tab/frame/origin/request provenance, and hands off to Core contracts without granting page/content privilege. Observations are provenance-bound evidence inputs, never direct authority.
2. **Untrusted-input gate**: all page/content-script and native messages are schema- and size-bounded before any privilege; oversized/malformed/unknown-authoritative-field messages fail closed.
3. **Native Messaging host / local broker**: real native host reachable via Chromium Native Messaging; `allowed_origins` remains the separate platform-enforced boundary and is never bypassed.
4. **Opaque scoped authorization capability**: broker issues/validates/revokes expiring capabilities referenced only by opaque `AuthorizationContextRef` (from `packages/domain-contracts`); raw reusable cookie/password/token/session material never becomes ordinary canonical state and never leaves the browser/broker secret zone toward Core/durable/log/Recipe/model sinks.
5. **Exact binding**: each privileged auth use binds exact origin, target, contract, snapshot and observation provenance, plus partition context where browser state is partition-aware; cross-origin/unbound/wrong-partition/cross-contract/cross-snapshot reuse fails closed.
6. **Truthful auth lifecycle**: `issue`/`use`/`revoke` semantics with expiry producing truthful `AUTH_REQUIRED`/`AUTH_FAILED` behavior — never silent scope/target widening or re-issue to escape failure.
7. **Browser-specific task tests**: executable tests proving the positive tuple behavior and every negative in `TEST_MATRIX.yaml` on at least one applicable real browser/native-host tuple.

## Required invariants / invalid states

Fail closed when input is malformed/oversized, binding is incomplete, or state combination violates Frozen Product/L2 semantics. At minimum reject:

- privileged action from untrusted page/content input lacking schema/size plus origin/target/provenance validation;
- auth capability use where origin, target, contract, snapshot or provenance binding does not exactly match the current observation/task;
- wrong-partition or partition-unaware reuse where browser state is partition-aware;
- expired or revoked capability treated as valid; expiry silently converted into scope/target widening or automatic re-issue;
- `AuthorizationContextRef` (or its broker-side capability) redefining, enlarging, narrowing or silently rewriting confirmed `requested_scope`;
- Native Messaging rejection falling back to any unrestricted local IPC path;
- raw secret material (cookie/token/password/signed-URL secret) appearing as ordinary state in canonical task data, logs, evidence, Recipe data, model input or Core-durable paths;
- observation evidence promoted to self-certifying authority without provenance and without Core acceptance;
- claims (in code, tests or closeout) of browser/OS tuples not actually exercised.

## Successor binding rule

A capability is bound to one exact (origin, target, contract, snapshot, provenance[, partition]) tuple. Any semantic change to that tuple — new contract/snapshot identity, changed provenance chain, changed partition context — requires a new capability issue decision against the successor identity; capabilities are never silently re-bound in place. Revocation is effective for later uses; revocation does not retroactively rewrite recorded evidence.

## F1 implementation choices left open

The Builder may choose, inside the frozen semantics:

- package naming/decomposition (e.g. extension package, native-host/broker package, or combined) under `packages/*`/`apps/*`;
- implementation language for the native host consistent with the local real Chromium tuple actually tested (L2 demo evidence used Python 3.13.5; any choice must be recorded with exact runtime/version/provenance);
- extension manifest v3 permission set under least-privilege (host permissions, optional permissions where practical);
- message framing/serialization inside the schema/size bounds;
- local test harness mechanics (e.g. controlled auth origin, fixture pages, driven Chromium profile) provided the tested tuple is real and exactly recorded;
- capability store representation inside the broker secret zone (in-memory/expiring), provided no raw secret becomes Core-durable state.

These choices must not weaken or reinterpret the required invariants or the platform `allowed_origins` boundary.

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

T010 concern Validation is separate from this prep task and must additionally prove the real-browser/native-host tuple plus the full negative matrix from `TEST_MATRIX.yaml` on the exact implementation candidate. This JIT Prep does not run or claim that Validation.

## Escalation / stop conditions

Return without redesign when any of the following is encountered:

- `TASK_PACK_DEFECT`: T010 WHAT is incomplete/contradictory against Frozen Product/Task DAG or cannot express required acceptance without changing scope.
- `ARCHITECTURE_CONTRADICTION`: satisfying the Task Pack requires violating Frozen L2 ownership/trust boundaries (e.g. only a bypass of `allowed_origins` or raw-secret persistence could satisfy a requirement).
- `EXECUTION_PACK_INVALID`: branch/base/task-pack/ADS binding is wrong, required artifacts are missing/duplicated, or pack guidance contradicts higher authority.
- Environment unavailability (no real Chromium/native host on the local Builder) is a `state:blocked` condition with durable evidence — never a reason to substitute simulated browser "coverage" and claim the tuple.

Also stop and re-admit if `version/v0.1.0` advances from the manifest base and currentness cannot be established under ADS pack-staleness rules.

## Non-authority note

The current `.dev-standard/PROJECT_OVERRIDES.md` retains planning-era descriptive status text from before Stage 2.5/T001. Do not rewrite it as part of T010. Current durable execution facts are the materialization terminal, Issue DAG, T002 closeout and exact repository base. If the Builder finds a normative override rule that truly conflicts with those facts, treat it as an authority contradiction rather than silently choosing one.
