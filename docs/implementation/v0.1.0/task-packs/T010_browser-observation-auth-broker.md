# T010 — Browser observation, Native Messaging broker and scoped authorization

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Implement Browser Integration observation plus Native Messaging/local broker with opaque AuthorizationContextRef, exact origin/target/contract/snapshot/provenance binding, partition context where relevant, least authority and raw-secret containment.

## Authority / dependency
Frozen Product browser boundary + L2 ADR-005 and #8 evidence/limitations; exact dependency `T002`.

## Owned boundary
Extension observation/handoff, native host/broker, auth capability issue/use/revoke and browser-specific task tests.

## Forbidden scope
No unrestricted cookie/token export, no fallback around `allowed_origins`, no page/content privilege, no arbitrary navigation/crawl, no unsupported browser/OS claim.

## Acceptance / Validation
At least one applicable real browser/native-host tuple plus negative origin/target/snapshot/provenance/partition misuse, expiry, oversized messages, allowed_origins and secret-sink checks.

## Policy
`review:required`; `risk:critical`; L3 `required`; real-browser local Builder; freedom `F1_BOUNDED_IMPLEMENTATION`.

## Merge / routing
Target version branch; JIT after T002. Production vault/platform gaps remain explicit; architecture/security contradiction routes upward. Close with exact tested tuple.
