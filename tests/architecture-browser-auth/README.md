# Browser Auth Broker Architecture Research Demo

Research-only fixture for xDownload Issue #8. This directory is not production implementation and must not be promoted wholesale.

## Real boundary under test

- real Chromium-family browser process;
- real Manifest V3 extension privileged/background context;
- real `chrome.webRequest` observation path;
- real `chrome.cookies` session and partition-aware cookie API behavior;
- real registered Native Messaging host process over browser-managed stdio framing;
- real authenticated HTTP request to a controlled local origin.

The controlled HTTP server, Core durable sink, Recipe sink, and model sink are deterministic test fixtures.

## Run

```bash
python3 tests/architecture-browser-auth/run_e3_demo.py
```

Requirements:

- Python 3.13+;
- Chromium-family browser with the DevTools `Extensions.loadUnpacked` command available;
- Xvfb on headless Linux test hosts, or adapt the runner to an existing display;
- browser policy must permit unpacked test-extension installation;
- native messaging must be enabled for the test profile.

Platform notes:

- Linux: native host manifests are staged under an XDG-style `NativeMessagingHosts` directory and shell wrappers launch the Python broker.
- Windows: the runner registers hosts via `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>` (deleted again after the run) and compiles a tiny C# launcher exe with the in-box `csc.exe`, because Chrome launches native hosts with `CreateProcess` and refuses `.bat`/`.cmd` wrappers. Chrome 154 also no longer honors `--load-extension`; the Windows path installs the fixture through DevTools `Extensions.loadUnpacked` over `--remote-debugging-port`, using a stdlib WebSocket client without an `Origin` header and falling back to the profile's `DevToolsActivePort` file.

The runner uses CDP `Extensions.loadUnpacked` instead of the removed/deprecated `--load-extension` path on modern Chromium-family builds. If the host has an enterprise `ExtensionInstallBlocklist` that rejects unpacked extensions, the run must be reported `BLOCKED`; do not weaken the extension or Native Messaging assertions.

## Secret handling

The authenticated origin creates a fresh runtime sentinel session secret. Raw values are allowed only inside the browser cookie store and broker memory. Evidence records only opaque `AuthorizationContextRef` identities, hashes, provenance, status, and counters. The runner scans non-secret evidence artifacts for the raw sentinel and fails S6 if it appears.

## Scope

This fixture proves only the narrow Issue #8 architecture hypothesis for the recorded environment. It does not prove browser-store distribution, arbitrary third-party sites, multi-browser parity, multi-OS parity, production credential-vault design, DRM/access-control bypass, or release readiness.
