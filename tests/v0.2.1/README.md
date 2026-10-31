# xDownload v0.2.1 controlled validation fixtures

This directory is the version-scoped fixture registry for T11. It consolidates existing scenario evidence and provides reusable, deterministic direct/HLS loopback fixtures plus real temporary-filesystem materialization helpers.

## Evidence classes

- REAL_LOOPBACK_NETWORK: a real local HTTP listener and real HTTP client are used; this is not public-network or installed-user-network evidence.
- REAL_TEMP_FILESYSTEM: a real temporary directory is written, renamed, read back and cleaned up.
- INJECTED_FAILURE_FAKE: a deterministic injected error such as permission-denied/disk-full simulation; it is explicitly fake and cannot satisfy a real OS/installed gate.
- PURE_CONTRACT: a decoder/policy/redaction assertion with no external effect.

The corpus points to existing tests for restart, cancellation, duplicate, changed-validator, path, Host mismatch, corrupt output, owner conflict and redaction. The registry is not a claim that those tests have passed in this turn; each exact-source verification run must record its own result.

## Run

Node 24.21.0 and pnpm 12.8.1:

- Scoped harness: node --test tests/v0.2.1/controlled-fixtures.test.ts
- Root unit suite: pnpm run ci:verify

All network fixtures bind only to 127.0.0.1. All file fixtures use unique temporary directories. No fixture uses credentials, public internet, real user directories or browser profiles.

## Gate distinction

These fixtures support T03/T06/T14/T15/T16 validation. They do not prove installed Windows Host, packaged Electron, browser, production network, or user G0/G1. Injected permission/disk-full failures remain fake unless a designated installed gate supplies real OS evidence.
