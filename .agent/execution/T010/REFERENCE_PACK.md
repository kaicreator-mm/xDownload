# T010 L3 Reference Pack — browser observation, Native Messaging broker and scoped authorization

Task: `T010` / Issue `#29`  
Bound base: `version/v0.1.0@c813d3a1f2afea7bd3f99de1d01321904f5fbdd5`  
Evidence order: **Tests → Contract/Interface → Core Implementation → Failure Handling → Examples/Docs**.

This pack is implementation evidence/guidance only. Frozen Product/L2/Task Pack remain authority. It does not select a framework or redefine the security boundary.

## 1. Tests — highest priority references

### 1.1 Existing repository runner

Primary exact-base test mechanism: `vitest@4.1.11`, already pinned in root `package.json`, with `vitest.config.ts` discovering `packages/*/test/**/*.test.ts`.

Use table-driven binding matrices so each legal and illegal (origin, target, contract, snapshot, provenance, partition) combination has a stable oracle identity. Keep positive and negative cases adjacent. Secret-sink audits are sentinel-based tests: plant a fake sentinel "secret", assert it never appears in any exit sink.

**Patterns to emulate:**

- `test.each` binding matrices: same-tuple accepts, each-single-field-mismatch rejects;
- expiry/revocation tests driven by injectable time/clock seams so tests stay deterministic;
- message-gate tests from `unknown` bytes/objects with size-limit fixtures (oversized, truncated, unknown authoritative fields);
- negative fallback-path tests: force Native Messaging rejection and assert no alternate IPC path is even reachable;
- capability-reuse tests across contract/snapshot successor identities;
- one end-to-end harness run on the real browser/native-host tuple with the tuple identity recorded in test output/evidence.

Primary reference: Vitest source/docs at exact tag `v4.1.11`: `https://github.com/vitest-dev/vitest/tree/v4.1.11`. License fact: MIT at that tag; already selected by T001.

### 1.2 Real-tuple harness without framework overcommit

The real-tuple harness is task evidence, not a product framework. Prefer:

- a controlled local auth origin and fixture page(s) served locally;
- a driven Chromium profile loading the unpacked extension (CLI flag launch is acceptable F1 mechanics);
- native-host registration via the documented per-OS manifest key for the tested OS only;
- recorded cleanup so the harness does not leak global browser/host state.

Do not build a cross-browser/cross-OS abstraction "for later" — L2 ADR-012 keeps that matrix replaceable and L2 explicitly does not prove Firefox/Safari or Windows/macOS.

## 2. Contract / interface references

### 2.1 Canonical contracts already on the base

`packages/domain-contracts` (T002) is the only canonical vocabulary:

- opaque `AuthorizationContextRef` — branded identity (`src/ids.ts`), already the contract/snapshot field type; the broker must issue/validate refs compatible with it, never invent a second ref vocabulary;
- `contract.ts` / `snapshot.ts` — immutable requested scope, successor-identity rules the auth path must respect;
- `decode.ts` / `diagnostics.ts` — fail-closed decode pattern to mirror at the message gate;
- `ports.ts` — `DomainGateway`/`SurfaceCommand`/terminal projection seam for handoff without transferring mutable authority.

### 2.2 Platform interface references (primary, static)

- Chrome Extensions — Native Messaging (manifest `allowed_origins` key, host manifest, message framing: 4-byte native-order length + UTF-8 JSON): `https://developer.chrome.com/docs/apps/nativeMessaging` (and current `developer.chrome.com/docs/extensions/develop/concepts/native-messaging`).
- MV3 service worker / messaging / permissions model: `https://developer.chrome.com/docs/extensions/`.
- `webRequest` observation and `cookies`/partition context: official extension API references for the tested Chromium version.

These are interface/design references only; no Chromium source or doc text is copied into product source. Chromium itself is the platform dependency, not an npm dependency — its exact tested version must be recorded, not pinned in `package.json`.

## 3. Core implementation patterns worth reusing conceptually

### 3.1 Gate before privilege

```text
untrusted page/content or native message
→ schema + size decode (fail closed)
→ provenance extraction (tab/frame/origin/request)
→ binding check against capability tuple
→ privileged action or typed rejection
```

The T002 `decode.ts` flow is the pattern to mirror; never let raw input cross into privileged code first.

### 3.2 Capability as binding record, secret as zone-local state

Broker-side capability = exact (origin, target, contract, snapshot, provenance[, partition]) + expiry + revocation state + one opaque `AuthorizationContextRef` it maps to. Raw session material, if held at all, stays in the browser/broker secret zone and is never serialized into the capability record, canonical task state, logs or handoff payloads.

### 3.3 Truthful lifecycle over convenience

Expiry/revocation must be observable as `AUTH_REQUIRED`/`AUTH_FAILED` outcomes (PRD §16.5). Auto-re-issue on expiry is the classic false-success trap; make re-issue an explicit, separately invoked decision, never an internal recovery step.

### 3.4 `allowed_origins` is a second, independent lock

Treat Chromium's `allowed_origins` enforcement as an independent platform boundary (L2 invariant 14): the broker's own checks are necessary but never a replacement, and there is no code path that reaches the host except through Native Messaging from an allow-listed origin.

## 4. Failure handling patterns

Fail closed at every boundary.

- Malformed/oversized message → typed rejection before privilege; preserve safe diagnostics without echoing secret material.
- Binding mismatch → reject; never "nearest match" or partial acceptance.
- Expired/revoked → truthful auth-failure semantics; no silent widening.
- Native Messaging unavailable/rejected → fail the task path; no fallback transport exists by design.
- Environment lacks real Chromium/host → `state:blocked` with durable evidence; no simulated tuple substitution.
- Task Pack wrong/incomplete → `TASK_PACK_DEFECT`; Frozen L2 conflict → `ARCHITECTURE_CONTRADICTION`; pack mis-bound → `EXECUTION_PACK_INVALID`; unexecutable gate → `VALIDATION_NOT_EXECUTED`, never PASS.

## 5. Examples / docs mapping to T010 acceptance

| Acceptance concern | Reference pattern | Required T010 proof |
| --- | --- | --- |
| Real tuple | L2 Research Demo #8 tuple discipline (Chromium 144/Linux recorded exactly) | at least one applicable tuple executed; exact identity recorded; no untested-tuple claims |
| Observation provenance | L2 §6.4 bind observation to tab/frame/origin/request | provenance carried on every observation; unprovenanced input cannot reach privilege |
| Opaque scoped auth | L2 ADR-005/invariant 12; `packages/domain-contracts` `AuthorizationContextRef` | issue/use/revoke/expiry with opaque ref only; no raw-secret canonical state |
| Exact binding | L2 invariant 13; PRD §17 R02 | binding matrix suite; auth never rewrites requested_scope (C10) |
| `allowed_origins` | L2 invariant 14; Chrome Native Messaging docs | allow-list enforcement + no-fallback tests |
| Secret containment | L2 §12 sentinel evidence pattern; PRD §29 | sentinel non-propagation across tested sinks |
| Truthful expiry | PRD §16.5 AUTH_REQUIRED/AUTH_FAILED; C24 | expiry/revocation suite produces the exact truth tuple |
| Redirect provenance | C29 | declared-CDN transition accepted; unrelated redirect rejected |
| Untrusted message gate | L2 §6.4 schema/size bounds before privilege | oversized/malformed/unknown-field rejection suite |

## 6. Dependency/version/license facts

| Component | Exact version on bound base | License | T010 role |
| --- | ---: | --- | --- |
| `typescript` | `5.9.3` | Apache-2.0 | already pinned; extension/broker TS sources |
| `vitest` | `4.1.11` | MIT | already pinned; unit/negative/binding tests |
| Node.js | `24.21.0` (fnm) | MIT-style | existing runtime; native host may use a different recorded runtime |
| Chromium | recorded at test time (L2 evidence tuple: `144.0.7559.96`) | Chromium license | platform under test, not a package dependency |

**No new runtime dependency is recommended or pinned by this Reference Pack.** A native-host implementation language/runtime is an F1 choice (L2 demo evidence used Python 3.13.5); if a package/runtime is added, record exact name/version/license/provenance and verify it does not become de facto security authority. This keeps library choice from becoming an architectural decision.

## 7. Do / Don't

### Do

- keep raw secrets zone-local; expose only opaque refs;
- bind every privileged use to the exact tuple and partition context;
- make expiry/revocation observable and truthful;
- treat `allowed_origins` as independent authority;
- gate every untrusted message on schema and size;
- test the negative matrix on the real tuple and record the tuple identity;
- reuse T002 canonical identities rather than inventing parallel vocabularies.

### Don't

- don't export cookies/tokens as ordinary data to Core/logs/evidence/Recipe/model;
- don't add any unrestricted IPC fallback around Native Messaging;
- don't grant content scripts privileged reach;
- don't implement arbitrary navigation/crawl or page-privilege features;
- don't claim Firefox/Safari or Windows/macOS support from a Chromium/Linux run;
- don't auto-re-issue expired capabilities;
- don't build the integrated Core runtime or collection workflows here (T015/T016);
- don't copy Chromium source/docs text or L2 research fixtures wholesale into production code.

## 8. Reuse / license risk

Risk is low if platform docs are used as interface reference only and no substantial third-party source is copied. The L2 research branch (demo #8) is evidence/reference: promote its validated invariants and limitations; do not merge its fixtures into production. Any new dependency is consumed under its own license with exact provenance recorded in the implementation PR.

## 9. Validation boundary

This Reference Pack does not prove T010. The later Builder produces an exact candidate; T010 concern Validation must execute the real-tuple and negative matrix on that exact candidate; Fresh Independent Review is separately required because the browser/security/auth boundary task is `risk:critical` and `review:required`.
