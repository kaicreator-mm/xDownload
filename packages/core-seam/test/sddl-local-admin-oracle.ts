/**
 * Test-only Windows SDDL LA equivalence: Microsoft uses LA for the LOCAL
 * machine's Administrator account SID, not arbitrary domain RID-500 SIDs.
 *
 * Fails closed when the actual machine Administrator SID cannot be read from
 * the OS. Never let a claimed user identity or a string suffix decide this.
 */
import { execFileSync } from 'node:child_process';

const SID_FORMAT = /^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/u;
const MACHINE_ADMIN_SID_FORMAT = /^S-1-5-21-(?:[0-9]+-){3}500$/u;

export function resolveActualMachineAdministratorSid(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    // CIM LocalAccount=True distinguishes the computer's RID 500 from an
    // identically suffixed domain administrator SID. Do not look up the
    // localized/renamable account display name "Administrator".
    const script = [
      "$accounts = @(Get-CimInstance -ClassName Win32_UserAccount -Filter 'LocalAccount = TRUE' -ErrorAction Stop)",
      "$matches = @($accounts | Where-Object { $_.SID -match '^S-1-5-21-(?:[0-9]+-){3}500$' } | Select-Object -ExpandProperty SID)",
      "if ($matches.Count -ne 1) { exit 12 }",
      "[Console]::Out.Write($matches[0])",
    ].join('; ');
    const value = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16_384 }).trim();
    return MACHINE_ADMIN_SID_FORMAT.test(value) ? value : undefined;
  } catch {
    // A missing CIM privilege/provider is NOT an excuse to trust LA.
    return undefined;
  }
}

/** Pure oracle; tests supply only a separately OS-resolved local SID. */
export function hasExactExpectedUserAce(
  sddl: string,
  expectedUserSid: string,
  machineAdministratorSid: string | undefined,
): boolean {
  if (!SID_FORMAT.test(expectedUserSid)) return false;
  if (sddl.includes(`(A;;GA;;;${expectedUserSid})`)) return true;
  return (
    machineAdministratorSid !== undefined &&
    MACHINE_ADMIN_SID_FORMAT.test(machineAdministratorSid) &&
    machineAdministratorSid === expectedUserSid &&
    sddl.includes('(A;;GA;;;LA)')
  );
}
