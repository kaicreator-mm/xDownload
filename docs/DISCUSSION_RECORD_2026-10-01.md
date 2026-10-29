# xDownload Discussion Record — 2026-10-01

## Purpose

This document preserves the product reasoning that led from the initial “LLM-assisted downloader” idea to the current xDownload product direction. It is a discussion record, not a frozen architecture or release contract.

## 1. Starting question: can LLMs perform resource sniffing?

The initial idea was to build a download tool where the LLM is responsible for identifying the real downloadable resource from browser/page/network context, while deterministic tools perform the actual transfer.

The core split established during discussion was:

```text
Browser / URL
     ↓
Browser / Network Observation
     ↓
Resource Candidates
     ↓
LLM / Harness reasoning
     ↓
DownloadPlan
     ↓
Deterministic Download Tools
     ↓
Validation
```

The important product/engineering conclusion was that the LLM should not directly implement sockets, retries, file writes, checksums, HLS segment transfer, or other transport primitives. Its useful role is understanding, classification, adaptation, repair, and knowledge creation.

## 2. DownloadPlan sharing led to Recipe separation

A concrete `DownloadPlan` can contain current-user/session-specific information such as cookies, authorization headers, signed URLs, CSRF values, selected page state, and account context. Therefore a raw plan should not be the main cross-user sharing object.

The discussion introduced a three-part split:

```text
Shared Recipe / Pattern
        +
Local ExecutionContext
        ↓
Compiled DownloadPlan
```

### DownloadPlan

A short-lived execution object for one concrete task.

### DownloadRecipe / Knowledge

Reusable, sanitized knowledge describing how to identify, select, acquire, and validate a type of resource.

### ExecutionContext

Local user/session context such as browser profile, credentials, cookies, ephemeral tokens, current page state, and signed URLs.

The sharing principle became:

> Share reusable knowledge and validation evidence; do not share user credentials or instantiated execution context.

## 3. Recipe should not mean “one website, one script”

The discussion expanded Recipe into a broader knowledge model:

```text
Knowledge
├── Protocol Patterns
│   ├── HTTP Range
│   ├── HLS
│   └── DASH
├── Player Patterns
│   ├── Video.js
│   ├── Shaka
│   ├── hls.js
│   └── JWPlayer
├── Provider Patterns
├── Site-specific Patterns
├── Failure Patterns
└── Recipes
```

The intended direction is compositional reuse. A new site may be understood as an existing player pattern + protocol pattern + provider/auth pattern, with only a small unknown piece requiring new reasoning.

## 4. Product completeness discussion

To become a real product rather than a technology demo, the following product concerns were identified:

- ordinary HTTP/HTTPS download quality;
- browser integration;
- media/resource discovery;
- HLS/DASH handling;
- task queue and persistence;
- retry and safe resume;
- filename and duplicate handling;
- media/file validation;
- semantic resource selection;
- output organization;
- UI workflow;
- CLI / automation workflow;
- privacy and credential boundaries;
- bounded AI exploration;
- failure taxonomy and recovery;
- local knowledge reuse;
- optional public/private Recipe Registry;
- API/SDK/agent integration as later surfaces.

A key product lesson was that AI should not dominate the user interface. Users should primarily see normal download concepts: file, task, progress, speed, remaining time, failure reason, retry, and result. AI appears when it creates additional value, for example when a page is unknown or an existing rule has failed.

## 5. Harness reframing

The discussion then reframed xDownload from “a downloader with AI features” into a product implemented through a **Download Domain Harness**.

Under this model:

### Tools

- Browser Observer
- HTTP downloader
- HLS downloader
- DASH downloader
- media processor / validator
- filesystem
- proxy/network tools

Tools perform deterministic operations. They do not own domain policy.

### Knowledge

- protocol knowledge
- player knowledge
- provider knowledge
- site knowledge
- failure patterns
- validated Recipes

### Domain State

Examples:

```text
CREATED
→ RESOLVING
→ READY
→ DOWNLOADING
→ VALIDATING
→ COMPLETED
```

with explicit failure/recovery states rather than a single `downloading` flag.

### Workflow

Typical stable workflow:

```text
Discover
→ Resolve
→ Acquire
→ Post-process
→ Validate
→ Organize
```

### Decision / Constraints

The Harness decides which knowledge and tool to use, when to retry, when to re-observe, when to escalate to AI, and when to stop.

### Validation / Evidence

A file merely existing is not enough to claim success. Validation determines whether the transferred object is complete, valid, and actually matches the user’s intended target. Evidence records what was observed, chosen, executed, and validated.

### Evolution

When knowledge is missing or stale:

```text
Knowledge Gap
→ LLM reasoning
→ hypothesis
→ tool probe
→ deterministic validation
→ candidate knowledge
→ replay / promotion
```

The desired long-term property is that successful discoveries can reduce future reasoning cost, but this is an internal Harness efficiency goal, not the primary user-facing product success condition.

## 6. First L1 conclusion

The first L1/Product Evidence pass concluded that:

- transport/download engines are already mature and are not by themselves a strong product differentiator;
- browser resource discovery and continuous site adaptation are real problems;
- “LLM + downloader + browser sniffing” is already becoming commoditized by modern tools;
- the strongest unvalidated thesis is the self-improving loop: discovery → validation → reusable knowledge → repair;
- ordinary deterministic paths should be used before LLM fallback;
- DRM/access-control circumvention is outside the intended product boundary.

The initial recommendation was `REFRAME + NARROW`, focusing on proving the self-evolving Harness hypothesis.

## 7. Adversarial review changed the product hierarchy

The adversarial review identified that the first direction over-promoted the Harness thesis into the product goal.

The strongest correction was:

> Product success is not the same as Recipe generalization success.

A tool can have elegant knowledge reuse and still be unpleasant to use. Conversely, xDownload could create meaningful user value even if cross-user Recipe sharing is weak.

The review therefore separated four decision layers:

```text
G0 Product Value
   Is downloading easier, more reliable, and lower-friction?

G1 AI Increment
   Does AI solve valuable cases deterministic methods cannot?

G2 Local Knowledge Compounding
   Does one discovery reduce future work for the same/local system?

G3 Shared Knowledge
   Can knowledge be safely and reliably reused across users?
```

Only G0 is a fundamental product-level gate. G1–G3 can independently fail without necessarily killing the download product.

## 8. Current product thesis

The current working thesis is:

> **xDownload is a convenient, reliable download product whose core internal implementation paradigm is a Download Domain Harness.**

The priority order is:

```text
Correct completion
    >
Reliability and recovery
    >
Low user effort
    >
Fast feedback
    >
AI discovery
    >
Local knowledge reuse
    >
Cross-user Recipe network
```

The Harness remains central to engineering, but is not the reason a user should tolerate a worse download experience.

## 9. Current product surfaces

Working product surfaces are:

- Desktop UI — primary end-user surface;
- Browser Integration — core discovery/input surface;
- CLI — first-class automation surface;
- API / MCP / SDK / remote execution — later candidate surfaces, not v0 blockers.

UI, CLI, and browser integration should converge on a shared task/resource/runtime model whenever feasible, so a task created in one surface has an unambiguous identity and state in the others.

## 10. Current AI policy

Known deterministic paths should not require AI.

AI is entered only for bounded knowledge-gap cases such as:

- unknown resource;
- unknown player/provider;
- Recipe mismatch;
- site change;
- unclassified discovery failure.

AI exploration must have explicit limits for time, model calls, probes, network traffic, optional monetary budget, and cancellation propagation.

If AI is unavailable, normal supported downloads must continue to work.

## 11. Current knowledge/security policy

Shared/public knowledge must not contain:

- cookies;
- JWT/session tokens;
- signed URLs;
- CSRF tokens;
- account-specific values;
- private page data.

Recipes should prefer declarative capabilities and should not be arbitrary shell/script execution containers.

Browser content and community/shared Recipes are both untrusted inputs.

## 12. Validation principle

Validation is a P0 product and Harness requirement.

It should distinguish at least:

- transfer completeness;
- format validity;
- media integrity;
- target correctness.

Examples of false success that must be rejected include saving a login HTML page with HTTP 200, downloading an advertisement instead of the main video, downloading a preview instead of the full resource, or producing a video without its intended audio track.

## 13. Experiment design correction

A single hand-picked corpus is insufficient. Current discussion requires at least:

### Natural Corpus

Real ordinary download tasks to measure overall product usefulness.

### Hard Corpus

Tasks where current tools fail or require substantial intervention, to measure AI incremental value.

### Holdout Corpus

Pages/sessions/profiles/machines/users not used during Recipe generation or tuning, to measure generalization.

Tool versions, configuration, operator steps, time budget, network conditions, and failures should be recorded so results are auditable.

## 14. Product boundaries currently agreed in discussion

Initial scope is oriented around user-accessible resources and ordinary web/media download workflows.

Explicit non-goals include:

- DRM circumvention;
- paywall/access-control bypass;
- credential theft;
- authentication cracking;
- protected key extraction;
- unauthorized access;
- arbitrary website automation unrelated to download;
- arbitrary Recipe code execution.

## 15. Important unresolved decisions

The discussion deliberately leaves several items for PRD/product experiment/L2 freeze rather than silently deciding them:

- exact first release OS scope;
- whether CLI always shares the desktop runtime/daemon or can run fully standalone;
- Chromium browser support details;
- exact HLS/DASH feature matrix including multi-audio/subtitles/encryption support;
- whether authenticated resources are v0 P0;
- local model vs cloud model vs user-provided model defaults;
- public Registry timing;
- telemetry defaults;
- commercial/model-cost responsibility;
- exact quantitative release thresholds after baseline measurement.

## 16. Document lineage

The repository preserves the reasoning chain rather than only the latest conclusion:

1. `docs/product/PRD-v0.0-pre-review.md` — historical pre-review product-direction draft derived from the first L1 analysis.
2. `docs/reviews/2026-10-01-adversarial-review.md` — adversarial review that challenged the initial hierarchy and acceptance model.
3. `docs/product/PRD-v0.1-draft.md` — regenerated current PRD draft after the review.

These documents should not be treated as equally current. The v0.1 draft is the current product draft; v0.0 and the review are retained as provenance and counter-evidence.
