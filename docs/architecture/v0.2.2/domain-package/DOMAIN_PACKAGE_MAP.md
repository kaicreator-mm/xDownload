# xDownload Domain Package Map

> Source baseline: wip/v0.2.2-ui-rebuild-r0@9e3ccd382311619e60b8d2a7373e8a7d34733334  
> Parent: #337 · A00 audit: #338 · A05 documentation task: #339

## Purpose

This document maps the current xDownload v0.2.x Domain Package structure and the intended v0.2.2 refinement boundary. It is a source-linked architecture index, not a new runtime specification.

## Current package inventory

| Package | Current responsibility | Current boundary issue | Target responsibility |
|---|---|---|---|
| packages/domain-contracts | Core-owned DTOs, schemas, validation, evidence, result projection and ports | Contains neutral contracts but not all Host-facing download contracts | Continue as neutral, pure contract package; add only genuinely shared Host-operation contracts |
| packages/download-domain-app | K/S/B/C declarations, Business Intents, semantic rules, integrations, migration policy and some runtime composition | Depends on Host, imports Host implementations, exports physical store/runtime assembly | Domain declarations, business policy, schemas, semantic recipe and Workflow definitions |
| packages/download-domain-host | Trusted Direct/HLS bridges, target registries and permit-gated physical effects | Depends on App and imports deep App source | Trusted C handlers, Host ports, registries and physical adapters; consumes neutral Contracts |
| packages/core-runtime | Core lifecycle, Core Seam, Scheduler, persistence and Domain App route | Imports deep App/Host paths and consumes App-owned physical FileCasDocStore | Sole production composition root with stable App/Host public APIs and injected Host ports |
| apps/cli, apps/desktop-shell, apps/browser-extension | Surface-specific UI/CLI and Core Seam consumption | Must not grow direct access to K, private journals or physical Host | Consume Core Seam and stable Core APIs only |

## Current source facts

- App manifest depends on Host: packages/download-domain-app/package.json.
- Host manifest depends on App: packages/download-domain-host/package.json.
- App Direct composition imports Host Direct implementation.
- App S4 integration imports Host HLS bridge.
- App media registry imports a Host target-ref helper.
- Host Direct and Media bridges import deep App contract paths.
- Core Runtime composes the Domain App route but imports deep App and Host source.
- App root exports FileCasDocStore and runtime assembly functions.

The exact source evidence and blob SHAs are in A00 report R1.

## Target dependency direction

\`\`\`text
                 domain-contracts
                   ^          ^
                   |          |
        download-domain-app  download-domain-host
                   ^          ^
                   |          |
                   +---- core-runtime
                              |
                           apps / UI
\`\`\`

App and Host may both depend on neutral Contracts. Core Runtime composes App and Host. App must not depend on Host. Host must not depend on App. Apps must not load K or physical Host implementations directly.

## Domain App ownership

Keep in Domain App:
- Business Intent and user-confirmation semantics.
- K/S/B/C declarations and stable Business ABI.
- Workflow definitions and business policy.
- Semantic recipe, finite-membership selection and advisory constraints.
- T09 migration policy if retained as a supported module.

Move out of App:
- Physical SDK V10DocStore adapter.
- Direct/HLS Host implementations and physical effects.
- Host registries and locator-resolution implementation.
- Production runtime assembly and alternate production K-load entrypoints.

## Host ownership

Host owns:
- Direct acquisition C handler.
- Media/HLS acquisition C handler.
- TargetRef and MediaTarget registries seeded by trusted composition.
- Physical file/network adapters and SDK Host-port implementations.
- Permit verification immediately before physical effects.

Host does not own:
- Business Intent admission policy.
- K Effect Journal or Permit authority.
- A second download engine, Scheduler or Workflow engine.
- UI state or Agent Tool policy.

## Core Runtime ownership

Core Runtime owns:
- Production BUILD and K lifecycle composition.
- Host port injection.
- Core Seam binding and transport replay.
- RouteLog and Core durability composition.
- One selected production K instance per runtime process.

It must not duplicate Domain App business rules or bypass K for external effects.

## Status

This map reflects the A00 exact source baseline. The target architecture is planned, not yet source-implemented. Current WIP must be re-read before any Task dispatch or integration.