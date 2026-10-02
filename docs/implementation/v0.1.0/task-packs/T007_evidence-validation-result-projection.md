# T007 — Typed Evidence, Validation, Coverage and Result projection

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement Core-owned typed EvidenceLedger, ValidationRecord, requested-scope CoverageAccounting and deterministic ResultProjector for RequestFulfillment, TargetResolution, SelectionAcquisition, Coverage, StopReason and ValidationSummary.

## Authority / dependency
Frozen PRD result/coverage rules + L2 ADR-009; exact dependency `T002`.

## Owned boundary
Evidence/validation/coverage/result domains and read projections.

## Forbidden scope
No single success flag; no discovery self-certification; no count-equality completeness; no accessible-subset substitution for immutable requested scope; no surface-specific result derivation.

## Acceptance / Validation
C01–C34 and status-combination tests, empty-set handling, cancellation projection, auth-limited 18/16 tuple, partial/truncated/unknown distinctions and independent validator claim binding.

## Policy
`review:required`; `risk:high`; L3 `required`; high-capability Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Product-status ambiguity routes upward. Close with exact semantic test evidence.
