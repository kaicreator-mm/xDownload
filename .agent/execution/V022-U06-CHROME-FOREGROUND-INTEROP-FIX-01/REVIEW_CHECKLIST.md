# Independent Review Checklist — U06 foreground interop fix

- [ ] Exact candidate HEAD/tree/base re-read (R1 base: `4d2148b80976532cecfaddc111c7fdc94980a289`, tree `78246a75ef4951328b17f27b2f9da0b0824d90a4`).
- [ ] Changed paths exactly chrome-toolbar-active-tab.mjs.
- [ ] U06ActionMouse declares GetForegroundWindow in the same PowerShell type/process that calls it.
- [ ] PowerShell interop compiles and method invocation returns IntPtr without exception.
- [ ] Screenshot remains limited to foreground, unoccluded Chrome bounds.
- [ ] No full-desktop fallback; all skip paths retain explicit reason.
- [ ] Existing atomic --out, fresh profile, manifestUnchanged and genuine toolbar click constraints remain intact.
- [ ] Node24 syntax, Prettier, typecheck, ci:verify and exact-SHA Woodpecker PASS.
- [ ] Grant positive is PASS only if genuinely executed on unlocked desktop; otherwise NOT_RUN.
- [ ] Independent Exact-SHA review P0/P1/P2 recorded.
- [ ] No production source, Product/L2, main/version, release or deployment changes.