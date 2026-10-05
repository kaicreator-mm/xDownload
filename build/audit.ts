/**
 * T018 package-content audit — executable, fail-closed (REFERENCE_PACK §1.1).
 *
 * The audit compares emitted reality against the declared content rules:
 *
 * 1. dist/ contains exactly the declared top-level artifact set;
 * 2. every file inside an artifact matches that artifact's allowlist and
 *    nothing matches the global development-material denylist
 *    (.agent/execution, frozen docs, toolchain-smoke packages, tests, TS
 *    source, source maps, markdown, env/key material);
 * 3. no file content matches credential-shaped material (deterministic
 *    scanner; any un-allowlisted match is fatal — failing closed is the
 *    feature);
 * 4. the extension package layout equals exactly what its MV3 manifest
 *    references (missing referenced output = PACKAGE_MANIFEST_MISMATCH,
 *    unreferenced executable payload = violation);
 * 5. every artifact identity exists and re-hashes correctly;
 * 6. every BUILT_AND_SMOKED tuple in the support matrix cites durable PASS
 *    evidence that actually exists — a claim without evidence fails the
 *    build (C22/C34: unexecuted checks stay NOT_PROVEN, never PASS).
 */

import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS, DIST_TOP_LEVEL_ALLOWLIST, type ArtifactSpec } from './build-config.ts';
import { contentManifest, canonicalContentHash, type PackageIdentity } from './identity.ts';

export interface AuditViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface AuditInput {
  readonly distDir: string;
  /** Repo-root-relative evidence dir backing BUILT_AND_SMOKED claims. */
  readonly evidenceDir: string;
}

export interface SupportMatrixTuple {
  readonly id: string;
  readonly status: 'BUILT_AND_SMOKED' | 'NOT_PROVEN' | 'BLOCKED';
  readonly claimType: string;
  readonly evidence?: readonly string[];
  readonly reason?: string;
}

export interface SupportMatrix {
  readonly matrixVersion: string;
  readonly tuples: readonly SupportMatrixTuple[];
}

/**
 * Glob-lite matcher: a leading double-star-slash segment matches any
 * (possibly empty) directory prefix; a slash-double-star at the end matches
 * everything below; a lone star matches within one segment; anything else
 * matches exactly.
 */
export function globMatches(pattern: string, candidate: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(candidate);
}

function globToRegex(pattern: string): RegExp {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char: string = pattern[index] ?? '';
    if (char === '') {
      break;
    }
    if (char === '*') {
      if (pattern.startsWith('**/', index)) {
        source += '(?:.*/)?';
        index += 3;
        continue;
      }
      // A double star after a slash (any depth below): matches everything.
      if (index > 0 && pattern[index - 1] === '/' && pattern.startsWith('**', index)) {
        source += '.*';
        index += 2;
        continue;
      }
      source += '[^/]*';
      index += 1;
      continue;
    }
    source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }
  return new RegExp(`^${source}$`);
}

const CREDENTIAL_PATTERNS: readonly { readonly name: string; readonly regex: RegExp }[] = [
  { name: 'private-key-block', regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'bearer-or-provider-key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-token', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'json-credential-field',
    regex: /"(?:api[_-]?key|secret|password|passwd|token|cookie|authorization)"\s*:\s*"[^"]{8,}"/i,
  },
  {
    name: 'assignment-credential-field',
    regex: /(?:api[_-]?key|secret|password|passwd)\s*=\s*["'][^"']{8,}["']/i,
  },
];

/** Deterministic scan of one file's text for credential-shaped material. */
export function scanTextForCredentials(text: string): readonly { name: string; excerpt: string }[] {
  const hits: { name: string; excerpt: string }[] = [];
  for (const pattern of CREDENTIAL_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match !== null && match[0] !== undefined) {
      hits.push({ name: pattern.name, excerpt: match[0].slice(0, 24) });
    }
  }
  return hits;
}

const SCANNABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.json', '.cmd', '']);

function auditArtifactFiles(
  artifact: ArtifactSpec,
  artifactDir: string,
): readonly AuditViolation[] {
  const violations: AuditViolation[] = [];
  for (const full of listArtifactFiles(artifactDir)) {
    const relative = path.relative(artifactDir, full).split(path.sep).join('/');
    const allowed = artifact.allowlist.some((pattern) => globMatches(pattern, relative));
    if (!allowed) {
      violations.push({
        rule: 'artifact-allowlist',
        detail: `${artifact.outDir}/${relative} is not admitted by the declared content rules`,
      });
    }
    for (const denied of DENIED_RULES) {
      if (globMatches(denied.pattern, `${artifact.outDir}/${relative}`)) {
        violations.push({ rule: denied.rule, detail: `${artifact.outDir}/${relative}` });
      }
    }
    const ext = path.extname(relative);
    if (SCANNABLE_EXTENSIONS.has(ext)) {
      for (const hit of scanTextForCredentials(fs.readFileSync(full, 'utf8'))) {
        violations.push({
          rule: `credential-material:${hit.name}`,
          detail: `${artifact.outDir}/${relative} matches '${hit.excerpt}...'`,
        });
      }
    }
  }
  return violations;
}

const DENIED_RULES: readonly { readonly rule: string; readonly pattern: string }[] = [
  { rule: 'agent-execution-material', pattern: '**/.agent/**' },
  { rule: 'frozen-docs', pattern: '**/docs/**' },
  { rule: 'node-modules', pattern: '**/node_modules/**' },
  { rule: 'test-fixture-or-dev-test', pattern: '**/test/**' },
  { rule: 'toolchain-smoke-package', pattern: '**/toolchain-smoke*/**' },
  { rule: 'raw-ts-source', pattern: '**/*.ts' },
  { rule: 'source-map', pattern: '**/*.map' },
  { rule: 'markdown', pattern: '**/*.md' },
  { rule: 'env-or-key-file', pattern: '**/.env*' },
  { rule: 'env-or-key-file', pattern: '**/*.pem' },
  { rule: 'env-or-key-file', pattern: '**/*.key' },
];

function listArtifactFiles(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

/** MV3 manifest-referenced file set (background, content scripts, icons). */
export function manifestReferencedFiles(manifest: Record<string, unknown>): readonly string[] {
  const referenced: string[] = [];
  const background = manifest['background'];
  if (typeof background === 'object' && background !== null) {
    const worker = (background as Record<string, unknown>)['service_worker'];
    if (typeof worker === 'string') {
      referenced.push(worker);
    }
  }
  const contentScripts = manifest['content_scripts'];
  if (Array.isArray(contentScripts)) {
    for (const script of contentScripts) {
      if (typeof script === 'object' && script !== null) {
        const js = (script as Record<string, unknown>)['js'];
        if (Array.isArray(js)) {
          for (const file of js) {
            if (typeof file === 'string') {
              referenced.push(file);
            }
          }
        }
      }
    }
  }
  const action = manifest['action'];
  if (typeof action === 'object' && action !== null) {
    const icons = (action as Record<string, unknown>)['default_icon'];
    if (typeof icons === 'string') {
      referenced.push(icons);
    } else if (typeof icons === 'object' && icons !== null) {
      for (const file of Object.values(icons as Record<string, unknown>)) {
        if (typeof file === 'string') {
          referenced.push(file);
        }
      }
    }
  }
  const icons = manifest['icons'];
  if (typeof icons === 'object' && icons !== null) {
    for (const file of Object.values(icons as Record<string, unknown>)) {
      if (typeof file === 'string') {
        referenced.push(file);
      }
    }
  }
  return referenced;
}

function auditExtensionManifestMatch(extensionDir: string): readonly AuditViolation[] {
  const violations: AuditViolation[] = [];
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [
      { rule: 'PACKAGE_MANIFEST_MISMATCH', detail: 'extension package is missing manifest.json' },
    ];
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const referenced = manifestReferencedFiles(manifest);
  const emitted = listArtifactFiles(extensionDir)
    .map((full) => path.relative(extensionDir, full).split(path.sep).join('/'))
    .sort();
  const referencedSet = new Set(['manifest.json', ...referenced]);
  for (const file of referenced) {
    if (!fs.existsSync(path.join(extensionDir, file))) {
      violations.push({
        rule: 'PACKAGE_MANIFEST_MISMATCH',
        detail: `manifest references '${file}' but the build does not emit it`,
      });
    }
  }
  for (const file of emitted) {
    if (!referencedSet.has(file)) {
      violations.push({
        rule: 'unreferenced-executable-payload',
        detail: `extension package contains '${file}' which the manifest does not reference`,
      });
    }
  }
  return violations;
}

function readIdentities(distDir: string): Map<string, PackageIdentity> {
  const identityDir = path.join(distDir, 'identity');
  const identities = new Map<string, PackageIdentity>();
  if (!fs.existsSync(identityDir)) {
    return identities;
  }
  for (const file of fs.readdirSync(identityDir)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const parsed = JSON.parse(
      fs.readFileSync(path.join(identityDir, file), 'utf8'),
    ) as PackageIdentity;
    identities.set(parsed.artifact, parsed);
  }
  return identities;
}

export function loadSupportMatrix(distDir: string): SupportMatrix {
  const matrixPath = path.join(distDir, 'support-matrix.json');
  return JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as SupportMatrix;
}

const CLAIM_TYPES: ReadonlySet<string> = new Set([
  'built-and-smoked-on-host',
  'not-proven',
  'blocked',
]);

function auditSupportMatrix(matrix: SupportMatrix, evidenceDir: string): readonly AuditViolation[] {
  const violations: AuditViolation[] = [];
  for (const tuple of matrix.tuples) {
    if (!CLAIM_TYPES.has(tuple.claimType)) {
      violations.push({
        rule: 'unqualified-claim-string',
        detail: `tuple '${tuple.id}' carries claimType '${tuple.claimType}' outside the allowed claim vocabulary`,
      });
    }
    if (tuple.status === 'BUILT_AND_SMOKED') {
      const evidence = tuple.evidence ?? [];
      if (evidence.length === 0) {
        violations.push({
          rule: 'claim-without-evidence',
          detail: `tuple '${tuple.id}' claims BUILT_AND_SMOKED without any evidence file`,
        });
        continue;
      }
      for (const evidencePath of evidence) {
        const full = path.join(evidenceDir, evidencePath);
        if (!fs.existsSync(full)) {
          violations.push({
            rule: 'claim-without-evidence',
            detail: `tuple '${tuple.id}' cites missing evidence '${evidencePath}'`,
          });
          continue;
        }
        const evidenceDoc = JSON.parse(fs.readFileSync(full, 'utf8')) as {
          overall?: string;
        };
        if (evidenceDoc.overall !== 'PASS') {
          violations.push({
            rule: 'claim-without-evidence',
            detail: `tuple '${tuple.id}' cites '${evidencePath}' whose overall status is not PASS`,
          });
        }
      }
    } else if ((tuple.reason ?? '').trim() === '') {
      violations.push({
        rule: 'unclassified-tuple',
        detail: `tuple '${tuple.id}' is ${tuple.status} without a recorded reason`,
      });
    }
  }
  return violations;
}

/** Run the full fail-closed package-content audit. Throws on any violation. */
export function auditDist(input: AuditInput): readonly AuditViolation[] {
  const violations: AuditViolation[] = [];
  if (!fs.existsSync(input.distDir)) {
    throw new Error(`audit: dist directory '${input.distDir}' does not exist`);
  }
  const topLevel = fs
    .readdirSync(input.distDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
  for (const name of topLevel) {
    if (!DIST_TOP_LEVEL_ALLOWLIST.includes(name)) {
      violations.push({
        rule: 'dist-top-level-allowlist',
        detail: `dist contains undeclared top-level entry '${name}'`,
      });
    }
  }
  const identities = readIdentities(input.distDir);
  for (const artifact of ARTIFACTS) {
    const artifactDir = path.join(input.distDir, artifact.outDir);
    if (!fs.existsSync(artifactDir)) {
      violations.push({ rule: 'missing-artifact', detail: artifact.outDir });
      continue;
    }
    violations.push(...auditArtifactFiles(artifact, artifactDir));
    if (artifact.id === 'extension') {
      violations.push(...auditExtensionManifestMatch(artifactDir));
    }
    const identity = identities.get(artifact.id);
    if (identity === undefined) {
      violations.push({
        rule: 'package-identity-unproven',
        detail: `artifact '${artifact.id}' has no identity sidecar`,
      });
    } else if (canonicalContentHash(contentManifest(artifactDir)) !== identity.contentHash) {
      violations.push({
        rule: 'package-identity-unproven',
        detail: `artifact '${artifact.id}' fails identity re-hash`,
      });
    }
  }
  const matrixPath = path.join(input.distDir, 'support-matrix.json');
  if (!fs.existsSync(matrixPath)) {
    violations.push({ rule: 'missing-support-matrix', detail: 'support-matrix.json' });
  } else {
    violations.push(...auditSupportMatrix(loadSupportMatrix(input.distDir), input.evidenceDir));
  }
  return violations;
}
