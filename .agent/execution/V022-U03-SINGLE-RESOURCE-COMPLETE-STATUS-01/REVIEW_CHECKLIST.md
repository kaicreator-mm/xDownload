# Independent Review Checklist — v022-U03-SINGLE-RESOURCE-COMPLETE-STATUS-01

- [ ] Exact PR HEAD/tree/base re-read.
- [ ] Changed paths exactly renderer-main.ts and ux-r0-form-schema.test.ts.
- [ ] Valid single-resource COMPLETE + NOT_APPLICABLE is complete only with all other authoritative dimensions.
- [ ] Collection VERIFIED_COMPLETE behavior unchanged.
- [ ] Partial/failed/cancelled/unknown/missing remain non-complete.
- [ ] Complete counts, filters, status tag and progress label use the same predicate.
- [ ] NOT_APPLICABLE row is called completed, never “coverage verified”.
- [ ] No changes to domain contract/Core/adapter/Host/IPC/main/package/CI.
- [ ] Node24 syntax/Prettier before CI; focused tests/typecheck/ci:verify and Woodpecker exact SHA pass.
- [ ] Independent Exact-SHA review P0/P1/P2 recorded.
- [ ] Runtime Electron fixture evidence is PASS only if executed; otherwise NOT_RUN.
- [ ] No main/version merge, release or deployment.
