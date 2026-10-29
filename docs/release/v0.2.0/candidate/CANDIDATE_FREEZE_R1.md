# v0.2.0 — Candidate Freeze reconciliation R1

Candidate Freeze Controller decision record — Task T18 (#218), ADS `4.18.0@2c395c55…`,
exact candidate `version/v0.2.0@e35d5fc4c8afe96f91d5ded57d4497365cf60908` (carries all four
validation evidence documents; implementation history T01–T13 merged, 17/22 frozen-DAG tasks DONE).

## Visible-gate reconciliation (per `docs/validation/v0.2.0/**`)

| Gate | Verdict | Blocking detail |
| --- | --- | --- |
| T14 core durability | **PASS** (5/5 legs) | Carried finding CF-1 (below); SQLite cross-process leg NOT_PROVEN (driver absent by recorded T13 decision — file-CAS boundary documented) |
| T15 browser | PASS (source level) / **BLOCKED** (installed session) | No Native Messaging transport wired; no installable extension artifact; Windows pipe manifest is a v0.1 placeholder |
| T16 product | PASS (composition level, 5 suites) / **BLOCKED** (installed) / NOT_RUN (human G0/G1) | G1 CLI argv not wired to the v0.2 Domain App; G2 no packaged/installable product; G3 installed baselines `NOT_PROVEN_DESCRIPTOR_ONLY`; G4 S2/S5/S6 browser legs need real sessions; G5 S4 has no implementation journey (T12 folded rationale vs release claim) |
| T17 platform | **PASS** | SDK byte identity 4/4 vs #183; clean consumer single-resolution; exports smoke 12/12; zero registry fallback with live counter-evidence |

## Carried findings requiring owner disposition

- **CF-1 (from T14, P2-equivalent):** `apps/cli/test/headless-authority.test.ts` import-whitelist scan deterministically FAILs since T07 merge `f795e9e` (deep import `@xdownload/download-domain-app/src/contracts/index.ts`); behavior tests pass. Not introduced by T13/T14; surfaced by full-lane re-run.
- **CF-2 (from T16/G5):** S4 (HLS VOD Basic) has no implementation journey in the candidate; the release claim must either drop S4 or fund an owning lane.

## Decision

`CANDIDATE_FREEZE=BLOCKED` — the pack predicate "all required visible Validation PASS and current
on exactly one version candidate" is **not** satisfied: the installed-surface scopes of T15 and T16
are BLOCKED, and CF-1/CF-2 are unresolved. Per the pack's own failure handling, BLOCKED is recorded
truthfully; nothing is washed into PASS, and no freeze identity is minted.

Consequences: T19 (Hidden Validation) and the downstream closure chain (T20–T22) remain gated on a
future freeze at R2+; they cannot lawfully run against a non-frozen candidate.

## Path to an R2 freeze (owner decision required — both routes are lawful)

1. **Gap-closure amendment (complete the installed surface):** bounded DAG-amendment tasks for
   (a) CLI argv wiring + CF-1 import normalization, (b) extension packaging + native transport
   seam wiring, (c) S4 ownership (implement or drop from claims), then re-run T15/T16 affected
   scopes; human G0/G1 and hidden validation additionally require real human sessions and the
   isolated hidden authority — not producible by builder agents.
2. **Release-scope amendment (rescope v0.2 claims):** an L2/Product amendment redefining v0.2 as a
   workspace/component-level release (composition-runtime + packages, no installed end-user
   surface claims); under amended claims the composition/source/platform levels already evidenced
   could satisfy a re-reconciled freeze, with installed-level scopes formally out of scope.

No source was modified by this decision record (evidence-only write set).
