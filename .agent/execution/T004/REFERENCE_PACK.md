# T004 L3 Reference Pack — core command/query authority boundary

Task: `T004` / Issue `#23`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a production IPC transport, peer-identity mechanism or new runtime library, and does not redefine public semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

Seam behavior is naturally table-driven: for each (envelope version × command type × peer state × payload shape × duplicate/restart history) tuple there is one stable expected outcome. Keep positive and negative cases adjacent.

**Patterns to emulate:**

- `test.each` / table-driven cases over envelope versions, command discriminants, peer authorization states and bound violations;
- decode/submit tests from `unknown` wire-shaped input, never only from already-typed in-process objects;
- duplicate-submit tests where the same idempotency identity is submitted twice and assertions check one accepted lineage, not two successes;
- conflicting-duplicate tests (same identity, different payload) asserting typed rejection;
- restart simulation: tear down and rebuild the Core/server instance while the client retains its identities, then reconnect and re-submit; assert no duplicate effects and preserved accepted state;
- late-command tests: drive a lineage to terminal, then deliver a control command and assert recorded/rejected-as-late with terminal truth unchanged;
- oversized-input tests driven from declared bounds constants so the limit and the test cannot silently diverge;
- immutable fixture inputs and fresh server/client instances per case so duplicate handling cannot pass through shared state.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`.

License fact: `vitest@4.1.11` is MIT-licensed at tag `v4.1.11`. It is already selected by T001; T004 does not introduce it.

### 1.2 Restart/reconnect without a real second machine

Frozen L2 §9 makes authoritative state survive Core process restart a driving fact; the exact production daemon-vs-on-demand lifecycle remains unfrozen. Concern tests therefore simulate restart in-process: dispose the server instance, construct a fresh one over the same authoritative identities, and continue the client. This tests the seam contract, not a platform daemon. If the F1-chosen transport is a real loopback socket/pipe, tests exercise it locally and deterministically without external services.

## 2. Contract / interface references

### 2.1 Versioned envelope — JSON Schema Draft 2020-12 as design reference

Primary references:

- Core: `https://json-schema.org/draft/2020-12/json-schema-core`
- Validation: `https://json-schema.org/draft/2020-12/json-schema-validation`

Use these as mature design references for explicit schema identity/version at the envelope boundary, required correlation fields, enumerated command discriminants and fail-closed unknown-field policy. T004 does not require emitting JSON Schema or adding a JSON Schema runtime. If emitted, generated/hand-authored schema remains subordinate to one canonical semantic source and its compatibility tests.

Relevant patterns:

- explicit schema/version discriminator on every framed message;
- closed command discriminated variants; unknown discriminant = reject;
- separate syntactic framing/shape validation from authority-affecting semantic validation;
- declared byte/depth/field bounds as part of the wire contract, not an implementation accident.

### 2.2 TypeScript discriminated unions and exhaustive narrowing

Exact compiler on the base: `typescript@5.9.3`, strict mode with `noUncheckedIndexedAccess`.

Primary references:

- TypeScript Handbook narrowing/discriminated unions: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions`
- exact source tag: `https://github.com/microsoft/TypeScript/tree/v5.9.3`

License fact: `typescript@5.9.3` is Apache-2.0 licensed at tag `v5.9.3`. It is already selected by T001; T004 does not introduce it.

Use discriminants for command types, envelope versions and rejection causes with exhaustive handling. Wire data is erased at runtime: `unknown input → runtime decode/validation → canonical typed value`; a TypeScript assertion is never validation.

### 2.3 Transport-neutral ports pattern

Define server/client ports as pure interfaces so the concrete transport is one adapter among possible adapters (frozen L2 invariant 19 / ADR-012). The port vocabulary should speak in terms of: authenticated peer, framed envelope, submit-with-identity, read projection, connection lifecycle events (connect/reconnect/disconnect). Keep the concrete loopback/IPC transport behind this port; do not let socket-specific types leak into command semantics.

### 2.4 Seam identity pattern

Keep T004-layer identities nominally distinct from `@xdownload/domain-contracts` branded ids (reuse the same `Branded` technique from `packages/domain-contracts/src/ids.ts`):

- `CommandId` / idempotency/request identity
- `PeerId` / peer identity
- revision counters per aggregate (distinct from domain `ContractId`/`EffectId`)

The semantic requirement is category separation, not a specific branding implementation.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Authorize, frame-bound, then decode, then transition

Recommended flow at the seam:

```text
raw inbound bytes from transport
→ peer identity verification / authorization decision (same-install/same-user)
→ frame + declared size/bounds check
→ structural/version envelope decode
→ idempotency/revision gate (identity seen? payload equal? revision current?)
→ payload decode via @xdownload/domain-contracts (canonical value or typed rejection)
→ Core-owned authority transition / projection read
→ response envelope (acceptance, typed rejection, or projection)
```

Fail closed at each arrow. Never begin an authority transition before authorization, bounds and decode all pass.

### 3.2 Idempotency gate before effect

The envelope's command/idempotency identity is checked against the accepted-command record before any state change: same identity + same payload → return the original acceptance (converged lineage); same identity + different payload → typed rejection; new identity + stale expected revision → typed rejection (frozen L2 §6.3/§6.8/§10 "revision/idempotency checks"). This gate is seam logic; the durable command/effect record itself belongs to T005/T006 — T004 defines and tests the seam contract against an in-package representation without building the production ledger.

### 3.3 Lifecycle-independent client

Client submits, then may outlive any single Core instance: on disconnect it reconnects and re-submits with the same idempotency identity; the gate makes replay safe. Clients never start/stop Core as an authority prerequisite and never cache authoritative state as a side channel (frozen L2 §9 "CLI must not depend on Desktop UI lifetime"; §10 "Read caches are disposable and never become authority").

### 3.4 Projections are read-only values

The read side returns canonical read-only projections derived Core-side (frozen L2 §6.7 `ResultProjector` ownership; §10 terminal statuses table). The seam must not expose mutation methods for budget/result state and must not recompute product status per surface.

## 4. Failure handling patterns

Fail closed at the seam, in authorization → bounds → version → idempotency → decode order.

### Unknown/malformed wire input

- missing version at a boundary that requires one → reject;
- unknown command discriminant or authority-changing unknown field → reject, never default;
- oversized/deep input → reject before parse into authority state, with the declared bound named in the diagnostic;
- preserve original bytes/value for diagnostics where safe; never leak secrets into diagnostics.

### Peer failures

- identity verification failure and authorization failure are distinct typed rejections, both fail-closed;
- transport failure is reported truthfully; never degrade to an unauthenticated channel (frozen L2 §6.4 "no fallback from rejected Native Messaging to unrestricted local IPC").

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T004 acceptance

| Acceptance concern | Frozen reference | Required T004 proof |
| --- | --- | --- |
| Versioned command/query seam | Frozen L2 §6.1 (Local Command/Query Port), §8 step "adapter-neutral local command/query seam" | transport-neutral ports + one F1 transport; versioned envelope |
| Command transaction facts | Frozen L2 §6.3 | envelope carries idempotency identity, expected revision, lineage correlation |
| Idempotent commands / duplicate submit | Frozen L2 §6.8; ADR-010; PRD §35 C13 | duplicate converges to one lineage; conflicting duplicate rejects; restart replay safe |
| Revision/idempotency checks | Frozen L2 §10 (AcquisitionContract row) | stale-revision rejection with typed diagnostic |
| Restart/reconnect, late commands | Frozen L2 §11 / §11.1 (rules 6–7) | restart survives, late command recorded/rejected, one precedence across surfaces |
| Peer authorization + input bounds | Frozen L2 §12 (seam 6 "local IPC client → Core authority"; controls list); §15 A9 | same-install/same-user admission; unauthorized/oversized rejection |
| No unrestricted fallback IPC / allowed_origins | Frozen L2 §6.4, §12, invariant 14 | no unauthenticated coexisting path; truthful auth failure |
| Lifecycle independence / thin surfaces | Frozen L2 §9 architecture-driving facts; invariant 2 | CLI/browser/Desktop-shaped clients submit/read without owning Core lifetime |
| Core-owned projections | Frozen L2 §6.7, §10 (terminal statuses row) | read-only projection facade; no per-surface derivation |
| Surface parity of semantics | Frozen PRD §8 ("UI, CLI and Browser Integration MUST project the same contract semantics"), §6.1–6.4 | one seam consumed identically by all future adapters |
| CLI client contract expectations | Frozen PRD §27 | submit acceptance separable from final result; bounded non-interactive states representable through the seam |
| Applicable counterexamples | Frozen PRD §35 C08/C11/C12/C13/C16/C30/C31 + `TEST_MATRIX.yaml` | seam-level oracle/fixture mapping per id |

## 6. Dependency/version/license facts

### Already pinned and recommended for T004 use

| Package | Exact version on bound base | License | T004 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | static seam modeling, strict exhaustive type checking |
| `vitest` | `4.1.11` | MIT | executable seam/transport/negative tests |
| `@xdownload/domain-contracts` | workspace package (T002 output) | repository-internal | canonical payload decode/validation and diagnostics |

Sources: root `package.json` on exact base; upstream exact-tag license files in `microsoft/TypeScript@v5.9.3` and `vitest-dev/vitest@v4.1.11`; `packages/domain-contracts/` on exact base.

### New runtime transport dependency

**None is recommended or pinned by this Reference Pack.** Prefer Node.js built-ins (the base pins Node `24.21.0`; its standard-library net/pipe modules suffice for a local loopback transport) or an in-process channel for deterministic tests. If the Builder adds a runtime dependency under F1, the implementation evidence must record exact package name/version/license and primary source, and Review must check that the library does not become the de facto peer-authorization trust root or Product/Architecture authority.

This keeps library popularity from becoming an architectural decision.

## 7. Do / Don't

### Do

- authorize, bound, version-gate and decode before any authority transition;
- make envelope version compatibility explicit and testable;
- make duplicate replay converge on one lineage and test it across a simulated restart;
- keep transport behind neutral ports so ADR-012 replaceability survives;
- reuse `@xdownload/domain-contracts` decoders and diagnostics as the single payload vocabulary;
- keep T004 ids type-distinct from domain ids;
- test semantic negative states (unauthorized peer, oversized input, conflicting duplicate, late command), not only happy paths;
- record the F1 transport choice and its declared bounds durably.

### Don't

- don't implement Desktop UI, CLI adapter, browser extension/broker, persistence ledger, scheduler or projector domain behavior;
- don't create an unauthenticated fallback path or bypass Native Messaging `allowed_origins`;
- don't let surfaces own budget/result state or derive status per-surface;
- don't claim exactly-once external-effect semantics — only idempotent acceptance/reconciliation;
- don't use TypeScript casts as wire validation;
- don't silently deduplicate a conflicting-payload duplicate;
- don't pre-freeze production IPC transport, framework or daemon lifecycle;
- don't copy large external implementations or licenses into this repository.

## 8. Reuse / license risk

Risk is low if external material is used as interface/testing/design reference only. Do not copy substantial source from TypeScript, Vitest, Node.js or other libraries into T004. If a new dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR. JSON Schema references here are standards/design references; no spec text needs to be copied into product source.

## 9. Validation boundary

This Reference Pack does not prove T004. The later Builder produces an exact candidate; T004 concern Validation must execute the seam test matrix on that exact candidate; Fresh Independent Review is separately required because the command/query boundary is a public/security boundary task (`review:required`, `risk:high`). Version-level visible Validation remains owned by T020–T023 on the exact T019 candidate.
