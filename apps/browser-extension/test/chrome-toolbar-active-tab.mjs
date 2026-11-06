/*
 * v0.2.2 U06 — genuine Chrome toolbar-action activeTab driver (test-only).
 *
 * Self-contained Node 24 runner with explicit modes:
 *
 *   node chrome-toolbar-active-tab.mjs \
 *     --mode=control|grant --chrome=<exe> --extension=<unpacked-dir> \
 *     --out=<evidence-dir>
 *
 * --out must be a FRESH, non-existent directory, claimed by an atomic
 * exclusive mkdir (kernel EEXIST decision, no TOCTOU): an existing path is
 * refused before anything is written — caller-owned paths are never
 * deleted, truncated or reused.
 *
 * Both modes use a FRESH temporary Chrome profile and a loopback synthetic
 * fixture page with harmless attachment links; a persistent user profile is
 * never touched.
 *
 * control — denial-only control. It may open the popup URL directly in a
 *   background tab, labels the run DENIAL_CONTROL_ONLY, and must show that
 *   no activeTab authority was obtained (the initial scan fails closed).
 *
 * grant — positive mode ONLY through a genuine user click on the extension
 *   action in the visible Chrome toolbar, delivered by Windows UI
 *   Automation enumeration + native user32 mouse input (pinning through the
 *   visible Extensions menu when the action is not directly reachable).
 *   Before any click the interactive desktop is proven unlocked and
 *   input-capable; a locked/inaccessible desktop or an unreachable toolbar
 *   action returns the dedicated NOT_RUN exit status (3) with exact
 *   evidence. There is NO fallback to direct popup navigation, CDP popup
 *   APIs or chrome.action.openPopup — those can never count as positive.
 *
 * --mode=grant --self-test=privacy-inspection-error — focused R3 P2-01
 *   regression for the optional Chrome-window screenshot privacy check. It
 *   launches the same real Chrome + extension, then invokes the generated
 *   toolbar-action script with the U06_PRIVACY_SELFTEST_INSPECTION_ERROR
 *   seam: a synthetic top-level window whose UIA reads always throw, and a
 *   forced-pass foreground precondition so the enumeration loop is reached
 *   on any desktop. The script performs NO native clicks under the seam. The
 *   run PASSES only if the privacy check records UNKNOWN and skips the
 *   screenshot (UIA_TOOLBAR_SCREENSHOT_SKIPPED=window_inspection_error:*)
 *   and never widens the capture. This seam exists solely in this test file
 *   and is never set by a normal grant run.
 *
 * In both modes the popup is instrumented BEFORE its scripts execute (CDP
 * auto-attach with waitForDebuggerOnStart): Worker message kinds/counts and
 * chrome.permissions.request counts are recorded, and mere mode/tab
 * switching must add zero of each. The positive claim is limited to toolbar
 * popup opening, temporary activeTab authority, the initial synthetic page
 * scan and the truthfully rendered rows — no Host/Core, Native Host or real
 * download claim. UIA helper scripts are generated into the evidence
 * directory at runtime; this file is the only repository path.
 *
 * Smoke tooling only — never packaged, never shipped.
 */
/* global process, console, setTimeout, clearTimeout, fetch, WebSocket, Buffer */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const EXIT = { PASS: 0, FAIL: 1, NOT_RUN: 3 };
const FIXTURE_PAGE = '/page';

function argValue(name) {
  const flag = process.argv.find((value) => value.startsWith(`${name}=`));
  return flag === undefined ? null : flag.slice(name.length + 1);
}
const MODE = argValue('--mode');
const CHROME_ARG = argValue('--chrome');
const EXTENSION_ARG = argValue('--extension');
const OUT_ARG = argValue('--out');
const SELF_TEST = argValue('--self-test');

if (MODE !== 'control' && MODE !== 'grant') {
  console.error(
    'usage: node chrome-toolbar-active-tab.mjs --mode=control|grant [--chrome=exe] [--extension=dir] [--out=evidence-dir] [--self-test=privacy-inspection-error|desktop-precheck|foreground-guard]',
  );
  process.exit(EXIT.FAIL);
}
if (
  SELF_TEST !== null &&
  !['privacy-inspection-error', 'desktop-precheck', 'foreground-guard'].includes(SELF_TEST)
) {
  console.error(
    `FAIL: unknown --self-test value: ${SELF_TEST}; supported: privacy-inspection-error, desktop-precheck, foreground-guard`,
  );
  process.exit(EXIT.FAIL);
}
if (SELF_TEST !== null && MODE !== 'grant') {
  console.error(
    'FAIL: --self-test requires --mode=grant (the seam only exists in the grant-mode privacy check)',
  );
  process.exit(EXIT.FAIL);
}

// P1 repair, round 2 (web source-review): a caller-supplied --out directory
// must be FRESH and is claimed by an ATOMIC, EXCLUSIVE mkdir — the EEXIST
// decision is the kernel's, so no TOCTOU window exists between an existence
// probe and directory creation. The driver never deletes or truncates
// caller-owned paths. Without --out a fresh temporary directory is created.
function claimFreshEvidenceDir(target) {
  try {
    fs.mkdirSync(target);
    return;
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      console.error(
        `FAIL: --out path already exists: ${target}; refusing to reuse, delete or truncate caller-owned paths. Choose a fresh, non-existent directory.`,
      );
      process.exit(EXIT.FAIL);
    }
    if (error && error.code === 'ENOENT') {
      // Parent missing: create the parent chain (which the driver owns at
      // that point just as little as the leaf), then re-claim the leaf
      // atomically; a racing creator still wins EEXIST below.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.mkdirSync(target);
        return;
      } catch (second) {
        if (second && second.code === 'EEXIST') {
          console.error(
            `FAIL: --out path already exists: ${target}; refusing to reuse, delete or truncate caller-owned paths. Choose a fresh, non-existent directory.`,
          );
          process.exit(EXIT.FAIL);
        }
        throw second;
      }
    }
    throw error;
  }
}
let evidenceDir;
if (OUT_ARG !== null) {
  claimFreshEvidenceDir(OUT_ARG);
  evidenceDir = OUT_ARG;
} else {
  evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-active-tab-evidence-'));
}
const profileDir = path.join(evidenceDir, 'profile');
fs.mkdirSync(profileDir, { recursive: true });
const eventsPath = path.join(evidenceDir, 'events.ndjson');
fs.writeFileSync(eventsPath, '');

function log(step, value = {}) {
  fs.appendFileSync(
    eventsPath,
    `${JSON.stringify({ t: new Date().toISOString(), step, ...value })}\n`,
  );
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// R8: unpacked extensions get a deterministic id derived from their absolute
// load path (Chrome hashes the path bytes; verified against the live
// extension id on this host). The driver seeds the fresh temporary profile's
// Preferences with the action pinned to the toolbar so the genuine click
// targets the stable main-toolbar action button instead of the transient
// Extensions menu row. This is driver-owned test profile content — no
// product source, manifest or permission is involved, and the click itself
// remains a genuine visible toolbar-action click.
function unpackedExtensionIdFromPath(extensionPath) {
  const digest = createHash('sha256').update(Buffer.from(extensionPath, 'utf16le')).digest('hex');
  return digest
    .slice(0, 32)
    .split('')
    .map((character) => String.fromCharCode(parseInt(character, 16) + 97))
    .join('');
}

function discoverChrome() {
  if (CHROME_ARG !== null) return CHROME_ARG;
  const cacheRoot = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(cacheRoot)) return null;
  const versions = fs
    .readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^win64-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const version of versions.reverse()) {
    const candidate = path.join(cacheRoot, version, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveExtensionDir() {
  if (EXTENSION_ARG !== null) return EXTENSION_ARG;
  const repoRoot = path.resolve(here, '..', '..', '..');
  const candidate = path.join(repoRoot, 'dist', 'extension');
  return fs.existsSync(path.join(candidate, 'manifest.json')) ? candidate : null;
}

const chromeExe = discoverChrome();
const extensionDir = resolveExtensionDir();
if (chromeExe === null) {
  console.error(
    'FAIL: no Chrome executable (pass --chrome=<exe> or install a puppeteer Chrome for Testing build)',
  );
  process.exit(EXIT.FAIL);
}
if (extensionDir === null) {
  console.error(
    'FAIL: no unpacked extension directory (pass --extension=<dir> or run `pnpm run build` first)',
  );
  process.exit(EXIT.FAIL);
}
for (const required of ['manifest.json', 'popup.html', 'background.service-worker.js']) {
  if (!fs.existsSync(path.join(extensionDir, required))) {
    console.error(`FAIL: extension directory is missing ${required}: ${extensionDir}`);
    process.exit(EXIT.FAIL);
  }
}
// R8: the extension action's accessible Name anchors to the manifest name
// (ordinal prefix — see the menu-row form below). The toolbar/menu UIA
// selectors match these manifest-derived forms instead of a wildcard so the
// per-site toggle and more-options rows in Chrome's Extensions menu can
// never dilute the uniqueness gate.
const manifestJson = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const actionName = typeof manifestJson.name === 'string' ? manifestJson.name : null;
if (actionName === null || actionName === '') {
  console.error(`FAIL: extension manifest has no usable name: ${extensionDir}`);
  process.exit(EXIT.FAIL);
}
// R8 (+ review-response environment fact): the MENU action row's accessible
// name is the manifest action name, optionally followed by Chrome's dynamic
// per-site access hint suffix ('xDownload Browser Integration、每次访问时都
// 询问。选择即可更改网站权限' — Chrome 153 zh-CN, evidence grant-r8-rr4/
// uia-extensions-menu.json; grant-r8-6/7 saw the bare name the same day).
// The PINNED toolbar button's name is the action's default_title plus a
// newline and Chrome's per-site hint ('<default_title>\n想要访问此网站').
// Both are ordinal-prefix clauses of ONE shared exact action predicate
// (review repair P1-01) applied by both grant
// mechanisms on the Node side (rowIsExtensionAction) and in PowerShell
// (Test-U06ExtensionActionElement) — anchored to the loaded manifest, no
// wildcard. Environment fact (grant-r8-9-diag, Chrome 153 zh-CN): the
// pinned button exposes ExpandCollapsePattern and no InvokePattern, so the
// shared predicate truthfully yields zero direct-path candidates on this
// host and the genuine grant flows through the Extensions-menu mechanism
// under the same predicate; both are genuine guarded UIA input.
const actionDefaultTitle =
  typeof manifestJson.action?.default_title === 'string' && manifestJson.action.default_title !== ''
    ? manifestJson.action.default_title
    : null;
const actionToolbarTitlePrefix = actionDefaultTitle === null ? null : `${actionDefaultTitle}\n`;
// R8 review repair (P1-01): the driver's dump-row pre-selection mirrors the
// shared PowerShell action predicate clause-for-clause so a candidate is
// never handed to the click helper unless it already satisfies the unified
// exact action semantics: exact manifest-derived name form, visible with
// non-zero bounds, InvokePattern required, TogglePattern and
// ExpandCollapsePattern rejected (dump rows carry each element's supported
// pattern ProgrammaticNames). The PowerShell helper re-derives the same
// predicate live before any input; both sides must agree.
const ACTION_REQUIRED_PATTERN = 'InvokePatternIdentifiers.Pattern';
const ACTION_FORBIDDEN_PATTERNS = [
  'TogglePatternIdentifiers.Pattern',
  'ExpandCollapsePatternIdentifiers.Pattern',
];
function rowIsExtensionAction(row) {
  return (
    typeof row.name === 'string' &&
    // Menu-row form: manifest action name, optionally followed by Chrome's
    // dynamic per-site access hint suffix (Chrome 153 zh-CN, evidence
    // grant-r8-rr4); toolbar form: '<default_title>\n' prefix. Ordinal
    // anchors to the loaded manifest, no wildcard — mirrored in PowerShell.
    ((actionName !== '' && row.name.startsWith(actionName)) ||
      (actionToolbarTitlePrefix !== null && row.name.startsWith(actionToolbarTitlePrefix))) &&
    row.isOffscreen === false &&
    row.width > 0 &&
    row.height > 0 &&
    Array.isArray(row.patterns) &&
    row.patterns.includes(ACTION_REQUIRED_PATTERN) &&
    !ACTION_FORBIDDEN_PATTERNS.some((pattern) => row.patterns.includes(pattern))
  );
}
// R8: pin the extension action to the toolbar of the fresh profile before
// first launch (deterministic unpacked id from the load path — verified
// against the live extension id). With the action visible on the main
// toolbar the exact-name enumeration finds it directly and the genuine
// click targets the stable toolbar button instead of the transient
// Extensions menu row.
const seededExtensionId = unpackedExtensionIdFromPath(extensionDir);
const seededPreferencesPath = path.join(profileDir, 'Default', 'Preferences');
fs.mkdirSync(path.dirname(seededPreferencesPath), { recursive: true });
fs.writeFileSync(
  seededPreferencesPath,
  `${JSON.stringify({ extensions: { pinned_extensions: [seededExtensionId] } })}\n`,
);

const result = {
  mode: MODE,
  chromeExecutable: chromeExe,
  nodeVersion: process.version,
  profileDir,
  extensionDirectory: extensionDir,
  manifestSha256Before: sha256(path.join(extensionDir, 'manifest.json')),
  directPopupUrl: MODE === 'control',
  directPopupPurpose: MODE === 'control' ? 'DENIAL_CONTROL_ONLY_NOT_A_USER_GESTURE' : null,
  openPopupCalls: 0,
  toolbarClicks: 0,
  desktopPrecheck: null,
  // P2 repair (web source-review): honest zero-side-effect labeling. These
  // are SOURCE-SCOPE ASSERTIONS, not runtime-measured counters: this driver
  // invokes no Native Host path (the unpacked test extension declares no
  // native messaging host) and never initiates a download (fixture
  // attachment links are never clicked; the loopback fixture serves the
  // page and 404s every attachment request).
  zeroSideEffects: {
    nativeHostCalls: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
    realDownloads: { count: 0, basis: 'SOURCE_SCOPE_ASSERTION' },
  },
};

// --------------------------------------------------------------------------
// UIA helper scripts — generated into the evidence dir at runtime so this
// .mjs stays the only repository write path for the harness.
// --------------------------------------------------------------------------
const PRECHECK_PS1 = `param(
  [Parameter(Mandatory=$true)][string]$OutPath,
  [switch]$SelfTest
)
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class U06Desktop {
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
function Get-LockState($desktopName, $foregroundOwner, $foregroundText) {
  $known = -not [string]::IsNullOrWhiteSpace($desktopName) -and
    -not [string]::IsNullOrWhiteSpace($foregroundOwner)
  $titleIsLockScreen = $foregroundText -match '锁屏|Lock screen|锁定'
  $locked = -not $known -or $desktopName -ne 'Default' -or
    $foregroundOwner -ieq 'LockApp' -or $titleIsLockScreen
  return [pscustomobject]@{ locked = [bool]$locked; inputCapable = [bool](-not $locked); foregroundIsLockScreen = [bool]$titleIsLockScreen; stateKnown = [bool]$known }
}
if ($SelfTest) {
  $cases = @(
    @{ name = 'resident_lockapp_chrome'; desktop = 'Default'; owner = 'chrome'; title = 'Chrome'; resident = $true; expected = $false },
    @{ name = 'foreground_lockapp'; desktop = 'Default'; owner = 'LockApp'; title = ''; resident = $true; expected = $true },
    @{ name = 'lock_title'; desktop = 'Default'; owner = 'other'; title = 'Lock screen'; resident = $false; expected = $true },
    @{ name = 'non_default'; desktop = 'Winlogon'; owner = 'chrome'; title = 'Chrome'; resident = $false; expected = $true },
    @{ name = 'unknown_owner'; desktop = 'Default'; owner = ''; title = ''; resident = $false; expected = $true },
    @{ name = 'unknown_desktop'; desktop = ''; owner = 'chrome'; title = 'Chrome'; resident = $false; expected = $true }
  )
  $results = @($cases | ForEach-Object {
    $state = Get-LockState $_.desktop $_.owner $_.title
    [pscustomobject]@{ name = $_.name; lockAppRunning = $_.resident; locked = $state.locked; inputCapable = $state.inputCapable; pass = ($state.locked -eq $_.expected) -and ($state.inputCapable -eq (-not $_.expected)) }
  })
  $results | ConvertTo-Json -Depth 4 | Set-Content -Path $OutPath -Encoding UTF8
  if (@($results | Where-Object { -not $_.pass }).Count -ne 0) { exit 1 }
  exit 0
}
$desktop = [U06Desktop]::OpenInputDesktop(0, $false, 0x0001)
$desktopName = $null
if ($desktop -ne [IntPtr]::Zero) {
  $builder = New-Object System.Text.StringBuilder 256
  $needed = 0
  if ([U06Desktop]::GetUserObjectInformation($desktop, 2, $builder, 256, [ref]$needed)) {
    $desktopName = $builder.ToString()
  }
  [U06Desktop]::CloseDesktop($desktop) | Out-Null
}
$foreground = [U06Desktop]::GetForegroundWindow()
$foregroundText = ''
$foregroundPid = [uint32]0
$foregroundOwner = $null
if ($foreground -ne [IntPtr]::Zero) {
  $title = New-Object System.Text.StringBuilder 512
  if ([U06Desktop]::GetWindowText($foreground, $title, 512) -gt 0) { $foregroundText = $title.ToString() }
  [U06Desktop]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid) | Out-Null
  if ($foregroundPid -ne 0) {
    $owner = Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue
    if ($null -ne $owner) { $foregroundOwner = $owner.ProcessName }
  }
}
# A resident LockApp process is diagnostic only; its foreground ownership,
# known lock-screen titles and a non-Default desktop remain lock indicators.
$lockAppRunning = $null -ne (Get-Process LockApp -ErrorAction SilentlyContinue | Select-Object -First 1)
$state = Get-LockState $desktopName $foregroundOwner $foregroundText
[pscustomobject]@{
  inputDesktop = $desktopName
  lockAppRunning = $lockAppRunning
  foregroundIsLockScreen = $state.foregroundIsLockScreen
  foregroundProcessId = $foregroundPid
  foregroundProcessName = $foregroundOwner
  stateKnown = $state.stateKnown
  locked = $state.locked
  inputCapable = $state.inputCapable
  foregroundWindowTitle = $foregroundText
  checkedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Compress | Set-Content -Path $OutPath -Encoding UTF8
Write-Output ('U06_PRECHECK_EXIT=0')
exit 0
`;

const UIA_DUMP_PS1 = `param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$OutPath
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $ProcessId
)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $condition
)
$rows = @()
foreach ($window in $windows) {
  $elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Subtree,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    $current = $element.Current
    $patterns = @($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
    if ($current.Name -ne '' -or $current.ControlType.ProgrammaticName -match 'Button|MenuItem|TabItem|Document') {
      $num = { param($v) if ([double]::IsInfinity($v) -or [double]::IsNaN($v)) { 0 } else { [int]$v } }
      $rows += [pscustomobject]@{
        window = $window.Current.Name
        name = $current.Name
        automationId = $current.AutomationId
        className = $current.ClassName
        controlType = $current.ControlType.ProgrammaticName
        isOffscreen = $current.IsOffscreen
        x = & $num $current.BoundingRectangle.X
        y = & $num $current.BoundingRectangle.Y
        width = & $num $current.BoundingRectangle.Width
        height = & $num $current.BoundingRectangle.Height
        patterns = $patterns
      }
    }
  }
}
$rows | ConvertTo-Json -Depth 4 | Set-Content -Path $OutPath -Encoding UTF8
Write-Output ('UIA_DUMP_EXIT=0 COUNT=' + $rows.Count + ' OUT=' + $OutPath)
exit 0
`;

// --------------------------------------------------------------------------
// R5/R6 foreground admission guard — shared verbatim by UIA_CLICK_PS1 and
// UIA_TOOLBAR_ACTION_PS1 (each sets $script:Native to its own P/Invoke class).
// No SetCursorPos/mouse_event unless GetForegroundWindow() readback equals the
// exact target Chrome HWND, and SetCursorPos failure never falls through to
// mouse input. Activation denial, readback timeout, HWND change or unreadable
// HWND returns 'denied' with zero cursor movement and zero mouse input.
// Under -SelfTest the native APIs are never touched: readback is scripted
// from a queue and input advances seam counters only.
// --------------------------------------------------------------------------
const PS_FOREGROUND_GUARD = String.raw`
$selfTestGuard = $false
if ($SelfTest) { $selfTestGuard = $true }
$script:seamSetCursorPos = 0
$script:seamMouseEvent = 0
$script:seamMouseDown = 0
$script:seamMouseUp = 0
$script:seamReadbackScript = @()
$script:seamSetCursorPosResult = $true
function Read-Foreground {
  if ($selfTestGuard) {
    if ($script:seamReadbackScript.Count -gt 0) {
      $next = $script:seamReadbackScript[0]
      $script:seamReadbackScript = @($script:seamReadbackScript | Select-Object -Skip 1)
      if ($next -is [string] -and $next -eq '__THROW__') { throw 'synthetic foreground readback failure' }
      return $next
    }
    return [IntPtr]::Zero
  }
  return $script:Native::GetForegroundWindow()
}
function Assert-Foreground($targetHwnd) {
  if ($targetHwnd -eq [IntPtr]::Zero) { return 'denied' }
  # R8: probe the readback FIRST and request activation only on mismatch. The
  # original entry fired an unconditional SetForegroundWindow before the first
  # readback; when the target is Chrome's already-active Extensions menu
  # popup, that activation churn can dismiss the menu before the guarded
  # click, so activation calls are now minimized. The admission invariant is
  # unchanged: the readback must equal the exact target HWND before any
  # cursor movement or mouse input, and the self-test seam keeps its exact
  # scripted readback sequence (the probe is skipped under the seam).
  if (-not $selfTestGuard) {
    if ((Read-Foreground) -ne $targetHwnd) {
      $script:Native::SetForegroundWindow($targetHwnd) | Out-Null
    }
  }
  $deadline = (Get-Date).AddSeconds(2)
  while ((Get-Date) -lt $deadline) {
    if ((Read-Foreground) -eq $targetHwnd) { return 'granted' }
    if ($selfTestGuard) { break }
    Start-Sleep -Milliseconds 100
    $script:Native::SetForegroundWindow($targetHwnd) | Out-Null
  }
  if ($selfTestGuard) { return 'denied' }
  # Activation retry via AttachThreadInput: attaching to the current
  # foreground thread lets this background thread legitimately request
  # activation. No input is synthesized; the readback below still decides,
  # and any denial keeps cursor movement and mouse input at zero. The attach
  # is paired only on success and guaranteed detached in finally.
  $fg = $script:Native::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero -and $fg -ne $targetHwnd) {
    $dummyPid = [uint32]0
    $fgThread = $script:Native::GetWindowThreadProcessId($fg, [ref]$dummyPid)
    $me = $script:Native::GetCurrentThreadId()
    if ($fgThread -ne 0 -and $fgThread -ne $me) {
      $attached = $script:Native::AttachThreadInput($me, $fgThread, $true)
      try {
        $script:Native::SetForegroundWindow($targetHwnd) | Out-Null
      } finally {
        if ($attached) { $script:Native::AttachThreadInput($me, $fgThread, $false) | Out-Null }
      }
    }
  }
  $retryDeadline = (Get-Date).AddSeconds(1)
  while ((Get-Date) -lt $retryDeadline) {
    if ((Read-Foreground) -eq $targetHwnd) { return 'granted' }
    Start-Sleep -Milliseconds 100
  }
  return 'denied'
}
function Send-NativeClick($targetHwnd, $x, $y) {
  # R7: exact foreground readback before every new input side effect. Once
  # mouse-down is attempted, mouse-up is guaranteed in finally: a focus
  # change/readback error may block a click, but must never leave the global
  # left button logically pressed. The cleanup up is not a second click.
  if ((Read-Foreground) -ne $targetHwnd) {
    return [pscustomobject]@{ sent = $false; reason = 'foreground_moved'; mouseDownSent = $false; mouseUpCleanupSent = $false }
  }
  $cursorOk = $true
  if ($selfTestGuard) {
    $script:seamSetCursorPos += 1
    $cursorOk = $script:seamSetCursorPosResult
  } else {
    $cursorOk = $script:Native::SetCursorPos($x, $y)
  }
  if (-not $cursorOk) {
    return [pscustomobject]@{ sent = $false; reason = 'set_cursor_pos_failed'; mouseDownSent = $false; mouseUpCleanupSent = $false }
  }
  if ((Read-Foreground) -ne $targetHwnd) {
    return [pscustomobject]@{ sent = $false; reason = 'foreground_moved'; mouseDownSent = $false; mouseUpCleanupSent = $false }
  }

  $mouseDownAttempted = $false
  $mouseDownSent = $false
  $mouseUpCleanupSent = $false
  $failureReason = $null
  try {
    $mouseDownAttempted = $true
    if ($selfTestGuard) {
      $script:seamMouseDown += 1
      $script:seamMouseEvent += 1
    } else {
      $script:Native::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    }
    $mouseDownSent = $true

    try {
      if ((Read-Foreground) -ne $targetHwnd) {
        $failureReason = 'foreground_moved_after_mouse_down'
      }
    } catch {
      $failureReason = 'foreground_readback_error_after_mouse_down'
    }
  } catch {
    $failureReason = 'mouse_down_failed'
  } finally {
    # Always release after a down attempt, even when the post-down guard
    # refuses or throws. This is a release cleanup only, never a new click.
    if ($mouseDownAttempted) {
      try {
        if ($selfTestGuard) {
          $script:seamMouseUp += 1
          $script:seamMouseEvent += 1
        } else {
          $script:Native::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        }
        $mouseUpCleanupSent = $true
      } catch {
        $failureReason = 'mouse_up_cleanup_failed'
      }
    }
  }

  if ($failureReason -ne $null) {
    return [pscustomobject]@{
      sent = $false
      reason = $failureReason
      mouseDownSent = $mouseDownSent
      mouseUpCleanupSent = $mouseUpCleanupSent
    }
  }
  return [pscustomobject]@{
    sent = $true
    reason = 'clicked'
    mouseDownSent = $mouseDownSent
    mouseUpCleanupSent = $mouseUpCleanupSent
  }
}
function Invoke-GuardedClick($targetHwnd, $x, $y) {
  $verdict = Assert-Foreground $targetHwnd
  if ($verdict -eq 'denied') {
    return [pscustomobject]@{ verdict = $verdict; clicked = $false; reason = 'foreground_denied'; mouseDownSent = $false; mouseUpCleanupSent = $false }
  }
  $send = Send-NativeClick $targetHwnd $x $y
  if (-not $send.sent) {
    return [pscustomobject]@{
      verdict = $verdict
      clicked = $false
      reason = $send.reason
      mouseDownSent = $send.mouseDownSent
      mouseUpCleanupSent = $send.mouseUpCleanupSent
    }
  }
  return [pscustomobject]@{
    verdict = $verdict
    clicked = $true
    reason = 'clicked'
    mouseDownSent = $send.mouseDownSent
    mouseUpCleanupSent = $send.mouseUpCleanupSent
  }
}
function Invoke-GuardSelfTest([string]$SelfTestOutPath) {
  $cases = @()
  $target = [IntPtr]424242
  $other = [IntPtr]1111
  function New-Case($name, $readbacks, $cursorResult, $clickTarget) {
    $script:seamSetCursorPos = 0
    $script:seamMouseEvent = 0
    $script:seamMouseDown = 0
    $script:seamMouseUp = 0
    $script:seamReadbackScript = @($readbacks)
    $script:seamSetCursorPosResult = $cursorResult
    $r = Invoke-GuardedClick $clickTarget 10 10
    [pscustomobject]@{
      name = $name
      verdict = $r.verdict
      reason = $r.reason
      clicked = $r.clicked
      setCursorPosCalls = $script:seamSetCursorPos
      mouseEventCalls = $script:seamMouseEvent
      mouseDownCalls = $script:seamMouseDown
      mouseUpCalls = $script:seamMouseUp
      mouseDownSent = $r.mouseDownSent
      mouseUpCleanupSent = $r.mouseUpCleanupSent
    }
  }
  # (a) denied/mismatched activation readback: zero cursor movement, zero input
  $c = New-Case 'foreground_denied' @($other) $true $target
  $cases += Add-Note $c ($c.verdict -eq 'denied' -and $c.clicked -eq $false -and $c.setCursorPosCalls -eq 0 -and $c.mouseEventCalls -eq 0)
  # (b) matching HWND readback: full admission, counters advance only
  $c = New-Case 'foreground_matching' @($target, $target, $target, $target) $true $target
  $cases += Add-Note $c ($c.verdict -eq 'granted' -and $c.clicked -eq $true -and $c.setCursorPosCalls -eq 1 -and $c.mouseEventCalls -eq 2 -and $c.mouseDownCalls -eq 1 -and $c.mouseUpCalls -eq 1 -and $c.mouseDownSent -and $c.mouseUpCleanupSent)
  # (c) unreadable foreground ([IntPtr]::Zero): fail closed, zero input
  $c = New-Case 'foreground_unreadable' @([IntPtr]::Zero) $true $target
  $cases += Add-Note $c ($c.verdict -eq 'denied' -and $c.clicked -eq $false -and $c.setCursorPosCalls -eq 0 -and $c.mouseEventCalls -eq 0)
  # (d) zero/unknown target HWND: fail closed before any readback
  $c = New-Case 'target_unknown' @($target) $true ([IntPtr]::Zero)
  $cases += Add-Note $c ($c.verdict -eq 'denied' -and $c.clicked -eq $false -and $c.setCursorPosCalls -eq 0 -and $c.mouseEventCalls -eq 0)
  # (e) R6: activation granted but HWND mismatch immediately before cursor:
  # zero cursor movement, zero mouse input
  $c = New-Case 'post_activation_mismatch' @($target, $other) $true $target
  $cases += Add-Note $c ($c.verdict -eq 'granted' -and $c.clicked -eq $false -and $c.reason -eq 'foreground_moved' -and $c.setCursorPosCalls -eq 0 -and $c.mouseEventCalls -eq 0)
  # (f) R6: SetCursorPos failure: zero mouse events
  $c = New-Case 'set_cursor_pos_failed' @($target, $target) $false $target
  $cases += Add-Note $c ($c.clicked -eq $false -and $c.reason -eq 'set_cursor_pos_failed' -and $c.setCursorPosCalls -eq 1 -and $c.mouseEventCalls -eq 0)
  # (g) R6: foreground moves between mouse-down and mouse-up
  $c = New-Case 'foreground_moved_after_mouse_down' @($target, $target, $target, $other) $true $target
  $cases += Add-Note $c ($c.clicked -eq $false -and $c.reason -eq 'foreground_moved_after_mouse_down' -and $c.setCursorPosCalls -eq 1 -and $c.mouseEventCalls -eq 2 -and $c.mouseDownCalls -eq 1 -and $c.mouseUpCalls -eq 1 -and $c.mouseDownSent -and $c.mouseUpCleanupSent)
  # (h) R7: a readback exception after down still runs the matching up cleanup.
  $c = New-Case 'foreground_readback_error_after_mouse_down' @($target, $target, $target, '__THROW__') $true $target
  $cases += Add-Note $c ($c.clicked -eq $false -and $c.reason -eq 'foreground_readback_error_after_mouse_down' -and $c.setCursorPosCalls -eq 1 -and $c.mouseEventCalls -eq 2 -and $c.mouseDownCalls -eq 1 -and $c.mouseUpCalls -eq 1 -and $c.mouseDownSent -and $c.mouseUpCleanupSent)
  $allPass = @($cases | Where-Object { -not $_.pass }).Count -eq 0
  [pscustomobject]@{ ok = [bool]$allPass; cases = $cases } | ConvertTo-Json -Depth 4 | Set-Content -Path $SelfTestOutPath -Encoding UTF8
  if (-not $allPass) { exit 1 }
  exit 0
}
function Add-Note($caseObj, $pass) {
  $caseObj | Add-Member -MemberType NoteProperty -Name pass -Value [bool]$pass -Force
  return $caseObj
}
if ($SelfTest) {
  if ([string]::IsNullOrWhiteSpace($OutPath)) {
    Write-Output 'FOREGROUND_GUARD_SELFTEST_EXIT=1 REASON=missing_outpath'
    exit 1
  }
  Invoke-GuardSelfTest $OutPath
}
`;

// R8 review repair (P1-01, PR #384 comment 6679145575): ONE shared exact
// extension-action predicate, interpolated verbatim into BOTH click helpers
// (u06-uia-click.ps1 for the pinned-direct toolbar path and
// u06-uia-toolbar-action.ps1 for the Extensions-menu path). Both grant
// mechanisms now accept an element under identical clauses:
//   1. manifest-derived name form — the menu action row's Name starts with
//      the loaded manifest action name (Chrome 153 appends a dynamic
//      per-site access hint suffix to it; evidence grant-r8-rr4), OR the
//      pinned toolbar button's Name has the documented toolbar-title form
//      ('<action.default_title>\n<Chrome per-site hint>'). No wildcard.
//   2. visible with non-zero bounds (not offscreen, Width>0, Height>0).
//   3. invoke semantics: GetSupportedPatterns() contains InvokePattern and
//      contains neither TogglePattern nor ExpandCollapsePattern, so a
//      same-name visible toggle (per-site access) or expander (more-options
//      button) can never be clicked and recorded as the action.
// Environment fact (evidence grant-r8-9-diag/uia-before-toolbar.json, Chrome
// 153 zh-CN): the pinned toolbar button exposes ExpandCollapsePattern and no
// InvokePattern, so under the shared predicate the pinned-direct path
// truthfully yields zero candidates on this host and the genuine grant
// proceeds through the Extensions-menu mechanism under the SAME predicate.
// Both are genuine guarded UIA input; the no-fallback set (CDP popup,
// openPopup, DOM events, popup URL) is untouched, and any non-single
// cardinality still exits NOT_RUN with zero input.
const U06_ACTION_PREDICATE_PS1 = `# The toolbar-title form is '<base title>[char]10<Chrome per-site hint>'. The
# base title crosses the Node→PowerShell process boundary as its own
# argument, so it must never carry the newline itself: a raw LF inside a
# Windows command line corrupts PowerShell argument binding (grant-r8-rr1:
# the helper died at binding with zero output and zero input). The prefix is
# assembled HERE, after binding.
$script:U06ToolbarTitlePrefix = ''
if ($ToolbarBaseTitle -ne '') { $script:U06ToolbarTitlePrefix = $ToolbarBaseTitle + [char]10 }
$script:U06InvokePatternId = [System.Windows.Automation.InvokePatternIdentifiers]::Pattern.Id
$script:U06TogglePatternId = [System.Windows.Automation.TogglePatternIdentifiers]::Pattern.Id
$script:U06ExpandCollapsePatternId = [System.Windows.Automation.ExpandCollapsePatternIdentifiers]::Pattern.Id
function Test-U06ExtensionActionElement {
  param($Element, [string]$ActionName, [string]$ToolbarTitlePrefix)
  try {
    $current = $Element.Current
    if ($null -eq $current) { return $false }
    $name = $current.Name
    # Menu-row documented form: the manifest action name, optionally followed
    # by Chrome's dynamic per-site access hint suffix (Chrome 153 zh-CN appends
    # e.g. '、每次访问时都询问。选择即可更改网站权限' to the Extensions-menu
    # action row — evidence grant-r8-rr4/uia-extensions-menu.json; grant-r8-6/7
    # saw the bare name earlier the same day). Ordinal prefix anchor, anchored
    # to the loaded manifest — no wildcard.
    $nameIsMenuForm = ($ActionName -ne '' -and -not [string]::IsNullOrEmpty($name) -and $name.StartsWith($ActionName, [System.StringComparison]::Ordinal))
    $nameIsToolbarForm = ($ToolbarTitlePrefix -ne '' -and -not [string]::IsNullOrEmpty($name) -and $name.StartsWith($ToolbarTitlePrefix, [System.StringComparison]::Ordinal))
    if (-not ($nameIsMenuForm -or $nameIsToolbarForm)) { return $false }
    if ($current.IsOffscreen) { return $false }
    $bounds = $current.BoundingRectangle
    if ($null -eq $bounds -or $bounds.Width -le 0 -or $bounds.Height -le 0) { return $false }
    $patternIds = @($Element.GetSupportedPatterns() | ForEach-Object { $_.Id })
    return ($patternIds -contains $script:U06InvokePatternId -and -not ($patternIds -contains $script:U06TogglePatternId) -and -not ($patternIds -contains $script:U06ExpandCollapsePatternId))
  } catch {
    # Fail closed: an element that cannot be fully read is never the action.
    return $false
  }
}
`;

const UIA_CLICK_PS1 = `param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$ActionName = '',
  [string]$ToolbarBaseTitle = '',
  [string]$ControlType = '',
  [string]$OutPath = '',
  [switch]$SelfTest
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class U06Mouse {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$script:Native = [U06Mouse]
${PS_FOREGROUND_GUARD}
${U06_ACTION_PREDICATE_PS1}
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $ProcessId
)
$windows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $condition
) | ForEach-Object { $_ })
# R8 review repair (P1-01): the pinned-direct path applies the SAME shared
# exact action predicate as the Extensions-menu path (exact manifest-derived
# name form, visible non-zero bounds, InvokePattern required, Toggle and
# ExpandCollapse rejected) plus the concrete -Name anchor the driver passes
# from its dump-row selection. The predicate re-derives every clause live on
# the element that will actually receive input, so a same-name visible
# element without the action's invoke semantics can never be clicked here.
# Cardinality stays exactly-one-or-fail; any other count exits 3 and the
# driver records NOT_RUN with zero input.
$matches = @()
foreach ($window in $windows) {
  $elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Subtree,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    if (-not (Test-U06ExtensionActionElement $element $ActionName $script:U06ToolbarTitlePrefix)) { continue }
    $current = $element.Current
    $typeMatches = $ControlType -eq '' -or $current.ControlType.ProgrammaticName -eq ('ControlType.' + $ControlType)
    if (($Name -eq '' -or $current.Name -ceq $Name) -and $typeMatches) {
      $matches += [pscustomobject]@{ Element = $element; Window = $window }
    }
  }
}
if ($matches.Count -ne 1) {
  Write-Output ('UIA_CLICK_EXIT=3 MATCH_COUNT=' + $matches.Count + ' NAME=' + $Name)
  exit 3
}
$target = $matches[0].Element
$window = $matches[0].Window
$rect = $target.Current.BoundingRectangle
$x = [int]($rect.X + $rect.Width / 2)
$y = [int]($rect.Y + $rect.Height / 2)
# R5 foreground admission guard: zero cursor movement and zero mouse input
# unless GetForegroundWindow() readback equals the exact target Chrome HWND.
$guard = Invoke-GuardedClick ([IntPtr]$window.Current.NativeWindowHandle) $x $y
if (-not $guard.clicked) {
  Write-Output ('UIA_CLICK_EXIT=6 REASON=' + $guard.reason + ' FOREGROUND_GUARD=1 MOUSE_DOWN_SENT=' + [int]$guard.mouseDownSent + ' MOUSE_UP_CLEANUP_SENT=' + [int]$guard.mouseUpCleanupSent)
  exit 6
}
[pscustomobject]@{
  mechanism = 'Windows UI Automation bounding rectangle + user32 SetCursorPos/mouse_event after GetForegroundWindow() readback equals target Chrome HWND'
  processId = $ProcessId
  name = $target.Current.Name
  controlType = $target.Current.ControlType.ProgrammaticName
  automationId = $target.Current.AutomationId
  x = $x
  y = $y
  clickCount = 1
} | ConvertTo-Json -Compress
Write-Output 'UIA_CLICK_EXIT=0'
exit 0
`;

const UIA_TOOLBAR_ACTION_PS1 = `param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [string]$ActionName = 'xDownload Browser Integration',
  [string]$ToolbarBaseTitle = '',
  [switch]$SelfTest
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class U06ActionMouse {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$script:Native = [U06ActionMouse]
${PS_FOREGROUND_GUARD}
${U06_ACTION_PREDICATE_PS1}
# R3 P2-01 focused regression seam: set ONLY by the Node driver's
# --self-test=privacy-inspection-error run via the process environment. A
# normal grant run never sees this. Under the seam the script performs NO
# native clicks, forces the foreground-window precondition so the top-level
# enumeration loop is reachable on any desktop, and injects a synthetic
# top-level window whose UIA reads always throw — proving the privacy check
# fails closed on inspection errors.
$selfTestInspectionError = $env:U06_PRIVACY_SELFTEST_INSPECTION_ERROR -eq '1'
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $ProcessId
)
function Get-ChromeWindows {
  return @([System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $condition
  ) | ForEach-Object { $_ })
}
function Click-Element($element, $window) {
  $rect = $element.Current.BoundingRectangle
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  # R8 input-liveness gate: re-read the element identity immediately before
  # the guarded input. A dead or emptied element (the Extensions menu closed
  # between enumeration and click) means the recorded rectangle no longer
  # maps to the action — abort with zero input instead of clicking dead
  # coordinates and labeling it a genuine click.
  try {
    $liveCheck = $element.Current
    if ([string]::IsNullOrEmpty($liveCheck.Name) -or $liveCheck.BoundingRectangle.Width -le 0) {
      Write-Output ('UIA_CLICK_TARGET_STALE=1 name=' + $liveCheck.Name)
      return $null
    }
  } catch {
    Write-Output 'UIA_CLICK_TARGET_STALE=1 read_error'
    return $null
  }
  # R5 foreground admission guard: zero cursor movement and zero mouse input
  # unless GetForegroundWindow() readback equals the exact target Chrome HWND.
  $guard = Invoke-GuardedClick ([IntPtr]$window.Current.NativeWindowHandle) $x $y
  if (-not $guard.clicked) {
    Write-Output ('UIA_TOOLBAR_ACTION_EXIT=6 REASON=' + $guard.reason + ' FOREGROUND_GUARD=1 MOUSE_DOWN_SENT=' + [int]$guard.mouseDownSent + ' MOUSE_UP_CLEANUP_SENT=' + [int]$guard.mouseUpCleanupSent)
    exit 6
  }
  return @($x, $y)
}
$windows = Get-ChromeWindows
$puzzle = $null
$mainWindow = $null
foreach ($window in $windows) {
  $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($element in $elements) {
    if ($element.Current.AutomationId -eq 'view_1006' -and -not $element.Current.IsOffscreen) {
      $puzzle = $element
      $mainWindow = $window
      break
    }
  }
  if ($puzzle -ne $null) { break }
}
if ($puzzle -eq $null) {
  Write-Output 'UIA_TOOLBAR_ACTION_EXIT=4 REASON=extensions_button_not_found'
  exit 4
}
if (-not $selfTestInspectionError) {
  $menuPoint = Click-Element $puzzle $mainWindow
  if ($menuPoint -eq $null) {
    Write-Output 'UIA_TOOLBAR_ACTION_EXIT=7 REASON=extensions_button_stale_before_input'
    exit 7
  }
  Start-Sleep -Milliseconds 700
  & (Join-Path $PSScriptRoot 'u06-uia-dump.ps1') -ProcessId $ProcessId -OutPath $OutPath
}
# P2 repair, round 2 (web source-review): capture ONLY the Chrome window
# bounds, never the full primary desktop — and only when the privacy
# boundary is PROVABLE: the Chrome window must be the foreground window and
# no other visible top-level window may overlap its bounds (an overlap
# could smuggle unrelated private pixels into the capture). When any
# precondition fails the screenshot is skipped with a recorded reason —
# the capture is never widened to make it possible.
$captureAllowed = $false
$captureSkipReason = 'unknown'
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  $winRect = $mainWindow.Current.BoundingRectangle
  if ($winRect.Width -le 0 -or $winRect.Height -le 0) {
    $captureSkipReason = 'window_bounds_unavailable'
  } else {
    $chromeHandle = [IntPtr]$mainWindow.Current.NativeWindowHandle
    $foreground = [U06ActionMouse]::GetForegroundWindow()
    if ($selfTestInspectionError) { $foreground = $chromeHandle }
    if ($foreground -ne $chromeHandle) {
      $captureSkipReason = 'chrome_window_not_foreground'
    } else {
      $occluder = $null
      # R3 P2-01: any UIA exception while reading a top-level window makes
      # the privacy state UNKNOWN — an uninspected window must NEVER be
      # treated as non-occluding. The first inspection error is recorded and
      # the screenshot is skipped below.
      $inspectionError = $null
      $topLevel = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      $topWindows = @($topLevel | ForEach-Object { $_ })
      if ($selfTestInspectionError) {
        # Prepended (not appended) so the inspection-error path is exercised
        # deterministically regardless of the real desktop's overlapping
        # windows — a real occluder found earlier would skip the capture for
        # the occluded_by reason without ever touching the mock. The mock
        # models a window whose UIA read yields nothing: PowerShell's adapted
        # member access surfaces a failing UIA property read as $null rather
        # than throwing (verified against .NET getter exceptions), so a $null
        # Current is exactly what an uninspected window looks like here.
        $mock = [pscustomobject]@{ Current = $null }
        $topWindows = @($mock) + $topWindows
      }
      foreach ($top in $topWindows) {
        try {
          $current = $top.Current
          if ($null -eq $current) {
            # A readable AutomationElement never reports a $null Current; a
            # $null here means the inspection failed (or terminally errored
            # deeper below). UNKNOWN — never treat as non-occluding.
            if ($null -eq $inspectionError) { $inspectionError = '<unreadable>' }
            continue
          }
          if ($current.NativeWindowHandle -eq $chromeHandle) { continue }
          if ($current.IsOffscreen) { continue }
          $other = $current.BoundingRectangle
          if ($null -eq $other) {
            # Zero-size bounds are provably non-occluding (skipped below),
            # but NO bounds at all means the read failed. UNKNOWN.
            if ($null -eq $inspectionError) { $inspectionError = $current.Name }
            continue
          }
          if ($other.Width -le 0 -or $other.Height -le 0) { continue }
          $overlapX = [Math]::Min($winRect.X + $winRect.Width, $other.X + $other.Width) - [Math]::Max($winRect.X, $other.X)
          $overlapY = [Math]::Min($winRect.Y + $winRect.Height, $other.Y + $other.Height) - [Math]::Max($winRect.Y, $other.Y)
          if ($overlapX -gt 0 -and $overlapY -gt 0) {
            $occluder = $current.Name
            break
          }
        } catch {
          if ($null -eq $inspectionError) {
            try { $inspectionError = $top.Current.Name } catch { $inspectionError = '<unreadable>' }
          }
        }
      }
      if ($null -ne $inspectionError) {
        $captureSkipReason = 'window_inspection_error:' + $inspectionError
      } elseif ($null -ne $occluder) {
        $captureSkipReason = 'occluded_by:' + $occluder
      } else {
        $captureAllowed = $true
      }
    }
  }
} catch {
  $captureSkipReason = 'precheck_error:' + $_.Exception.Message
}
if ($captureAllowed) {
  try {
    $bitmap = New-Object System.Drawing.Bitmap ([int]$winRect.Width), ([int]$winRect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen([int]$winRect.X, [int]$winRect.Y, 0, 0, $bitmap.Size)
    $bitmap.Save($OutPath + '.chrome-window.png', [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output 'UIA_TOOLBAR_SCREENSHOT_CHROME_WINDOW_ONLY=1'
  } catch {
    Write-Output ('UIA_TOOLBAR_SCREENSHOT_SKIPPED=capture_error:' + $_.Exception.Message)
  }
} else {
  Write-Output ('UIA_TOOLBAR_SCREENSHOT_SKIPPED=' + $captureSkipReason)
}
if ($selfTestInspectionError) {
  Write-Output 'UIA_TOOLBAR_SELFTEST_FOREGROUND_PRECONDITION=forced_pass_under_seam'
  Write-Output ('UIA_TOOLBAR_SELFTEST_PRIVACY=' + $(if ($captureAllowed) { 'CAPTURE_ALLOWED' } else { 'SKIPPED:' + $captureSkipReason }))
  Write-Output 'UIA_TOOLBAR_SELFTEST_EXIT=0'
  exit 0
}
# R8 selector: Chrome 153's visible Extensions menu exposes three UIA
# elements matching the wildcard '*xDownload*' (the action row, the per-site
# access toggle and the per-extension more-options button), so a wildcard
# uniqueness gate can never pass. The action row is identified exactly by the
# SHARED exact action predicate (defined above the foreground guard, shared
# verbatim with u06-uia-click.ps1): exact manifest-derived name form, visible
# non-zero bounds, InvokePattern required, Toggle/ExpandCollapse rejected.
# Any other cardinality still exits 5 (NOT_RUN), never a guessed click.
# (R8 review repair P1-01: the per-path pattern constants were folded into
# the shared predicate so the two grant mechanisms cannot drift apart.)
# R8: Chrome's Extensions menu popup animates for ~1s after opening and
# individual UIA reads on its elements fail transiently during that window
# (observed: the row read cleanly on an immediate retry milliseconds later).
# A transient read failure must never silently drop the action row, so the
# whole read-only enumeration is retried up to three times. This is read
# retry only — no input is ever sent, and the gate stays exactly-one-or-NOT_RUN.
$matches = @()
$enumAttempt = 0
while ($matches.Count -ne 1 -and $enumAttempt -lt 3) {
  if ($enumAttempt -gt 0) { Start-Sleep -Milliseconds 300 }
  $enumAttempt += 1
  $matches = @()
  foreach ($window in (Get-ChromeWindows)) {
    $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $elements) {
      try {
        if (Test-U06ExtensionActionElement $element $ActionName $script:U06ToolbarTitlePrefix) {
          $matches += [pscustomobject]@{ Element = $element; Window = $window }
        }
      } catch {
        # Transient UIA read failure (e.g. menu animation): skip this element
        # in the current pass; a later pass re-enumerates from scratch.
        continue
      }
    }
  }
}
if ($matches.Count -ne 1) {
  Write-Output ('UIA_TOOLBAR_ENUM_ATTEMPTS=' + $enumAttempt)
  foreach ($window in (Get-ChromeWindows)) {
    $winName = $window.Current.Name
    $winElements = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    $windowCandidates = @()
    foreach ($element in $winElements) {
      try {
        $current = $element.Current
        # Mirror the menu-row documented form (manifest name, optional
        # Chrome per-site hint suffix) so exit-5 diagnostics count what the
        # selector counts — read-only, input never follows a DIAG pass.
        if (-not [string]::IsNullOrEmpty($current.Name) -and ($ActionName -eq '' -or $current.Name.StartsWith($ActionName, [System.StringComparison]::Ordinal)) -and -not $current.IsOffscreen) {
          $windowCandidates += [pscustomobject]@{ name = $current.Name; patterns = (@($element.GetSupportedPatterns() | ForEach-Object { $_.Id }) -join ','); width = [int]$current.BoundingRectangle.Width }
        }
      } catch { continue }
    }
    Write-Output ('DIAG_WINDOW elements=' + @($winElements).Count + ' actionNameFormMatches=' + @($windowCandidates).Count + ' title=' + $winName)
    foreach ($candidate in $windowCandidates) {
      Write-Output ('DIAG_CANDIDATE ' + ($candidate | ConvertTo-Json -Compress))
    }
  }
  $foregroundPidNow = [uint32]0
  $foregroundNow = [U06ActionMouse]::GetForegroundWindow()
  if ($foregroundNow -ne [IntPtr]::Zero) {
    [U06ActionMouse]::GetWindowThreadProcessId($foregroundNow, [ref]$foregroundPidNow) | Out-Null
  }
  Write-Output ('DIAG_FOREGROUND_PID=' + $foregroundPidNow)
  Write-Output ('UIA_TOOLBAR_ACTION_EXIT=5 MATCH_COUNT=' + $matches.Count)
  exit 5
}
$target = $matches[0].Element
$point = Click-Element $target $matches[0].Window
if ($point -eq $null) {
  Write-Output 'UIA_TOOLBAR_ACTION_EXIT=7 REASON=action_row_stale_before_input'
  exit 7
}
[pscustomobject]@{
  menuMechanism = 'user32 SetCursorPos/mouse_event on Extensions toolbar automationId view_1006 after GetForegroundWindow() readback admission'
  actionMechanism = 'user32 SetCursorPos/mouse_event on xDownload extension action after GetForegroundWindow() readback admission'
  name = $target.Current.Name
  controlType = $target.Current.ControlType.ProgrammaticName
  automationId = $target.Current.AutomationId
  x = $point[0]
  y = $point[1]
  actionClickCount = 1
} | ConvertTo-Json -Compress
Write-Output 'UIA_TOOLBAR_ACTION_EXIT=0'
exit 0
`;

const ps1Files = {
  'u06-desktop-precheck.ps1': PRECHECK_PS1,
  'u06-uia-dump.ps1': UIA_DUMP_PS1,
  'u06-uia-click.ps1': UIA_CLICK_PS1,
  'u06-uia-toolbar-action.ps1': UIA_TOOLBAR_ACTION_PS1,
};
for (const [name, body] of Object.entries(ps1Files)) {
  fs.writeFileSync(path.join(evidenceDir, name), body);
}

async function runPowerShell(script, args, options = {}) {
  try {
    const answer = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(evidenceDir, script),
        ...args,
      ],
      { timeout: 30_000, windowsHide: true, ...options },
    );
    log(script, { exitCode: 0, stdout: answer.stdout.trim(), stderr: answer.stderr.trim() });
    return answer.stdout;
  } catch (error) {
    log(script, {
      exitCode: error.code ?? 1,
      stdout: error.stdout?.trim() ?? '',
      stderr: error.stderr?.trim() ?? '',
      error: String(error),
    });
    throw error;
  }
}

function readJsonWithBom(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ''}`);
}

// --------------------------------------------------------------------------
// Grant-mode desktop admission: the interactive desktop must be unlocked and
// input-capable BEFORE any genuine click is attempted.
// --------------------------------------------------------------------------
async function precheckDesktop() {
  const outPath = path.join(evidenceDir, 'desktop-precheck.json');
  await runPowerShell('u06-desktop-precheck.ps1', ['-OutPath', outPath]);
  const check = readJsonWithBom(outPath);
  result.desktopPrecheck = check;
  log('desktop-precheck', check);
  return check.inputCapable === true && check.locked === false;
}

async function dumpUia(pid, name) {
  const out = path.join(evidenceDir, `${name}.json`);
  await runPowerShell('u06-uia-dump.ps1', ['-ProcessId', String(pid), '-OutPath', out]);
  const rows = readJsonWithBom(out);
  return Array.isArray(rows) ? rows : [rows];
}

// toolbarBaseTitle is the manifest action's default_title WITHOUT the
// newline: a raw LF cannot cross the Windows command line safely (grant
// r8-rr1 binding corruption) — PowerShell assembles the '<title>[char]10'
// prefix itself after binding.
async function clickUia(pid, name, controlType, manifestActionName, toolbarBaseTitle) {
  const args = ['-ProcessId', String(pid), '-Name', name];
  if (controlType) args.push('-ControlType', controlType.replace('ControlType.', ''));
  if (manifestActionName) args.push('-ActionName', manifestActionName);
  if (toolbarBaseTitle) args.push('-ToolbarBaseTitle', toolbarBaseTitle);
  await runPowerShell('u06-uia-click.ps1', args);
  result.toolbarClicks += 1;
  log('genuine-toolbar-click', {
    name,
    controlType,
    mechanism: 'UIA rectangle + user32 mouse_event',
  });
}

// Popup instrumentation: installed before the popup scripts execute. It
// counts popup→Worker messages by kind and chrome.permissions.request
// calls; mere mode/tab switching must add zero of each.
const POPUP_INSTRUMENTATION = `(() => {
  const counts = { workerMessages: 0, permissionRequests: 0, messageKinds: [] };
  window.__U06_COUNTS__ = counts;
  if (globalThis.chrome?.runtime?.sendMessage) {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      counts.workerMessages += 1;
      counts.messageKinds.push(args[0]?.kind ?? null);
      return original(...args);
    };
  }
  if (globalThis.chrome?.permissions?.request) {
    const original = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = (...args) => {
      counts.permissionRequests += 1;
      return original(...args);
    };
  }
})();`;

async function main() {
  if (SELF_TEST === 'desktop-precheck') {
    const outPath = path.join(evidenceDir, 'desktop-precheck-self-test.json');
    await runPowerShell('u06-desktop-precheck.ps1', ['-OutPath', outPath, '-SelfTest']);
    const cases = readJsonWithBom(outPath);
    fs.writeFileSync(
      path.join(evidenceDir, 'result.json'),
      `${JSON.stringify({ ok: true, cases }, null, 2)}\n`,
    );
    console.log(JSON.stringify({ ok: true, cases }));
    return EXIT.PASS;
  }
  if (SELF_TEST === 'foreground-guard') {
    // R5 deterministic guard self-test: BOTH click helpers run their shared
    // guard logic under the -SelfTest seam (scripted foreground readback,
    // seam input counters — zero native API touch). Cases: denied/mismatched
    // readback, matching HWND admission, unreadable foreground, unknown
    // target HWND. A pass requires zero SetCursorPos/mouse_event calls on
    // every denial path in both scripts.
    const toolbarOut = path.join(evidenceDir, 'foreground-guard-toolbar-action.json');
    await runPowerShell('u06-uia-toolbar-action.ps1', [
      '-ProcessId',
      '0',
      '-OutPath',
      toolbarOut,
      '-SelfTest',
    ]);
    const clickOut = path.join(evidenceDir, 'foreground-guard-click.json');
    await runPowerShell('u06-uia-click.ps1', [
      '-ProcessId',
      '0',
      '-Name',
      'self-test',
      '-OutPath',
      clickOut,
      '-SelfTest',
    ]);
    const toolbar = readJsonWithBom(toolbarOut);
    const click = readJsonWithBom(clickOut);
    result.selfTest = { name: SELF_TEST, toolbarAction: toolbar, click };
    result.ok = toolbar.ok === true && click.ok === true;
    result.status = result.ok ? 'PASS' : 'FAIL';
    result.manifestSha256After = sha256(path.join(extensionDir, 'manifest.json'));
    result.manifestUnchanged = result.manifestSha256After === result.manifestSha256Before;
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    log('driver-result', { selfTest: result.selfTest.name, ok: result.ok });
    console.log(
      JSON.stringify({ ok: result.ok, status: result.status, selfTest: result.selfTest }),
    );
    return result.ok ? EXIT.PASS : EXIT.FAIL;
  }
  const httpRequests = [];
  const server = http.createServer((req, res) => {
    httpRequests.push({ url: req.url, method: req.method });
    log('http-request', { url: req.url, method: req.method });
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === FIXTURE_PAGE) {
      const port = server.address().port;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html lang="zh-CN"><title>U06 local fixture</title><body><h1>U06 local fixture</h1>' +
          `<a href="http://localhost:${String(port)}/attachment-a.bin">attachment-a</a>` +
          `<a href="http://localhost:${String(port)}/attachment-b.bin">attachment-b</a></body></html>`,
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const httpPort = server.address().port;

  let chrome;
  let socket;
  let exitCode = EXIT.FAIL;
  try {
    // The R3 privacy self-test verifies only the PowerShell privacy-check
    // logic through the inspection-error seam; the generated script performs
    // no native input under the seam, so the unlocked-desktop admission gate
    // (a property of the genuine click, which the self-test never performs)
    // does not apply to it.
    if (MODE === 'grant' && SELF_TEST === null && !(await precheckDesktop())) {
      result.ok = false;
      result.status = 'NOT_RUN';
      result.notRunReason = `desktop locked or not input-capable: ${JSON.stringify(result.desktopPrecheck)}`;
      fs.writeFileSync(
        path.join(evidenceDir, 'result.json'),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      log('not-run', { reason: result.notRunReason });
      console.log(`GRANT_NOT_RUN_BLOCKER=${result.notRunReason}`);
      return EXIT.NOT_RUN;
    }

    const cdpPort = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const port = typeof address === 'object' && address !== null ? address.port : -1;
        probe.close(() => (port > 0 ? resolve(port) : reject(new Error('no CDP port'))));
      });
    });
    const chromeArgs = [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${extensionDir}`,
      `--remote-debugging-port=${String(cdpPort)}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      `http://127.0.0.1:${String(httpPort)}${FIXTURE_PAGE}`,
    ];
    result.launchCommand = { executable: chromeExe, args: chromeArgs };
    chrome = spawn(chromeExe, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let chromeStderr = '';
    chrome.stderr.on('data', (chunk) => {
      chromeStderr += String(chunk);
      fs.appendFileSync(path.join(evidenceDir, 'chrome-stderr.log'), String(chunk));
    });
    result.chromePid = chrome.pid;
    log('chrome-launched', { pid: chrome.pid, profileDir, cdpPort });
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${String(cdpPort)}/json/version`);
      return response.ok ? response.json() : null;
    }, 'Chrome DevTools endpoint');
    result.browserVersion = version;
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${String(cdpPort)}/json/list`);
      const list = await response.json();
      const worker = list.find((item) =>
        /^chrome-extension:\/\/[a-p]{32}\/background\.service-worker\.js$/u.test(item.url),
      );
      return worker ? list : null;
    }, 'extension service worker');
    const workerTarget = targets.find((item) =>
      /^chrome-extension:\/\/[a-p]{32}\/background\.service-worker\.js$/u.test(item.url),
    );
    const extensionId = workerTarget.url.match(/^chrome-extension:\/\/([a-p]{32})\//u)[1];
    result.extensionId = extensionId;
    log('extension-loaded', { extensionId });

    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const attachHandlers = [];
    let popupSessionId;
    let attachError;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result ?? {});
        return;
      }
      if (message.method === 'Target.attachedToTarget') {
        for (const handler of attachHandlers) void handler(message.params);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const evaluate = async (sessionId, expression) => {
      const answer = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
      return answer.result?.value;
    };
    const mouseClick = async (sessionId, selector) => {
      const point = await evaluate(
        sessionId,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return null;
          element.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
      );
      if (!point) throw new Error(`mouse target unavailable: ${selector}`);
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mouseMoved', x: point.x, y: point.y },
        sessionId,
      );
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        sessionId,
      );
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        sessionId,
      );
      log('popup-mouse-click', { selector });
    };

    attachHandlers.push(async (attached) => {
      try {
        if (attached.targetInfo.url.includes('/popup.html')) {
          popupSessionId = attached.sessionId;
          await send('Page.enable', {}, attached.sessionId);
          await send('Runtime.enable', {}, attached.sessionId);
          await send('Runtime.evaluate', { expression: POPUP_INSTRUMENTATION }, attached.sessionId);
          await send(
            'Page.addScriptToEvaluateOnNewDocument',
            { source: POPUP_INSTRUMENTATION },
            attached.sessionId,
          );
          log('popup-auto-attached-before-release', { targetInfo: attached.targetInfo });
        }
        await send('Runtime.runIfWaitingForDebugger', {}, attached.sessionId);
      } catch (error) {
        attachError = error;
      }
    });
    await send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });

    if (SELF_TEST === 'privacy-inspection-error') {
      // R3 P2-01 focused regression evidence: invoke the SAME generated
      // toolbar-action script with the inspection-error seam — a synthetic
      // top-level window whose UIA reads always throw. The privacy check
      // must record UNKNOWN and skip the screenshot; capturing anyway (or
      // widening bounds) is a FAIL. No popup/gesture assertions run here.
      const stdout = await runPowerShell(
        'u06-uia-toolbar-action.ps1',
        [
          '-ProcessId',
          String(chrome.pid),
          '-OutPath',
          path.join(evidenceDir, 'uia-extensions-menu.json'),
        ],
        { env: { ...process.env, U06_PRIVACY_SELFTEST_INSPECTION_ERROR: '1' } },
      );
      const skipMatch = stdout.match(/UIA_TOOLBAR_SCREENSHOT_SKIPPED=([^\r\n]+)/u);
      result.selfTest = {
        name: SELF_TEST,
        seamEnv: 'U06_PRIVACY_SELFTEST_INSPECTION_ERROR',
        foregroundPrecondition: 'forced_pass_under_seam',
        privacySkipReason: skipMatch ? skipMatch[1] : null,
        screenshotCaptured: stdout.includes('UIA_TOOLBAR_SCREENSHOT_CHROME_WINDOW_ONLY=1'),
        nativeClicksPerformed: false,
      };
      result.manifestSha256After = sha256(path.join(extensionDir, 'manifest.json'));
      result.manifestUnchanged = result.manifestSha256After === result.manifestSha256Before;
      result.ok =
        skipMatch !== null &&
        skipMatch[1].startsWith('window_inspection_error:') &&
        result.selfTest.screenshotCaptured === false &&
        result.manifestUnchanged === true;
      result.status = result.ok ? 'PASS' : 'FAIL';
      result.chromeStderrTail = chromeStderr.slice(-1000);
      fs.writeFileSync(
        path.join(evidenceDir, 'result.json'),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      log('driver-result', { selfTest: result.selfTest, ok: result.ok });
      console.log(
        JSON.stringify({
          mode: MODE,
          selfTest: result.selfTest,
          ok: result.ok,
          status: result.status,
          manifestUnchanged: result.manifestUnchanged,
        }),
      );
      exitCode = result.ok ? EXIT.PASS : EXIT.FAIL;
      return exitCode;
    }

    if (MODE === 'control') {
      // Denial-only control: the direct popup URL is permitted HERE and only
      // here, in a background tab, explicitly not a user gesture.
      await send('Target.createTarget', {
        url: `chrome-extension://${extensionId}/popup.html`,
        background: true,
      });
      log('denial-control-popup-created-directly', { userGesture: false });
    } else {
      try {
        const rows = await dumpUia(chrome.pid, 'uia-before-toolbar');
        // R8 review repair (P1-01): the direct path now applies the SAME
        // unified exact action predicate as the menu path, both Node-side
        // (this filter over the dump rows) and PowerShell-side (the click
        // helper re-derives it live before any input). The enumeration is
        // recorded truthfully: on Chrome 153 the pinned toolbar button
        // exposes ExpandCollapsePattern and no InvokePattern (evidence
        // grant-r8-9-diag), so the strict predicate yields zero candidates
        // there and the genuine grant proceeds through the Extensions-menu
        // mechanism under the same predicate — a genuine guarded UIA input,
        // never the forbidden fallback set (CDP/openPopup/DOM/popup URL).
        const candidates = rows.filter((row) => rowIsExtensionAction(row));
        result.directPathEnumeration = {
          dumpRows: rows.length,
          actionNameFormRows: rows.filter(
            (row) =>
              typeof row.name === 'string' &&
              ((actionName !== '' && row.name.startsWith(actionName)) ||
                (actionToolbarTitlePrefix !== null &&
                  row.name.startsWith(actionToolbarTitlePrefix))),
          ).length,
          predicateCandidates: candidates.length,
          actionName,
          toolbarTitlePrefix: actionToolbarTitlePrefix,
          predicate:
            'manifest-name-prefix-form+visible-nonzero-bounds+Invoke-required+Toggle/ExpandCollapse-rejected',
        };
        log('direct-path-enumeration', result.directPathEnumeration);
        if (candidates.length === 1) {
          await clickUia(
            chrome.pid,
            candidates[0].name,
            candidates[0].controlType,
            actionName,
            actionDefaultTitle,
          );
        } else {
          await runPowerShell('u06-uia-toolbar-action.ps1', [
            '-ProcessId',
            String(chrome.pid),
            '-OutPath',
            path.join(evidenceDir, 'uia-extensions-menu.json'),
            '-ActionName',
            actionName,
            ...(actionDefaultTitle !== null ? ['-ToolbarBaseTitle', actionDefaultTitle] : []),
          ]);
          result.toolbarClicks += 1;
          log('genuine-toolbar-click', {
            name: 'xDownload extension action in Extensions menu',
            mechanism:
              'user32 mouse_event Extensions menu + user32 mouse_event xDownload extension action',
          });
        }
      } catch (error) {
        // The extension action could not be clicked through the visible
        // toolbar UI. This is a NOT_RUN blocker, never a FAIL and never a
        // fallback to direct popup navigation / CDP / openPopup. The R5
        // foreground guard denial is recorded distinctly: it guarantees zero
        // cursor movement and zero native input were sent.
        // The exit-6 guard marker reaches us on the failed process's captured
        // stdout, not in the execFile error message. The reason distinguishes
        // pre-input denial (zero cursor/mouse) from a mid-click foreground
        // move (mouse-down may have been sent; the helper guarantees its matching mouse-up cleanup).
        const stdoutText = String(error.stdout ?? '');
        const guardBlocked = stdoutText.includes('FOREGROUND_GUARD=1');
        const reasonMatch = stdoutText.match(/REASON=([^\s]+)/u);
        const guardReason = reasonMatch ? reasonMatch[1] : 'unknown';
        const downMatch = stdoutText.match(/MOUSE_DOWN_SENT=([01])/u);
        const upMatch = stdoutText.match(/MOUSE_UP_CLEANUP_SENT=([01])/u);
        result.nativeInputCleanup = {
          mouseDownSent: downMatch ? downMatch[1] === '1' : null,
          mouseUpCleanupSent: upMatch ? upMatch[1] === '1' : null,
        };
        result.ok = false;
        result.status = 'NOT_RUN';
        result.foregroundGuard = guardBlocked ? `blocked:${guardReason}` : 'not_applicable';
        result.notRunReason = guardBlocked
          ? `native click guard blocked (${guardReason}): ${String(error)}`
          : `genuine toolbar action not clickable: ${String(error)}`;
        fs.writeFileSync(
          path.join(evidenceDir, 'result.json'),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        log('not-run', { reason: result.notRunReason });
        console.log(`GRANT_NOT_RUN_BLOCKER=${result.notRunReason}`);
        return EXIT.NOT_RUN;
      }
    }

    try {
      await waitFor(
        () => popupSessionId ?? (attachError ? Promise.reject(attachError) : null),
        'popup target auto-attach after genuine toolbar click',
      );
    } catch (error) {
      // A genuine click that opened no popup proves no user gesture reached
      // the action (e.g. input landed on the lock screen). NOT_RUN, no
      // fallback. R8: record the full target list at timeout so the evidence
      // distinguishes "popup never opened" from "opened but not attached".
      let popupTargetsAtTimeout = null;
      try {
        const targetsResponse = await send('Target.getTargets', {});
        popupTargetsAtTimeout = (targetsResponse.targetInfos ?? []).map((target) => ({
          type: target.type,
          url: String(target.url).slice(0, 120),
        }));
      } catch {
        popupTargetsAtTimeout = null;
      }
      result.ok = false;
      result.status = 'NOT_RUN';
      result.popupTargetsAtTimeout = popupTargetsAtTimeout;
      result.notRunReason = `genuine toolbar click opened no popup: ${String(error)}`;
      fs.writeFileSync(
        path.join(evidenceDir, 'result.json'),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      log('not-run', { reason: result.notRunReason });
      console.log(`GRANT_NOT_RUN_BLOCKER=${result.notRunReason}`);
      return EXIT.NOT_RUN;
    }
    await waitFor(
      () =>
        evaluate(
          popupSessionId,
          `document.readyState === 'complete' && !!document.getElementById('state')`,
        ),
      'popup document ready',
    );
    if (MODE === 'grant') {
      await waitFor(
        () =>
          evaluate(popupSessionId, `document.querySelectorAll('#attachments > li').length === 2`),
        'activeTab-granted attachment scan',
      );
    } else {
      await waitFor(
        () =>
          evaluate(
            popupSessionId,
            `document.getElementById('state').textContent.includes('Cannot access contents')`,
          ),
        'activeTab-denied scan refusal',
      );
    }
    result.initial = await evaluate(
      popupSessionId,
      `(() => ({
        state: document.getElementById('state').textContent,
        stateClass: document.getElementById('state').className,
        attachmentCount: document.querySelectorAll('#attachments > li').length,
        attachments: Array.from(document.querySelectorAll('#attachments .link')).map((node) => node.textContent),
        counts: window.__U06_COUNTS__,
      }))()`,
    );
    result.activeTabQuery = await evaluate(
      popupSessionId,
      `chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs.map((tab) => ({ id: tab.id, url: tab.url ?? null })))`,
    );
    result.beforeSwitch = await evaluate(popupSessionId, `window.__U06_COUNTS__`);
    for (const mode of ['batch', 'collection', 'advanced', 'page']) {
      await mouseClick(popupSessionId, `.mode-tab[data-mode="${mode}"]`);
      await sleep(200);
    }
    result.afterSwitch = await evaluate(popupSessionId, `window.__U06_COUNTS__`);
    result.switchDelta = {
      workerMessages: result.afterSwitch.workerMessages - result.beforeSwitch.workerMessages,
      permissionRequests:
        result.afterSwitch.permissionRequests - result.beforeSwitch.permissionRequests,
      selectedPanel:
        (await evaluate(
          popupSessionId,
          `document.querySelector('.mode-tab[aria-selected="true"]')?.dataset.mode ?? null`,
        )) ?? null,
    };
    try {
      const shot = await send(
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true },
        popupSessionId,
      );
      fs.writeFileSync(
        path.join(evidenceDir, `${MODE}-popup.png`),
        Buffer.from(shot.data, 'base64'),
      );
    } catch (error) {
      result.screenshotError = String(error);
      log('popup-screenshot-unavailable', { error: String(error) });
    }
    result.attachmentRequests = httpRequests.filter((item) => item.url?.startsWith('/attachment-'));
    result.manifestSha256After = sha256(path.join(extensionDir, 'manifest.json'));
    result.manifestUnchanged = result.manifestSha256After === result.manifestSha256Before;
    // P2 repair (web source-review): manifestUnchanged is part of the PASS
    // predicate — a mutated manifest during the run is a failure, never a
    // footnote.
    result.ok =
      result.manifestUnchanged === true &&
      (MODE === 'grant'
        ? result.initial.attachmentCount === 2 &&
          result.switchDelta.workerMessages === 0 &&
          result.switchDelta.permissionRequests === 0
        : result.initial.attachmentCount === 0 &&
          result.initial.state.includes('Cannot access contents') &&
          result.switchDelta.workerMessages === 0 &&
          result.switchDelta.permissionRequests === 0);
    result.chromeStderrTail = chromeStderr.slice(-1000);
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    log('driver-result', { ok: result.ok, switchDelta: result.switchDelta });
    console.log(
      JSON.stringify({
        mode: MODE,
        ok: result.ok,
        status: result.ok ? 'PASS' : 'FAIL',
        initial: result.initial,
        switchDelta: result.switchDelta,
        toolbarClicks: result.toolbarClicks,
        manifestUnchanged: result.manifestUnchanged,
      }),
    );
    exitCode = result.ok ? EXIT.PASS : EXIT.FAIL;
  } catch (error) {
    result.ok = false;
    result.error = String(error);
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    log('driver-failed', { error: String(error) });
    console.error(`${MODE.toUpperCase()}_DRIVER_ERROR=${String(error)}`);
    exitCode = EXIT.FAIL;
  } finally {
    if (socket) socket.close();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
      await sleep(800);
      if (chrome.exitCode === null && chrome.signalCode === null) {
        await execFileAsync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F']).catch(
          () => undefined,
        );
      }
    }
    await new Promise((resolve) => server.close(resolve));
    // The fresh temporary profile is per-run residue; evidence above is the
    // durable artifact. A persistent user Chrome profile was never touched.
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  console.log(`${MODE.toUpperCase()}_DRIVER_EXIT=${String(exitCode)}`);
  return exitCode;
}

process.exit(await main());
