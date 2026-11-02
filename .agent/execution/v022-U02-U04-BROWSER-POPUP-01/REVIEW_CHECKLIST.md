# Independent Review Checklist — v022-U02-U04-BROWSER-POPUP-01

Review the final candidate by exact HEAD and Tree; do not substitute a prior build or earlier PR revision.

- [ ] Current PR base is `wip/v0.2.2-ui-rebuild-r0`; expected base is the manifest SHA or an explicitly authorized current rebind.
- [ ] Aggregate changed paths are exactly the three allowed paths; no hidden/untracked/out-of-scope writes.
- [ ] Schema descriptor version, operation and field-kind allowlists fail closed.
- [ ] Descriptor remains presentation-only; no Host/Core capability or authority is fabricated.
- [ ] Existing DOM IDs, accessible tab/tabpanel relationships and explanations remain correct.
- [ ] S6_PREPARE_COLLECTION and V02_ADD_DOWNLOAD payloads are unchanged.
- [ ] Single-flight polling is generation- and identity-bound; late responses cannot regress terminal state.
- [ ] New submissions invalidate old generations.
- [ ] Known Chrome missing-page-access error is localized; exact raw detail is preserved.
- [ ] Unknown errors remain distinguishable.
- [ ] No permission request/widening, manifest, service worker, Host, Core, IPC, Native Host, HKCU or real download changes.
- [ ] Node24 syntax/Prettier preflight occurred before CI.
- [ ] Focused tests, typecheck, aggregate ci:verify and Woodpecker results are bound to the exact candidate SHA.
- [ ] Windows/Chrome installed-popup validation is reported separately and NOT_RUN is not called PASS.
- [ ] Output P0/P1/P2, PASS/BLOCK and version-only/WIP-only eligibility; no main/version/v0.2.1 merge.
