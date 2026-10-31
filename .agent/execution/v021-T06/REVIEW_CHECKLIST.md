# T06 Review Checklist

- Verify exact base/HEAD/tree and frozen T06 write set.
- Confirm S4 is not mislabeled as S3.
- Confirm explicit selected variant is bound to the observed master; no first-variant fallback.
- Confirm only finite HLS VOD with supported simple non-DRM topology is admitted.
- Confirm immediate playlist ancestry and trusted origin policy for every rendition/segment.
- Confirm K permit, Host validation, one existing HLS engine and one TransferBudget ledger.
- Confirm final media integrity, digest and authorized-root materialization.
- Confirm unsupported live/DRM/ambiguous inputs refuse truthfully with no false success.
- Confirm no changes to Core seam/runtime, domain contracts, generic operations or surfaces.
- Run exact fixture and root verification on Node 24.21.0 / pnpm 12.8.1.
- Record P0/P1/P2 and PASS/BLOCK on exact SHA; no self-review.
