# T021 — Browser/auth/security real-host Validation

Status `CANDIDATE / NOT FROZEN`; target `v0.1.0`.

## Goal
Independently validate exact T019 candidate Browser Integration, Native Messaging/broker and authorization boundary on every concrete browser/OS tuple claimed for release.

## Dependencies / boundary
Exact dependency `T019`; evidence-only, no code repair.

## Acceptance / Validation
Real browser/native host observation/handoff; `allowed_origins`; untrusted message bounds; origin/target/contract/snapshot/provenance and partition binding; auth expiry; cross-binding misuse rejection; raw-secret sentinel does not reach Core durable/log/Recipe/model sinks. Unsupported tuples remain unclaimed.

## Policy
`review:not-required`; `risk:critical`; L3 `not-required`; independent Browser/Platform Validator; freedom `F0_MECHANICAL`.

## Failure / closeout
Any failure routes to separate repair and successor exact-candidate validation. Close only with environment tuple, candidate SHA and PASS/FAIL/BLOCKED evidence; #8 research PASS is reference only.
