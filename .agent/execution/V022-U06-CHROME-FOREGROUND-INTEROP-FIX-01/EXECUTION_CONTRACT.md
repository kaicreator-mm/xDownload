# Execution Contract — V022-U06-CHROME-FOREGROUND-INTEROP-FIX-01

## Identity

- Issue: xDownload #347 (follow-up to #332).
- Exact base: a3e1b22c200ef11a942dacc953e2bfecdc3db03c.
- Base tree: 0a39b3e2b18479fd8f66d1c4c69c22a3c6e44bf7.
- Task branch: task/v0.2.2-u06-chrome-foreground-interop-fix.
- Task Pack blob: 47eb80b65c9fd8b680824e8cebff5f30f8b66a57.
- Exact source write set: apps/browser-extension/test/chrome-toolbar-active-tab.mjs only.

## Admission

Owner approval is pending at #347. Do not publish a Builder Claim or mutate source until the Owner explicitly approves the exact base and one-file write set. After approval, publish a fresh accepted LOCAL_BUILDER DISPATCH_CLAIMED bound to this manifest and base.

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