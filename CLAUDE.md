# CLAUDE.md

Read `AGENTS.md` first and follow the immutable development-standard revision recorded in `.dev-standard/VERSION`.

Claude-specific guidance belongs here only when it is truly tool-specific. Do not duplicate PRD, architecture, repository rules, test commands or release gates that already exist in `AGENTS.md`, `.dev-standard/PROJECT_OVERRIDES.md` or `docs/`.

Before implementation:

1. identify the frozen scope / Task;
2. read affected contracts/tests before editing implementation;
3. use the project commands from `.dev-standard/PROJECT_OVERRIDES.md`;
4. preserve unrelated user changes;
5. record PASS / FAIL / NOT_RUN / NOT_APPLICABLE / BLOCKED truthfully.
