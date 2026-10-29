# v0.2.0 — Product/L2 release-scope amendment R1 (component-level release)

STATUS=AMENDMENT_CANDIDATE (effective upon independent review PASS + merge; supersedes the
release-claim reading of PRODUCT_R0/L2_R0 for v0.2.0 ONLY, per the freeze-receipt amendment clause)
OWNER_DECISION=Route-B recorded 2026-10-29 (owner accepted the controller recommendation in the
working session; #184 standing direction unaffected)
AMENDS=docs/planning/v0.2.0/PRODUCT_R0.md (release claims), docs/architecture/v0.2.0/L2_R0.md
(release mode) — as a dated addendum; frozen semantics text above is NOT rewritten in place
BASELINE=version/v0.2.0@15956b073e0e782fc6c624070f0dcbd6e08c83d9
PREDECESSOR_DECISION=docs/release/v0.2.0/candidate/CANDIDATE_FREEZE_R1.md (FREEZE=BLOCKED)

## 1. What changes (claims only; no frozen architecture semantics change)

v0.2.0 is amended to a **component/workspace-level release**. Its claims are exactly what the
candidate evidences today:

- CL-1 Domain App composition runtime: K-admitted, permit-gated, journal-truthful download
  orchestration over the EXISTING v0.1 engines (direct-acquisition, hls-vod-adapter), proven at
  composition level by T11/T12 suites and T14 core durability validation (crash/restart/UNKNOWN/
  no-double-grant, cross-process durable readback).
- CL-2 Two workspace packages (`@xdownload/download-domain-app`, `@xdownload/download-domain-host`)
  with public exports, clean-consumer install, single-resolution dependency graph, byte-identical
  v0.10.3 Git-source SDK pinning (T02/T13/T17).
- CL-3 The bounded-authorization surface sources (CLI adapter T07, browser surface T08) as
  ready-to-wire components with source-level fail-closed validation (T15 SOURCE_LEVEL=PASS).
- CL-4 Lineage authority partition (T09): old lineages stay v0.1-owned; new K lineages exclusively
  claimed; default = no migration.

## 2. What is explicitly OUT of v0.2.0 claims (deferred, with owners)

| Deferred item | Evidence home | Deferred to |
| --- | --- | --- |
| Installed CLI user surface (argv wiring; CF-1 import normalization) | T16 gap G1; T14 carried finding | v0.2.1 |
| Browser extension v0.2 cutover (submission-path switch in the existing v0.1 extension, v0.2 host manifest, packaged artifact; real Chromium session revalidation on the new trust path using the v0.1 harness) | T15 gaps 1–3; T16 G2/G4 | v0.2.1 |
| S4 (HLS VOD Basic) as a claimed release journey | T16 gap G5 (disposition: NOT CLAIMED in v0.2.0; engine path is exercised by the S3 media journey) | v0.2.1 (implement) or permanent drop (owner) |
| Installed baselines bound to a release SHA | T16 G3 (stays NOT_PROVEN_DESCRIPTOR_ONLY — correct under component claims) | v0.2.1 |
| Product G0/G1 human effort parity | T16 HUMAN_G0G1=NOT_RUN | v0.2.1 (requires human sessions; not producible by agents) |

Nothing already disproven is claimed; nothing already claimed is weakened silently — the deferral
ledger above is part of this amendment and must survive into v0.2.1 intake unchanged.

## 3. Effect on gates

Under the amended claim set, the required visible validation for freeze becomes exactly:
T14 core PASS · T15 SOURCE_LEVEL PASS (installed scope not claimed) · T16 COMPOSITION_LEVEL PASS
(installed scope not claimed) · T17 platform PASS — all evidenced at
`docs/validation/v0.2.0/**` against candidate `15956b0`'s ancestors (`7fa7210` evidence heads,
unchanged code). The unfixed CF-1 finding remains recorded as a known non-freeze-blocking defect
with owner disposition deferred to v0.2.1 (it is a CLI-surface consistency issue; CLI surface is
not a v0.2.0 claim). Human G0/G1 and installed baselines are not invoked by component claims.

## 4. What does NOT change

- v0.1 remains the released product line; `version/v0.1.0` untouched; v0.1's own gates unaffected.
- All frozen architecture semantics (single authority per lineage, permit-before-effect, no byte
  streams through K, v0.10.3-only SDK, no npm publication assumption) stand unamended.
- T19 Hidden Validation runs against the frozen component candidate as packaged claims CL-1..CL-4.

## 5. Review focus (required)

Verify: (a) no claim exceeds what the four validation documents actually prove; (b) the deferral
ledger is complete against the T15/T16 gap lists and CF-1/CF-2; (c) the amendment is a claim-scope
change only, not a semantic freeze rewrite; (d) owner-decision provenance is recorded honestly.
