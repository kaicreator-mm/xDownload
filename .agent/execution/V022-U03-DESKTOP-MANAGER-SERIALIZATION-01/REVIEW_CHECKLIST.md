# Independent Review Checklist — v022-U03-DESKTOP-MANAGER-SERIALIZATION-01

Review the final candidate by exact HEAD and Tree; do not substitute prior build/review evidence.

- [ ] Current PR base is `wip/v0.2.2-ui-rebuild-r0` and the expected base is `9e3ccd382311619e60b8d2a7373e8a7d34733334` or an explicitly authorized current rebind.
- [ ] Aggregate changed paths are exactly `apps/desktop-shell/src/main/manager.ts` and `apps/desktop-shell/test/manager.test.ts`.
- [ ] Every manager operation that touches the shared adapter is serialized.
- [ ] Public list calls are single-flight/coalesced.
- [ ] Internal closeout uses the unlocked list helper and cannot deadlock by re-entering the gate.
- [ ] Queue release occurs in finally and rejected operations do not poison later work.
- [ ] Deferred A/B list-vs-Cancel A and list-vs-Retry A tests prove the exact Core target.
- [ ] Each list row uses the projection for its own lineage.
- [ ] No second adapter/Core, adapter.ts, renderer, IPC, Host, Core, manifest or packaging changes.
- [ ] Existing fail-closed disconnect/refusal, diagnostics, retry and reveal behavior remains intact.
- [ ] Node24 syntax/Prettier preflight occurred before CI.
- [ ] Focused tests, typecheck, aggregate ci:verify and Woodpecker bind to exact candidate SHA.
- [ ] P0/P1/P2 and PASS/BLOCK are recorded by an independent reviewer.
- [ ] Packaged Windows runtime reproduction is honestly PASS or NOT_RUN.
- [ ] No merge to version/v0.2.1/main and no release/deployment.
