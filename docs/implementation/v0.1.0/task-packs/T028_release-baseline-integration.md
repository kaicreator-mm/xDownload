# T028 — Version PR + release baseline integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
After Release Qualification PASS only, integrate `version/v0.1.0` to `main` through the final Version PR and establish the release baseline without changing qualified product bytes/semantics.

## Dependency
Exact dependency `T027`.

## Owned boundary
Repository integration/currentness, final Version PR diff and release-baseline identity. Merge target is `main`.

## Forbidden scope
No implementation repair, no candidate content drift, no unqualified delta, no new version naming, no tag/publication unless separately authorized by release policy.

## Acceptance / Validation
Verify qualified candidate ancestry, merge base/currentness, final PR diff contains only qualified version changes, required final independent integration review is current, and post-merge baseline identity is recorded.

## Policy
`review:required` for high-blast repository integration; `risk:high`; L3 `not-required`; high-capability Repository Integration Controller; freedom `F0_MECHANICAL`.

## Failure / closeout
Any drift invalidating qualification routes back to successor validation/qualification, not forced merge. Close with exact mainline baseline; Release PASS/publication remains governed by release authority.
