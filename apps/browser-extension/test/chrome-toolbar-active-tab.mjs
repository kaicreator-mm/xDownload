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

if (MODE !== 'control' && MODE !== 'grant') {
  console.error(
    'usage: node chrome-toolbar-active-tab.mjs --mode=control|grant [--chrome=exe] [--extension=dir] [--out=evidence-dir]',
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
  [Parameter(Mandatory=$true)][string]$OutPath
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
}
'@
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
if ($foreground -ne [IntPtr]::Zero) {
  $title = New-Object System.Text.StringBuilder 512
  if ([U06Desktop]::GetWindowText($foreground, $title, 512) -gt 0) { $foregroundText = $title.ToString() }
}
# The input-desktop name alone can stay 'Default' while the physical console
# shows the lock screen (native mouse input then cannot reach Chrome). Treat
# the visible lock screen — LockApp running or a lock-screen foreground — as
# locked even when the input-desktop query disagrees.
$lockAppRunning = $null -ne (Get-Process LockApp -ErrorAction SilentlyContinue | Select-Object -First 1)
$foregroundIsLockScreen = $foregroundText -match '锁屏|Lock screen|锁定'
$locked = ($desktopName -ne 'Default') -or $lockAppRunning -or $foregroundIsLockScreen
[pscustomobject]@{
  inputDesktop = $desktopName
  lockAppRunning = $lockAppRunning
  foregroundIsLockScreen = $foregroundIsLockScreen
  locked = $locked
  inputCapable = -not $locked
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

const UIA_CLICK_PS1 = `param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$ControlType = ''
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class U06Mouse {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $ProcessId
)
$windows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $condition
) | ForEach-Object { $_ })
$matches = @()
foreach ($window in $windows) {
  $elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Subtree,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    $current = $element.Current
    $typeMatches = $ControlType -eq '' -or $current.ControlType.ProgrammaticName -eq ('ControlType.' + $ControlType)
    if ($current.Name -ceq $Name -and $typeMatches -and -not $current.IsOffscreen -and $current.BoundingRectangle.Width -gt 0) {
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
[U06Mouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) | Out-Null
Start-Sleep -Milliseconds 250
[U06Mouse]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 100
[U06Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[U06Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
[pscustomobject]@{
  mechanism = 'Windows UI Automation bounding rectangle + user32 SetCursorPos/mouse_event'
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
  [Parameter(Mandatory=$true)][string]$OutPath
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
}
'@
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
  [U06ActionMouse]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 150
  [U06ActionMouse]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 100
  [U06ActionMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [U06ActionMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
$menuPoint = Click-Element $puzzle $mainWindow
Start-Sleep -Milliseconds 700
& (Join-Path $PSScriptRoot 'u06-uia-dump.ps1') -ProcessId $ProcessId -OutPath $OutPath
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
    if ($foreground -ne $chromeHandle) {
      $captureSkipReason = 'chrome_window_not_foreground'
    } else {
      $occluder = $null
      $topLevel = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      foreach ($top in $topLevel) {
        try {
          if ($top.Current.NativeWindowHandle -eq $chromeHandle) { continue }
          if ($top.Current.IsOffscreen) { continue }
          $other = $top.Current.BoundingRectangle
          if ($other.Width -le 0 -or $other.Height -le 0) { continue }
          $overlapX = [Math]::Min($winRect.X + $winRect.Width, $other.X + $other.Width) - [Math]::Max($winRect.X, $other.X)
          $overlapY = [Math]::Min($winRect.Y + $winRect.Height, $other.Y + $other.Height) - [Math]::Max($winRect.Y, $other.Y)
          if ($overlapX -gt 0 -and $overlapY -gt 0) {
            $occluder = $top.Current.Name
            break
          }
        } catch { }
      }
      if ($null -ne $occluder) {
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
$matches = @()
foreach ($window in (Get-ChromeWindows)) {
  $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($element in $elements) {
    $current = $element.Current
    if ($current.Name -like '*xDownload*' -and -not $current.IsOffscreen -and $current.BoundingRectangle.Width -gt 0) {
      $matches += [pscustomobject]@{ Element = $element; Window = $window }
    }
  }
}
if ($matches.Count -ne 1) {
  Write-Output ('UIA_TOOLBAR_ACTION_EXIT=5 MATCH_COUNT=' + $matches.Count)
  exit 5
}
$target = $matches[0].Element
$point = Click-Element $target $matches[0].Window
[pscustomobject]@{
  menuMechanism = 'user32 SetCursorPos/mouse_event on Extensions toolbar automationId view_1006'
  actionMechanism = 'user32 SetCursorPos/mouse_event on xDownload extension action'
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

async function runPowerShell(script, args) {
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
      { timeout: 30_000, windowsHide: true },
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

async function clickUia(pid, name, controlType) {
  const args = ['-ProcessId', String(pid), '-Name', name];
  if (controlType) args.push('-ControlType', controlType.replace('ControlType.', ''));
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
    if (MODE === 'grant' && !(await precheckDesktop())) {
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
        const candidates = rows.filter(
          (row) => row.name?.includes('xDownload') && !row.isOffscreen && row.width > 0,
        );
        if (candidates.length === 1) {
          await clickUia(chrome.pid, candidates[0].name, candidates[0].controlType);
        } else {
          await runPowerShell('u06-uia-toolbar-action.ps1', [
            '-ProcessId',
            String(chrome.pid),
            '-OutPath',
            path.join(evidenceDir, 'uia-extensions-menu.json'),
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
        // fallback to direct popup navigation / CDP / openPopup.
        result.ok = false;
        result.status = 'NOT_RUN';
        result.notRunReason = `genuine toolbar action not clickable: ${String(error)}`;
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
      // fallback.
      result.ok = false;
      result.status = 'NOT_RUN';
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
