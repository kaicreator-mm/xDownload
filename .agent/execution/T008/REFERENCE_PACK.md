# T008 L3 Reference Pack — direct HTTP/file acquisition + resume/retry/integrity

Task: `T008` / Issue `#27`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a new HTTP library or redefine canonical semantics.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts` in a Node environment.

The Frozen Task Pack acceptance demands **controlled server tests**. On this base that means a task-owned deterministic localhost HTTP fixture server (e.g. `node:http` listener started per test/per suite, closed afterward). Do not use real third-party hosts: concern tests must be reproducible and hermetic.

**Patterns to emulate:**

- one minimal fixture server with per-scenario behavior: validator headers (ETag/Last-Modified) on/off, `Accept-Ranges`/`206 Partial Content` support, `If-Range` evaluation, redirect chains (same-origin hop, cross-origin CDN hop, unrelated-host hop), signed-locator expiry, truncation mid-body, corruption, wrong bytes;
- table-driven scenarios so each Frozen-Task-Pack acceptance row (strong/no validators, range support/change, truncation, retry, redirects, signed-locator refresh, budget consumption, wrong target, corruption) has a stable oracle identity;
- assertions against the adapter's canonical outputs (effect/evidence/validation/result), not against incidental internal structures;
- deterministic budgets: fixed initial budgets per scenario so consumption/replenishment semantics are exactly observable;
- keep the T002 `packages/domain-contracts` oracle tests (`oracles-c01-c34.test.ts`, `identity-locator.test.ts`) as vocabulary references, not as T008 test substitutes.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`.

License fact: `vitest@4.1.11` is MIT-licensed at tag `v4.1.11`. It is already selected by T001; T008 does not introduce it.

### 1.2 HTTP semantics references (design, not copied code)

- RFC 9110 "HTTP Semantics" — conditional requests (`If-Range` in §13.2.2 context, validators §8.8) and Range Requests (§14): `https://www.rfc-editor.org/rfc/rfc9110` and `https://www.rfc-editor.org/rfc/rfc9110#section-14`.
- RFC 9110 §14 covers `Range`, `Accept-Ranges`, `206 Partial Content`, and multi-part ranges; §8.8.3 defines strong vs weak validators — the exact basis for the U5 rule (resume only with sufficiently validated representation identity).

Relevant rules to encode as tests: a `206` to a ranged request with a changed/absent strong validator must not be appended; weak validators (`W/`) are not sufficient representation identity for append; `If-Range` matching means "serve the range, same representation", mismatch means "full new representation".

Standards text is reference only; do not copy specification text into product source.

## 2. Contract / interface references

### 2.1 The T002 canonical ports are the interface

The adapter's public surface is bounded by `packages/domain-contracts`:

- effect/command envelope identity (`SurfaceCommand`, `effectId`) — every transfer attempt belongs to a durable effect lineage so retry/restart reconciles instead of blindly replaying (Frozen L2 invariant 8);
- budget identities (`budget.ts`) — transfer consumption is reported through canonical budget domains; the adapter never owns a private ledger (invariant 7);
- typed evidence/validation (`evidence.ts`, `result.ts`) — transfer/format/media/target outcomes are emitted as canonical records; the adapter does not invent success semantics (invariant 17);
- identity vs locator separation (`ids.ts`, `identity-locator.test.ts` semantics) — redirect hops are locator facts bound by provenance to the frozen `LogicalTargetId` (invariant 4, ADR-011).

If a transfer concern genuinely cannot be expressed through these ports, that is an escalation (`TASK_PACK_DEFECT`/`ARCHITECTURE_CONTRADICTION`), not a reason to fork vocabulary.

### 2.2 Node HTTP capability on the pinned runtime

Exact runtime on base: Node `24.21.0` (T001-pinned). Built-in capability available without new dependencies:

- global `fetch` (undici-based) for client requests, with `Range`/`If-Range` headers and body streaming;
- `node:http` / `node:https` modules as an alternative client and the natural fixture-server foundation;
- `node:crypto` for integrity digests (e.g. SHA-256) used by integrity hooks.

Under `F1_BOUNDED_IMPLEMENTATION` the Builder may instead add one narrowly justified HTTP client dependency; the implementation evidence must then record exact package/version/license/provenance and Review must check the library does not become de facto Product/Architecture authority. The JIT pack intentionally does not preselect a library.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Frozen target → locator resolution → byte transfer → validation gate

Recommended flow:

```text
frozen logical target (from canonical contract/effect)
→ provenance-bound locator resolution (redirects/CDN/signed refresh may follow, identity check at each hop)
→ byte transfer (range/resume per U5 rule; budget consumption reported per unit)
→ integrity hooks (transfer completeness, format probe, target match, S3 media checks)
→ canonical typed evidence/validation/result emission (never adapter-local success)
```

### 3.2 Resume decision as an explicit typed decision, not a heuristic

Model the resume choice as an explicit outcome with reasons: `validated-resume` (strong validator matched via `If-Range`), `safe-restart` (no validator, ambiguous identity, validator change), `fail-closed` (unsupported/ambiguous). Every append must be traceable to a validated identity decision; every restart must stay in the same logical target/effect lineage.

### 3.3 Redirect handling with provenance binding

Follow redirects only as delivery mechanics for the frozen target: each hop is recorded as a locator/provenance fact; identity is retained only while the binding holds. An unrelated-host redirect or changed final resource fails closed (C29). Redirects never create a discovery/enumeration side effect.

### 3.4 Budget consumption as reported units

Express consumption in canonical budget terms (requests, bytes, active transfer time per Frozen PRD §15.2) reported through the canonical seam, with GlobalSafetyBudget as the hard precedence ceiling (§15.4). Retry inherits remaining budgets; nothing in the adapter may treat a retry as replenishment (C13).

### 3.5 Integrity hooks map to Frozen PRD §22 layers

For S1: Transfer (byte/range completeness, response consistency), Format (parseable; login/error HTML masquerading as target content rejected), Target (acquired resource matches frozen identity). For S3 additionally Media (expected tracks/media presence, duration/container sanity). Acceptance requires the applicable gates; a user-confirmed candidate does not waive them (C27).

## 4. Failure handling patterns

Fail closed at authoritative boundaries.

### Ambiguous identity

- missing/weak-only validator at resume time → safe restart or typed failure, never append;
- `If-Range` mismatch → treat response as a new representation; decide explicitly, do not merge;
- redirect to unrelated resource → fail closed with target-preservation evidence.

### Truncated / corrupt / wrong bytes

- length/range/completeness mismatch → truthful truncated result vocabulary; no acceptance;
- digest/integrity mismatch → typed integrity failure evidence; quarantine semantics belong to later Core lanes, the adapter's job is truthful reporting;
- wrong bytes (right size, wrong target) → Target Validation failure; technical validity alone is not success (C09).

### Budget exhaustion

- TransferBudget exhausted mid-transfer/retry → stop work, truthful budget-exhausted outcome, no scope reinterpretation (C28 shows domains are distinct: DiscoveryBudget exhaustion does not block a frozen target while Transfer/GlobalSafety budgets remain).

### Contradiction / uncertainty

- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`
- Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`
- pack mis-bound/malformed → `EXECUTION_PACK_INVALID`
- tooling/test unavailable → no PASS; record `VALIDATION_NOT_EXECUTED`

## 5. Examples / docs mapping to T008 acceptance

| Acceptance concern | Reference pattern | Required T008 proof |
| --- | --- | --- |
| Strong/no validators | RFC 9110 §8.8/§13/§14 + L2 U5 | validated resume vs safe restart decision is tested both ways |
| Range support/change | RFC 9110 §14 `206`/`Accept-Ranges` handling | range honored when safe; validator change never appended across |
| Safe restart | L2 §6.5 HTTP resume/retry candidate rules | unprovable identity restarts on same lineage |
| Truncation | Transfer Validation layer (PRD §22) | truncation detected, never accepted |
| Retry | L2 invariant 8 stable effect lineage + PRD §15 | retry stays in lineage, consumes remaining budget (C12/C13) |
| Redirects / signed-locator refresh | ADR-011 + invariant 4 provenance binding | bound hop retains identity; unrelated hop fails closed (C29) |
| Budget consumption | PRD §15.2/§15.4 + invariant 7 | transfer/retry units counted via canonical seam; GlobalSafety precedence |
| Wrong target / corruption | Target/Transfer Validation layers + C09/C27 | fail-closed typed outcomes; confirmation waives nothing |
| S3 media file | S3 slice (PRD §28) + Media Validation layer | required track/media presence gates acceptance |

## 6. Dependency/version/license facts

### Already pinned and available for T008 use

| Capability | Exact version on bound base | License | T008 role |
| --- | ---: | --- | --- |
| Node.js runtime | `24.21.0` (T001-pinned) | Node license | built-in `fetch`/`node:http`/`node:https`/`node:crypto` — client, fixture server, digests |
| `typescript` | `5.9.3` | Apache-2.0 | strict adapter/fixture typing |
| `vitest` | `4.1.11` | MIT | executable protocol/negative tests |

Sources: root `package.json` on exact base; upstream license files at `microsoft/TypeScript@v5.9.3`, `vitest-dev/vitest@v4.1.11`; Node runtime pinned by T001 toolchain record (`docs/implementation/v0.1.0/T001_TOOLCHAIN_RECORD.md`).

### New runtime HTTP dependency

**None is recommended or pinned by this Reference Pack.** Node built-ins cover the controlled-test scope. If a third-party client is introduced under F1, record exact package/version/license/provenance in the implementation PR; Review must confirm the library does not silently define resume/identity/budget semantics (those stay Product/L2-derived).

## 7. Do / Don't

### Do

- run all concern tests against a task-owned localhost controlled server;
- make the resume/restart/fail-closed decision explicit, typed and evidenced;
- bind every redirect hop to the frozen logical target's provenance;
- report budget consumption through canonical budget/effect identities;
- gate acceptance on applicable Transfer/Format/Target(/Media) validation;
- emit canonical evidence/result records; stay inside `packages/domain-contracts` vocabulary;
- test negatives: append across validator change, scope expansion through redirects, truncated/corrupt/wrong-target acceptance, budget bypass, retry lineage escape.

### Don't

- don't implement HLS/segment transfer, browser handoff, discovery, persistence, scheduling or surfaces;
- don't let the adapter own success semantics or a private budget ledger;
- don't append bytes without a validated representation identity decision;
- don't substitute the target because a locator changed;
- don't replenish budgets on retry or reinterpret scope on exhaustion;
- don't persist signed-URL secrets/cookies/tokens as ordinary state;
- don't depend on real third-party hosts in tests;
- don't copy RFC text or large external implementations into this repository.

## 8. Reuse / license risk

Risk is low if RFC 9110 and library sources are used as design/interface reference only. Do not copy substantial source from any library or standards body into T008. If a new dependency is introduced, consume it normally under its package license and record exact provenance/version/license in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T008. The later Builder produces an exact candidate; T008 concern Validation must execute the controlled-protocol test matrix on that exact candidate; Fresh Independent Review is separately required because this task is `risk:high` and `review:required`.
