# xDownload v0.2.0 — Product/L2/DAG Freeze Receipt R1

STATUS=FROZEN_R1 (this receipt, upon independent review PASS + merge into `planning/v0.2-domain-app`)
ISSUE=#188 (planning owner) / #184 (Product intake)
STANDARD=ADS 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
POC_EVIDENCE=xDownload#183 `DOMAIN_APP_POC=PASS` (independent R1, `SDK_GAP=NO`), PR #199 merged experiment-only at `41a502e0a3df9bb509e05e9057889ca82887ece2` (reviewed head `2000532a89a73e281a489d22cd53bdb31c06df6c`, tree `1d5c44114c69256afd1765cc1f04f53a393ca4d5`), REVIEW_RESULT comment `kaicreator-mm/xDownload#183@6480496090`.

## 1. Freeze predicate verification

The L2 R0 freeze gate was "do not freeze while U01/U02/U03 are unresolved; all three demanded `EXECUTABLE_DEMO_REQUIRED: #183`". That demo now exists and is independently qualified:

- **U03 (v0.10.3 public build/pack/Host closure of selected K/S/B/C) — RESOLVED.** E01 proven: four public SDK packages packed from the exact tag `v0.10.3` (commit `061376f4a023070f215f9feffad5c24d96d503cb`, tree `099cdc831aef63befd62aaede7e7a853d1be468f`), tarball SHA256 recorded AND independently verified byte-identical by the reviewer via fresh re-pack; sealed BUILD (subject `5f3d1626f524…`, closure `94a30dcc3052…`) loaded and driven (load/send/query/subscribe) by a clean Node24 consumer. npm publication remains NOT done — final package pin requalification stays a later checkpoint (A06), unchanged.
- **U01 (K Effect journal vs existing budget ledger / cancellation authority) — RESOLVED FOR FREEZE.** The executable demo shows one authoritative budget path (existing `TransferBudgetLedgerPort` driven by the trusted Host bridge strictly behind the live K permit — `permitEffectId` asserted non-null), truthful UNKNOWN under mid-transfer cancel (N04) with zero auto-redownload, and durable journal rows across restart. **Residual explicitly carried forward:** production durability equivalence against `persistence-ledger` is REQUIRED scope of Task T09 (migration) and T14 (validation); this freeze does not claim it.
- **U02 (old Core-to-K lineage handoff / physical write ownership) — RESOLVED FOR FREEZE via the independently verified no-migration partition form** permitted by the L2 text ("EXECUTABLE_DEMO_REQUIRED **or independently proven no-migration partition with source evidence**"): N06 demonstrates the partition primitive — a legacy-writer identity claiming an artifact lineage already owned by the K-side writer is refused (`WRITER_IDENTITY_CONFLICT`) by a Host CAS claim, matching the invariant "old and new writers never open on the same protected identity". Full lineage migration/replay proof remains REQUIRED scope of T09 before T11 integration.
- U04/U05/U06 remain DEFER / Task Validation / measure-at-integration respectively — unchanged, non-blocking by their own terms.

## 2. Owner direction (durable receipt)

Product intake #184 recorded the standing owner direction that v0.2 proceeds only on a positive independent PoC verdict. That condition is now met. On 2026-10-29 the owner additionally directed in the working session: "继续完成 xDownload v0.2 剩余内容的开发，一直到整个 v0.2 完成" (continue the remaining v0.2 development through full completion of v0.2). This receipt records that direction as the owner approval required by #188's acceptance item 5 for proceeding to freeze and DAG materialization. v0.1 remains untouched throughout (`V01_RELEASE_IMPACT=NONE`).

## 3. What this freeze authorizes

1. `PRODUCT_R0`, `L2_R0` (with the U01/U02/U03 dispositions above), `SCAFFOLD_R0` (structure-only), `TASK_DAG_R0` (T01–T22), and `TASK_PACKS_R0` are promoted from REVIEW_CANDIDATE/PLANNED to **FROZEN v0.2.0 R1** at the merge commit of the freeze PR into `planning/v0.2-domain-app` (SHA recorded in the #188 freeze receipt comment after merge).
2. Creation of integration branch `version/v0.2.0` from the frozen planning state (code base `version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2` is the historical anchor; v0.2 source work lands on `version/v0.2.0`).
3. Materialization of the Task DAG as canonical GitHub Issues T01–T22 with **native Issue dependencies** exactly per `TASK_DAG_R0.md` (issues carry the Task Pack contracts; each Issue is `state:planned` until its own readiness readback + JIT Claim).
4. No executable source is authorized by this receipt. Every Task's source work starts only after: its own Task Issue exists with native dependency readback (`blocked_by` all DONE), a current accepted Builder `DISPATCH_CLAIMED`, and the Task Pack write scope. `SF_SOURCE` handoff follows ADS Stage 2.4A.

## 4. Freeze invariants carried into execution

- Per-lineage single authority (L2 invariant): old Core keeps old lineages; K owns new v0.2 lineages; never both on one identity (T09 must prove migration or keep the partition permanently).
- v0.10.3-only SDK; no v0.10.2 fallback; npm publication NOT assumed.
- Every Task exposes tests, refusal paths and NOT_PROVEN; independent Review per the DAG table; validators are separate Tasks (T14–T17), release authorities T18–T22.
- Any changed kernel state semantics, SDK ABI, source security, auth or migration policy after this freeze requires an L2 amendment (new reviewed decision), never an in-place edit of frozen semantics.

## 5. Independent review requirement for this receipt

This freeze diff itself is subject to required independent review (Product semantics, L2 dispositions, DAG freeze) before merge. Reviewer: reconstruct from GitHub, verify the #183 evidence chain and the dispositions above, output P0/P1/P2 and `L2_FREEZE_READY=YES|NO`.
