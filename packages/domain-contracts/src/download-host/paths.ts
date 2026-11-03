/**
 * V022 A01 — neutral Host-operation contracts: output-root containment
 * grammar.
 *
 * Both the Domain App (sealing the confirmed scope) and the trusted Host
 * (materializing bytes and emitting evidence) must enforce the identical
 * output-root/artifact containment rules before any I/O, so the single
 * grammar lives here. Pure string validation: no filesystem access, no
 * path resolution against the real OS, no Node APIs.
 */
import { diagnostic, fail, ok, type DomainValidationResult } from '../diagnostics.ts';

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
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(root)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be an absolute path'),
    ]);
  }
  const segments = root.split(/[\\/]/).filter((segment) => segment.length > 0 && segment !== '.');
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
 * path is rejected BEFORE any physical effect can exist.
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
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  if (!artifactPath.startsWith(normalizedRoot)) {
    return fail([
      diagnostic(
        'OUTPUT_ROOT_ESCAPED',
        'artifactPath',
        'artifact path escapes the authorized output root',
      ),
    ]);
  }
  const remainder = artifactPath.slice(normalizedRoot.length);
  if (/^[\\/]/.test(remainder) === false) {
    return fail([
      diagnostic(
        'OUTPUT_ROOT_ESCAPED',
        'artifactPath',
        'artifact path must be inside the output root',
      ),
    ]);
  }
  const segments = remainder.split(/[\\/]/).filter((segment) => segment.length > 0);
  if (segments.includes('..')) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', "artifact path must not contain '..'"),
    ]);
  }
  return ok(artifactPath);
}
