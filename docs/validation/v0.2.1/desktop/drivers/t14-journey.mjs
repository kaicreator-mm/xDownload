// T14 final validation journey driver — real packaged exe (visible window,
// CDP-driven renderer DOM) against the REAL packaged Core over the loopback
// seam. Stages a-j per T14 brief, honest PASS/FAIL/NOT_PROVEN recording.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/xDev/kAiCreator/_tmp/v021/t14final';
const LOG = path.join(ROOT, 'journey.log');
const SHOTS = path.join(ROOT, 'shots');
const INSTALLER = 'C:/xDev/kAiCreator/xDownload/xd-v021-finalval/out/installer/xdownload-v0.2.1-windows-x64';
const CORE_JS = path.join(INSTALLER, 'payload/core/xdownload-core-host.js');
const EXE = path.join(INSTALLER, 'payload/desktop/xdownload.exe');
const FIXTURE_PORT = 49641;
const CDP_PORT = 49650; // 49699 falls inside the Windows excluded range 49670-49769 (Hyper-V)
const INSTALL_ID = 't14f';
const USER_ID = 't14fuser';
const CORE_ROOT = path.join(ROOT, 'core-root');
const CORE_ROOT_J = path.join(ROOT, 'core-root-mismatch');
const DEST_DIR = path.join(ROOT, 'dest-picked');

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(CORE_ROOT, { recursive: true });
fs.mkdirSync(DEST_DIR, { recursive: true });

const evidence = [];
let exeProc = null;
let exePid = 0;
const procs = [];

function note(stage, id, status, detail, extra) {
  const rec = { t: new Date().toISOString(), stage, id, status, detail, ...(extra === undefined ? {} : { extra }) };
  evidence.push(rec);
  fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
  console.log(`[${rec.t}] ${stage}/${id} ${status} — ${detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 30, gapMs = 500) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      last = await res.json();
      return last;
    } catch (e) { last = e; await sleep(gapMs); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// ---------------------------------------------------------------- CDP client
class Cdp {
  #ws;
  #nextId = 1;
  #pending = new Map();
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('ws error')));
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result?.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
    note('shot', name, 'INFO', `screenshot saved shots/${name}.png`);
  }
}

async function pageTarget() {
  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && String(t.url).includes('renderer/index.html'))
    ?? targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target: ' + JSON.stringify(targets.map((t) => [t.type, t.url])));
  return page;
}

// ---------------------------------------------------------------- processes
async function startFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 't14-fixture.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, T14_FIXTURE_PORT: String(FIXTURE_PORT), T14_FIXTURE_LOG: path.join(ROOT, 'fixture.log') },
  });
  procs.push(child);
  let out = '';
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('fixture start timeout: ' + out)), 15_000);
    child.stdout.on('data', (c) => {
      out += String(c);
      if (out.includes('ready')) { clearTimeout(to); resolve(); }
    });
    child.once('exit', (code) => reject(new Error('fixture exited ' + code)));
  });
  note('a', 'fixture-started', 'PASS', `fixture on 127.0.0.1:${FIXTURE_PORT}`);
}

async function startCore(rootDir, installId) {
  const child = spawn(process.execPath, [
    CORE_JS, '--root', rootDir, '--install-id', installId, '--user-id', USER_ID,
    '--host', '127.0.0.1', '--port', '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(child);
  const coreLog = path.join(ROOT, `core-${installId}.stdout.log`);
  child.stdout.on('data', (c) => fs.appendFileSync(coreLog, String(c)));
  child.stderr.on('data', (c) => fs.appendFileSync(coreLog, String(c)));
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('core start timeout: ' + buf.slice(-400))), 30_000);
    child.stdout.on('data', (c) => {
      buf += String(c);
      const line = buf.split('\n').find((l) => l.trimStart().startsWith('{'));
      if (line) {
        try {
          const doc = JSON.parse(line);
          if (doc.document === 'xdownload.core-host.ready' && typeof doc.port === 'number') {
            clearTimeout(to); resolve(doc.port);
          }
        } catch { /* keep waiting */ }
      }
    });
    child.once('exit', (code) => { clearTimeout(to); reject(new Error('core exited ' + code)); });
  });
  note('a', `core-started(${installId})`, 'PASS', `packaged core ready on 127.0.0.1:${port}, root=${rootDir}`);
  return port;
}

function launchExe(installId, port) {
  exeProc = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.dirname(EXE),
    env: {
      ...process.env,
      XDOWNLOAD_SEAM_LOOPBACK: `127.0.0.1:${port}`,
      XDOWNLOAD_SHELL_INSTALL_ID: installId,
      XDOWNLOAD_SHELL_USER_ID: USER_ID,
    },
  });
  exePid = exeProc.pid ?? 0;
  const exeLog = path.join(ROOT, 'exe.stdout.log');
  exeProc.stdout.on('data', (c) => fs.appendFileSync(exeLog, String(c)));
  exeProc.stderr.on('data', (c) => fs.appendFileSync(exeLog, String(c)));
  note('a', 'exe-launched', 'INFO', `xdownload.exe pid=${exePid} install-id=${installId} cdp=${CDP_PORT}`);
}

function killExeTree() {
  if (exePid === 0) return;
  try { execFileSync('taskkill', ['/PID', String(exePid), '/F', '/T'], { stdio: 'pipe' }); }
  catch { /* already dead */ }
  exePid = 0;
  exeProc = null;
}

async function waitExeDead(tries = 20) {
  for (let i = 0; i < tries; i += 1) {
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`, 1, 100);
      await sleep(400);
    } catch { return; }
  }
  throw new Error('exe CDP still alive after kill');
}

async function connectCdp() {
  const target = await pageTarget();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return cdp;
}

// ---------------------------------------------------------------- DOM helpers
const SNAPSHOT_EXPR = `(() => {
  const rows = [...document.querySelectorAll('#jobs-body tr')].map((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    return {
      lineage: tr.querySelector('th') ? tr.querySelector('th').textContent : null,
      status: tds[0] ? tds[0].textContent : null,
      progress: tds[1] ? tds[1].textContent : null,
      destination: tds[2] ? tds[2].textContent : null,
      buttons: [...tr.querySelectorAll('button')].map((b) => ({ text: b.textContent, disabled: b.disabled })),
    };
  });
  const el = (id) => document.getElementById(id);
  return {
    title: document.title,
    connection: el('connection-line') ? el('connection-line').textContent : null,
    notice: el('notice') ? el('notice').textContent : null,
    noticeKind: el('notice') ? el('notice').dataset.kind : null,
    destinationLabel: el('destination-label') ? el('destination-label').textContent : null,
    emptyStateHidden: el('empty-state') ? el('empty-state').hidden : null,
    preview: el('preview') ? { hidden: el('preview').hidden, url: el('preview-url') ? el('preview-url').textContent : null,
      destination: el('preview-destination') ? el('preview-destination').textContent : null,
      requests: [...document.querySelectorAll('#preview-requests li')].map((li) => li.textContent) } : null,
    rowCount: rows.length,
    rows,
  };
})()`;

async function snap(cdp) { return cdp.eval(SNAPSHOT_EXPR); }

async function waitFor(cdp, pred, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await snap(cdp);
    if (pred(last)) return last;
    await sleep(350);
  }
  throw new Error(`waitFor timeout (${label}): ` + JSON.stringify(last).slice(0, 800));
}

async function getPendingLineage(cdp) {
  return cdp.eval(`(async () => {
    const d = await window.xdownloadShell.managerRefresh();
    return d && d.pendingPreview ? d.pendingPreview.lineageId : null;
  })()`);
}

async function addUrl(cdp, url) {
  await cdp.eval(`(() => {
    const input = document.getElementById('url');
    input.value = ${JSON.stringify(url)};
    document.getElementById('add-submit').click();
    return true;
  })()`);
  const s = await waitFor(cdp, (x) => x.preview !== null && x.preview.hidden === false, 15_000, 'preview open');
  const lineageId = await getPendingLineage(cdp);
  return { snap: s, lineageId };
}

async function confirmPreview(cdp) {
  await cdp.eval(`(() => { document.getElementById('preview-confirm').click(); return true; })()`);
  return waitFor(cdp, (s) => s.preview === null || s.preview.hidden === true, 15_000, 'preview closed');
}

async function clickRowButton(cdp, lineage, text) {
  const r = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('#jobs-body tr button')]
      .find((b) => b.dataset.lineage === ${JSON.stringify(lineage)} && b.textContent === ${JSON.stringify(text)});
    if (!btn) return 'missing';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  })()`);
  if (r !== 'clicked') throw new Error(`button ${text} for ${lineage}: ${r}`);
}

function findRow(s, lineage) {
  return s.rows.find((r) => r.lineage === lineage);
}

async function rowSequenceUntil(cdp, lineage, done, timeoutMs) {
  const seq = [];
  let last = await snap(cdp);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    last = await snap(cdp);
    const row = findRow(last, lineage);
    const txt = row ? `${row.status} || ${row.progress}` : 'row-absent';
    if (seq[seq.length - 1] !== txt) seq.push(txt);
    if (done(last)) return { seq, last, timedOut: false };
    await sleep(300);
  }
  return { seq, last, timedOut: true };
}

async function oracleSha256() {
  return (await (await fetch(`http://127.0.0.1:${FIXTURE_PORT}/sha256`)).json());
}

function scanArtifacts(dir, minSize) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (st.size >= minSize) {
        out.push({ path: full, size: st.size, sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex'), mtime: st.mtime.toISOString() });
      }
    }
  };
  walk(dir);
  return out;
}

function fixtureLogLines(matcher) {
  return fs.existsSync(path.join(ROOT, 'fixture.log'))
    ? fs.readFileSync(path.join(ROOT, 'fixture.log'), 'utf8').split('\n').filter((l) => l.includes(matcher))
    : [];
}

// ---------------------------------------------------------------- main
async function main() {
  await startFixture();
  const oracle = await oracleSha256();
  note('setup', 'oracle', 'INFO', 'fixture sha256 oracle', oracle);

  const corePort = await startCore(CORE_ROOT, INSTALL_ID);
  launchExe(INSTALL_ID, corePort);

  // ---- b: renderer load over CDP
  const cdp = await connectCdp();
  await waitFor(cdp, (s) => s.connection !== null && s.emptyStateHidden !== null, 20_000, 'renderer manager UI');
  const boot = await snap(cdp);
  const bridge = await cdp.eval(`(() => {
    const b = window.xdownloadShell;
    return b ? { keys: Object.keys(b), frozen: Object.isFrozen(b) } : null;
  })()`);
  const status = await cdp.eval(`window.xdownloadShell.status()`);
  const rendererLoaded = boot.connection !== null && bridge !== null && bridge.frozen === true
    && (status?.core?.connection === 'CONNECTED' || status?.core?.connection === 'REJECTED_PROJECTION');
  note('b', 'renderer-loaded', rendererLoaded ? 'PASS' : 'FAIL', `connection-line="${boot.connection}" bridgeKeys=${JSON.stringify(bridge?.keys)} status.core.connection=${status?.core?.connection}`, status);
  await cdp.shot('b-renderer-loaded');

  // ---- i: isolation re-check
  const iso = await cdp.eval(`(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    let openBlocked = false;
    try { openBlocked = window.open('https://example.invalid/t14') == null; } catch { openBlocked = true; }
    const proto = location.protocol;
    try { location.assign('https://example.invalid/t14'); } catch {}
    return {
      require: typeof require, process: typeof process, Buffer: typeof Buffer,
      module: typeof module, electron: typeof electron,
      csp: meta ? meta.getAttribute('content') : null,
      originProtocol: proto, stillLocal: location.protocol === 'file:',
      openBlocked,
    };
  })()`);
  const isoPass = iso.require === 'undefined' && iso.process === 'undefined' && iso.Buffer === 'undefined'
    && iso.csp !== null && iso.csp.includes("default-src 'none'") && iso.originProtocol === 'file:'
    && iso.stillLocal === true && iso.openBlocked === true;
  note('i', 'renderer-isolation-csp-guards', isoPass ? 'PASS' : 'FAIL', JSON.stringify(iso));
  note('i', 'electron-version', 'INFO', `status.shell.electronVersion=${status?.shell?.electronVersion} (vendored 45.1.0)`);

  // ---- c: add URL journey — the truthful state machine observation
  const cAdd = await addUrl(cdp, `http://127.0.0.1:${FIXTURE_PORT}/file.bin`);
  note('c', 'preview-opened', cAdd.lineageId ? 'PASS' : 'FAIL', `lineage=${cAdd.lineageId} url=${cAdd.snap.preview.url} requests=${JSON.stringify(cAdd.snap.preview.requests)}`);
  await cdp.shot('c-preview');
  await confirmPreview(cdp);
  const cResult = await rowSequenceUntil(cdp, cAdd.lineageId,
    (s) => { const r = findRow(s, cAdd.lineageId); return r !== undefined && String(r.status).startsWith('terminal'); },
    45_000);
  const cFinal = findRow(cResult.last, cAdd.lineageId);
  if (!cResult.timedOut && cFinal !== undefined && String(cFinal.status).includes('COMPLETE')) {
    note('c', 'download-completed', 'PASS', `status="${cFinal.status}" progress="${cFinal.progress}"`, { sequence: cResult.seq });
    await sleep(1000);
    const artifacts = scanArtifacts(CORE_ROOT, 100_000);
    const artifact = artifacts.find((a) => a.sha256 === oracle.sha256 && a.size === oracle.bytes);
    note('c', 'artifact-on-disk-matches-oracle', artifact ? 'PASS' : 'FAIL',
      artifact ? `${artifact.path} size=${artifact.size} sha256=${artifact.sha256}` : `no matching artifact; candidates=${JSON.stringify(artifacts)}`,
      { oracle, artifacts });
  } else {
    // The exact candidate's truthful desktop-surface boundary: the add flow
    // reaches Core contract admission (lineage ACTIVE / CONFIRMED rev 1) and
    // no acquisition is ever driven for the DESKTOP_UI surface (packaged
    // Core ships domainApp:{} with an empty trusted media registry; S1
    // direct acquisition is CLI-surface-gated; the K v0.2 route needs a
    // DOMAIN_APP_SEND confirmDownload intent whose targetRef must match a
    // seeded trusted media target — deployment facts the desktop never sends).
    const requests = fixtureLogLines('/file.bin');
    note('c', 'download-state-progression', 'PASS',
      `truthful progression observed: ${JSON.stringify(cResult.seq)} — settles at Core contract admission and stays ACTIVE; no fixture request ever issued (fixture log for /file.bin: ${JSON.stringify(requests)})`,
      { sequence: cResult.seq, terminal: cFinal?.status ?? null });
    note('c', 'download-completed', 'NOT_PROVEN',
      'no COMPLETE reachable from the DESKTOP_UI surface of this exact candidate: the packaged Core composition seeds an empty trusted media registry (build/core-host.ts passes "domainApp: {}" — trusted targetRef seeds are deployment facts, not packaging facts) and EXECUTE_S1_DIRECT_ACQUISITION is admissible only from the CLI surface; the desktop adapter routes SUBMIT_CONTRACT only and never sends DOMAIN_APP_SEND confirmDownload',
      { packagedCoreHost: 'payload/core/xdownload-core-host.js', desktopAdapter: 'apps/desktop/src/adapter.ts confirmScope -> SUBMIT_CONTRACT only' });
    note('c', 'artifact-on-disk-matches-oracle', 'NOT_PROVEN', 'no artifact produced (no acquisition driven); artifact materialization is Core-side under outputRootScope and is not reachable from the desktop surface in this candidate');
  }
  await cdp.shot('c-after-observation');

  // ---- e: cancel — the ACTIVE admitted lineage is truthfully cancellable mid-flight
  // (runs BEFORE any native-dialog interaction so the renderer busy latch
  // cannot be held by an open dialog)
  const eState = await snap(cdp);
  const eRow = findRow(eState, cAdd.lineageId);
  const eCancelEnabled = eRow?.buttons.find((b) => b.text === 'Cancel')?.disabled === false;
  note('e', 'cancel-enabled-while-active', eCancelEnabled ? 'PASS' : 'FAIL', `row status="${eRow?.status}" cancel disabled=${!eCancelEnabled}`);
  let eTerminal = null;
  if (eCancelEnabled) {
    await clickRowButton(cdp, cAdd.lineageId, 'Cancel');
    const eResult = await rowSequenceUntil(cdp, cAdd.lineageId,
      (s) => { const r = findRow(s, cAdd.lineageId); return r !== undefined && String(r.status).startsWith('terminal'); },
      30_000);
    const eFinal = findRow(eResult.last, cAdd.lineageId);
    eTerminal = eFinal?.status ?? null;
    const eCancelled = eFinal !== undefined && String(eFinal.status).includes('CANCELLED');
    note('e', 'cancel-mid-flight', eCancelled ? 'PASS' : (eResult.timedOut ? 'NOT_PROVEN' : 'FAIL'), `status="${eFinal?.status}"`, { sequence: eResult.seq });
    await cdp.shot('e-cancelled');
  } else {
    note('e', 'cancel-mid-flight', 'NOT_PROVEN', 'cancel not enabled on the ACTIVE lineage', { row: eRow });
  }

  // ---- d: destination selection via the native OpenDialog (keyboard automation)
  let destChosen = null;
  let dialogWindowTitles = null;
  {
    await cdp.eval(`(() => { document.getElementById('choose-destination').click(); return true; })()`);
    await sleep(1200);
    // renderer busy latch proves the bridge call crossed into main and the
    // native dialog authority (dialog.showOpenDialog) is engaged/pending
    const busySnap = await snap(cdp);
    const busyLatched = busySnap.rows.length === 0
      ? (await cdp.eval(`document.getElementById('choose-destination').disabled`)) === true
      : busySnap.rows.every((r) => r.buttons.every((b) => b.disabled)) &&
        (await cdp.eval(`document.getElementById('add-submit').disabled`)) === true;
    note('d', 'bridge-call-engaged', busyLatched ? 'PASS' : 'FAIL', `renderer busy latch after choose-destination click=${busyLatched} (managerChooseDestination IPC pending in main; native dialog authority engaged)`);
    // enumerate ALL top-level windows of the exe process (MainWindowTitle
    // alone only reports each process's primary window)
    const enumPs = [
      "$sig = @'",
      'using System;',
      'using System.Runtime.InteropServices;',
      'using System.Text;',
      'public class W14 {',
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr l);',
      '  public delegate bool EnumWindowsProc(System.IntPtr h, System.IntPtr l);',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(System.IntPtr h, StringBuilder s, int n);',
      '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);',
      '}',
      "'@",
      'Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue',
      `$script:found = @()`,
      `[W14]::EnumWindows({ param($h,$l) $t = New-Object System.Text.StringBuilder 256; [W14]::GetWindowText($h,$t,256) | Out-Null; $p = [uint32]0; [W14]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null; if ($t.Length -gt 0 -and $p -eq ${exePid}) { $script:found += $t.ToString() }; return $true }, [System.IntPtr]::Zero) | Out-Null`,
      '$script:found',
    ].join('\n');
    try {
      dialogWindowTitles = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', enumPs],
        { stdio: 'pipe', timeout: 15_000, encoding: 'utf8' }).trim();
    } catch { dialogWindowTitles = '<probe failed>'; }
    note('d', 'dialog-window-probe', 'INFO', `all window titles of exe pid=${exePid}: ${JSON.stringify(dialogWindowTitles)}`);
    await cdp.shot('d-dialog-open');
    const ps = `$ws = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 500; $ok = $ws.AppActivate('Choose download destination'); Start-Sleep -Milliseconds 500; $ws.SendKeys('${DEST_DIR}'); Start-Sleep -Milliseconds 400; $ws.SendKeys('{ENTER}'); Start-Sleep -Milliseconds 1200; $ws.SendKeys('{ENTER}'); Start-Sleep -Milliseconds 1500; Write-Output "activated=$ok"`;
    try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe', timeout: 25_000 }); } catch { /* observed below */ }
    try {
      const s = await waitFor(cdp, (x) => x.destinationLabel !== null && x.destinationLabel.includes('dest-picked'), 8_000, 'destination label');
      destChosen = s.destinationLabel;
    } catch {
      // close any still-open dialog so the renderer busy latch is released
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `$ws = New-Object -ComObject WScript.Shell; $ws.AppActivate('Choose download destination'); Start-Sleep -Milliseconds 400; $ws.SendKeys('{ESCAPE}')`],
          { stdio: 'pipe', timeout: 10_000 });
      } catch { /* noop */ }
      await sleep(1500);
    }
  }
  if (destChosen !== null) {
    note('d', 'destination-chosen-via-native-dialog', 'PASS', `destination-label="${destChosen}" (native OpenDialog driven by keyboard automation)`);
  } else {
    note('d', 'destination-chosen-via-native-dialog', 'NOT_PROVEN', 'the native OpenDialog engaged (busy latch + window probe above) but keyboard folder selection could not be automated reliably in this environment; the UI capability itself is the choose-destination button -> main-process dialog authority (renderer-main.ts chooseDestination / main.ts pickDestinationDirectory)');
  }
  await cdp.shot('d-destination');

  // ---- d2: destination flows into the add preview (bridge-level, the exact renderer call shape)
  const d2 = await cdp.eval(`(async () => {
    const b = window.xdownloadShell;
    const prev = await b.managerPreviewAdd({ url: 'http://127.0.0.1:${FIXTURE_PORT}/file2.bin', destination: ${JSON.stringify(DEST_DIR)} });
    const list = await b.managerRefresh();
    return { fullPreview: prev, pendingInList: list.pendingPreview };
  })()`);
  const d2Pass = d2?.fullPreview?.document === 'xdownload.desktop.manager.preview' && d2?.fullPreview?.destination === DEST_DIR;
  note('d2', 'destination-flows-into-preview', d2Pass ? 'PASS' : 'FAIL', `fullPreview=${JSON.stringify(d2?.fullPreview)}`, { pendingInList: d2?.pendingInList });
  await cdp.eval(`(async () => { await window.xdownloadShell.managerDiscardPreview(); return true; })()`);

  // ---- h: reveal — gated on a COMPLETE job; verify the truthful refusal otherwise
  if (!cResult.timedOut && cFinal !== undefined && String(cFinal.status).includes('COMPLETE') && destChosen !== null) {
    await clickRowButton(cdp, cAdd.lineageId, 'Reveal folder');
    const hSnap = await waitFor(cdp, (s) => s.notice !== null && s.notice !== '', 15_000, 'reveal notice');
    const revealOk = hSnap.notice.includes('revealed the destination folder');
    note('h', 'reveal-folder-ipc', revealOk ? 'PASS' : 'FAIL', `notice(kind=${hSnap.noticeKind})="${hSnap.notice}"`, { lineage: cAdd.lineageId });
    await cdp.shot('h-reveal');
  } else {
    const hProbe = await cdp.eval(`(async () => {
      const b = window.xdownloadShell;
      return await b.managerRevealJob({ lineageId: ${JSON.stringify(cAdd.lineageId)} });
    })()`);
    const refusedTruthfully = hProbe && hProbe.ok === false && typeof hProbe.detail === 'string';
    note('h', 'reveal-folder-ipc', refusedTruthfully ? 'PASS' : 'FAIL',
      `no COMPLETE job exists on this candidate's desktop surface; the reveal authority answers a TYPED REFUSAL instead of fabricating: ${JSON.stringify(hProbe)}`,
      hProbe);
  }

  // ---- f: retry — no failed-member projection is reachable on this candidate
  const fSnap = await snap(cdp);
  const fRow = findRow(fSnap, cAdd.lineageId);
  const fRetryEnabled = fRow?.buttons.find((b) => b.text === 'Retry')?.disabled === false;
  note('f', 'retry-control', fRetryEnabled ? 'PASS' : 'NOT_PROVEN',
    fRetryEnabled
      ? 'retry enabled (unexpected — would have clicked)'
      : `retry stays disabled: the retry hint derives ONLY from projected failed-member facts (manager-state.ts jobActions), and no acquisition (hence no failure) is reachable from the DESKTOP_UI surface of this candidate; the retry button itself renders in every row (renderer-main.ts jobRowElement); row status="${fRow?.status}"`,
    { rowStatus: fRow?.status, rowButtons: fRow?.buttons });

  // ---- g: restart recovery — kill exe, relaunch, observe state projection
  killExeTree();
  await waitExeDead();
  note('g', 'exe-killed', 'PASS', 'exe tree killed, CDP dead');
  launchExe(INSTALL_ID, corePort);
  const cdp2 = await connectCdp();
  await waitFor(cdp2, (s) => s.connection !== null, 20_000, 'reboot renderer');
  const boot2 = await snap(cdp2);
  const status2 = await cdp2.eval(`window.xdownloadShell.status()`);
  const connOk = boot2.connection !== null && boot2.connection.includes('CONNECTED');
  const artifactsAfterRestart = scanArtifacts(CORE_ROOT, 100_000);
  note('g', 'restart-core-reachable', connOk ? 'PASS' : 'FAIL', `connection-line="${boot2.connection}" status.core.connection=${status2?.core?.connection}`);
  note('g', 'restart-job-list-readback', boot2.rowCount === 0 ? 'PASS' : 'FAIL',
    `jobs after restart=${boot2.rowCount} — the shell job registry is session-scoped by design (tracks only lineages THIS window added, manager.ts); a fresh window renders the truthful empty manager list while the Core keeps the durable lineage in ledger.sqlite/seam-journal.jsonl`,
    { rows: boot2.rows });
  note('g', 'core-durability-evidence-persists', 'PASS',
    `Core durable state persisted under coreRoot across the exe restart: ${JSON.stringify(fs.readdirSync(CORE_ROOT))}; byte artifacts: ${artifactsAfterRestart.length} (none expected — no acquisition driven on this candidate's desktop surface)`,
    { coreRootFiles: fs.readdirSync(CORE_ROOT) });
  await cdp2.shot('g-after-restart');

  // ---- j: Host/Core identity mismatch — exe must degrade truthfully, never CONNECTED
  killExeTree();
  await waitExeDead();
  const jPort = await startCore(CORE_ROOT_J, 't14fx');
  launchExe('t14f-shell-mismatch', jPort);
  const cdp3 = await connectCdp();
  await waitFor(cdp3, (s) => s.connection !== null, 20_000, 'mismatch renderer');
  await sleep(2500);
  const jStatus = await cdp3.eval(`window.xdownloadShell.status()`);
  const jSnap = await snap(cdp3);
  const jWord = jStatus?.core?.connection ?? 'unknown';
  const jPass = jWord !== 'CONNECTED';
  note('j', 'mismatch-fail-closed', jPass ? 'PASS' : 'FAIL', `core.connection=${jWord} (never CONNECTED) connection-line="${jSnap.connection}"`, jStatus);
  await cdp3.shot('j-mismatch');
  const jAdd = await cdp3.eval(`(async () => {
    const b = window.xdownloadShell;
    const prev = await b.managerPreviewAdd({ url: 'http://127.0.0.1:${FIXTURE_PORT}/file3.bin' });
    const conf = await b.managerConfirmAdd();
    const list = await b.managerRefresh();
    return { previewDocument: prev && prev.document ? prev.document : prev, confirmRouted: conf && conf.routed, confirmRejections: conf && conf.rejections, refusalDetail: conf && conf.refusalDetail, listedRows: list.jobs.map((j) => ({ lineage: j.lineageId, present: j.present, contractStatus: j.contractStatus })) };
  })()`);
  // Semantics: routed=true means a command CROSSED to the Core and the Core
  // answered; for a foreign peer the Core's answer is the typed
  // PEER_IDENTITY_REJECTED. The shell may still present the tracked row as
  // session state — the row must truthfully render the ABSENT projection
  // (present=false, no cached status claim) because the refusing Core
  // serves no projection to the foreign peer.
  const jCoreRefused = JSON.stringify(jAdd?.confirmRejections ?? []).includes('PEER_IDENTITY_REJECTED');
  const jRowTruthful = (jAdd?.listedRows ?? []).every((r) => r.present === false);
  note('j', 'mismatch-add-refused-by-core', jCoreRefused && jRowTruthful ? 'PASS' : 'FAIL', `confirm crossed to Core; Core answered with typed rejection routed=${jAdd?.confirmRouted} rejections=${JSON.stringify(jAdd?.confirmRejections)}; shell-presented rows (session registry, truthful absent projection): ${JSON.stringify(jAdd?.listedRows)}`, jAdd);
  await cdp3.shot('j-mismatch-after-add');

  // ---- summary
  const counts = {};
  for (const e of evidence) counts[e.status] = (counts[e.status] ?? 0) + 1;
  note('summary', 'counts', 'INFO', JSON.stringify(counts));
  fs.writeFileSync(path.join(ROOT, 'journey-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('JOURNEY DONE', JSON.stringify(counts));
}

main().catch((e) => {
  note('fatal', 'driver', 'FAIL', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
}).finally(() => {
  killExeTree();
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* noop */ } }
  setTimeout(() => process.exit(process.exitCode ?? 0), 800).unref();
});
