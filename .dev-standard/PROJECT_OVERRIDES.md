# Project Overrides

## Project Identity

- Repository: `kaicreator-mm/xDownload`
- Product / Service: `xDownload`
- Standard revision: read `.dev-standard/VERSION`

## Structure Profile

- Repository profile: `other — Stage 2.4 planning checkpoint; Product/Scope FROZEN; Architecture FROZEN; Task DAG CANDIDATE / NOT FROZEN`
- Main modules: `docs/` only at the current Stage 2.4 planning checkpoint
- Intentional deviations from `PROJECT_STRUCTURE.md`:
  - `Production implementation layout is not yet established. T001 may establish the implementation monorepo/toolchain only after Task DAG review/freeze/materialization makes implementation executable.`

## Integration / GitHub Execution Profile

- Integration mode: `version-branch`
- Version integration branch pattern: `version/vX.Y.Z`
- Current integration/checkpoint branch: `version/v0.1.0` (`Product/Scope FROZEN`; `Architecture FROZEN`; Task DAG candidate exists but is NOT FROZEN)
- Prior Stage 1 planning/evidence branch: `docs/product-baseline-2026-10-01`
- Issue-based execution DAG: `disabled until the Task DAG candidate receives required independent review, is separately Frozen, and Stage 2.5 materialization is authorized`
- Task Issue template/profile: `canonical pinned-standard task issue contract`
- Stacked PR policy: `allowed only for a real unmerged code-baseline dependency`

Rules:

- Initial release target version MUST be selected before the Version Branch Stage 1 checkpoint is created.
- PRD document versions (for example v0.4.1) MUST NOT be treated as product release versions.
- The current `docs/implementation/v0.1.0/TASK_DAG.md` is a candidate planning checkpoint and MUST NOT be treated as Frozen or as live execution state.
- After future Task DAG Freeze/materialization, the Frozen Task DAG remains the planning/history checkpoint and GitHub Issue Dependencies become the canonical live execution DAG.
- Task branches follow the pinned standard JIT branch rule and are not created before dependency readiness/current integration identity except for a real stacked-code dependency.

## v4 Adoption / Compatibility Profile

- `v4.adoption_level`: `A1_MANUAL_PROTOCOL`
- `v4.compatibility_mode`: `native-v4`
- `v4.assurance.default`: `manual-minimum`
- `v4.model_diversity.default_basis`: `none by default; explicit Stage/Task authority may require provider/model-diverse assurance`
- `v4.interchange`: `disabled`
- `v4.reducer`: `disabled`
- `v4.controllers`: `disabled`
- `v4.fast_path`: `canonical, but initial product development is substantial and uses version-branch mode`

No adoption choice may weaken exact-subject Review/Validation, Candidate Freeze, Release Qualification or Repository Integration truth.

## Agent / Operator Attribution Profile

- Event schema for new structured events: `ai-dev:event:v2`
- Operator ID convention: `<kind>:<project-local-id>`
- ChatGPT Web examples: `chatgpt-web:product-a`, `chatgpt-web:review-a`
- Local Agent examples: `codex:ubuntu-build-01`, `claude-code:windows-01`
- Session reference convention: `non-secret session/run alias`
- Transport actor convention: `github:<account>`
- Role claim policy: `ROLE_CLAIMED/ROLE_RELEASED for substantial concurrent work when useful`

Required independent review must be attributable to an independent reviewer context even if the same GitHub transport account is used.

## Independent Review Profile

- Review profile: `risk-based`
- Default Task Review Policy: `recommended`
- Required triggers: `security/auth/authorization; public API/schema/migration semantics; cross-service contracts; concurrency/data integrity; destructive/recovery behavior; high-blast-radius integration; explicit release blocker; Frozen Stage authority requiring review`
- Not-required examples: `mechanical/generated docs-only changes when no higher authority requires review`
- Allowed reviewer sources: `fresh ChatGPT session; Claude; Codex/other independent reviewer; human`
- Exact-SHA re-review policy: `pinned standard default`

For Stage 1 Product Freeze of the initial xDownload product definition, independent adversarial product review is REQUIRED by project authority until a current exact-subject PASS is obtained.

For the initial Stage 2.4 v0.1.0 Task DAG candidate, Fresh Independent Task DAG Review is **REQUIRED** before a separate Task DAG Freeze/materialization step. The Planning Builder MUST NOT self-review.

## Validation Execution Profile

Current Stage 2.4 planning state:

- Linux validation: `NOT_RUN — production implementation/runtime not established`
- Windows validation: `NOT_RUN — production implementation/runtime not established`
- macOS validation: `NOT_RUN — concrete release-claimed production platform tuple not established`
- Other real environment/device: `NOT_RUN — not yet qualified`
- Planned version-level visible Validation ownership after implementation/candidate stabilization: `T020 core recovery/data integrity; T021 browser/auth/security; T022 Product gates/Critical Journeys; T023 package/platform qualification`
- Candidate Freeze / Hidden Validation / Closure / Release Qualification ownership: `T024 / T025 / T026 / T027`, all currently `NOT_RUN`

Exact platform/runtime validation tuples remain downstream of actual implementation/package choices and Frozen Product/Architecture boundaries.

## CI Profile

- CI profile: `disabled`
- Disabled reason: `planning-stage repository; implementation/toolchain has not yet been established`
- Planned activation owner after authorized implementation dispatch: `T001 Repository/toolchain bootstrap + CI activation`
- Exact-SHA clean-validation fallback: `NOT_RUN — implementation validation is not yet applicable to current planning artifacts; formal document Review remains exact-subject bound`

CI profile MUST be revisited by T001 before dependent implementation tasks begin.

## CI Execution Profile

- CI provider: `NOT_APPLICABLE — planning stage only`
- CI backend / execution model: `NOT_APPLICABLE — planning stage only`
- CI runner role: `NOT_APPLICABLE — planning stage only`
- Workflow config: `NOT_APPLICABLE — planning stage only`
- Workflow config source: `NOT_APPLICABLE — planning stage only`
- Execution shell / entrypoint model: `NOT_APPLICABLE — planning stage only`
- Runtime source: `NOT_APPLICABLE — planning stage only`
- Clone / checkout model: `NOT_APPLICABLE — planning stage only`
- Partial clone policy: `NOT_APPLICABLE — planning stage only`
- Submodule policy: `NOT_APPLICABLE — planning stage only`
- Git LFS policy: `NOT_APPLICABLE — planning stage only`
- Fresh-run / rerun policy: `new exact subject requires new applicable Review/Validation evidence`

## Required Commands

- Bootstrap: `NOT_RUN — implementation/toolchain not established`
- Format: `NOT_RUN — implementation/toolchain not established`
- Lint: `NOT_RUN — implementation/toolchain not established`
- Typecheck: `NOT_RUN — implementation/toolchain not established`
- Unit: `NOT_RUN — implementation/toolchain not established`
- Contract: `NOT_RUN — implementation/toolchain not established`
- Integration: `NOT_RUN — implementation/toolchain not established`
- Critical Journey: `NOT_RUN — executable harness planned by T003; exact-candidate execution owned by T022`
- Hidden Validation: `NOT_RUN — downstream T025 only after Candidate Freeze`
- Production Build / Package: `NOT_RUN — implementation stage not reached; planned T018/T023`

## Runtime / Platform Requirements

- Supported OS/platform: `NOT_QUALIFIED — Frozen Architecture intentionally leaves concrete release matrix replaceable until downstream implementation and exact platform Validation`
- Required runtime/toolchain versions: `NOT_SELECTED/NOT_QUALIFIED — downstream T001/T018 subject to Frozen Architecture`
- Required services: `local product architecture only; exact implementation dependencies not yet established`
- Required SDK/device/browser tuple: `NOT_QUALIFIED`

## Project-specific Hard Boundaries

- `kaicreator-mm/ai-development-standard` pinned revision is the lifecycle/process authority.
- Chat discussion is not a durable project fact; material planning/review outputs must be checkpointed in GitHub.
- Stage 1 Product Freeze requires the ADS Stage 1 artifact set and current exact-subject required review PASS; reviewer agreement does not replace later executable Validation.
- No L2 Architecture work before PRD/Scope Freeze checkpoint.
- No Task DAG freeze before L2 Architecture Freeze.
- The current Stage 2.4 Task DAG/Task Packs are `CANDIDATE / NOT FROZEN`; no Task Issue/Issue Dependency materialization is authorized by their existence.
- No implementation dispatch before Frozen Task DAG materialization and task Review Policy assignment.
- xDownload remains subject to its Frozen PRD product/security boundaries once Product Freeze occurs.
- Frozen Architecture Facts/Decisions may change only through the formal ADS Architecture Amendment / newly discovered material UNKNOWN process.
- Task/PR Review or Validation PASS does not imply Candidate Freeze, Version Closure, Release Qualification or Release PASS.

## Required Release Gates

The Stage 2.4 Task DAG candidate plans the downstream authority chain without claiming any result:

- `T020` Core crash/restart/data-integrity Validation — `NOT_RUN`
- `T021` Browser/auth/security real-host Validation — `NOT_RUN`
- `T022` Product gates + Critical Journey Validation — `NOT_RUN`
- `T023` Package/platform qualification Validation — `NOT_RUN`
- `T024` Candidate Freeze — `NOT_RUN`
- `T025` Hidden Validation — `NOT_RUN`
- `T026` Version Closure — `NOT_RUN`
- `T027` Release Qualification — `NOT_RUN`
- `T028` Version PR/release-baseline integration — `NOT_STARTED`

Actual release qualification remains governed by Frozen Product/Architecture and pinned ADS exact-subject evidence rules.

## Ownership / Sensitive Areas

- Product/Scope docs → Stage 1 Product authority; required independent review before Product Freeze.
- Frozen Architecture → Stage 2 Architecture authority; changes require the formal amendment/new-material-UNKNOWN path.
- Stage 2.4 Task DAG candidate → required Fresh Independent Task DAG Review before separate Freeze/materialization.
- Security/credential/browser-session boundaries → required independent review when implementation concerns exist.
- Public contracts/schema/migration/data integrity → required independent review when applicable.
