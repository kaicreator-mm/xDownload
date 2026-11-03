# Independent Review Checklist — v022-U06-DESKTOP-TERMINAL-AND-CHROME-ACTIVETAB-HARNESS-01

- [ ] Exact PR HEAD/tree and base re-read; base equals authorized WIP base or a separately authorized rebind.
- [ ] Aggregate changed paths are exactly the three frozen Task Pack paths.
- [ ] Default Desktop harness remains ACTIVE/no terminal.
- [ ] COMPLETE/FAILED fixtures are schema-valid, injected only after real submit admission and accepted by the existing Core Seam.
- [ ] CANCELLED uses the real renderer Cancel control.
- [ ] Each Desktop run is isolated, deterministic, cleans up and records Core raw dimensions plus actual DOM.
- [ ] Zero real downloads and zero Native Host calls.
- [ ] Single-resource COMPLETE coverage remains NOT_APPLICABLE; no fake VERIFIED_COMPLETE or renderer changes.
- [ ] Browser denial control is clearly labelled and is the only mode allowed to direct-open popup URL.
- [ ] Browser grant uses visible Chrome extension-action toolbar click; no openPopup, direct URL or CDP popup substitute.
- [ ] Locked/inaccessible desktop returns NOT_RUN and cannot be counted as PASS.
- [ ] Worker messages, permissions.request counts and zero-side-effect tab switching are recorded.
- [ ] No manifest/permission, popup/worker, production Core/Host, renderer, IPC, build, lockfile or CI changes.
- [ ] Node24 syntax/Prettier preflight precedes CI; typecheck, focused smoke, ci:verify and Woodpecker bind to exact SHA.
- [ ] Independent reviewer records P0/P1/P2 and PASS/BLOCK.
- [ ] No main/version merge, release or deployment.
