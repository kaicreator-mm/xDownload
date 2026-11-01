# xDownload v0.2.1 — DAG Amendment R2A (T02-R1 write-set completion)

```yaml
status: ADMITTED_PENDING_MERGE
amendment_id: v021-DAG-AMENDMENT-R2A
parent_amendment: v021-DAG-AMENDMENT-R2 (PR #290, merged as 69be00740450b5895f2f960d0bb8d5419ecfc460)
triage_issue: 287
successor_issue: "291 (T02-R1, claim issuecomment-6553877360)"
source_baseline: version/v0.2.1@69be00740450b5895f2f960d0bb8d5419ecfc460
frozen_files_edited: NONE
claims: NONE
```

## Purpose (additive; the smallest completion of R2's admitted successor)

T02-R1's implementation proved (#291 builder escalation, evidence on the
issue): wiring `domainApp` into `build/core-host.ts` makes the packaged Core
bundle read NINE frozen byte files RELATIVE TO THE BUNDLE at runtime — the
DomainHarness K composition loads its sealed mechanism bytes from the
workspace tree (`payloads/dist/{kernel-mechanism-v1,standard-sdk-v1,
workflow-router}.mjs`, `payloads/SHA256SUMS`, `business-download.mjs`,
`capability-acquisition-stub.mjs`, `s4-hls-vod-business.mjs`,
`s4-hls-vod-capability.mjs`, `generated/acorn.js`). In-process tests resolve
them inside `packages/**`, so the seam was invisible until the installed-path
smoke; the packaged `dist/core` lacks them and the Core fails to boot with
`CORE_COMPOSITION_FAILED` (ENOENT), making #287's acceptance unreachable and
turning the packaged-core suites (`build/test/real-path-s2.test.ts` et al.)
red. Shipping frozen bytes the K already self-verifies (SHA256SUMS) is
packaging work, not a semantic change; R2's write set
(`build/core-host.ts; build/test/**`) cannot express it.

## Write-set completion

**T02-R1 exclusive write set (authoritative, completing R2's):**
`build/core-host.ts; build/test/**; build/build-config.ts; build/package.ts`.

Allowed packaging changes, narrowly:
1. `build/build-config.ts`: the CORE artifact allowlist gains the exact
   literal patterns for the nine frozen runtime files (no broad globs).
2. `build/package.ts`: byte-verbatim copy of those nine files from the frozen
   workspace tree into `dist/core/` at their bundle-relative paths
   (fail-closed source resolution; missing source refuses the build), the
   same vendoring discipline as koffi/Electron (every copied byte inside the
   artifact identity hash and installer SHA256SUMS).

Everything else in R2 is unchanged and remains authoritative. All R2
forbidden rules stay in force (packages/**, apps/**, installers/**,
scripts/** untouched; no new authority/transport/trust boundary; public
package roots only). Acceptance for T02-R1 is R2's acceptance plus: the
packaged core boots with the domainApp composition on win32-x64 and the full
unit suite (including the packaged-core suites) is green.

## Amendment rules

Merges to `version/v0.2.1` BEFORE the packaging-side source write. The T02-R1
claim (issuecomment-6553877360) covers the completed write set; no new claim
is required, but the builder must record this amendment in the delivery.
Frozen Product/L2/DAG untouched; any further change needs a new amendment.
