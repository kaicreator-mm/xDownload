# experiments/domain-app-download — #183 Research Demo PoC

**Status: research experiment only.** This directory is the bounded write scope
admitted by xDownload Issue #183 (Assurance Plan `XD-POC-183-V2-R1-INTEGRATED`,
Task Pack `POC_LOCAL_AGENT_HANDOFF_R0.md` @ `5b2499ffe4e6668819d4cbccd22896f0e80661f9`).
Nothing here is a product package, a v0.1 candidate, or a v0.2 freeze input.

## What is tested

- **E01**: Node >= 24 clean consumer installs only locally packed tarballs built
  from the exact DomainHarness Git tag `v0.10.3`
  (commit `061376f4a023070f215f9feffad5c24d96d503cb`, tree
  `099cdc831aef63befd62aaede7e7a853d1be468f`; npm publication NOT done, manifests
  remain `0.10.2-rc.0`). Pack receipts + SHA256: `evidence/e01-sdk-pack/`.
- **P01/P02**: positive journeys — fixed local HTTP fixture → trusted pre-send
  gateway → DomainHarness K admission → permitted C/Host operation → existing
  `DirectHttpAdapter` transfer → digest-backed materialized file → terminal
  query; the no-LLM-provider path stays deterministic.
- **N01–N08**: fail-closed negatives — absent permit, scope/path/source
  replacement, duplicate effect, cancel/UNKNOWN truthfulness, tampered
  receipt/journal, dual business writers, unselected BUILD module, and the
  mandatory upstream #1437 raw-send poisoning gate (invalid then valid
  same-identity with zero poisoned journal entry).
- **M01** (if measurable): baseline direct path vs K-orchestrated path on the
  same fixture.

Run: `npm install ./evidence/e01-sdk-pack/*.tgz && npm test` (after
`node scripts/pack-sdk.mjs <sdk-checkout>` on a fresh machine; see
`scripts/pack-sdk.mjs` for the pinned-tag guard).

## What is NOT proven

- Production migration, durability equivalence to v0.1
  CoreScheduler/AuthoritativeLedgerWriter, or any dual-writer reconciliation.
- Already-poisoned Effect Journal recovery (upstream #1437 repair).
- npm registry publication, upstream release readiness, or any v0.1 release
  gate impact (none).
- Anything outside this directory: `packages/**`, `apps/**`, `build/**`,
  `tests/**`, root manifests, `.dev-standard/**` are untouched read-only
  sources consumed via imports only.

 Verdict: see `docs/research/v0.2/POC_RESULT_R0.md`. Verdict ownership: `DOMAIN_APP_POC=PASS|FAIL|BLOCKED|NOT_RUN` is decided by the
independent exact-SHA reviewer per the Task Pack; results here are builder
evidence only.
