# xDownload — ADS 4.18.0 scoped Project Overrides (Domain App research/PoC only)

> **Effective scope:** isolated `experiment/ads-v418-poc` line and its separately reviewed descendants only, once the exact change is approved and actually integrated there. This file is a **successor to the inherited stale Stage-2 v0.1 planning override** on this isolated branch. It is neither a retroactive rewrite of old v0.1 authority nor effective on `version/v0.1.0` / `main`.
>
> **Status:** DRAFT / independent review required — Issue #194. **ADS pin:** `.dev-standard/VERSION` = `4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7`. **PoC:** Issue #183. **Adoption:** #182, independent #192 R1 PASS on prior two-file pin, NOT this successor.

## 1. Project identity and actual inspected layout

- Repository: `kaicreator-mm/xDownload`; existing pnpm TypeScript monorepo.
- Immutable **inspection-only** initial source baseline: `version/v0.1.0@195355d03b847825ce5acf78c73e06f7386e11e2`. This is **not** a v0.1 release qualification or authorized v0.2 code baseline.
- Root `package.json` inspected at baseline: `private: true`, ESM, `engines.node: "24.21.0"`, `packageManager: "pnpm@12.8.1"`. It already declares `build`, `smoke`, `format:check`, `lint`, `typecheck`, `test:unit`, `ci:verify`. These are a **declared source profile**, not evidence that a particular machine ran or passed.
- Existing code sources include `apps/cli`, `apps/browser-extension`, `packages/domain-contracts`, `packages/core-runtime`, `packages/core-scheduler`, `packages/persistence-ledger`, `packages/direct-acquisition`, `packages/hls-vod-adapter` and others. Root `pnpm-workspace.yaml` covers `packages/*`. The inherited "docs-only, no production workspace" text was **historically true for an earlier stage** but is NOT the currently inspected repository layout.
- Existing root `pnpm-lock.yaml` is canonical for the inspected baseline. Do not create a second lockfile, silently upgrade dependencies, or rewrite v0.1 evidence for the PoC.

## 2. Branch/version and authority boundary

| Concern | Current disposition |
| --- | --- |
| v0.1 Product/L2/DAG/Claims/Release | **HISTORICAL_ONLY**: bound to ADS 4.0.0 at `94cad2b0487e8a552c66d6bcd1cba36b7779383d`; exact frozen source and authorized execution history must be read on their own branch |
| This future-only ADS 4.18 research adoption | **SCOPED**: only the isolated branch where `.dev-standard/VERSION` and this override are independently accepted |
| PoC research #183 | **PLANNED_NOT_DISPATCHED**: public DomainHarness v0.10.3 selected K/S/B/C, build/Host/DirectHttpAdapter and Node24 proof NOT_RUN |
| xDownload v0.2 Product/L2/Scaffold/DAG | **CANDIDATE_ONLY**: separate planning #188 / Draft PR #190, no Freeze or source-first Scaffold Claim |
| Future `version/v0.2.0` | **NOT_CREATED/NOT_QUALIFIED**: must choose actual post-v0.1 integration base, adopt a qualified pin and independently approve an effective successor override |
| Native Task blocked_by and `DISPATCH_CLAIMED` | **NOT_PROVEN**: neither Issue text nor workflow labels nor static DAG are legal substitutes |

- Integration mode for future substantial version: **version branch with JIT Task branches**, only when version baseline, Product/L2/DAG authority and native dependencies are qualified.
- Research mode here: isolated spike/demo branch, protected source only under a lawful existing Issue + accepted current serialized Claim and exact write scope. A **draft PR and a review PASS on this override are NOT Claim/dispatch**.
- GitHub Issue + accepted event history is the durable work source; chat triggers carry only repo/Issue/role pointers.
- No automatic `main`, `version/v0.1.0`, release tag or publication integration.

## 3. ADS v4.18 role and review profile

- `v4.adoption_level=A1_MANUAL_PROTOCOL`. No unsupported reducer/interchange/controller implementation is presumed active.
- `v4.compatibility_mode=native-v4` for **new admitted work only**. No migration/reinterpretation of historical v0.1 event-v2 / old stage state.
- New structured events use applicable ADS `ai-dev:event:v2` writer/role/operator attribution when emitted. A single connected GitHub transport user is not proof of an independent logical Reviewer. Actual session/reviewer identity must be recorded in accepted evidence.
- Review policy is **risk-based and uniquely selected before dispatch**. Required for public DomainHarness ABI, network/Host/permission, durable budget/journal, migration and material effective admission rules. Recommended or not-required only where qualified policy permits, never as a waiver of physical Validation.
- No code/source write without the current exact integration base, lawful Issue/Task Pack, native dependencies readback where material, validated JIT `DISPATCH_CLAIMED`, exclusive write set and admissible effect boundary.
- If this stack cannot create/read the native dependency or accepted Claim, record `NATIVE_DAG_NOT_PROVEN` / `CLAIM_NOT_PROVEN` and **HOLD**; use a narrowly authorized local controller handoff rather than a Markdown substitute.

## 4. CI, tests, build host and platform evidence

- Source-available project command: `pnpm run ci:verify` → format check, lint, typecheck and unit tests per actual root scripts. A command's existence is **not** an observed successful run.
- Independent ADS #192 R1 verified 3 success-labelled GitHub check runs at experiment PR #185 exact source. That evidence establishes only the checks' **declared subject and recorded success**, not an unqualified general CI backend, fresh SDK consumer, accepted source Scaffold or an actual Windows installed path.
- CI provider/runner topology for new v0.2/PoC execution: **inspect current checked-in workflow and authoritative job receipt first**; cannot infer universal GitHub Actions vs external Woodpecker from old text or an individual check. Retry infrastructure faults on a fresh trace when appropriate, without turning unexecuted test cases into PASS.
- Real local/build environment for PoC: **Node >=24** supported upstream; actual xDownload inspected root pins `24.21.0`. Use a host satisfying **both actual constraints**, with a clean public DomainHarness **v0.10.3** candidate package build/pack/consumer, actual Node version, OS, package byte SHA256, commands and exit codes. No v0.10.2 compatibility fallback.
- Windows browser/native Host, filesystem/SQLite effects, external network/source authorization and release claims: `NOT_RUN` / `UNKNOWN` until the actual protected environment and artifact identity prove them. Unit CI cannot substitute.
- No environment secret/paid model is needed for the deterministic minimum PoC. No automatic network, installation script execution, arbitrary external fetch or permission elevation merely from an SDK manifest.

## 5. Source ownership / deployment and failure handling

- User intent, target/member set, file destination, browser session/authorization, receipt and final digest remain scope-bound; no model, Recipe or Host can grant new effect permissions.
- The prospective new Domain App's selected **K** owns new-lineage admission, Permit, business journal, recovery and UNKNOWN; legacy Core owns old-lineage work until independently qualified partition or migration. Physical Host/SQLite and transfer budget are **not** a second app business authority.
- Source-only PoC development, when separately admitted under #183: bounded under `experiments/domain-app-download/**` plus sanitized research result artifact, as governed by Issue #183 and linked handoff. `apps/**`, `packages/**`, root manifests/lock and v0.1/main remain read-only without an explicit new authority.
- If public SDK, Native Issue Graph, Claim, legal Host boundary, budget/permit identity, or shipped baseline is unknown/conflicting, mark gate `BLOCKED`/`NOT_RUN`, stop affected execution and route to its actual owner. Avoid speculative new security/Host abstractions.
- Do not reuse this experiment's v0.10.3 candidate SDK hashes as final release package identity. Re-pin the real final SDK and requalify downstream compatibility in the future version.

## 6. Required gates and current state

```ini
SCOPED_ADS_PIN=4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
PARENT_ADOPTION_R1_192=PASS_RESEARCH_ONLY
THIS_OVERRIDE_INDEPENDENT_REVIEW=NOT_RUN
EFFECTIVE_MERGE_TO_EXPERIMENT=NOT_AUTHORIZED
POC_183_SOURCE=NOT_STARTED
POC_183_NODE24_REAL_SDK_HOST=NOT_RUN
POC_183_INDEPENDENT_VERDICT=NOT_RUN
V02_PRODUCT_FREEZE=NO
V02_L2_FREEZE=NO
V02_SCAFFOLD_ACCEPTED=NO
V02_NATIVE_TASK_DAG=NOT_MATERIALIZED
V01_RELEASE_IMPACT=NONE
```

Version-level Candidate Freeze, Hidden, Version Closure, independent Release Qualification and authorized Repository Integration remain completely separate ADS authorities. No planning/PoC/CI result implies their PASS.
