# Independent Review Checklist — V022-A02-DOMAIN-APP-PUBLIC-BOUNDARY

- [ ] Exact candidate HEAD/tree and WIP base re-read.
- [ ] Aggregate changed paths are exactly the 11 Task Pack paths.
- [ ] No App-to-Host source imports remain.
- [ ] Public App root has no runtime assembler, bridge pin or physical adapter exports.
- [ ] Current Core deep-import compatibility remains until A04.
- [ ] K/S/B/C identifiers, module bytes/hashes, Business Intent semantics and operation IDs are unchanged.
- [ ] Runtime integration test scenarios are mapped for Core A04.
- [ ] T09 remains dormant.
- [ ] No Host/Contracts/Core, manifest, lockfile, CI, SDK or vendor changes.
- [ ] Node 24 syntax and changed-file Prettier ran before CI.
- [ ] Focused tests, typecheck, ci:verify and exact-SHA local Docker Woodpecker evidence are present.
- [ ] Independent reviewer records P0/P1/P2 and PASS/BLOCK.
- [ ] WIP integration only; no main/version/release/deployment.
