# VALIDATION_BROWSER_R1 — v0.2.0 T15 browser surface validation

- Task: xDownload v0.2.0 freeze T15 (validation-browser), Issue #215
- Validator: `operator_id=zcode:xd-v02-t15-validator-agent`
- Workstation: `xd-v02-t15-validator`, branch `task/v02-t15`
- Candidate under validation: `7fa7210` (`7fa721053aeb2c48ce7b1c150ef71ea94e15e09d`, verified `git rev-parse HEAD` == candidate)
- Date: 2026-10-29
- Write-set discipline: this document only; no source, no tests, no packaging changes were made.

## Verdict (layered)

| Layer | Verdict |
| --- | --- |
| SOURCE_LEVEL (T08 bounded-authorization surface, static + pure-function) | **PASS** |
| INSTALLED_SESSION (real Windows/Chromium trusted browser session) | **BLOCKED** (prerequisites absent; NOT proven, not mocked — see §3) |

Overall R1 conclusion: the candidate's browser-lane authorization surface is correct at source level and its fail-closed negatives are real, tested code; an installed real-browser session **cannot be executed on this candidate** because no transport is wired to the surface and no installable artifact / Windows pipe manifest exists. The gap list in §3.4 is the input for T18.

All paths below are repo-relative to the candidate `7fa7210`.

## 1. T08 suite re-run (real exit, candidate HEAD)

Command (workstation root, node `v24.21.0`):

```text
node --experimental-transform-types --test apps/browser-extension/src/domain-app/domain-app.test.ts
```

Result: **EXIT=0** — `tests 22 / suites 6 / pass 22 / fail 0 / cancelled 0 / skipped 0` (`duration_ms 237.12`). Full output retained in the validation transcript (`_tmp/t15-browser-test.log` outside the repo; counts quoted verbatim above).

The test file's own header declares the honest scope boundary this document keeps:
`apps/browser-extension/src/domain-app/domain-app.test.ts:6-7` — "The real Windows browser/native session proof is explicitly T15 validation and is NOT exercised here (NOT_RUN in this lane)."

## 2. SOURCE_LEVEL — static confinement review (evidence grade)

### 2.1 Payload field whitelist (no browser context can reach the payload)

- The whitelist is a frozen `as const` tuple of exactly the 9 canonical T01 confirmed-intent fields: `apps/browser-extension/src/domain-app/authorization-request.ts:39-49` (`requestId, lineageId, targetRef, outputRootScope, allowedOperation, slice, digestAnchor, declaredBytes, caller`).
- `buildAuthorizationPayload` (`authorization-request.ts:92-109`) copies each field **explicitly, one by one**; there is no spread of the action object and no generic key copy. The only conditional spreads are of the two validated optional fields themselves (`authorization-request.ts:103-104`), and the `caller` block is rebuilt field-by-field (`authorization-request.ts:105-106`), so an unknown key attached to the action at runtime cannot propagate.
- The input type is a closed interface with no cookies/tabs/history/page fields at all: `authorization-request.ts:57-72` (`BrowserAuthorizationAction`); identity comes from extension infrastructure, never page data (`authorization-request.ts:78-81`).
- Output is deep-frozen: `authorization-request.ts:108`; the gate re-freezes the decoded intent: `authorization-gate.ts:36`.
- **Zero-execution negative**: the constructor never executes chrome/DOM code — grep for `chrome\.|document\.|window\.|navigator\.|localStorage` over `apps/browser-extension/src/domain-app/*.ts` matches **only documentation-comment lines** stating "no chrome.* API, no DOM" (`authorization-gate.ts:14`, `authorization-request.ts:24`, `native-host-seam.ts:24`); zero executable references.

### 2.2 Gate = canonical T01 decoder, verbatim refusal pass-through

- `gateConfirmedAuthorization` (`authorization-gate.ts:31-37`) delegates entirely to the canonical T01 `validateConfirmedIntent` (`packages/download-domain-app/src/contracts/index.ts`); refusal returns `authorized:false` with the T01 diagnostics **unchanged** (`authorization-gate.ts:33-35`); the header commits to never re-writing, swallowing or downgrading a refusal reason (`authorization-gate.ts:11-12`).
- Test mapping: raw-URL `targetRef` → `LOCATOR_SUBSTITUTION_REJECTED` (`domain-app.test.ts:153-162`); unknown field → `SCOPE_WIDENING_REFUSED` at `extraScope` (`domain-app.test.ts:143-151`); verbatim code/path pass-through for `MALFORMED_REQUIRED_FIELD`/`slice` (`domain-app.test.ts:164-171`); stripped required field → `MISSING_REQUIRED_FIELD`/`targetRef` (`domain-app.test.ts:198-207`); non-object candidates refused (`domain-app.test.ts:209-213`).

### 2.3 Fail-closed seam branches — exhaustive enumeration (file:line)

Request construction (`apps/browser-extension/src/domain-app/native-host-seam.ts`):

| Branch | Location | Behavior |
| --- | --- | --- |
| requestId rejected by seam id rules | `native-host-seam.ts:77-80` | `{ok:false, reason}` — no frame produced |
| installId rejected | `native-host-seam.ts:81-84` | fail closed |
| userId rejected | `native-host-seam.ts:85-88` | fail closed |
| envelope fixed to one command type / fixed surface | `native-host-seam.ts:47-50` | `SUBMIT_CONTRACT` / `BROWSER_EXTENSION` (typed `CommandType`, out-of-vocabulary drift is a compile error) |

Response evaluation (`native-host-seam.ts:150-199`) — every branch below refuses:

| Refusal code | Location | Trigger |
| --- | --- | --- |
| `HOST_RESPONSE_ABSENT` | `native-host-seam.ts:154-159` | `undefined`/`null` answer — absence is a refusal, never an implicit pass |
| `HOST_RESPONSE_MALFORMED` | `native-host-seam.ts:160-168` | `decodeSeamResponse` refuses (incl. unsupported seam major — verified by test with a `2.0.0` schemaIdentity) |
| `HOST_RESPONSE_UNBOUND` | `native-host-seam.ts:170-175` | `inReplyTo` ≠ this request's `requestId` |
| `HOST_CHECK_REJECTED` | `native-host-seam.ts:176-178` | explicit `REJECTED`; host diagnostics pass through verbatim |
| `HOST_OUTCOME_UNEXPECTED` | `native-host-seam.ts:179-184` | any non-ACCEPTED outcome on a command frame (e.g. PROJECTION) |
| `HOST_RESPONSE_MALFORMED` (2nd site) | `native-host-seam.ts:185-191` | ACCEPTED without a well-formed acceptance record |
| `HOST_RESPONSE_UNBOUND` (2nd site) | `native-host-seam.ts:192-197` | acceptance re-bound to a different request/aggregate |

Test mapping (all executed, EXIT=0): absent answer (`domain-app.test.ts:265-273`), malformed + unsupported major + missing acceptance (`domain-app.test.ts:275-293`), unbound request and re-bound aggregate (`domain-app.test.ts:295-309`), explicit rejection with diagnostics pass-through (`domain-app.test.ts:311-325`), PROJECTION frame (`domain-app.test.ts:327-336`), seam id rule failures (`domain-app.test.ts:242-247`).

### 2.4 Pipeline stage ordering (nothing bypasses the gate)

`authorizeBoundedSubmission` (`apps/browser-extension/src/domain-app/submission-pipeline.ts:45-75`) fixes the order **gate → request construction → host-check evaluation**; each refusal returns before any later stage runs (`submission-pipeline.ts:50-53, 54-57, 58-68`); `ADMITTED` is reachable only after a host-accepted check (`submission-pipeline.ts:69-74`). The module documents that the transport send lives outside the lane and the sender must obey this admissibility decision (`submission-pipeline.ts:10-12`).
Test mapping: widened payload refused at the gate before anything else (`domain-app.test.ts:359-369`); missing host answer → `REFUSED_AT_HOST`/`HOST_RESPONSE_ABSENT` (`domain-app.test.ts:340-344`); bad request identity → `REFUSED_AT_REQUEST` (`domain-app.test.ts:371-378`); full admit path asserts the sealed intent/request/ACCEPTED response triple (`domain-app.test.ts:345-356`).

## 3. INSTALLED_SESSION — real Windows/Chromium session

**Verdict: BLOCKED.** The session was NOT run and cannot be run against this candidate. No mocked browser output is sold as installed proof. Prerequisite gaps, each verified on the candidate:

### 3.1 No transport is wired to the T08 surface (decisive)

- Grep evidence: **no runtime file in `apps/browser-extension` imports `src/domain-app`**. All matches of `domain-app` imports inside the extension are the surface's own files importing the T01 contracts (`authorization-gate.ts:18,20`, `authorization-request.ts:32`, `native-host-seam.ts:40`, `submission-pipeline.ts:16`). `service-worker.ts`, `popup.js`, `s2-glue.ts`, `s5-*`, `s6-*` reference nothing from `./domain-app/`.
- The surface's own header records the boundary: `native-host-seam.ts:22-24` — "This module implements NO transport: the Native Messaging pipe, host process lifecycle and relay integration belong to the later join lanes (T12/T15)."
- Commit evidence: the last commit touching `apps/browser-extension` is `8804fa0` (T08), adding exactly the 6 `src/domain-app/` files and nothing else — no service-worker/popup/glue change, no wiring.
- Consequence: a real browser session on this candidate has **no call path** into `gateConfirmedAuthorization` / `buildNativeHostCheckRequest` / `evaluateNativeHostCheck`. Any "installed" proof produced today would be exercising the v0.1 lanes, not the v0.2 surface.

### 3.2 No installable extension artifact exists

- No `dist/` under `apps/browser-extension`; no `.zip`/`.crx` anywhere in the app tree.
- The in-tree MV3 `apps/browser-extension/manifest.json` is the v0.1.0-era manifest (`"version": "0.1.0"`) referencing `background.service-worker.js`, `popup.html`, `icon128.png` at manifest-relative paths that **do not exist in the source tree** (sources are TS under `src/background/`, assets under `src/popup/`). Loading the tree unpacked as-is fails on the missing background script; the referenced files only come into existence via the v0.1.0 build pipeline (`build/package.ts`, outputs to git-ignored `dist/`), which was not run and which per the T13 packaging ledger delivers no v0.2 dist artifacts: `build/README.md:172-196` — "T13 deliberately adds no `ARTIFACTS` entry for them … installed-path validation belongs to T15/T16".

### 3.3 No Windows native-messaging pipe manifest for the v0.2 extension

- The only host manifest in-tree is `packages/browser-auth-broker/assets/com.xdownload.broker.json` — a v0.1.0 (T010) placeholder: POSIX host path `"/usr/local/bin/xdownload-broker-host"` (not a Windows executable) and dummy `allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]` (no real extension ID).
- `build/README.md:135-140` records exactly this state: "The real unpacked-extension origin is only knowable once the extension is actually loaded in a real browser, so the shipped placeholder stays until then and the browser tuple stays NOT_PROVEN", and `build/README.md:100-101`: "The extension↔native handshake inside a real browser was NOT executed and stays NOT_PROVEN." The HKCU registration flow (`build/native-host.ts`) exists only inside the v0.1.0 build layer for built dist artifacts.

### 3.4 Prerequisite gap list (input for T18)

1. **Wire the transport**: a join lane must connect the extension runtime (service worker/popup path) to the T08 surface so a real session actually executes gate → request-build → host-check evaluation. Until then `INSTALLED_SESSION` is structurally impossible, not merely unexecuted.
2. **Produce a loadable extension artifact**: run/extend the packaging step so the emitted tree contains exactly the files the MV3 manifest references (`PACKAGE_MANIFEST_MISMATCH`-audited), including a built `background.service-worker.js` from the TS source.
3. **Windows native-messaging registration with the real origin**: fill `com.xdownload.broker` host manifest with a Windows host path and the real unpacked-extension origin (knowable only after a first real load), then register under HKCU `Software\Google\Chrome\NativeMessagingHosts\`.
4. **Host facts for the session run**: real Windows Chrome is present at `C:\Program Files\Google\Chrome\Application\chrome.exe`. A load smoke was deliberately **not attempted**: the only loadable-or-buildable tree is the v0.1 extension exercising S5/S6 lanes; running it would produce v0.1 behavior that must not be sold as v0.2 installed proof.

## 4. File owner truth — authorized root / containment semantics (source level)

- `validateConfirmedIntent` routes `outputRootScope` through the root grammar before emitting: `packages/download-domain-app/src/contracts/intent.ts:116-118`.
- `validateOutputRoot` (`intent.ts:182-195`): bounded string; absolute only (drive-letter/POSIX-absolute, `intent.ts:187-189`); any `..` segment refused → `OUTPUT_ROOT_ESCAPED` (`intent.ts:190-193`).
- `validateArtifactPath` (`intent.ts:197-221`): artifact must start with the normalized root (`:204-209`), be strictly inside it (`:210-215`), and contain no `..` (`:216-219`) — escapes and the root itself are refused.
- Host-side consumption (file owner truth where bytes materialize): `packages/download-domain-host/src/direct/direct-acquisition-bridge.ts:19,43` applies the `validateArtifactPath` containment grammar against the confirmed root.
- Test evidence mapping: containment positives/negatives in `packages/download-domain-app/src/contracts/contract.test.ts:93-106` (relative and traversing roots refused; artifact outside root, traversing artifact, and the root itself refused); the same semantics hold **through the browser gate** (`domain-app.test.ts:184-196`: `C:/tmp/../secrets` and `relative/root` refused via `gateConfirmedAuthorization`).
- Bounded caller identity (no browser session material): `authorization-request.ts:105-106` + `intent.ts:154-168` (bounded `actor`/`sessionRef`, exact-key rebuild).

## 5. Method and honesty notes

- The layered verdict is deliberately kept separate: a source-level PASS must not launder into an installed-scope claim. Per the pack, "no mocked browser sold as installed real proof" — no real-session evidence was fabricated, and the not-attempted load smoke is recorded with its reason (§3.4 item 4), not hidden.
- Static review was performed on the exact candidate bytes (`HEAD == 7fa7210`, working tree clean at validation start and before the docs commit below).
- Commands whose results this document cites: the T08 suite (§1, EXIT=0), read-only greps/file reads (§2, §3, §4; no repo state was mutated except this docs write-set).
