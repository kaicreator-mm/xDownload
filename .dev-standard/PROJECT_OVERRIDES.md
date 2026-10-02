# Project Overrides

## Project Identity

- Repository: `kaicreator-mm/xDownload`
- Product / Service: `xDownload`
- Standard revision: read `.dev-standard/VERSION`

## Structure Profile

- Repository profile: `other — planning-stage product repository; implementation structure not yet Architecture Frozen`
- Main modules: `docs/` only at current Stage 0/1 checkpoint
- Intentional deviations from `PROJECT_STRUCTURE.md`:
  - `Implementation layout is not yet established because L2 Architecture has not started.`

## Integration / GitHub Execution Profile

- Integration mode: `version-branch`
- Version integration branch pattern: `version/vX.Y.Z`
- Current Stage 1 working branch: `docs/product-baseline-2026-10-01` (temporary planning/evidence branch; not an implementation integration branch)
- Issue-based execution DAG: `enabled after Frozen Task DAG is materialized`
- Task Issue template/profile: `canonical pinned-standard task issue contract`
- Stacked PR policy: `allowed only for a real unmerged code-baseline dependency`

Rules:

- Initial release target version MUST be selected before the Version Branch Stage 1 checkpoint is created.
- PRD document versions (for example v0.4.1) MUST NOT be treated as product release versions.
- Frozen Task DAG remains the planning checkpoint; GitHub Issue Dependencies become the canonical live execution DAG after materialization.
- Task branches follow the pinned standard JIT branch rule.

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

## Validation Execution Profile

Current planning-stage state:

- Linux validation: `NOT_RUN — implementation/runtime not established before L2`
- Windows validation: `NOT_RUN — implementation/runtime not established before L2`
- macOS validation: `NOT_RUN — target platform matrix not Product/Architecture Frozen`
- Other real environment/device: `NOT_RUN — not yet defined`

Exact platform/runtime validation tuples will be defined by Frozen PRD/Architecture and downstream Task authority.

## CI Profile

- CI profile: `disabled`
- Disabled reason: `planning-stage repository; no implementation/toolchain exists yet`
- Exact-SHA clean-validation fallback: `NOT_RUN — implementation validation is not yet applicable to current Stage 0/1 planning artifacts; formal document Review remains exact-subject bound`

CI profile MUST be revisited before implementation tasks begin.

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
- Critical Journey: `NOT_RUN — product Critical Journeys exist conceptually but executable harness is not established`
- Hidden Validation: `NOT_RUN — implementation stage not reached`
- Production Build / Package: `NOT_RUN — implementation stage not reached`

## Runtime / Platform Requirements

- Supported OS/platform: `NOT_FROZEN — Product/Architecture decision pending`
- Required runtime/toolchain versions: `NOT_FROZEN`
- Required services: `NOT_FROZEN`
- Required SDK/device: `NOT_FROZEN`

## Project-specific Hard Boundaries

- `kaicreator-mm/ai-development-standard` pinned revision is the lifecycle/process authority.
- Chat discussion is not a durable project fact; material planning/review outputs must be checkpointed in GitHub.
- Stage 1 Product Freeze requires the ADS Stage 1 artifact set and current exact-subject required review PASS; reviewer agreement does not replace later executable Validation.
- No L2 Architecture work before PRD/Scope Freeze checkpoint.
- No Task DAG freeze before L2 Architecture Freeze.
- No implementation dispatch before Frozen Task DAG materialization and task Review Policy assignment.
- xDownload remains subject to its Frozen PRD product/security boundaries once Product Freeze occurs.

## Required Release Gates

Current Stage 0/1 does not define release gates beyond standard truthfulness. Release gates MUST be derived later from Frozen PRD / Frozen Architecture / Task authority / pinned standard; historical review notes do not create release gates by themselves.

## Ownership / Sensitive Areas

- Product/Scope docs → Stage 1 Product authority; required independent review before Product Freeze.
- Security/credential/browser-session boundaries → required independent review once implementation concerns exist.
- Public contracts/schema/migration/data integrity → required independent review when applicable.
