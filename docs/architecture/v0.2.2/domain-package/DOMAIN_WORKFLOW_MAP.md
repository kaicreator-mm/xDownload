# xDownload Domain Workflow Map

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00: #338 · A05: #339

## Workflow layers

| Layer | Owner | Example | Meaning |
|---|---|---|---|
| Domain Workflow Definition | Business package (B) | download-acquisition, s4-hls-vod | Declarative states, transitions, guards and effect intents |
| Workflow execution | DomainHarness K | K load / Effect Journal / Permit | Governed execution and durable effect lifecycle |
| C Operation | App declaration + Host implementation | acquisition.acquire, media.acquire | Physical effect invoked only through K permit |
| Domain Journey | Domain App TypeScript | S2/S3/S5/S6 journey functions | Decode, evaluate, confirm, submit and project |
| UI Journey | Desktop / Browser | form, selection, task detail, polling | User interaction; not a second business state machine |

## Primary Business Workflows

### Direct download acquisition

- Business module: packages/download-domain-app/src/business/business-download.mjs.
- Workflow key: download-acquisition.
- Business Intent: confirmDownload.
- Effect: effect:acquire.
- C Operation: acquisition.acquire.
- Host implementation: DirectAcquisitionBridge.
- Scope: confirmed targetRef, output root, operation, slice, optional digest/size and caller.
- Guard: declaredBytes profile bound in the sealed Business policy.
- Terminal semantics: only typed terminal Host outcome settles the effect.

### S4 HLS VOD

- Business module: packages/download-domain-app/src/integrations/s4-hls-vod-business.mjs.
- Workflow key: s4-hls-vod.
- Business Intent: confirmDownload with explicit S4 confirmed rendition selection.
- Effect: effect:acquire.
- C Operation: media.acquire.
- Host implementation: Media/HLS bridge over the existing hls-vod-adapter engine.
- Selection contract binds snapshot, member, preview, rendition, manifest, profile, tuple digest and validity window.
- Host re-observes the manifest and verifies the confirmed selection before segment requests.

## Domain Journeys

### S2 — Discovery / current-page attachment

Source: packages/download-domain-app/src/integrations/s2-discovery.ts.

1. Decode a finite declared member set and observations.
2. Evaluate the deterministic no-LLM semantic recipe.
3. Ambiguity returns a confirmation plan with zero effects.
4. A unique selection proceeds only with explicit confirmation for exactly that member.
5. Submit one S1 direct confirmed intent through the direct journey.

### S3 — Direct media file

Source: packages/download-domain-app/src/integrations/s3-media.ts.

- Sealed K/S/B/C composition with media.acquire.
- Host media bridge is permit-gated.
- Opaque targetRef resolves through trusted media registry.
- Existing HLS engine owns transfer and budget accounting; no second engine or private budget ledger.
- Journey verifies terminal envelope and materialized evidence.

### S5 — Current-page collection

Source: packages/download-domain-app/src/integrations/s5-collection.ts.

- Evaluate the finite declared current-page member set.
- The canonical full-match set is the collection scope.
- Batch confirmation must cover exactly the matched set, each member once.
- Each confirmed member becomes one direct intent in canonical order.
- COMPLETE requires every confirmed member to settle completed; counts/timeouts do not close coverage.

### S6 — Explicit playlist/gallery collection

Source: packages/download-domain-app/src/integrations/s6-navigation.ts.

- The explicitly declared finite member set is the scope.
- No discovery or crawl is performed by this entry.
- Batch confirmation must correspond exactly to the declared set.
- A strict subset re-asks; an extra/duplicate member refuses.
- Each declared member becomes one direct intent, exactly once.

## Function-to-Workflow mapping

- getPolicy() exposes a Business policy endpoint; it is not an Agent Tool.
- buildDownloadDomainApp() builds the sealed App package; it is not a user-facing operation.
- submitConfirmedDownload() is a Domain App journey function.
- runS2DiscoveryJourney(), runS5CollectionJourney() and runS6NavigationJourney() are domain journey functions.
- Core route composes K and exposes the v0.2 command through Core Seam.

## Boundary rules

- UI Journey may collect and confirm facts but cannot create a parallel business authority.
- Workflow Definition belongs to B; K executes it.
- C handler is a Host implementation, not a second Workflow engine.
- Agent Tool flow is a future separate adapter and is not present in this architecture refinement.