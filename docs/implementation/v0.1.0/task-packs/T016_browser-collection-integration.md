# T016 — Browser + collection workflow integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Integrate browser observation/scoped auth and bounded Recipe/collection workflows with authoritative Core for required S2/S5/S6.

## Authority / dependencies
Frozen S2/S5/S6 and L2 trust/scope boundaries. Exact dependencies `T010,T011,T015`.

## Owned boundary
Cross-boundary browser→broker→Core handoff, collection workflow orchestration and focused end-to-end fixtures/real-browser tests.

## Forbidden scope
No browser-owned transfer lifecycle, unrestricted IPC, arbitrary frontier, continuation inferred from budget or silent snapshot drift.

## Acceptance / Validation
S2 explicit attachment + provenance redirects; S5 current-page `continuation_scope=NONE`; explicit continuation/successor snapshot; S6 finite/natural-end collection; auth expiry/inaccessible members; partial/truncated/unknown truth.

## Policy
`review:required`; `risk:critical`; L3 `required`; high-capability local Builder with browser access; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after all dependencies. Security/scope contradiction stops affected path. Close with exact tuple/fixture evidence.
