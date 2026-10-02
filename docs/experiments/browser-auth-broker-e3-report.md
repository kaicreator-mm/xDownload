# Research Demo Report — Browser Observation + Scoped Auth Broker

## Identity

- Research Issue: `#8`
- Baseline SHA: `44fd0fc7287b45735f069263c87486e6585fd7ae`
- Consumed dependency SHA: `version/v0.1.0@44fd0fc7287b45735f069263c87486e6585fd7ae`
- Frozen Product source: `docs/product/PRD-v0.4.2-review-candidate.md@65be7aaeabe7ead5544bbc9e7d6e16a805412025`
- Architecture candidate source: `docs/architecture/L2_ARCHITECTURE_EVIDENCE.md@44fd0fc7287b45735f069263c87486e6585fd7ae`
- Pinned ADS: `4.0.0@94cad2b0487e8a552c66d6bcd1cba36b7779383d`
- Research branch: `research_v0.1.0-browser-auth-broker`
- Final research HEAD: recorded in the terminal closeout on Issue #8; no research-branch mutation is permitted after the final exact-HEAD rerun.
- Evidence Strength: `E3`
- Executed environment (first tuple): Linux `6.18.44` x86_64, Chromium `144.0.7559.96`, Python `3.13.5`, Xvfb-backed real Chromium process.
- Executed environment (second tuple): Windows `11` (`10.0.26200`) x86_64, Google Chrome `154.0.8037.58`, Python `3.14.7`, real desktop session (no display shim); final closeout records the exact final HEAD rerun.

## Hypothesis

If a real supported reference browser extension communicates with a real native messaging host against a controlled authenticated origin, then xDownload can bind observed page/network resource metadata and an authorization capability to the intended tab/origin/AcquisitionContract, acquire the authorized test resource, reject unbound/cross-origin misuse, and keep raw session secret values out of Core durable state, logs, Recipe data and model-facing payloads.

## Result

`PASS`

## Second Executed Environment — Windows 11 + Google Chrome 154 (E3)

The same fixture was executed on a second, independent real desktop host to widen the proven tuple beyond Chromium/Linux. No scenario semantics, extension code, broker code, or server behavior were changed; only the runner gained a Windows execution path (`os.name == "nt"`) plus research-only host-registration material.

Environment identity:

- Platform: `Windows-11-10.0.26200-SP0` x86_64, real interactive desktop (no Xvfb equivalent used);
- Browser: Google Chrome `154.0.8037.58` (`C:\Program Files\Google\Chrome\Application\chrome.exe`);
- Python: `3.14.7`;
- Extension ID: `pfmdeelofnfcfabikilcoichkfclmgoj` (pinned via manifest key, identical to the Linux run);
- Native host: `com.kaicreator.xdownload.auth_demo`;
- Browser sender origin: `chrome-extension://pfmdeelofnfcfabikilcoichkfclmgoj/`;
- Command: `python tests/architecture-browser-auth/run_e3_demo.py`.

Windows-specific real-environment mechanics recorded for reproducibility:

- Chrome 154 no longer honors the removed `--load-extension` path; the runner installs the unpacked fixture through DevTools `Extensions.loadUnpacked` over `--remote-debugging-port`, connecting with a stdlib WebSocket client that omits the `Origin` header (Chrome rejects foreign `Origin` handshakes) and falls back to the profile's `DevToolsActivePort` file for the actual bound port.
- Native Messaging host registration uses the documented Windows mechanism: a manifest JSON plus an `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>` registry value. Keys created by the runner are deleted again at run end.
- Chrome on Windows launches native hosts with `CreateProcess`, which refuses `.bat`/`.cmd` wrappers; the runner compiles a tiny C# launcher exe (in-box `csc.exe`, .NET Framework 4.x) that forwards stdio to the Python broker and injects the evidence environment variables. A `.bat` probe host was empirically rejected on this Chrome build.
- The host had no enterprise extension policy (`ExtensionInstallBlocklist` absent); two pre-existing third-party `HKCU\...\Google\Chrome\Extensions` registrations were observed and left untouched. They do not interfere with the fixture.

Second-tuple scenario matrix (all eight scenarios executed by the same extension/background.js flow):

| Scenario | Actual | Status |
|---|---|---|
| S1 authenticated handoff | real browser session → real Native Messaging broker → HTTP `200`; digest `94c22cd46d42c6167639aaeaf8e1215b69b8fa51f3f4490c8642f4234960afff` | PASS |
| S2 observation boundary | real `webRequest` captured relevant + irrelevant metadata with tab/frame/request/origin provenance | PASS |
| S3 cross-origin misuse | `scope_mismatch`, `network_attempted=false`, cross-origin forged requests `0` | PASS |
| S4 content-script boundary | oversized unexpected schema rejected as `message_too_large` before privileged/native action | PASS |
| S5 native allow-list | Chrome rejected mismatched `allowed_origins`: `Access to the specified native messaging host is forbidden.`; denied host not launched | PASS |
| S6 secret propagation | Core/durable/log/Recipe/model raw-secret flags all `false`; artifact scan hits `0` | PASS |
| S7 session expiry | same opaque auth ref; bound resource returned HTTP `401`, `status=auth_required`; no scope widening | PASS |
| S8 partition/context | real partition-aware cookie lookup succeeded for correct context, wrong context absent; correct capability binding accepted, wrong partition rejected | PASS |

Representative second-run observables: `tab_id=487716060`, `frame_id=0`, `observed_request_id=4`, `authorization_context_ref=authctx_d70cb5e18686fb9fefd52b6d`, native messages before finalize `10` (payload sizes `343,324,447,198,197,335,358,351,351,324`), server counters: resource requests `3`, authorized `2`, unauthorized `1`, cross-origin forged `0`. The controlled sentinel secret was not printed or persisted; the run-local origin port, tab ID, and capability ref are intentionally not architecture constants.

## Expected vs Actual

| Item | Expected | Actual | Status |
|---|---|---|---|
| S1 authenticated handoff | bound capability acquires exact protected bytes | HTTP `200`, digest `94c22cd46d42c6167639aaeaf8e1215b69b8fa51f3f4490c8642f4234960afff` | PASS |
| S2 observation boundary | relevant + irrelevant request metadata observed; only relevant selected | real `webRequest` metadata captured with tab/frame/request/origin provenance | PASS |
| S3 cross-origin misuse | reject before network | `scope_mismatch`, `network_attempted=false`, cross-origin resource requests `0` | PASS |
| S4 content-script boundary | malformed/oversized message rejected before privilege | `message_too_large`; no native action from that message | PASS |
| S5 native allow-list | wrong extension identity rejected | Chromium: `Access to the specified native messaging host is forbidden.`; denied host never launched | PASS |
| S6 secret propagation | no raw sentinel outside browser/broker secret zone | Core/durable/log/Recipe/model flags all false; external non-secret artifact scan hits `0` | PASS |
| S7 session expiry | truthful auth failure without scope widening | same opaque auth ref returned `401`, `status=auth_required` | PASS |
| S8 partition/context | correct partition accepted, wrong partition/session context not silently reused | real partitioned cookie lookup + broker binding check both discriminate correct vs wrong context | PASS |

## Observed Evidence

Representative real-run observables:

- Browser: `Chromium 144.0.7559.96`
- Extension ID: `pfmdeelofnfcfabikilcoichkfclmgoj`
- Native host: `com.kaicreator.xdownload.auth_demo`
- Browser sender origin: `chrome-extension://pfmdeelofnfcfabikilcoichkfclmgoj/`
- Contract ID: `contract-demo-001`
- Snapshot ID: `snapshot-demo-001`
- Relevant request: real `xmlhttprequest`, `frame_id=0`, nonnegative real tab ID, browser-issued request ID
- Native messages before final evidence message: `10`
- Native payload sizes in the observed run: `344, 325, 448, 198, 197, 336, 359, 352, 352, 325` bytes
- Protected resource digest: `94c22cd46d42c6167639aaeaf8e1215b69b8fa51f3f4490c8642f4234960afff`
- Server counters: 3 protected-resource requests total = browser page request + broker S1 + expired-session S7; authorized `2`, unauthorized `1`, cross-origin forged requests `0`
- Raw secret seen by Core / durable state / log / Recipe / model sink: all `false`

Exact runtime-specific tab ID, request ID, port, capability ref, and temp artifact paths are intentionally run-local and are re-recorded in the final Issue closeout rather than frozen as architecture constants.

## Commands / Setup

Primary fixture command:

```bash
python3 tests/architecture-browser-auth/run_e3_demo.py
```

The reference container had a host-wide Chromium policy with `ExtensionInstallBlocklist=["*"]`. That environment policy was temporarily removed outside the fixture for the evidence run and restored immediately afterward. The runner itself does not mutate enterprise browser policy. With the blocking policy present, `Extensions.loadUnpacked` correctly produces a host-environment `BLOCKED` condition rather than a false xDownload architecture failure.

The fixture prewarms the extension service worker on a controlled no-resource page before opening the authenticated page so the real `webRequest` listener is registered before the requests under test. This is test-harness setup, not a product navigation requirement.

## Scenario Results

### Positive

S1 proved a browser-managed session cookie can stay within the browser/broker secret zone while the Core-facing durable payload receives only an opaque `AuthorizationContextRef`, provenance, status, byte count, and digest.

### Boundary

S2 proved the intended non-blocking observation path exposes request/tab/frame/initiator provenance. S8 proved partition-aware browser cookie lookup is available in the tested Chromium and that the broker can bind capability identity to the partition-context value rather than silently reuse another context.

### Negative / Fail Closed

S3 rejected a forged `localhost` origin/target against a capability bound to `127.0.0.1` before network dispatch. S4 rejected an oversized unexpected content-script schema. S5 proved a registered native host with a mismatched `allowed_origins` entry is rejected by Chromium without launching the denied host process.

### Failure / Recovery

S7 invalidated the controlled session after capability creation. The subsequent acquisition reused the same capability identity and target binding, attempted exactly the bound resource, received HTTP `401`, and returned truthful `auth_required` rather than changing origin, target, or permissions.

## Real Under Test

- Chromium browser process;
- Manifest V3 extension privileged/background context;
- `chrome.webRequest` observation;
- `chrome.cookies` including partition-aware lookup;
- Native Messaging host registration, allow-list enforcement, host process spawn, and native stdio message framing;
- broker-authorized real HTTP request to a controlled authenticated local origin.

## Deterministic Fakes

- local HTTP origin with deterministic login/session/resource endpoints;
- Core durable sink;
- Recipe sink;
- model sink.

## What was proven

- Browser request provenance can be captured and bound to tab/frame/origin/request identity.
- A browser-session secret can be converted into an opaque local broker capability while Core-facing state remains secret-free.
- The capability can be constrained to origin + target + contract + snapshot + tab/frame/request + optional partition context.
- Cross-origin/unbound misuse can fail closed before network dispatch.
- Native host `allowed_origins` is an independently enforced least-authority boundary.
- Session expiry can surface as truthful auth failure without widening scope.
- Chromium 144 in this environment exposes usable partition-aware cookie semantics for this seam.

## What was NOT proven

- Firefox or Safari behavior;
- macOS native-host registration/packaging (Windows registration is now proven for the tested Chrome 154 tuple; packaging/distribution remains unproven);
- extension-store installation, signing, update, or review;
- arbitrary third-party authenticated sites;
- production credential vault implementation;
- DRM/paywall/access-control bypass;
- general browser automation or crawling;
- production concurrency, persistence, telemetry, packaging, performance, or release readiness;
- Architecture Freeze or Task DAG readiness.

## Findings

### KEEP

- opaque `AuthorizationContextRef` as the Core-facing authority handle;
- exact origin/target/contract/snapshot/provenance binding;
- browser/content messages treated as untrusted and schema/size checked before native privilege;
- native host `allowed_origins` as a separate platform-enforced boundary;
- secret non-propagation assertions across durable/Core/Recipe/model sinks;
- truthful auth-expiry result without scope mutation.

### ADAPT

- Automated modern-Chromium research setup should use DevTools `Extensions.loadUnpacked` (or another supported test installation mechanism), not assume `--load-extension` remains available (it is gone on Chrome 154).
- Real test environments must explicitly record enterprise extension policy because host policy can block unpacked research fixtures before xDownload code executes.
- Partition context should be an explicit optional field of the authorization-capability binding where the browser exposes partition-aware state.
- Windows native hosts must be real executables (a small compiled launcher); `.bat`/`.cmd` wrappers are refused by `CreateProcess`, and registration is per-user registry plus manifest, not an XDG-style directory.
- DevTools automation on Windows should discover the actual bound port via the profile's `DevToolsActivePort` file and must not send a foreign `Origin` header on the WebSocket handshake.

### DROP

- whole-cookie-jar export to Core;
- content-script authority to invoke arbitrary native actions;
- fallback from failed Native Messaging to unrestricted local IPC;
- silently reusing an auth capability across origin/target/partition context.

## Architecture Implications

The evidence supports L2 U3 moving from `UNKNOWN / EXECUTABLE_DEMO_REQUIRED` to a narrow proven fact for the tested Chromium/Linux tuple: a local Browser Integration + Native Messaging scoped broker seam is executable with least-authority binding and raw-secret containment. L2 may use this evidence to choose the opaque-capability boundary, but this report does not itself freeze that architecture.

## Architecture Contradiction

`NONE`

## Production Seams / Follow-up Issues

No unexpected product contradiction or missing production seam was discovered that requires expansion of this Demo. Future production work still needs Frozen-L2 decisions for extension installation/update, OS-specific native-host registration, broker lifetime/storage, and production credential-vault integration. Those are downstream architecture/Task concerns and are not implemented here.

## Reusable Reference Artifacts

- `tests/architecture-browser-auth/extension/manifest.json`
- `tests/architecture-browser-auth/extension/background.js`
- `tests/architecture-browser-auth/extension/content.js`
- `tests/architecture-browser-auth/native_host.py`
- `tests/architecture-browser-auth/run_e3_demo.py`
- `tests/architecture-browser-auth/README.md`

These are research fixtures/reference scenarios only, not production code.

## Closeout Statement

Issue #8 is Evidence complete when the final branch exact HEAD is rerun in the recorded E3 environment and the Issue terminal records that exact HEAD, environment identity, scenario matrix, secret-negative results, and non-proven scope. No Frozen Product, Architecture Freeze, Task DAG, or production implementation artifact is changed by this research branch.
