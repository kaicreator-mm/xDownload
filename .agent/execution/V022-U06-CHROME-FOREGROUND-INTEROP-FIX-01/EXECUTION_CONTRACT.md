# Execution Contract — V022-U06-CHROME-FOREGROUND-INTEROP-FIX-01

## Identity

- Issue: xDownload #347 (follow-up to #332).
- Exact base: 4d2148b80976532cecfaddc111c7fdc94980a289.
- Base tree: 78246a75ef4951328b17f27b2f9da0b0824d90a4.
- Task branch: task/v0.2.2-u06-chrome-foreground-interop-fix-r1.
- Task Pack blob: 989b8434293abcfbda731ea15b34370bd4fa434c.
- Exact source write set: apps/browser-extension/test/chrome-toolbar-active-tab.mjs only.

## Admission

Owner authorization is recorded at #347 comment 6616544705. Publish a fresh accepted LOCAL_BUILDER DISPATCH_CLAIMED bound to this R1 manifest and exact base before source mutation. The Local Builder must implement the fix and complete local verification; do not dispatch LOCAL_VALIDATION-only work.

## Required behavior

- Declare user32.dll GetForegroundWindow on the U06ActionMouse interop type used by UIA_TOOLBAR_ACTION_PS1.
- Keep the screenshot privacy boundary fail-closed: Chrome must be foreground and no other visible top-level window may overlap Chrome bounds.
- Preserve existing skip reasons; never widen to full desktop.
- Preserve genuine toolbar-click-only activeTab positive semantics, isolated Chrome profile, atomic fresh --out, manifestUnchanged predicate, and denial-only control.
- If desktop is locked or grant cannot run, keep grant evidence NOT_RUN; never downgrade it to PASS.

## Required validation

1. Node 24 syntax check and changed-file Prettier before CI.
2. Compile/execute the generated PowerShell interop declaration in a real PowerShell process and verify GetForegroundWindow returns an IntPtr without missing-member errors.
3. Browser denial control using a fresh temporary profile.
4. Real toolbar grant only if the desktop is unlocked; otherwise explicit NOT_RUN with reason.
5. Typecheck and aggregate pnpm run ci:verify.
6. Local Docker Woodpecker exact candidate SHA, Build ID, pipeline and step exit codes.
7. Fresh independent Exact-SHA review.

No production extension, manifest, permissions, worker, popup, Core, Host, IPC, package, lockfile or CI changes. No real download, Native Host, registry side effect, main/version merge, release or deployment.