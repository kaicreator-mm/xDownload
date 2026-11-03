# Independent Review Checklist — V022-A03 Domain Host Boundary

- [ ] Exact WIP HEAD/tree and accepted Claim match the rebound Task Pack/Execution Pack.
- [ ] Aggregate changed paths are exactly the 14 Task Pack paths.
- [ ] No Host→App static, side-effect, relative, dynamic or CommonJS source import remains.
- [ ] Direct bridge consumes A01 Direct DTO.
- [ ] S3 bridge consumes A01B S3 DTO pinned to media.acquire + S3.
- [ ] S4 bridge consumes A01 S4 DTO and recomputes tuple digest from fresh master facts.
- [ ] Permit, origin, budget, targetRef, digest, cancellation and atomic materialization invariants preserved.
- [ ] FileCasDocStore is Host-owned and retains V10DocStore CAS/restart semantics.
- [ ] PlainFileLineageStore is Host-owned, structurally compatible, dormant and not wired to Core.
- [ ] No second K, Journal, route authority, Scheduler, transfer engine, SQLite or multi-process claim.
- [ ] No App/Contracts/Core/manifest/lockfile/CI/apps/SDK/vendor path changed.
- [ ] Node 24 syntax and changed-file Prettier ran before CI.
- [ ] Focused tests, typecheck, ci:verify and exact-SHA local Docker Woodpecker evidence present.
- [ ] Independent reviewer records P0/P1/P2 and PASS/BLOCK.
- [ ] WIP integration only; no main/version/release/deployment/real external download.
