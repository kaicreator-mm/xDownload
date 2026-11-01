# xDownload v0.2.1 — DAG Amendment R2 (packaged Core v0.2 route composition)

```yaml
status: ADMITTED_PENDING_MERGE
amendment_id: v021-DAG-AMENDMENT-R2
triage_issue: 287
successor_issue: TO_BE_MATERIALIZED_WITH_THIS_AMENDMENT
source_baseline: "version/v0.2.1@a9a49cd1294beb3300239b57fcab6b98c5907aea (post T09-R1 merge)"
amended_by: "owner direction (2026-11-01 session), recorded in #287"
frozen_reference: "docs/implementation/v0.2.1/TASK_DAG_R0.md + TASK_PACKS_R0.md @ planning/v0.2.1-user-release@1cffd6445308ac78fa2f9e4489af579f0deb32ef (Task Packs blob c0cbed29ffa1a47cad5aed288aa262dd0dd549a8; same-commit DAG blob ecb2e31088c9e3895fad042401f737938c37628a)"
frozen_files_edited: NONE
tasks_added: 1
tasks_reopened: 0
claims: NONE
```

## Purpose

Close the P1 installed-path gap found by #287: `build/core-host.ts` composes
`createCoreRuntime` without the `domainApp` option, so the packaged Core hosts
no v0.2 Domain App route at all — installed `submit/status/wait/cancel
--route v0.2` fail closed with `V02_INTENT_VALIDATOR_UNAVAILABLE` /
`JOB_PROJECTION_UNAVAILABLE`. The gap is a seam hole between T02's write set
(packages/**) and the packaging host (build/**); no prior task could write
both sides. This amendment admits exactly ONE successor that wires the
existing frozen T02 composition into the packaged host. The frozen
Product/L2/DAG files are NOT edited; this additive amendment is the sole
additional authority.

## Added task — T02-R1 (packaged Core v0.2 route composition; successor of T02's seam side)

- **Depends on:** T02 #251 (CLOSED), T09-R1 #285 (CLOSED — single-writer
  sequencing over build/**), #287 admission record.
- **Blocks (additive edges):** T12 #261 (installed v0.2 journey evidence),
  T15 #264 (v0.2 S4 submit path), T18 #267.
- **Risk:** critical. **Review:** independent exact-SHA required.
- **Exclusive write set:** `build/core-host.ts; build/test/**`.
- **Output:** the packaged Core host passes the frozen `domainApp` composition
  option (the exact in-process composition the route unit tests use; one K per
  Core, no new authority, trust boundary, transport or persistence owner).
- **Acceptance (#287 items 1–2):**
  1. On the installed candidate, a valid confirmed S4 intent via
     `submit --route v0.2` reaches the K composition — admitted, or a typed
     refusal from K itself — never `V02_INTENT_VALIDATOR_UNAVAILABLE`;
     `status/wait/cancel --route v0.2` exercise the real job projection.
  2. All existing suites stay green; fail-closed semantics (peer identity,
     pipe/TCP exclusivity, no-widening) unchanged; independent exact-SHA
     review + local Docker Woodpecker Node24 evidence at the exact head;
     merge to `version/v0.2.1` only.
- **Forbidden:** new IPC transport; second K/Core instance; changes to
  packages/** runtime semantics; non-Windows platform claims; edits to frozen
  planning artifacts; touching any file outside the write set.

## Edge materialization note

Same as Amendment R1: no public addIssueDependency mutation exists; the
additive edges are authoritative in THIS document and cross-referenced in
comments on #261/#264/#267. The frozen 63 native edges are unchanged.

## Amendment rules

- This amendment merges to `version/v0.2.1` BEFORE any T02-R1 source write.
- T02-R1 requires its own accepted single-writer JIT `DISPATCH_CLAIMED` on the
  exact current version/v0.2.1 head.
- No other task, write set or frozen artifact is affected; any further change
  requires a new amendment.
