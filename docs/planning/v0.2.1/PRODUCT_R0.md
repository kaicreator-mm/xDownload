# xDownload v0.2.1 — Product/Scope R0 candidate

```yaml
status: CANDIDATE_NOT_FROZEN
product_release_target: v0.2.1
planning_issue: 248
baseline: main@c29af4a4b89123997d03d5566ebe09ba83855fb0
ads: 4.18.0@2c395c55569fe2edf3f4135f12d3d069e526d0b7
predecessor: v0.2.0 component/workspace-level release
implementation_authorized: false
```

## 1. Product objective

Make xDownload a reliable, low-friction downloader for resources the user explicitly wants and is authorized to access. A user should be able to submit a target, understand what will happen, observe truthful progress, cancel or retry safely, recover from interruption, validate the resulting file, and find it again without reverse-engineering URLs or reading internal logs.

The v0.2.1 target is the first **integrated user-facing stabilization candidate** built on the v0.2.0 Domain App components. It is not release-qualified until every claimed installed journey is validated on one exact candidate SHA.

Priority order remains:

```text
Correct target and scope
> truthful result and artifact integrity
> safe recovery and durability
> low user effort and clear feedback
> responsiveness and performance
> automation
> optional AI assistance
```

The frozen Stage 1 Product semantics remain binding. This version candidate clarifies release acceptance; it does not authorize crawler behavior, broader scope, silent target changes, or weakening authorization.

## 2. v0.2.0 deferrals carried forward (verbatim frozen ledger)

The following ledger is copied verbatim from [PRODUCT_SCOPE_AMENDMENT_R1 §2](../v0.2.0/PRODUCT_SCOPE_AMENDMENT_R1.md). It must survive unchanged into v0.2.1 intake.

| Deferred item | Evidence home | Deferred to |
| --- | --- | --- |
| Installed CLI user surface (argv wiring; CF-1 import normalization) | T16 gap G1; T14 carried finding | v0.2.1 |
| Browser extension v0.2 cutover (submission-path switch in the existing v0.1 extension, v0.2 host manifest, packaged artifact; real Chromium session revalidation on the new trust path using the v0.1 harness) | T15 gaps 1–3; T16 G2/G4 | v0.2.1 |
| S4 (HLS VOD Basic) as a claimed release journey | T16 gap G5 (disposition: NOT CLAIMED in v0.2.0; engine path is exercised by the S3 media journey) | v0.2.1 (implement) or permanent drop (owner) |
| Installed baselines bound to a release SHA | T16 G3 (stays NOT_PROVEN_DESCRIPTOR_ONLY — correct under component claims) | v0.2.1 |
| Product G0/G1 human effort parity | T16 HUMAN_G0G1=NOT_RUN | v0.2.1 (requires human sessions; not producible by agents) |
| Standing boundary (not a gap): SQLite cross-process CAS leg stays NOT_PROVEN per the recorded T13 no-native-driver decision; file-CAS durability is the proven boundary | T14/T17 NOT_PROVEN notes | unchanged |

Nothing already disproven is claimed; nothing already claimed is weakened silently — the deferral ledger above is part of the v0.2.0 amendment and must survive into v0.2.1 intake unchanged.

## 3. User-facing capabilities added to the v0.2.1 target

### 3.1 A usable desktop Download Manager

A minimal local desktop application is in scope because desktop is the primary interactive surface in the frozen Product contract. It must reuse the existing Domain App/Core authority and existing adapters; it must not create a second scheduler, ledger, budget owner, or result truth.

Minimum journey:
- add a direct URL and review the target and output destination before starting;
- view queued/running/completed/failed/unknown jobs with truthful status;
- show transferred bytes and total only when known; show speed/ETA only when the measurements support them;
- cancel an active job and retry an eligible failed job with a distinct attempt identity;
- inspect the error and reveal the completed file or its containing folder;
- configure a default download directory and safe filename/collision behavior;
- recover after application restart without showing a false success or causing a duplicate accepted artifact.

A pause/resume control is not required unless the underlying transfer and recovery contract can prove it is safe. The UI must not simulate unsupported capabilities.

### 3.2 CLI usability without breaking automation

- Keep the machine-readable JSON contract stable and documented.
- Add a human-readable mode and concise progress/errors for interactive use; progress must not corrupt JSON stdout when JSON mode is selected.
- Provide first-run/Host diagnostics (for example, a `doctor` command) for runtime, Host connectivity, output-directory writability, and installed version.
- Preserve explicit exit-code semantics; ACCEPTED/RUNNING/UNKNOWN are never reported as successful completion.
- Keep direct, status, wait, cancel, retry and finite batch workflows; no implicit collection expansion.

### 3.3 Browser integration

- A user gesture starts the current-page attachment journey.
- Request host permissions only when needed and explain why.
- Display the selected target and result; no silent cookie/header disclosure or arbitrary page-origin authority.
- Host/extension mismatch, disconnected Host, denied permission, or invalid target fails closed with an actionable message.

### 3.4 Reliability and safe file handling

- Bound retries by attempts, elapsed time and the existing lifecycle budget.
- Never automatically replay an effect whose outcome is UNKNOWN until the authoritative state is reconciled.
- Resume only when remote range support and a stable validator/identity prove that the partial bytes belong to the same representation; otherwise restart or ask the user safely.
- Write to a confined partial path and atomically finalize after validation; prevent path traversal and default to no overwrite.
- Validate available digest/content/length evidence before reporting completion; record a computed digest without pretending it was an independently trusted target identity.
- Handle timeout, connection reset, HTTP errors, expired/changed resources, disk full, invalid filename and destination collision with truthful status and recovery guidance.

### 3.5 User trust, privacy and documentation

- Ordinary direct downloads work with no LLM configured.
- No mandatory cloud account or telemetry. Diagnostics are local by default and redact credentials, cookies, signed query strings and sensitive headers.
- Chinese-first end-user quick start/troubleshooting and English-first Agent/automation contracts.
- Document supported site/journey/platform matrix and explicit unsupported cases; do not promise universal video extraction.

## 4. Release acceptance

All conditions apply to one exact candidate SHA and its corresponding installed artifacts.

| ID | Acceptance |
|---|---|
| P01 | Direct URL journey produces a real validated file; completion comes from authoritative result projection. |
| P02 | Queue/status/progress/error/cancel/retry behavior is consistent across Desktop, CLI and Browser for the journeys each surface claims. |
| P03 | Restart/cancel/UNKNOWN/retry cases do not fabricate success or produce duplicate accepted effects. |
| P04 | Partial-file identity, safe path/name handling, no-overwrite default and atomic finalization have positive and negative tests. |
| P05 | CLI installed entrypoint, JSON contract, human-readable mode, exit codes and diagnostics work from a clean install. |
| P06 | Browser extension v0.2 cutover passes a real Chromium/Host session with permission-denial and hostile-input negatives. |
| P07 | S4 HLS VOD Basic passes a real installed journey on a controlled/authorized fixture with truthful media/result validation. |
| P08 | Desktop shell is packaged; the minimum Download Manager journey works through the trusted local boundary, with renderer privilege isolation. |
| P09 | Exact source, package, installer and installed baseline hashes bind to the release candidate; the claimed platform matrix is exercised. |
| P10 | Human G0/G1 study records real user sessions, conventional baseline, time/steps/errors and the user's actual assistance; no agent-generated substitute. |
| P11 | Hidden validation has zero escaped P0/P1 cases; no unresolved release-blocking P0/P1 remains. |
| P12 | Performance and user-effort comparisons use the same host/fixture/baseline; report raw evidence and adjudicate material regressions rather than inventing thresholds. |

## 5. Explicit non-goals

- General web crawler, arbitrary pagination/frontier expansion, DRM or access-control bypass.
- Mandatory LLM, cloud processing, account system, remote workers or telemetry.
- Rewriting the existing transfer engine or building a parallel transport/security stack.
- Unbounded retries, automatic replay of UNKNOWN, silent overwrite, inferred resume, or fabricated progress.
- Claiming broad website/platform compatibility beyond the tested matrix.
- Publishing DomainHarness v0.10.3 to npm; the upstream Git-source/build pin remains the authorized consumption path unless separately changed by its Owner.

## 6. Planning and authority

This document is a Product candidate only. It becomes frozen only after fresh independent exact-SHA Product review, explicit Owner freeze, and a durable read-back record. L2 and DAG must be reviewed and frozen separately. No implementation is authorized by this document or by Issue #248 alone.
