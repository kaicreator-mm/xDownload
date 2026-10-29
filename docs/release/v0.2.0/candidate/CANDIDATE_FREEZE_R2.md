# v0.2.0 — Candidate Freeze reconciliation R2 (FREEZE=PASS under amended claims)

Candidate Freeze Controller decision record — Task T18 (#218) round 2.
Exact candidate: `version/v0.2.0@bca81e224014194b0c15c186cfa4521f44fff572`
= R1 candidate lineage + `PRODUCT_SCOPE_AMENDMENT_R1.md` (independently reviewed PASS
`AMENDMENT_REVIEW=PASS` P0=0 P1=0, PR #241 merged). Validation evidence heads unchanged
(`7fa7210` ancestors; the amendment is docs-only and adds no code).

## Visible-gate reconciliation under the amended required set

| Required gate (per amendment §3) | Evidence | Verdict |
| --- | --- | --- |
| T14 core durability | `docs/validation/v0.2.0/core/VALIDATION_CORE_R1.md` | **PASS** (5/5 legs; SQLite cross-process leg = standing NOT_PROVEN boundary, non-required) |
| T15 browser — source level (installed scope not claimed) | `docs/validation/v0.2.0/browser/VALIDATION_BROWSER_R1.md` | **PASS** (INSTALLED_SESSION=BLOCKED stands recorded, out of claims) |
| T16 product — composition level (installed/human scopes not claimed) | `docs/validation/v0.2.0/product/VALIDATION_PRODUCT_R1.md` | **PASS** (INSTALLED_LEVEL=BLOCKED and HUMAN_G0G1=NOT_RUN stand recorded, out of claims) |
| T17 platform | `docs/validation/v0.2.0/platform/VALIDATION_PLATFORM_R1.md` | **PASS** |

All four required visible validations are PASS and current on exactly one candidate (`bca81e2`;
each evidence doc binds the same code lineage — the amendment added docs only).

## Unresolved-items disposition (none freeze-blocking under amended claims)

- CF-1 (CLI import whitelist, T07-attributed): recorded known defect; CLI surface not a v0.2.0
  claim; owner disposition deferred to v0.2.1 (amendment §2 row 1, reviewer-verified).
- CF-2 (S4 journey): NOT CLAIMED in v0.2.0 (amendment §2 row 3); engine path exercised by S3.
- Installed surfaces / installed baselines / human G0/G1: explicitly out of claims, deferral
  ledger intact in the amendment and mirrored to #242 (v0.2.1 intake).
- SQLite cross-process CAS: standing NOT_PROVEN boundary per recorded T13 decision (amendment row).

## Decision

**`CANDIDATE_FREEZE_R2=PASS`** — freeze identity minted on `bca81e224014194b0c15c186cfa4521f44fff572`
(tree of the amended candidate). R1's BLOCKED record stands immutable as history; this R2 record is
its lawful successor under the independently reviewed scope amendment.

Consequences: T19 (Hidden Validation) is now dispatchable against the frozen candidate; T20–T22
follow per the frozen DAG.

Honest scope note for downstream gates: this is a **component-level release freeze** (claims
CL-1..CL-4 of the amendment). RQ (T21) must carry the same scope wording; main integration (T22)
merges a component release, not an end-user product replacement — v0.1 remains the product line.
