# xDownload v0.2.1 — User Guide (English)

> **Candidate documentation only.** Source baseline version/v0.2.1@56f9e16d8d7afb29b2a493c07bdf4f886a0bf445. No v0.2.1 release or installed-path qualification is claimed by this file. [中文用户指南](README.zh-CN.md) · [Agent contract](../agent/README.md).

## Scope and limitations

One local Core process owns one DomainHarness K. CLI, browser extension and desktop UI do not create separate authorities. The selected installer tuple is **Windows x64 and Node.js 24** (repository pins Node 24.21.0 / pnpm 12.8.1). Linux/macOS, auto-update, code signing and storefront distribution are not qualified. Browser Native Messaging, installed Electron, HLS playback/download, installation/upgrade and human G0/G1 need separate real-world evidence at the final candidate SHA (T12–T17).

The CLI preserves legacy v1 behavior unless explicitly invoked with --route v0.2. Some valid v0.2 intents, particularly direct acquisition/cancel, can still be refused by the current Core; no silent downgrade. Controlled S4 HLS VOD requires an explicit authorized rendition, a bounded manifest and FFmpeg/ffprobe. No live/DRM bypass or implicit playlist crawling. Browser permissions are user-controlled and cannot grant arbitrary filesystem access.

## Build a candidate

From the monorepo root:

~~~text
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli/xdownload-cli.js help
~~~

The audited dist includes CLI, Core, MV3 extension and Native Messaging Host assets. On the selected **Windows x64** host, with all declared native runtime files present:

~~~text
node installers/compose-installer.ts --version 0.2.1
~~~

The composer fails closed on an incompatible host or missing native runtime. **A successful build is not real installation evidence.**

## Windows per-user installation

From a verified, final-candidate ZIP, inspect the packaged INSTALL.txt and:

1. Run verify.cmd and require PASS from the SHA256SUMS check.
2. Obtain the *actual* 32-letter Chromium extension ID from chrome://extensions, not a placeholder.
3. Run install.cmd --extension-id <real-id> [--install-id xdownload] [--launch-core]. It binds HKCU Native Messaging for the current user, without elevation or overwriting another registration.
4. Run status.cmd and inspect the registered host plus one canonical Core named pipe.
5. Load payload/extension as an unpacked extension with the same browser-origin identity.
6. Stop Core and uninstall the previous package binding before upgrading; do not assume automatic upgrade/migration.

These are documented operator steps. T13/T16 must still execute the real browser/OS journey.

## CLI (syntax-checked candidate examples; installed tests pending T12)

Replace all placeholders; the actual Core identity and local port or Windows --pipe-name are required.

~~~text
node dist/cli/xdownload-cli.js status --contract <contract-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 status --lineage <lineage-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 wait --lineage <lineage-id> --timeout-ms 30000 --poll-ms 200 --install-id <install-id> --user-id <user-id> --port <core-port>
~~~

Explicit --route v0.2 accepts argv verbs submit/status/wait/cancel/batch but **does not** accept download/media/hls/confirm/retry. Core can refuse an otherwise valid command and that typed refusal must be shown. Windows pipe failure does not trigger automatic TCP fallback.

One machine-readable JSON document is written to stdout and human notes to stderr. Exit codes: 0 accepted/success, 1 usage, 2 typed rejection, 3 user action needed, 4 terminal non-success, 5 transport, 6 bounded wait timeout. **An accepted submission is not a completed download.** UNKNOWN, absent total and failed/cancelled outcomes remain truthful, never invented as completion.

## Security, destination, resume and troubleshooting

The output must remain inside an authorized destination root; traversal, unsafe collisions, undeclared redirect targets or mismatched Host identity are rejected. Resume requires the original lineage plus a strong matching remote validator and exact range; changed sources, interrupted streams, corrupt output or exhausted budgets cannot be marked COMPLETE. After restart, query Core durable state before any explicit same-lineage retry. There is no implicit retry-all.

Check typed CLI errors, Core connectivity, status.cmd and verify.cmd rather than bypassing refusal. The desktop UI currently cannot enumerate all persisted K-owned downloads, so an absent row does not necessarily mean lost work.

**Qualification still pending:** installed CLI (T12), Chromium/Host (T13), desktop (T14), HLS (T15), Windows install and upgrade (T16), human G0/G1 (T17), then candidate freeze/hidden/closure/RQ and qualified main integration.
