# T028 — Version PR + release baseline integration

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
After canonical Release Qualification `READY` only, integrate `version/v0.1.0` to `main` through the final Version PR and establish the release baseline without changing qualified product bytes/semantics.

## Dependency
Exact dependency `T027`.

## Owned boundary
Repository integration/currentness, final Version PR diff and release-baseline identity. Merge target is `main`.

## Forbidden scope
No implementation repair, no candidate content drift, no unqualified delta, no new version naming, no tag/publication unless separately authorized by release policy. `CONDITIONAL`, `BLOCKED`, `FAIL`, Version Closure PASS, or generic Gate PASS do not authorize this repository-integration step.

## Acceptance / Validation
Require T027 canonical verdict `READY`. Re-read live candidate/main refs; verify the frozen candidate still matches its recorded SHA/tree/ref, qualified candidate ancestry, merge base/currentness, final PR diff contains only qualified version changes, required final independent integration review is current, and post-merge baseline identity is recorded. If target divergence changes approved content or candidate identity no longer matches qualification, stop and route to successor validation/qualification rather than integrating.

## Policy
`review:required` for high-blast repository integration; `risk:high`; L3 `not-required`; high-capability Repository Integration Controller; freedom `F0_MECHANICAL`.

## Failure / closeout
Any drift invalidating qualification routes back to successor validation/qualification, not forced merge. Close with exact canonical validated candidate SHA/tree plus final mainline baseline SHA/tree; Release Qualification and repository-integration results remain distinct, and tag/publication remains separately governed by release authority.
