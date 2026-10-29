# AGENTS.md

This project follows the immutable `kaicreator-mm/ai-development-standard` revision recorded in `.dev-standard/VERSION`.

## Read order

1. Read `.dev-standard/VERSION`.
2. Read `.dev-standard/PROJECT_OVERRIDES.md`.
3. Read the pinned standard's `AGENTS.md`.
4. For lifecycle work, read `standards/DEVELOPMENT_WORKFLOW.md`.
5. For L2 architecture work or unresolved architecture assumptions, read the pinned L2 / Research Demo standards.
6. For Issue-based Task DAG and multi-agent execution, read the pinned GitHub interaction / execution standards.
7. For validation/release, read the pinned Validation and Release standards.

## Project rules

- GitHub durable facts are authoritative; chat history is not project state.
- Formal Stage/Task outputs that become downstream dependencies require remote checkpoints.
- Exact-SHA/current-subject binding is mandatory for formal Review/Validation evidence.
- Review is risk-based unless a higher authority explicitly requires it.
- Required Review never substitutes for required Validation.
- Frozen product or architecture semantics must not be changed to make implementation easier.
- Frozen Task DAG is the planning checkpoint; GitHub Issue Dependencies become the canonical live execution DAG when materialized.
- Never report an unexecuted required gate as PASS.
- Project-specific truth and boundaries live in `.dev-standard/PROJECT_OVERRIDES.md`; product and architecture facts live under `docs/`.
