# T009 — HLS VOD media adapter

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement required basic HLS VOD as a specialized adapter: selected manifest/rendition identity, segment requests under TransferBudget, supported assembly/probing and applicable manifest/segment/format/media/target validation.

## Authority / dependency
Frozen S4 + L2 U6/ADR-006; exact dependency `T002`.

## Owned boundary
HLS/media adapter, media tooling boundary and deterministic media fixtures.

## Forbidden scope
No generic opaque byte path pretending HLS correctness; no DRM bypass; no universal DASH/multi-audio/subtitle/separate A/V promises; unsupported encryption/topology must fail closed.

## Acceptance / Validation
Master/media playlist selection, rendition provenance, segment missing/truncation, CDN delivery, budget accounting, assembly/probe validation and unsupported topology negatives.

## Policy
`review:required`; `risk:high`; L3 `required`; local media Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Unsupported media is truthful UNSUPPORTED/FAILED. Close with exact S4 fixtures/tests.
