# Execution Contract — v022-U02-U04-BROWSER-POPUP-01

## Identity and exact baseline

- Task: xDownload #329
- Task Pack: `docs/implementation/v0.2.2/task-packs/V022-U02-U04_browser-popup-followup.md` blob `f5f0a98186c741667f860b9a5989dcfeb92bb923`
- Integration branch: `wip/v0.2.2-ui-rebuild-r0`
- Exact base: `9e3ccd382311619e60b8d2a7373e8a7d34733334`
- Base tree: `ba48b805697ad19c36a6eb3a5e54b6d601b36120`
- Task branch: `task/v0.2.2-u02-u04-browser-popup-followup`
- Allowed write set: the exact three paths in Task Pack #329, no others.
- Agent freedom: `F1_BOUNDED_IMPLEMENTATION`.

## Execution authority

This document is subordinate to Task Pack #329. It narrows the exact-base execution only and grants no authority by itself.

**No source mutation is permitted until a current accepted Builder `DISPATCH_CLAIMED` is durably recorded for #329.**

The pinned ADS v4.18.0 revision is `2c395c55569fe2edf3f4135f12d3d069e526d0b7`. Its canonical `schemas/dispatch.schema.json` requires `execution_profile` and accepts only `LOCAL_BUILDER`, `LOCAL_VALIDATOR`, `WEB_REVIEWER`, `PLATFORM_VALIDATOR`, and `CLOSURE_VALIDATOR`. It does not accept a `WEB_BUILDER` profile. A Web source Builder cannot truthfully be represented as `LOCAL_BUILDER` or `WEB_REVIEWER`.

Therefore dispatch admission is currently **BLOCKED** by the profile mismatch also tracked in ADS #1353. Do not fabricate an event, omit a required dispatch field, use a non-schema profile, or relabel the Web Builder as Local. This is a governance blocker, not a source defect. The Task Pack and this exact-base Execution Pack may be retained as preparation; no implementation execution starts until a conforming dispatch path is authorized under the pinned standard.

## Implementation constraints after lawful admission

1. Keep the form descriptor local, frozen and versioned; it is presentation metadata only.
2. Preserve existing DOM IDs, user-facing explanations and Worker message payloads.
3. Implement one single-flight polling controller shared by S6 and v0.2 status views. Bind each run to contract/lineage identity and generation.
4. Terminal state and final typed refusal are latched; stale generations and late responses are ignored.
5. Localize only the known Chrome missing-page-access diagnostic. Preserve exact raw diagnostic in technical details.
6. No permission requests, permission widening, manifest changes, service-worker changes or new Host/Core authority.
7. Stop and route upward if the implementation requires any path or contract outside the Task Pack write set.

## Completion boundary

A source PR may target only `wip/v0.2.2-ui-rebuild-r0`. Completion requires exact changed-path proof, Node24 syntax/Prettier before CI, focused tests, typecheck, aggregate CI, exact-HEAD Woodpecker and independent Exact-SHA review. Installed Windows/Chrome toolbar-action evidence remains a separate U06 validation result under #326.
