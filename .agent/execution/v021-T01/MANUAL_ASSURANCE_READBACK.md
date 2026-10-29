# T01 Manual Assurance Readback

schema: xdownload/manual-assurance-readback/v1

## Adoption and floor

- ADS pin: 4.18.0 at 2c395c55569fe2edf3f4135f12d3d069e526d0b7.
- Project adoption: A1_MANUAL_PROTOCOL.
- Assurance default: manual-minimum.
- Reducer and controllers: disabled.
- No Assurance Plan v2 instance or machine currentness binding is present in the repository at the frozen integration base. This Task therefore uses the project's declared manual-minimum path; it does not claim a machine assurance plan or reducer verdict.
- T01 risk is critical and independent Review is required. No assurance reduction is requested or applied.

## Exact current inputs

- Product/L2/DAG independent R2 subject: 07af78c3abee741196ff566a7f21fdfe15d71da7.
- Product/L2/DAG R2: PASS, P0/P1/P2 = 0/0/0.
- Frozen Task DAG blob: ecb2e31088c9e3895fad042401f737938c37628a.
- Frozen Task Pack blob: c0cbed29ffa1a47cad5aed288aa262dd0dd549a8.
- Task Issue: #250, T01, no native blocked_by predecessors.
- Native dependency readback: 22/22 Issues and 63/63 edges exact in both blocked_by and reciprocal blocking directions.
- Integration base: version/v0.2.1 and main both c29af4a4b89123997d03d5566ebe09ba83855fb0.
- Root toolchain: Node 24.21.0 and pnpm 12.8.1.

## Required assurance activities

1. Preserve the exact Task Pack write set: packages/domain-contracts/** and packages/core-seam/** only.
2. Do not write source before accepted DISPATCH_CLAIMED.
3. Run deterministic schema, malformed-input, unknown-field, legacy compatibility and cross-surface parity tests.
4. Bind test evidence to the exact source branch HEAD and Node/pnpm versions.
5. Obtain independent exact-SHA Review; report P0/P1/P2 and PASS/BLOCK.
6. Do not merge to main or claim release qualification from this Task.

## Current evidence posture

- Planning Product/L2/DAG review: PASS.
- Native dependency readback: PASS.
- Execution Pack: complete core inventory, subject to final readback.
- Source implementation: NOT_STARTED.
- Node24 task validation: NOT_RUN.
- CI: NO_RUN.
- Independent source Review: NOT_RUN.
- Main merge and release qualification: NOT_AUTHORIZED.

No missing test, local validation, source Review or CI evidence is inferred as PASS. Any stale/missing exact input blocks execution and requires re-read/rebind before continuing.
