# xDownload — L1 Product Evidence

Status: Stage 1 Product Evidence

Standard authority:

- repository: `kaicreator-mm/ai-development-standard`
- version: `4.0.0`
- revision: `94cad2b0487e8a552c66d6bcd1cba36b7779383d`
- prompt basis: pinned `prompts/L1_PRODUCT_EVIDENCE.md`

Research date: 2026-10-02

Product Freeze: **NO**

Architecture Freeze: **NO**

This document is product evidence. It is not a PRD Freeze, architecture decision, implementation plan, or release claim.

---

## 1. Executive Recommendation

**Recommendation: PROCEED WITH NARROWING + REFRAME.**

The evidence supports a real product problem around resource acquisition from web pages and collections, but it does **not** support the thesis that “browser sniffing + download engine + AI/LLM” is itself differentiated.

The market already contains strong implementations of:

- mature deterministic download engines;
- large site-specific extractor ecosystems;
- browser download interception;
- current-page media/resource sniffing;
- playlist/gallery/collection handling;
- authenticated/cookie-aware downloads;
- AI/MCP-driven download management.

The strongest product opportunity for xDownload is therefore narrower:

> **Help a user express what they want to save, discover only the resources necessary to satisfy that intent, let the user cheaply resolve ambiguity when necessary, reliably acquire and validate the selected resources, organize them, and reuse validated templates/patterns so future tasks become more deterministic.**

The product should be evaluated as a **targeted resource acquisition tool**, not as a general crawler and not as an “AI downloader” whose primary value is model use.

The working product sequence should be:

```text
User Intent
  → Bounded Discovery
  → Semantic Selection
  → Optional Human Confirmation
  → Reliable Acquisition
  → Validation
  → Organization
  → Optional Knowledge Reuse
```

AI should remain a bounded fallback for knowledge gaps, template adaptation, or semantic ambiguity. Ordinary supported downloads must remain independent of model availability.

---

# 2. Problem Evidence

## 2.1 Download transport itself is a mature problem

**Evidence.** Mature download managers already provide HTTP/HTTPS downloading, resume/retry, browser integration, queues, automation, multi-protocol support, and task recovery.

Gopeed, for example, documents HTTP/HTTPS, BitTorrent, magnet and ed2k support, pause/resume/retry, batch operations, restart recovery, browser integration, REST API and CLI support.

Source:

- https://github.com/GopeedLab/gopeed

**Inference.** xDownload should not expect basic transport to be a defensible differentiator. A strong basic downloader is necessary product quality, but it is not the product thesis.

---

## 2.2 Resource discovery and site adaptation remain real problems

**Evidence.** Existing products devote substantial functionality to discovering resource URLs that are not obvious to the user.

JDownloader's LinkGrabber collects links from clipboard input and can perform “deep decryption” by loading an unknown URL and searching source content for links.

Source:

- https://jdownloader.org/knowledge/wiki/glossary/linkgrabber

Gopeed's browser extension explicitly advertises “Sniff web resources”.

Source:

- https://github.com/GopeedLab/browser-extension

Motrix Extension exposes a Sniffer view that lists video, audio and images loaded by the current page and allows image filtering by format, dimensions and size.

Source:

- https://github.com/motrixapp/motrix-extension

Video DownloadHelper continues to invest in streaming-site capture; its June 2026 v10.5 release notes describe a reworked streaming engine and preferred audio/subtitle language selection.

Source:

- https://v10.downloadhelper.net/changelog

**Inference.** Resource discovery is sufficiently valuable that multiple download products have first-class discovery/sniffing layers rather than treating URLs as always known.

---

## 2.3 Extractor maintenance and site change are persistent costs

**Evidence.** yt-dlp maintains a very large extractor catalog and explicitly warns that listed sites are not guaranteed to work because websites change; it states that the reliable test is to try the URL. It also provides a generic extractor for many embedded or otherwise unsupported cases.

Sources:

- https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
- https://github.com/yt-dlp/yt-dlp/wiki/FAQ

A concrete 2026 community example: JDownloader users reported YouTube playlist acquisition breaking after YouTube changed playlist internals; the temporary workaround was adding individual video URLs one by one.

Source:

- https://www.reddit.com/r/jdownloader/comments/1u7bw2g/playlist_download_not_working/

**Inference.** A downloader that depends on site-specific knowledge has a continuous adaptation problem. This supports xDownload's “template/recipe + repair” thesis, but does not prove that LLM reasoning is the best or cheapest repair mechanism.

---

## 2.4 Collection tasks create discovery, filtering and organization work beyond byte transfer

**Evidence.** Existing workflows for playlists and page resources frequently require users to:

- trigger collection parsing;
- distinguish the desired media from thumbnails/metadata/alternate formats;
- configure variants;
- choose destination/package organization;
- deal with site-specific failures.

Example community workflow for a YouTube playlist in JDownloader: add the playlist URL, let LinkGrabber search, select/sort the files, then start downloads; users report confusion when thumbnails/text files appear instead of desired media and when playlist handling changes.

Source:

- https://www.reddit.com/r/jdownloader/comments/1mqtmc0/stepbystep_guide_on_how_to_download_a_youtube/

Another user explicitly described JDownloader playlist handling as having “too many options” and wanting batch playlist download to be easier.

Source:

- https://www.reddit.com/r/jdownloader/comments/1fb5nm6/how_to_use_jdownloader_2_to_download_playlists/

Playlist organization also creates extra work, such as preserving item position or placing the collection into the intended folder structure.

Sources:

- https://www.reddit.com/r/jdownloader/comments/vtbiug/is_there_a_way_to_download_the_youtube_playlists/
- https://www.reddit.com/r/Piracy/comments/c6jwog/in_jdownloader_2_how_do_i_make_it_so_that_each/

**Inference.** The user problem is often not “transfer this URL” but “obtain this meaningful set of resources in the right form and organization.” That is a stronger product opportunity than transport acceleration alone.

---

# 3. User Workflow Evidence

The following workflows are supported by current product behavior and community usage. They are product evidence, not yet final acceptance criteria.

## 3.1 Direct file workflow

Typical flow:

```text
Known URL / browser download
→ browser interception or paste URL
→ choose target/location
→ transfer
→ resume/retry if needed
→ complete
```

This is already well served by classic download managers and should be treated as a baseline quality path.

---

## 3.2 Current-page media/resource workflow

Typical flow:

```text
Open page
→ browser extension observes network/page resources
→ list media/resources
→ user selects desired candidate/quality
→ downloader receives browser context where needed
→ download
```

This pattern is directly visible in Gopeed, Motrix Extension, Video DownloadHelper and other modern download managers.

**Product implication.** xDownload should not assume users know a final CDN URL. “Current page” can itself be a useful acquisition context.

---

## 3.3 Collection workflow

Typical flow:

```text
User provides explicit playlist/gallery/listing
→ product enumerates collection members
→ user filters/selects desired variants/items
→ batch acquisition
→ organize results
→ show partial/failure state when necessary
```

This workflow exists today but can be operationally noisy. The product opportunity is reducing repeated discovery and selection work without becoming an unbounded crawler.

---

## 3.4 Authenticated-resource workflow

Existing tools can use browser-provided session context to acquire resources the user is already authorized to access.

OmniGet describes browser-extension forwarding of cookies/referer for logged-in resources. yt-dlp documents account/cookie workflows for content requiring user authentication.

Sources:

- https://github.com/tonhowtf/omniget
- https://github.com/yt-dlp/yt-dlp/wiki/Extractors

**Product implication.** Local browser context propagation can be valuable, but credentials/tokens are a high-risk trust boundary. xDownload should maintain the product rule that models need not receive raw secrets.

---

## 3.5 Failure / site-change workflow

Typical current behavior:

```text
Known site workflow breaks
→ user sees missing/incorrect candidates or failure
→ update tool/plugin/extractor
→ change settings or use another tool
→ manually collect individual URLs as fallback
```

**Product implication.** Recovery and transparent fallback are part of product value. A system that “intelligently discovers” but silently downloads the wrong target is worse than a deterministic tool that asks the user once.

---

# 4. Alternatives / Competitors

## 4.1 yt-dlp — strongest extractor ecosystem baseline

Observed strengths:

- large built-in extractor catalog;
- generic extractor;
- playlist handling;
- format selection;
- cookies/auth support;
- mature CLI automation;
- active adaptation to site changes.

Sources:

- https://github.com/yt-dlp/yt-dlp
- https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md

Product lesson:

> Site knowledge can be encoded as deterministic extractors at large scale. xDownload must prove incremental value beyond “LLM can infer a URL.”

---

## 4.2 JDownloader — discovery + collection baseline

Observed strengths:

- LinkGrabber;
- deep-decryption of unknown links;
- packaging/filtering/sorting;
- mature collection/site plugin ecosystem.

Source:

- https://jdownloader.org/knowledge/wiki/glossary/linkgrabber

Observed weakness evidence:

- user-facing complexity around playlist options/variants;
- site changes can break collection crawling;
- fallback can become manual per-item URL acquisition.

Community sources:

- https://www.reddit.com/r/jdownloader/comments/1u7bw2g/playlist_download_not_working/
- https://www.reddit.com/r/jdownloader/comments/1fb5nm6/how_to_use_jdownloader_2_to_download_playlists/

Product lesson:

> Collection capability is valuable, but a collection workflow can still be too configuration-heavy or brittle.

---

## 4.3 Gopeed — modern manager + browser sniffing + AI/MCP counterexample

Observed strengths:

- modern cross-platform download manager;
- browser integration;
- JavaScript extension system;
- REST API and CLI;
- browser resource sniffing;
- MCP endpoint allowing AI agents to resolve, create and manage downloads with natural language.

Sources:

- https://github.com/GopeedLab/gopeed
- https://github.com/GopeedLab/browser-extension

Product lesson:

> “AI can control a download manager” and “browser can sniff resources” are already implemented product capabilities. They cannot be xDownload's unique product claim.

---

## 4.4 OmniGet — strongest direct counterexample to the original thesis

Observed strengths:

- desktop downloader;
- yt-dlp/FFmpeg integration;
- browser traffic sniffing for MP4/HLS/DASH/WebM/audio;
- deeper player search when ordinary sniffing is insufficient;
- playlist/gallery support through established engines;
- cookies/session handoff;
- MCP for Claude/Codex/Cursor and other agents;
- AI agents capable of queuing, inspecting, waiting for, diagnosing and retrying downloads.

Source:

- https://github.com/tonhowtf/omniget

Product lesson:

> A contemporary product already combines most of the surface ingredients that originally motivated xDownload. Therefore xDownload must be judged on a more specific user-value contract, not on assembling the same components.

---

## 4.5 Motrix Extension — semantic current-page selection evidence

Observed strengths:

- current-page resource Sniffer;
- video/audio/image discovery;
- filters by image format, dimensions and size;
- explicit acknowledgement that resource discovery does not guarantee successful acquisition;
- marks resources the backend cannot handle instead of pretending acceptance.

Source:

- https://github.com/motrixapp/motrix-extension

Product lesson:

> Discover → filter/select → acquire is already a useful browser-download mental model, and truthful “unsupported/failed” states are important product behavior.

---

## 4.6 Video DownloadHelper / classic browser integration

Video DownloadHelper continues to invest in streaming capture and media-track selection. IDM remains a widely known example of tight browser download interception through its Integration Module.

Sources:

- https://v10.downloadhelper.net/changelog
- https://data.internetdownloadmanager.com/register/new_faq/repair_idm_installation.html

Product lesson:

> Browser integration is expected quality for this category rather than differentiation by itself.

---

# 5. Counter-evidence

The L1 prompt requires evidence that may invalidate the product thesis. The following items are material.

## 5.1 Counter-evidence: AI integration is not whitespace

Gopeed and OmniGet already expose AI/MCP-driven download workflows. OmniGet additionally combines AI agents, browser sniffing and established media/gallery download engines.

**Consequence.** A PRD whose primary differentiated claim is “LLM-powered downloading” should be rejected.

---

## 5.2 Counter-evidence: most ordinary downloads do not need reasoning

Known direct files and supported media/collection templates are deterministic problems. Adding model calls to those paths would create latency, cost, failure modes and privacy concerns without clear user value.

**Consequence.** Product success must not depend on LLM use. The default should be deterministic/template-first execution.

---

## 5.3 Counter-evidence: mature extractor/template ecosystems may beat dynamic reasoning

yt-dlp demonstrates that a large body of site knowledge can be maintained as deterministic code. JDownloader similarly maintains plugins/decrypters.

**Consequence.** xDownload must test whether LLM-assisted template adaptation actually lowers maintenance/user cost versus ordinary extractor maintenance. It cannot assume this.

---

## 5.4 Counter-evidence: browser-based discovery is constrained and imperfect

Lazy loading, player behavior, transient URLs, split audio/video, auth context, cross-origin resources and DRM can make browser observations incomplete or misleading. Motrix explicitly warns that finding a resource does not guarantee successful download.

**Consequence.** Discovery success cannot equal acquisition success. Independent validation and truthful partial/unsupported states remain product requirements.

---

## 5.5 Counter-evidence: collection automation can become crawler complexity

A user request such as “find all PDFs across this domain” can be finite yet still be a general crawl. Unbounded or frontier-based discovery would expand xDownload into a crawler product with a different complexity profile.

**Consequence.** xDownload should retain an explicit Collection identity/membership boundary. Boundedness alone is insufficient.

---

## 5.6 Counter-evidence: full automation may be worse than one cheap confirmation

For semantically ambiguous cases, forcing a model to guess can reduce correctness. A single user confirmation may be cheaper and safer than additional autonomous exploration.

**Consequence.** Human-in-the-loop should be a normal product path. Product metrics should measure total user effort, not “percentage fully automatic.”

---

## 5.7 Counter-evidence: knowledge sharing may not generalize safely

Site patterns can vary by login state, geography, account entitlements, A/B tests, language, player version and temporary signed-resource behavior.

**Consequence.** Cross-user Recipe sharing is not a prerequisite for basic product success. Local Verified knowledge should be sufficient for the initial product thesis.

---

# 6. Product Shape Findings

## 6.1 Recommended product identity

Recommended product framing:

> **An intelligent targeted resource acquisition tool that helps users discover, select, reliably acquire, validate and organize network resources they are authorized to access.**

This is stronger than either:

- “download manager with an LLM”; or
- “small crawler.”

---

## 6.2 Recommended product hierarchy

### Layer 1 — Reliable direct acquisition

Must work without AI:

- direct HTTP/HTTPS resources;
- robust retry/resume behavior where safe;
- browser handoff;
- clear result/failure state.

### Layer 2 — Smart current-page acquisition

Examples:

- current page's attachments;
- current page's video/audio candidates;
- high-resolution images loaded by the page.

### Layer 3 — Explicit bounded collection acquisition

Examples:

- explicit playlist;
- explicit gallery;
- explicit listing with bounded continuation;
- user-selected finite resource group.

Collection requires identifiable membership; arbitrary site-wide frontier exploration is outside the product.

### Layer 4 — Bounded AI fallback

Use only when deterministic knowledge is insufficient:

- unknown player/provider pattern;
- template mismatch;
- site change;
- unresolved semantic ambiguity where user confirmation alone is insufficient.

---

## 6.3 Template-first is supported by the evidence

The problem space appears dominated by recurring classes rather than unconstrained reasoning:

- direct file;
- direct media;
- HLS/DASH media;
- current-page attachments;
- gallery;
- playlist;
- paginated listing;
- authenticated resource;
- split media tracks;
- expiring/signed resource.

**Hypothesis.** A limited set of Acquisition Templates may cover a high proportion of valuable tasks.

This hypothesis must be measured; current evidence does not establish a coverage percentage.

---

## 6.4 User assistance should be first-class

Recommended product modes:

- `AUTO`
- `ASSISTED`
- `MANUAL_SELECTION`

The product should prefer the minimum necessary interaction. A task is still successful if the system performs discovery and batch work but asks the user to resolve one material ambiguity.

---

## 6.5 Validation is part of the product, not only engineering

The product must distinguish:

```text
resource discovered
≠ target confirmed
≠ transfer complete
≠ file/format valid
≠ collection complete
```

This should remain visible in PRD acceptance semantics because wrong-target false success directly damages user trust.

---

## 6.6 Initial product scope should be narrower than the full downloader category

Recommended initial evidence slices:

1. Direct file acquisition baseline.
2. Current-page attachment/resource selection.
3. Explicit playlist/gallery acquisition.
4. One bounded paginated-list collection scenario.
5. Hard cases requiring user confirmation or AI-assisted template adaptation.

Defer from initial product-value proof:

- general site crawling;
- continuous monitoring/recrawl;
- full website/course mirroring;
- BitTorrent/magnet/eMule competition;
- broad cloud-drive proprietary protocol support;
- DRM/access-control circumvention;
- public Recipe network effects.

---

# 7. Key Assumptions and Validation Plan

The following assumptions are still **UNPROVEN** and should become explicit PRD gates or experiments where appropriate.

## A1 — Bounded collection acquisition creates meaningful user value

Hypothesis:

Users complete selected collection tasks with lower total effort than using current tools/manual workflows.

Measure:

- task success/correctness;
- active user time;
- manual actions;
- confirmations;
- recovery actions;
- post-download reorganization effort.

Required comparison:

- current conventional workflow;
- xDownload current-page batch;
- xDownload bounded navigation;
- semantic selection enabled/disabled;
- organization enabled/disabled.

---

## A2 — Assisted acquisition preserves value without requiring full automation

Hypothesis:

A small number of targeted confirmations substantially improves correctness while still reducing total user effort.

Measure:

- confirmations per task;
- user decision time;
- wrong-target rate;
- task completion time;
- abandonment rate.

Disconfirming evidence:

If common tasks require repeated per-item confirmation, the assisted workflow may not provide meaningful value.

---

## A3 — Template-first execution covers the majority of valuable scenarios

Hypothesis:

Most valuable tasks map to a bounded set of deterministic Acquisition Templates.

Measure:

- percent of Natural Corpus tasks resolved deterministically;
- percent resolved via known template;
- percent requiring user assistance;
- percent requiring AI adaptation;
- unsupported percent.

Do not set a success threshold until exploratory data establishes a plausible distribution; confirmation thresholds must then be frozen before independent confirmation.

---

## A4 — Validation can prevent false-success outcomes at acceptable cost

Hypothesis:

Independent target/transfer/format/media/coverage evidence prevents common false positives without making routine tasks cumbersome.

Measure:

- false-success rate;
- false-failure rate;
- validation latency;
- user interventions caused by validation uncertainty.

---

## A5 — Browser integration is sufficient for the intended P0 discovery slices

Hypothesis:

A Chromium-first browser observer can capture enough evidence for current-page attachments/media and selected bounded collection flows.

Disconfirming evidence:

If high-value scenarios systematically require arbitrary page automation or unrestricted navigation, the product boundary may need narrowing rather than expanding into a crawler.

---

## A6 — AI provides incremental value on a hard subset

Hypothesis:

On tasks where deterministic/template paths fail, bounded AI assistance improves successful resolution without unacceptable latency/cost/error.

Required comparison:

- same hard-task corpus;
- same browser/auth context;
- same allowed tools/budgets;
- deterministic/template baseline vs AI-assisted path;
- independent truth source.

AI must not receive credit for success caused only by extra user work or relaxed target semantics.

---

## A7 — Local knowledge reuse reduces repeated adaptation cost

Hypothesis:

A validated local Recipe/Template repair can solve subsequent same-pattern tasks with less reasoning and equal or better correctness.

Measure:

- model calls avoided;
- time saved;
- cross-page/session success;
- regression rate;
- maintenance/repair cost.

---

## A8 — Shared knowledge is optional and may fail independently

Hypothesis:

Cross-user Recipe sharing may create additional value, but basic product value does not depend on it.

This should remain a later gate, not a Product Freeze prerequisite for the initial release scope unless the PRD explicitly chooses otherwise.

---

# 8. Recommended Experiment Corpora

## Natural Corpus

Representative ordinary tasks used to measure whether xDownload is a good downloader/acquisition product at all.

Examples:

- direct downloadable file;
- current-page attachment;
- current-page media;
- explicit small playlist/gallery.

Purpose:

- Product Value / non-regression.

---

## Collection Corpus

Tasks specifically designed to isolate collection-value increments.

Examples:

- all attachments on current page;
- explicit gallery;
- explicit playlist;
- bounded paginated listing.

Purpose:

- Batch vs Navigation vs Semantic Selection vs Organization attribution.

---

## Hard Corpus

Cases where deterministic/template baseline initially fails or is meaningfully ambiguous.

Purpose:

- AI Increment and Assisted Acquisition evaluation.

---

## Holdout Corpus

Previously unseen pages/sessions/profile states/templates.

Purpose:

- local knowledge/template generalization and repair validation.

---

# 9. Recommended Baselines

At minimum compare against representative workflows from:

- browser-native downloading;
- yt-dlp;
- JDownloader;
- a modern browser-integrated download manager such as Gopeed or Motrix;
- a modern AI/sniffer downloader such as OmniGet where relevant.

The baseline must be chosen by task shape rather than forcing one tool onto every scenario.

---

# 10. Recommended Product Metrics

Do not use “LLM success rate” as the primary product metric.

Recommended product-level metrics:

1. **Correct task completion rate** — did the user obtain the intended resource(s)?
2. **False-success rate** — did the system claim success while returning the wrong/incomplete target?
3. **Active user time** — time requiring attention/actions.
4. **Manual action count** — clicks/selections/commands.
5. **Confirmation count and decision time** — cost of Assisted mode.
6. **Recovery cost** — actions/time after failure/site change.
7. **Organization cleanup cost** — renaming/moving/dedup work after acquisition.
8. **Deterministic/template coverage** — percent handled without AI.
9. **AI incremental success on hard tasks** — measured only against a frozen hard-task baseline.
10. **Knowledge reuse benefit** — reduced reasoning/maintenance on subsequent tasks with correctness non-regression.

Economic benefit is currently:

`NOT_MEASURED`

No claim of monetization, cost savings, willingness-to-pay or ROI is established by this L1.

---

# 11. Product Boundaries Recommended for PRD

## MUST remain in scope for initial product validation

- reliable supported direct downloads;
- browser-assisted current-page discovery;
- explicit bounded collection acquisition;
- semantic filtering/selection where it reduces user effort;
- user-assisted confirmation where needed;
- truthful validation/failure/partial states;
- Template-first deterministic execution;
- bounded AI fallback for knowledge gaps.

## MUST remain explicit non-goals unless later evidence reopens scope

- DRM circumvention;
- paywall/access-control bypass;
- credential theft or protected-key extraction;
- arbitrary site-wide crawling;
- open-ended recursive discovery;
- general-purpose scraping/indexing;
- silent expansion beyond the user's acquisition target;
- arbitrary executable Recipe/browser scripts;
- requiring model availability for ordinary supported downloads.

## SHOULD be deferred from initial Product Freeze unless separately justified

- public/shared Recipe registry;
- continuous site monitoring;
- full website/course mirroring;
- BitTorrent/magnet/eMule parity;
- broad cloud-drive proprietary protocol support;
- large protocol/platform matrices that do not contribute to the first validated user-value slice.

---

# 12. Product Shape Decision

The evidence supports the following product shape for the successor PRD:

```text
xDownload
=
Reliable Download Foundation
+
Smart Current-page Acquisition
+
Explicit Bounded Collection Acquisition
+
Human-assisted Ambiguity Resolution
+
Independent Validation
+
Template-first Knowledge Reuse
+
Bounded AI-on-Gap
```

The evidence does **not** support the following primary positioning:

```text
AI downloader
```

or:

```text
general crawler with download output
```

The recommended user-facing mental model remains:

> “Tell xDownload what accessible resource or collection you want to save; it helps find the right items, lets you confirm ambiguity, gets them reliably, validates the result, and organizes them.”

---

# 13. Recommendation

## Decision

**PROCEED WITH NARROWING + REFRAME**

Proceed to the successor PRD only if it preserves these evidence-backed constraints:

1. Basic product value is independent of AI.
2. Collection capability is explicit and membership-bounded, not general crawling.
3. Full automation is not required; low-cost user confirmation is valid.
4. Template-first deterministic handling is the default product strategy.
5. Validation is part of user-visible correctness, not only implementation detail.
6. AI value, local knowledge compounding and shared knowledge are separate gates and may fail independently.
7. Initial release scope is intentionally narrow enough to run meaningful product-value confirmation.

## What this L1 does NOT prove

This L1 does not prove:

- that users will prefer xDownload over current tools;
- that bounded collection acquisition produces sufficient net benefit;
- that AI materially improves hard-case success;
- that local Recipes generalize reliably;
- that shared Recipes are safe or economically valuable;
- that the product has a sustainable monetization model;
- that any technical architecture is feasible or preferred;
- that any release candidate is ready.

Those remain downstream product/architecture/validation questions.

---

# 14. Source Register

Accessed 2026-10-02 unless otherwise noted.

## Primary / vendor / project sources

1. yt-dlp supported sites — https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
2. yt-dlp FAQ — https://github.com/yt-dlp/yt-dlp/wiki/FAQ
3. yt-dlp Extractors / authenticated cases — https://github.com/yt-dlp/yt-dlp/wiki/Extractors
4. JDownloader LinkGrabber — https://jdownloader.org/knowledge/wiki/glossary/linkgrabber
5. Gopeed — https://github.com/GopeedLab/gopeed
6. Gopeed browser extension — https://github.com/GopeedLab/browser-extension
7. OmniGet — https://github.com/tonhowtf/omniget
8. Motrix Extension — https://github.com/motrixapp/motrix-extension
9. Video DownloadHelper changelog — https://v10.downloadhelper.net/changelog
10. IDM browser integration troubleshooting — https://data.internetdownloadmanager.com/register/new_faq/repair_idm_installation.html

## Community workflow / failure evidence

11. JDownloader playlist break after site change (2026) — https://www.reddit.com/r/jdownloader/comments/1u7bw2g/playlist_download_not_working/
12. JDownloader playlist workflow / confusing output — https://www.reddit.com/r/jdownloader/comments/1mqtmc0/stepbystep_guide_on_how_to_download_a_youtube/
13. JDownloader “too many options” playlist workflow — https://www.reddit.com/r/jdownloader/comments/1fb5nm6/how_to_use_jdownloader_2_to_download_playlists/
14. Playlist position naming — https://www.reddit.com/r/jdownloader/comments/vtbiug/is_there_a_way_to_download_the_youtube_playlists/
15. Playlist folder organization — https://www.reddit.com/r/Piracy/comments/c6jwog/in_jdownloader_2_how_do_i_make_it_so_that_each/

Community evidence is directional rather than statistically representative and must not be treated as population-level prevalence data.
