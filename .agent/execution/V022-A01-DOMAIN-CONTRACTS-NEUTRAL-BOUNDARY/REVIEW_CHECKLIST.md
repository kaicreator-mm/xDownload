# Independent Review Checklist — V022-A01-DOMAIN-CONTRACTS-NEUTRAL-BOUNDARY

- [ ] Exact PR HEAD/tree and WIP base re-read; no stale-base result.
- [ ] Aggregate changed paths are exactly the three Task Pack paths.
- [ ] Business Intent, K/S/B/C, route-table/BUILD validation and Workflow policy remain in Domain App.
- [ ] Direct and S4 Host request DTOs are exact-key, bounded and no-widening.
- [ ] Host independently validates the request before any physical effect.
- [ ] Raw URL/path locators, traversal, invalid digest/byte counts and stale S4 selection fail closed.
- [ ] EffectEnvelope accepted/running remains non-terminal.
- [ ] MaterializedEvidence remains digest-backed and output-root bounded.
- [ ] Contracts has no App/Host/Core/Node I/O/network/SDK imports.
- [ ] No package dependency, manifest, lockfile or CI change.
- [ ] Node 24 syntax and changed-file Prettier ran before CI.
- [ ] Focused tests, typecheck, ci:verify and exact-SHA local Docker Woodpecker evidence are present.
- [ ] Independent reviewer records P0/P1/P2 and PASS/BLOCK.
- [ ] No WIP merge without explicit Owner integration authorization; no main/version/release/deployment.
