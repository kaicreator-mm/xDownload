# T004 — Core command/query authority boundary

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement the versioned local command/query authority seam through which Desktop, CLI and Browser adapters submit idempotent commands/observations and read projections; include strict input bounds and same-install/same-user peer authorization appropriate to the chosen transport.

## Authority / dependency
Frozen PRD/L2/ADS; exact dependency `T002`.

## Owned boundary
Core command/query server/client seam, wire compatibility, peer authentication/authorization, input validation and lifecycle-independent client behavior.

## Forbidden scope
No competing mutable authority, no unrestricted fallback IPC, no raw browser-secret export, no surface-owned budget/result state.

## Acceptance / Validation
Contract compatibility; malformed/oversized/unauthorized peer rejection; idempotent request IDs; restart/reconnect behavior; CLI/browser/Desktop can be clients without owning Core lifetime.

## Policy
`review:required` for public/security boundary; `risk:high`; L3 `required`; local Builder + strong security reasoning; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Transport choice may vary inside L2 but architecture change routes upward. Close with exact task tests and limitations.
