# T015 — Authoritative Core runtime integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Converge command/query, persistence, scheduler, evidence/result and Direct HTTP/HLS adapters into one authoritative Core Control Runtime supporting deterministic S1/S3/S4 foundations.

## Authority / dependencies
Frozen L2 authority topology. Exact dependencies `T004,T005,T006,T007,T008,T009`.

## Owned boundary
Core composition/runtime lifecycle, adapter wiring and focused integration tests. Dependency-owned contracts/algorithms remain owned by their tasks.

## Forbidden scope
No parallel mutable authority, no semantic rewrites to solve integration, no broad platform claims, no acceptance before required validation.

## Acceptance / Validation
Exact task candidate runs focused integration across command→schedule→transfer/media→validate→persist→project, process restart, duplicate submit, cancellation cutoff, budget exhaustion and missing/corrupt artifact negatives.

## Policy
`review:required`; `risk:critical`; L3 `required`; high-capability local integration Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT only after all dependencies merged. Cross-lane contradiction routes to owner/amendment. Close with Core integration evidence; not version Validation.
