# xDownload / Download Domain Harness — Pre-Review Product Direction Draft

**Historical status:** preserved snapshot / superseded by `PRD-v0.1-draft.md`  
**Original framing:** L1 Product Evidence  
**Research date:** 2026-10-01  
**Original recommendation:** REFRAME + NARROW  
**Product Freeze:** NO

> This file preserves the first product-direction document that was later subjected to adversarial review. It is intentionally not silently corrected. External market claims below are historical research inputs and were not re-verified during repository import.

## 1. Product hypothesis

The initial hypothesis was not simply:

> Build a smarter IDM using an LLM.

Instead:

> Build a Download Domain Harness where Browser Observer, download engines, media tools, and filesystem are Tools; Protocol / Player / Provider / Site / Failure Patterns and Recipes are Knowledge; and the Harness uses Intent, State, Knowledge, Constraints and Validation to discover, acquire and validate resources. When a Knowledge Gap appears, an LLM may explore the unknown and successful results may later be solidified into reusable Knowledge.

Core proposed loop:

```text
Observe
→ Understand
→ Resolve
→ Acquire
→ Validate
→ Generalize
→ Reuse
→ Repair
```

## 2. Problem Evidence

### P1 — Data transfer itself is mature and is unlikely to be the primary differentiator

Existing download engines already support mature capabilities such as HTTP(S), multi-connection transfer, retry, proxying, headers/cookies, checksums, RPC and related transport behavior.

The initial research therefore proposed:

> **Download Transport is not the primary unresolved problem.**

Reimplementing a faster segmented downloader may have engineering value, but the research did not find sufficient evidence that transport alone is the strongest product wedge.

Historical reference used in the L1 pass:

- aria2: https://aria2.github.io/

### P2 — Resource discovery and site adaptation remain continuous problems

The initial research observed that download tools repeatedly need fixes for site changes, 403 errors, media panel failures and streaming recognition.

Historical references used in the L1 pass:

- IDM news/update history: https://www.internetdownloadmanager.com/news.html
- yt-dlp supported sites: https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md

The user-provided source that started the discussion also argued, from an IDM-user perspective, that frequent updates often correspond to changing site/resource parsing behavior.

Initial L1 finding:

> Resource identification and continuing site adaptation are real problems worth testing.

### P3 — Browser context is part of the real workflow

A common downloader workflow is not “manually discover the final URL.” It is:

```text
browse normally
→ resource appears / begins playing
→ browser integration observes it
→ downloader presents or captures the resource
```

Historical references used in the L1 pass:

- IDM starting/integration guidance: https://www.internetdownloadmanager.com/support/using_idm/starting.html
- Video DownloadHelper basic usage: https://help.downloadhelper.net/article/4-basic-usage

The research therefore treated Browser Observer as a product-relevant input surface rather than an AI-specific invention.

### P4 — Unknown/dynamic pages can require understanding page behavior

The first research pass highlighted cases where a tool cannot resolve a resource until the user opens the page, triggers playback or performs another action that causes a real request to occur.

Historical references used in the L1 pass:

- IDM FAQ discussing streaming/site-grabber limitations: https://www.internetdownloadmanager.com/register/new_faq/functions20.html
- JDownloader LinkGrabber/DeepDecrypt concepts: https://jdownloader.org/knowledge/wiki/glossary/linkgrabber

This supported a concrete user Job:

> “The page contains the resource I want, but my tool does not know how to find it.”

## 3. User Workflow Evidence

The first L1 grouped workflows as follows:

| Stage | User Job | Typical current approach | Pain |
|---|---|---|---|
| Ordinary file | Save this file | Browser / IDM / FDM / Gopeed | Largely solved |
| Known media site | Save this video/audio | yt-dlp extractor, VDH, JDownloader plugin, IDM panel | Site changes break support |
| Unknown dynamic page | The page can play it but the tool cannot find it | DevTools, deep scan, rules, switching tools | Technical friction |
| Authenticated resource | Download content this account can access | Cookie/header/session propagation | Privacy/session complexity |
| Site change | It worked yesterday but not today | Update tool/extractor, wait for fix, manual rule | Continuous maintenance |

The first draft emphasized the latter three cases as the most interesting Harness/LLM validation area.

## 4. Alternatives / Competitors

### IDM

Observed strength:

- mature browser integration;
- low-friction task handoff;
- established download-management UX.

Initial implication:

> Competing on “download faster” alone is weak; the more interesting problem is reducing continuous site-adaptation burden.

### yt-dlp

Observed strength:

- large deterministic extractor knowledge base;
- broad format/subtitle/auth/post-processing capabilities;
- generic extraction and plugin extensibility.

Initial implication:

> Recipe/Knowledge ecosystems already exist. Innovation would need to come from authoring, validation, security and evolution rather than merely introducing another extractor format.

### JDownloader

Observed strength:

- crawler/hoster plugins;
- LinkGrabber;
- DeepDecrypt;
- user rules/fallback mechanisms.

Initial implication:

> There is already an ancestor of “knowledge + deterministic execution.” LLM value would have to lower the cost of discovering, authoring or repairing that knowledge.

### Video DownloadHelper

Observed strength:

- browser-centric media detection;
- common HLS/DASH/media workflows;
- local media processing.

Initial implication:

> “Browser sniffing + downloader” by itself is not a sufficient differentiator.

Historical references:

- Chrome Web Store listing: https://chromewebstore.google.com/detail/video-download-helper/lmjnegcaeklhafolokijcfjliaokphfk
- DRM support statement: https://help.downloadhelper.net/article/14-what-can-i-do-if-the-video-is-protected-by-drm

### Gopeed

Observed direction in the first research pass:

- download engine;
- browser integration;
- API/extension system;
- AI/MCP integration.

Initial implication:

> Tools + extensions + AI control are already emerging in the market.

Historical reference:

- https://github.com/GopeedLab/gopeed

### OmniGet

This was the strongest counter-evidence found in the first L1 pass.

Observed direction at the time of research included:

- browser traffic/resource sniffing;
- deep search;
- existing downloader/extractor integration;
- cookie/referer handoff;
- AI/MCP/agent-oriented control.

Initial implication:

> **“LLM + browser sniffing + downloader” is not an empty market.**

The remaining hypothesized differentiation was a stronger validated-knowledge lifecycle rather than the presence of AI itself.

Historical reference:

- https://github.com/tonhowtf/omniget

## 5. Counter-evidence

### C1 — Most ordinary downloads may not need an LLM

For direct HTTP, known HLS/DASH manifests, known extractors and obvious browser-captured resources, adding an LLM can increase:

- latency;
- cost;
- nondeterminism;
- privacy surface.

Initial recommendation:

> deterministic-first / knowledge-first / LLM-on-gap.

### C2 — “AI downloader” is becoming commoditized

With modern downloaders already adding AI/MCP/agent controls and browser sniffing, natural-language control alone is unlikely to be a durable moat.

### C3 — Existing knowledge ecosystems are strong

yt-dlp, JDownloader and extensible download managers already have substantial deterministic knowledge.

If xDownload merely rewrites those ecosystems into a new Recipe DSL, the product may be duplicative.

### C4 — Browser observation creates sensitive permission/privacy surfaces

Observing browser/network context and transferring session information to a local app or model requires explicit product/security boundaries.

The first L1 therefore proposed a Local-first direction and minimal data exposure rather than indiscriminate raw network/context upload.

### C5 — Browser distribution channels can constrain this product category

The research treated browser-store/platform policy as a distribution risk to validate rather than assuming browser extension distribution is frictionless.

### C6 — DRM/access-control circumvention should not be the product success path

The initial scope explicitly excluded relying on DRM bypass, credential theft or access-control circumvention as the primary value proposition.

## 6. Product Shape Findings

The first L1 concluded that the stronger direction was not simply “AI Downloader” but:

> **Download Domain Harness — a system that turns resource discovery, acquisition, validation and knowledge evolution into reusable domain capability.**

Potential product surfaces were seen as:

- Desktop Downloader;
- Browser Extension;
- Agent/API;
- later SDK/tool integrations.

The initial Harness-centric core loop was:

### Known Knowledge path

```text
Intent
→ existing Pattern / Recipe
→ deterministic Tool execution
→ Validation
→ Result
```

### Knowledge Gap path

```text
Intent
→ Observation
→ existing Knowledge fails
→ LLM reasoning
→ hypothesis
→ probe using Tools
→ deterministic Validation
→ Candidate Knowledge
→ replay
→ promote/share
→ future deterministic execution
```

The initial document proposed an internal metric:

> How often can one successful AI discovery reduce future AI discovery?

This metric was later challenged by adversarial review because it could not substitute for product-level user value.

## 7. Initial Product Boundary

The first L1 proposed narrowing the first validation scope toward:

- Windows/Chromium-first exploration;
- HTTP(S);
- HLS;
- DASH;
- resources that the current browser/user can legitimately access;
- file/video/audio/document/attachment discovery.

Torrent/Magnet/P2P/cloud-drive-specific protocols were considered later Tools rather than the first discovery hypothesis.

Explicit non-goals included:

- DRM bypass;
- paywall/access-control bypass;
- credential theft;
- authentication cracking;
- protected key extraction;
- arbitrary shell/script execution through Recipes.

## 8. Key Assumptions

The first L1 identified six key assumptions:

### H1 — Knowledge Gap Frequency

Do users encounter enough real cases where current tools fail to identify a resource that the browser itself can access?

### H2 — LLM Discovery Advantage

Does LLM + structured browser observation materially outperform generic sniffing, deep search and existing deterministic extractors?

### H3 — Generalization

Can a successful one-off DownloadPlan be safely generalized into a Recipe/Pattern that works on other pages, sessions, users or machines?

### H4 — Repair

When a site changes, can old evidence + new observation help the LLM propose a reliable repair rather than rediscovering everything from scratch?

### H5 — Safety

Can reusable/shared knowledge avoid leaking credentials, signed URLs or arbitrary executable payloads?

### H6 — Economics

Does automated discovery/repair save more engineering/user effort than the model, validation and governance costs it introduces?

**Economic benefit status:** NOT_MEASURED.

## 9. Initial Validation Plan

The first draft proposed a dogfood corpus covering:

- ordinary HTTP downloads;
- direct media;
- HLS/DASH;
- dynamic players;
- iframe/embed scenarios;
- logged-in user-accessible resources;
- batch/page resources;
- known failure/change scenarios.

Suggested comparison categories included browser-native download, IDM-class tools, Video DownloadHelper, JDownloader, yt-dlp and newer AI/sniffer tools.

The first proposed gates were:

- Discovery Gap;
- LLM Increment;
- Recipe Replay;
- Knowledge Compounding.

This gate hierarchy was later revised because it risked equating Harness success with product success.

## 10. Initial Falsification Tests

The first draft proposed strong falsification conditions including:

- current tools already solve most target unknown-site cases;
- LLM can make one-off plans but cannot generalize knowledge;
- Recipe validation costs approach manual extractor maintenance;
- repair still needs manual DevTools analysis;
- observation requires unacceptable permissions;
- secure Recipe sandboxing makes Recipes too weak.

The document suggested that failure of cross-user/generalized Recipe behavior might force a major reframe.

The adversarial review later correctly challenged this as too strong: shared Recipe failure should not automatically imply product failure if xDownload still delivers strong user value.

## 11. Original Recommendation

### REFRAME

Do not proceed as a generic “LLM sniffing downloader.”

Instead investigate:

> deterministic Tools + reusable Knowledge + LLM Knowledge-Gap Resolution + deterministic Validation + Knowledge Evolution.

### NARROW

The first draft recommended initially proving:

> When deterministic downloader/extractor/generic browser sniffing does not know how to complete a download task the user is already authorized to access, can the Harness discover a method and turn it into future reusable knowledge?

## 12. Historical Terminal

```text
Problem existence: SUPPORTED
Existing demand for browser resource discovery: SUPPORTED
Download engine as differentiation: NOT SUPPORTED
LLM as generic product differentiator: NOT SUPPORTED
Knowledge-gap / site-adaptation problem: SUPPORTED
LLM automatic discovery advantage: UNVALIDATED
Cross-user Recipe generalization: UNVALIDATED
Self-evolving Harness moat: PLAUSIBLE / UNVALIDATED
Economic benefit: NOT_MEASURED
Legal/store/privacy feasibility: REQUIRES GATES
Recommendation: REFRAME + NARROW
```

## 13. Why this document is superseded

The subsequent adversarial review found that this document over-weighted the Harness thesis relative to the actual product Job.

The correction adopted afterward is:

- product success = users complete downloads correctly, conveniently and reliably;
- AI success is a separate gate;
- local knowledge compounding is a separate gate;
- cross-user Recipe sharing is a separate, non-blocking gate;
- ordinary download quality, UI/CLI workflow, validation, recovery and bounded failure behavior are first-class product requirements.

See:

- `docs/reviews/2026-10-01-adversarial-review.md`
- `docs/product/PRD-v0.1-draft.md`
