# L2 successor addendum — bounded Core-executed acquisitions (v0.1.0)

**Status:** PROPOSED / independent exact-SHA architecture review required.  
**Authority issue:** #103. **Trigger:** #100 Product entrypoint review and #101 proposed S1 PR #102.  
**Frozen references:** `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md`, `docs/product/PRD-v0.4.2-review-candidate.md`, `docs/implementation/v0.1.0/TASK_DAG.md`.  
**Base:** `version/v0.1.0@0d9fd0bb6c5c3cb735e7feedd148228f15d8bc78`.

## 1. Scope and preserved authority

This additive successor covers **one missing execution carrier**, not a new product, generic gateway, crawler, Desktop shell, or modification of frozen Product semantics. The canonical AcquisitionContract remains immutable and keeps its closed field schema. The Core is the sole authority for contract/snapshot/selection scope, identity, budgets, cancellation cutoff, ledger, recovery and the multidimensional terminal projector. CLI, browser and Desktop remain thin adapters. The existing browser-only `EXECUTE_S2_ACQUISITION` and its auth, chunk and provenance restrictions remain unchanged.

The currently packaged CLI `SUBMIT_CONTRACT` is an **acceptance**, not an executable download. Contract fields cannot encode the direct locator/redirect identity. Therefore, an explicit narrowly typed execution carrier after contract acceptance is justified, subject to review.

## 2. Proposed S1 seam carrier (T004 successor)

- Proposed command: `EXECUTE_S1_DIRECT_ACQUISITION`, peer surface `CLI` only, for an *already durably accepted* `SINGLE_RESOURCE` contract at the expected revision and immutable requested target/scope.
- Bound payload: canonical `snapshotId`, `memberId`, `artifactId`; `delivery.locatorUri` (http/https only), `declaredRedirectHosts` (bounded, provenance-bound), optional independently-sourced `expectedSha256`, optional `expectedContentTypePrefix` and `expectedTotalBytes`. Closed keys and byte/identity limits, explicit rejection of raw credentials/tokens.
- The **user-facing normal flow takes a URL**, not a SHA. An independently published digest may be used as an optional *strengthening* input. Internal artifact SHA256 is required for durability/integrity, but its computation *after downloading* is never proof that the resource matches a distinct, pre-registered byte identity.
- Without a known digest, target validation must bind to explicit user-selected URL and bounded redirect provenance; transfer validates content-length/ranges when available; format checks HTML masquerade and applicable representation characteristics. Do not label byte-identity certainty `ALL_PASSED` on a self-computed digest. If the required Target proof cannot be established, use a truthful non-success/UNKNOWN/NOT_VALIDATED projection and request stronger evidence rather than invent a pass. Test-frozen external Oracle remains off-surface and independent.
- Source or test fixtures cannot promote their own observed result into target truth; P1/C09/C34 counterexamples remain required.
- An accepted command **journals intent first**. Only after COMMITTED may the Core initiate external HTTP I/O and create a canonical work item. Failure or UNCERTAIN durability fences the authority before network effects. Completion is recorded via Core-private port from durable facts and the single projector; neither command ACCEPTED nor HTTP 200 means final success.
- Replay rebuilds accepted identities and per-command revisions, never starts transfers during authority reconstruction. Post-composition reconcile classifies work items/artifacts from durable state. Accepted artifacts are never re-downloaded, re-charged or re-accepted. Missing, corrupt or torn durable facts fail closed with truthful classifications. Pending work needs bounded recovery visibility; never silently wait forever for restart to expose a failure.

## 3. Negative/acceptance matrix

| Case | Expected gate |
|---|---|
| Unknown command field / malformed schema | Reject before intent |
| Non-CLI S1 peer, foreign install/user, raw secret | Reject; no new privilege |
| Wrong contract/snapshot/member/target, unbound CDN host | Reject; no scope growth |
| Missing optional publisher SHA | Normal URL input admitted; no independent byte-certainty claim |
| Known SHA differs from acquired bytes | Failed/unknown terminal, never COMPLETE |
| HTML login masquerade, truncated/range conflict | Failed/partial/unknown; no artifact acceptance |
| Duplicate request ID same payload | Convergent replay; one work item and charge |
| Duplicate ID changed payload or late terminal command | Reject without side effects |
| Cancel-before-accept and accept-before-cancel | Existing Core precedence unchanged |
| Crash after intent COMMITTED/before work item | Safe deterministic reconcile or truthful pending/failure |
| Crash after accepted bytes; corrupt/missing file; torn ledger/journal | No duplicate transfer or budget; fail closed/recovery truth |
| No supported stronger target proof | Explicit UNKNOWN/NEEDS_USER_ACTION rather than fabricated success |

## 4. Explicitly deferred carriers

S3 direct-media inherits relevant direct-transfer ports but **requires additional Media validation and user-selectable media identity**. S4 HLS remains a distinct manifest/segment/assemble validator, never coerced to one opaque direct URL. S5 defaults to current-page frozen membership and `continuation_scope=NONE`; S6 follows only an explicitly confirmed finite/natural-end collection relation. Those require **separate reviewed Core/collection and shipped-user-entrypoint slices**. This addendum does not pre-authorize arbitrary new opcodes or changes to browser credentials or continuation authority.

## 5. Gate and change-control

Additive authority order: **#103 L2 successor draft → fresh independent architecture/contract review → successor adoption → bounded #101 PR #102 R1 → independent source/security review and actual installed S1 E2E → merge → new version exact-SHA T019–T023 → PB3 genuine humans/G0/G1 → T024–T028**. A change to this L2 successor requires a new exact-SHA review. Old version-gate PASS on prior candidates is historical only. No compatibility promise before 1.0 does not permit corrupting existing durable roots.

**Decision requested:** adopt narrow S1 Core execution carrier subject to evidence above, or return `NEEDS_REVISION` with exact counterexample. **This draft alone is not Architecture Freeze or Release PASS.**
