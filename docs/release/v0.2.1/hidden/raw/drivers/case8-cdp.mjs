// Case 8 — renderer IPC isolation review of the PACKAGED desktop exe via CDP.
// Probes: node globals absent, preload bridge shape, window.open denied,
// navigation guard denies external URL, restrictive CSP blocks inline script.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, logRun } from './lib.mjs';

const CDP = 'http://127.0.0.1:49661';
const OUT = path.join(BASE, 'case8');
fs.mkdirSync(OUT, { recursive: true });

async function getPageWs() {
  const list = await (await fetch(`${CDP}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  return page.webSocketDebuggerUrl;
}

const ws = new WebSocket(await getPageWs());
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((r) => { ws.onopen = r; });
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result;
}

const results = {};

// P1: node integration globals must be undefined in the sandboxed renderer.
results.nodeGlobals = await evaluate(
  'JSON.stringify({require: typeof window.require, process: typeof window.process, ' +
  'Buffer: typeof window.Buffer, module: typeof window.module, global: typeof window.global, ' +
  'nodeG: typeof globalThis.process, ffi: typeof window.ffi, koffi: typeof window.koffi})',
);

// P2: what the preload bridge exposes (shape only).
results.bridgeShape = await evaluate(
  'JSON.stringify(Object.keys(window).filter(k => !["location","navigator","history","screen","top","parent","frames","window","self","document","performance","indexedDB","crypto","fetch","XMLHttpRequest","WebSocket","EventSource","localStorage","sessionStorage","alert","confirm","prompt","close","open","postMessage","focus","blur","print","stop","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","requestIdleCallback","cancelIdleCallback","matchMedia","getSelection","find","execCommand","setTimeout","clearTimeout","setInterval","clearInterval","queueMicrotask","createImageBitmap","crypto","indexedDB","speechSynthesis","trustedTypes","visualViewport","scheduler","navigation","cookieStore","launchQueue","ai","openDatabase","webkitConvertPointFromNodeToPage","webkitConvertPointFromPageToNode"].includes(k)))',
);

// P3: window.open to an external URL must be denied (no new target).
const targetsBefore = (await (await fetch(`${CDP}/json`)).json()).filter((t) => t.type === 'page').length;
results.openAttempt = await evaluate('window.open("https://example.com/", "_blank"); "open-called"');
await new Promise((r) => setTimeout(r, 1500));
const targetsAfter = (await (await fetch(`${CDP}/json`)).json()).filter((t) => t.type === 'page').length;
results.openTargetDelta = targetsAfter - targetsBefore;

// P4: navigation guard: assigning location to an external URL must not navigate.
results.navBefore = await evaluate('location.href');
await evaluate('try { location.href = "https://example.com/"; } catch (e) { } "nav-attempted"');
await new Promise((r) => setTimeout(r, 1500));
results.navAfter = await evaluate('location.href');

// P5: CSP: inject an inline script element; with default-src none it must not run.
results.csp = await evaluate(
  'const s = document.createElement("script"); s.id="csp-probe"; s.textContent = "window.__cspRan = true"; ' +
  'document.documentElement.appendChild(s); JSON.stringify({ran: window.__cspRan === true, hasCSPMeta: !!document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\'), cspContent: document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\')?.content ?? null})',
);

// P6: served page origin must be a local file (no remote load).
results.pageUrl = await evaluate('location.href');

logRun({ event: 'case8-cdp', ...results });
fs.writeFileSync(path.join(OUT, 'cdp-probes.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
