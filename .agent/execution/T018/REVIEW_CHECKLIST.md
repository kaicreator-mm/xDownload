# T018 Review Checklist

Policy: `review:required`  
Risk: `risk:high` (frozen at the freeze checkpoint; not recalculated)  
Review subject must be an exact implementation candidate SHA/tree. This JIT Prep performs no Review.

Packaging-honesty emphasis: this task produces the artifacts the outside world will see, so the dominant review risk is overclaiming — a package that implies more platform support, security or release readiness than was actually built and smoked. Review must concentrate on (a) no unqualified platform claims, (b) reproducible builds on a pinned, recorded toolchain, and (c) shipped-content honesty (no dev material, no secrets, no weakened boundaries).

## 1. Exact identity / currentness

- [ ] Review is bound to the exact T018 implementation HEAD and tree, not a branch name alone.
- [ ] Candidate descends from the admitted T018 JIT branch/base `888ce342b1d170ab4a217e0fff418cd8b0a0a712` or has an explicitly authorized/revalidated successor base.
- [ ] `version/v0.1.0` currentness and Execution Pack state are rechecked before Review.
- [ ] Frozen Task Pack identity remains `742ea7b6008d2b1327dbcea6450872b09cd853a5` (`T018_packaging-platform-integration.md`) unless a formal successor authority exists.
- [ ] ADS pin remains `94cad2b0487e8a552c66d6bcd1cba36b7779383d`.

## 2. Scope / authority fidelity

- [ ] Changes stay inside production build/packaging/install wiring, native-host registration wiring and package manifest/content rules, plus directly necessary root script/config/toolchain wiring.
- [ ] All 16 consumed packages (including `converged-runtime`) and app sources are semantically unmodified; no consumed package's exports, authority or behavior changed to make packaging easier.
- [ ] Frozen PRD/L2/Task DAG/Task Pack were not modified to accommodate packaging.
- [ ] No T019 candidate-preparation scope (release-candidate identity freeze, candidate cut) and no version-level Validation execution (T020–T023 scope) leaked into T018.
- [ ] Every new build/packaging dependency/toolchain has exact package/version/license/provenance recorded and stays within F2 and Frozen Architecture.

## 3. Packaging honesty (dominant review concern)

- [ ] The support/NOT_PROVEN matrix exists as durable data and separates `BUILT_AND_SMOKED` / `NOT_PROVEN` / `BLOCKED(reason)` per tuple.
- [ ] No OS/browser/shell support claim exceeds what was actually built and smoke-proven on a real Build Host; research tuples (e.g. Chromium 144/Linux from Research Demo #8) are not promoted to release claims.
- [ ] Platform blockers are recorded BLOCKED, never converted to PASS.
- [ ] No updater/signing claim exists unless the mechanism is actually configured AND validated on the real host.
- [ ] Package metadata/installer text carries no support strings stronger than the matrix.
- [ ] No Candidate Freeze, Version Closure, Release Qualification or platform qualification is inferred from T018 evidence; platform qualification remains T023's on the exact T019 candidate.

## 4. Reproducible builds / pinned toolchain

- [ ] Production build executes from a clean `pnpm install --frozen-lockfile`; the lockfile was never bypassed or edited.
- [ ] Toolchain versions (node/pnpm/bundler/packaging tools) are pinned and recorded per artifact.
- [ ] Package identity (source revision, toolchain versions, content hash) is emitted per artifact and verifiable.
- [ ] Rebuild determinism was checked where the toolchain permits; deviations are recorded, not hidden.
- [ ] New toolchain install-scripts are explicitly admitted (e.g. `onlyBuiltDependencies`) with provenance; no silent postinstall surface grew.

## 5. Package content / exclusion audit

- [ ] No shipped package contains `.agent/execution/**`, frozen docs, `packages/toolchain-smoke*`, test fixtures or dev-only tooling.
- [ ] The audit is executable and fails the build closed on violation; it is not a warning.
- [ ] Every included file/dependency is accounted for by a declared content rule; production closure matches declared runtime needs.
- [ ] No raw reusable credential material (tokens, cookies, API/provider keys) exists in any package or package config.

## 6. Boundaries / security preserved through packaging

- [ ] Native Messaging `allowed_origins` remains a separate platform-enforced boundary; no registration or fallback IPC widens or bypasses it (Frozen L2 invariant 14).
- [ ] Seam authorization/peer bounds, message-size bounds and validation survive packaging unchanged; nothing was disabled to make the build/launch work.
- [ ] Missing runtime/prerequisite and unreachable-Core cases fail with typed, honest behavior in the packaged artifacts (verified-empty/`needs_user_action`/transport-failure semantics preserved verbatim from sources).
- [ ] Extension package layout matches `apps/browser-extension/manifest.json` exactly; the build fails closed on any manifest-referenced output it does not emit.

## 7. Smoke / install evidence on claimed tuples

- [ ] Production package/build smoke executed per claimed tuple on real Build Host(s) from the packaged artifacts (not workspace sources), including Core reachability through the seam.
- [ ] Clean install/launch proven without workspace/node_modules/store residue; CLI independent of Desktop lifetime.
- [ ] Native-host registration and extension↔native handshake proven on the selected tuple(s) only; unselected platforms unclaimed.
- [ ] Evidence is durable and structured (commands, environment, results, package identities); tooling/host unavailability is reported NOT_EXECUTED/BLOCKED, never converted to PASS.

## 8. Toolchain / gate evidence

- [ ] Root gates remain green on the exact candidate: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm ci:verify`.
- [ ] T018-specific audit/smoke execution results are durable and distinct from the root gates.
- [ ] Concern Validation PASS, if any, is distinct from Independent Review PASS.

## 9. Scope creep / leakage

- [ ] `.agent/execution/` remains evidence only and did not leak into the repo tree beyond its own directory or into any shipped package.
- [ ] No release announcement, download/distribution channel or store-submission action was taken as part of T018.
- [ ] Build outputs live only in git-ignored locations (`dist/`, `out/`); no binaries were committed.

## 10. Review disposition

A required Fresh Independent Review should PASS only when there are no unresolved P0/P1 findings against the exact candidate and no higher-authority contradiction. Any bounded repair creates a new exact subject requiring successor Validation/Review per ADS currentness rules.
