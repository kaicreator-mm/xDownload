# T008 — Direct HTTP/file acquisition + resume/retry/integrity

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement S1 and direct-file S3 acquisition behind canonical ports with stable logical target identity, provenance-bound redirects/CDN/signed locator refresh, safe Range/If-Range resume and transfer/format/target integrity hooks.

## Authority / dependency
Frozen S1/S3 + L2 U5/ADR-006/011; exact dependency `T002`.

## Owned boundary
Direct HTTP/file adapter and task-owned controlled protocol fixtures.

## Forbidden scope
No target substitution because a locator changed; no unsafe append without representation identity; no scope expansion through redirects; no success before required validation.

## Acceptance / Validation
Controlled server tests for strong/no validators, range support/change, truncation, retry, redirects, signed-locator refresh, budget consumption, wrong target and corruption.

## Policy
`review:required`; `risk:high`; L3 `required`; local protocol Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Unsupported/ambiguous identity fails closed. Close with exact protocol test evidence.
