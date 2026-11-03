# Independent Review Checklist — V022-A01B-S3-MEDIA-HOST-REQUEST

- [ ] Exact candidate HEAD/tree and WIP base re-read; no stale-base result.
- [ ] Aggregate changed paths are exactly the three Task Pack paths.
- [ ] DTO pins allowedOperation=media.acquire and slice=S3.
- [ ] Exact-key, bounded, no-widening validation uses A01 neutral primitives.
- [ ] Raw locator, output-root traversal, digest, byte-count and caller negatives fail closed.
- [ ] Returned DTO is normalized/immutable and preserves only authorized facts.
- [ ] Existing A01 Direct and S4 DTOs are unchanged.
- [ ] Neutral Contracts has no App/Host/Core/Node I/O/network/SDK imports.
- [ ] No manifest, lockfile, CI, SDK, vendor or Product/L2 change.
- [ ] Node 24 syntax and changed-file Prettier ran before CI.
- [ ] Focused tests, typecheck, ci:verify and exact-SHA local Docker Woodpecker evidence are present.
- [ ] Independent reviewer records P0/P1/P2 and PASS/BLOCK.
- [ ] WIP integration only; no main/version/release/deployment.
