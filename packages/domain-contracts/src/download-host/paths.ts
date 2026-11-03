/**
 * V022 A01 — neutral Host-operation contracts: output-root containment
 * grammar.
 *
 * Both the Domain App (sealing the confirmed scope) and the trusted Host
 * (materializing bytes and emitting evidence) must enforce the identical
 * output-root/artifact containment rules before any I/O, so the single
 * grammar lives here.
 *
 * Separator discipline is fixed per root flavor so no cross-platform
 * backslash trickery can smuggle a traversal past one OS's parsing while
 * another OS's parsing escapes: a Windows root (`[A-Za-z]:[\\/]`) accepts
 * both separators; a POSIX root (`/`) accepts ONLY `/` and backslash is
 * refused outright (on POSIX a backslash is an ordinary filename byte, so
 * admitting it would make the grammar's containment claim ambiguous).
 * Pure string validation: no filesystem access, no Node APIs.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';

const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:[\\/]/;

/** Split path segments with the separator set of the root flavor. */
function splitSegments(root: string, value: string): string[] {
  const separator = WINDOWS_ROOT_PATTERN.test(root) ? /[\\/]/ : /\//;
  return value.split(separator).filter((segment) => segment.length > 0 && segment !== '.');
}

/** The root flavor decides which separators the artifact grammar admits. */
function isWindowsRoot(root: string): boolean {
  return WINDOWS_ROOT_PATTERN.test(root);
}

/** Output-root containment grammar: absolute, bounded, no traversal. */
export function validateOutputRoot(root: unknown): DomainValidationResult<string> {
  if (typeof root !== 'string' || root.length === 0 || root.length > 512) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'outputRoot',
        'output root must be a bounded path string',
      ),
    ]);
  }
  if (!WINDOWS_ROOT_PATTERN.test(root) && !root.startsWith('/')) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be an absolute path'),
    ]);
  }
  if (!isWindowsRoot(root) && root.includes('\\')) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'outputRoot',
        "POSIX output root must use '/' separators only; backslash is refused",
      ),
    ]);
  }
  const segments = splitSegments(root, root);
  if (segments.includes('..')) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'outputRoot', "output root must not contain '..' segments"),
    ]);
  }
  return ok(root);
}

/**
 * Artifact path containment inside a validated root: the path must be a
 * bounded string inside the authorized root with no '..' escape. A refused
 * path is rejected BEFORE any physical effect can exist. The artifact must
 * follow the root flavor's separator discipline (POSIX roots refuse
 * backslash; Windows roots admit both separators).
 */
export function validateArtifactPath(
  root: string,
  artifactPath: unknown,
): DomainValidationResult<string> {
  const rootCheck = validateOutputRoot(root);
  if (!rootCheck.ok) return rootCheck;
  if (typeof artifactPath !== 'string' || artifactPath.length === 0 || artifactPath.length > 768) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'artifactPath',
        'artifact path must be a bounded string',
      ),
    ]);
  }
  if (!isWindowsRoot(root) && artifactPath.includes('\\')) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'artifactPath',
        "POSIX artifact path must use '/' separators only; backslash is refused",
      ),
    ]);
  }
  // On Windows both separators are equivalent to the OS, so the containment
  // comparison normalizes to '/' while the returned value keeps the caller's
  // original separators. POSIX flavor already refused backslash above, so no
  // normalization is needed (or allowed) there.
  const windows = isWindowsRoot(root);
  const normalizedRoot = (windows ? root.replace(/\\/g, '/') : root).replace(/\/+$/, '');
  const comparablePath = windows ? artifactPath.replace(/\\/g, '/') : artifactPath;
  if (!comparablePath.startsWith(normalizedRoot)) {
    return fail([
      diagnostic(
        'OUTPUT_ROOT_ESCAPED',
        'artifactPath',
        'artifact path escapes the authorized output root',
      ),
    ]);
  }
  const remainder = comparablePath.slice(normalizedRoot.length);
  if (/^\//.test(remainder) === false) {
    return fail([
      diagnostic(
        'OUTPUT_ROOT_ESCAPED',
        'artifactPath',
        'artifact path must be inside the output root',
      ),
    ]);
  }
  const segments = splitSegments(root, remainder);
  if (segments.includes('..')) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', "artifact path must not contain '..'"),
    ]);
  }
  return ok(artifactPath);
}
