# Implementation Map — exact base 9e3ccd382311619e60b8d2a7373e8a7d34733334

This is a read-only map of the base source. It does not widen the Task Pack write set.

| File | Existing responsibility | Bounded implementation focus |
|---|---|---|
| `apps/browser-extension/src/popup/popup.html` | Popup S6 collection form, v0.2 advanced fields, mode tabs and accessible panels | Render/annotate fields from local descriptor while preserving existing DOM IDs, tab relationships and explanatory text. |
| `apps/browser-extension/src/popup/popup.js` | Popup mode state, S6 prepare/walk/confirm/execute/restore, v0.2 submission and status polling | Add allowlisted descriptor renderer, single-flight generation-bound poll controller and localized known scan-denial mapping. Preserve message payloads. |
| `apps/browser-extension/test/popup-s5-admission.test.ts` | Popup VM harness, S5/S6 admission, restored journey, localization, keyboard/theme/accessibility tests | Add positive/negative schema tests, deferred-response race tests and permission-denial exact-diagnostic/no-side-effect tests. |

## Known base facts

- S6 already uses explicit Core messages for prepare, page admission/record, confirmation and execution; do not change those payload contracts.
- S6 member selection is based on Core-minted member IDs and Core facts; preserve that authority.
- The current popup includes four mode tabs and keyboard navigation; retain the existing accessible relationship and no-side-effect tab switching.
- The package build copies the popup HTML/JS and icon. This Task does not authorize packaging changes.
- The exact current blobs are recorded in the Task proposal #328 and must be re-read at the admitted task base before implementation.
