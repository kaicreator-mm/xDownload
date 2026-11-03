# Task Pack — V022-U06-CHROME-FOREGROUND-INTEROP-FIX

> TASK_PACK_STATE: PROPOSAL / OWNER_APPROVAL_REQUIRED / NOT_SOURCE_CLAIM
> Parent: #332 U06 harness
> Current WIP: wip/v0.2.2-ui-rebuild-r0
> Exact approved base R1: 4d2148b80976532cecfaddc111c7fdc94980a289
> Base tree: 78246a75ef4951328b17f27b2f9da0b0824d90a4
> ADS: v4.18.0 / 2c395c55569fe2edf3f4135f12d3d069e526d0b7

## Goal

Repair the U06 test-only Chrome screenshot privacy precheck so its foreground-window probe can actually execute. The current grant-mode script calls U06ActionMouse.GetForegroundWindow(), but the generated U06ActionMouse C# interop class declares SetForegroundWindow, SetCursorPos and mouse_event only. GetForegroundWindow exists in a different generated PowerShell process/type (U06Desktop), so it is unavailable in U06ActionMouse and the optional screenshot path always fails closed.

## Exact write set

Exactly one path:

- apps/browser-extension/test/chrome-toolbar-active-tab.mjs

No other path is permitted. This is a harness-only correction; no production extension, manifest, permissions, background worker, popup, Core, Host, IPC, package, lockfile or CI change.

## Required correction

1. Add the correct user32.dll GetForegroundWindow P/Invoke declaration to the U06ActionMouse type that is used by the grant-mode screenshot precheck, with the exact IntPtr return type and no unrelated API additions.
2. Preserve the existing fail-closed privacy rule: capture only when Chrome is foreground and no other visible top-level window overlaps its bounds.
3. Preserve skip reasons and never fall back to a full-desktop screenshot or widen the capture region.
4. Preserve atomic exclusive --out creation, fresh temporary Chrome profile, toolbar-click-only grant semantics, denial control, manifestUnchanged predicate, and SOURCE_SCOPE_ASSERTION labels.
5. If Windows is locked or the real toolbar grant cannot be performed, record grant path as NOT_RUN with the exact reason; never report PASS.

## Required validation

- Node 24 syntax check and changed-file Prettier before CI.
- Exercise the generated PowerShell interop declaration in a real PowerShell process; confirm U06ActionMouse exposes GetForegroundWindow and returns an IntPtr without a missing-member exception.
- Run the Browser denial control in a fresh temporary profile.
- If the desktop is unlocked, run genuine toolbar-action grant mode and verify screenshot capture/skip behavior under the existing privacy boundary. If locked, record NOT_RUN.
- Typecheck and aggregate pnpm run ci:verify.
- Local Docker Woodpecker exact-SHA SUCCESS with Build ID, pipeline number and step exit codes.
- Independent Exact-SHA review after implementation.

## Admission and sequencing

- This is a new repair Task because the original U06 PR #334 is already merged at 5880731aa84601373c028e45f2ec0380e521686f and the current WIP base has advanced to a3e1b22c200ef11a942dacc953e2bfecdc3db03c.
- The prior U06 execution pack is historical and cannot be reused as a current-base Claim.
- A fresh Execution Pack, JIT branch and accepted LOCAL_BUILDER DISPATCH_CLAIMED are required after Owner approval.
- The Local Agent is a BUILDER and must complete the code repair and its local verification; do not dispatch LOCAL_VALIDATION-only work.

## Forbidden

- No write outside the one-file write set.
- No direct popup navigation as positive activeTab evidence.
- No real download, Native Host, registry or permission side effect.
- No main/version merge, release or deployment.
- No Product/L1 or L2 change.