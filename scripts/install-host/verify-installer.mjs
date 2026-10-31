#!/usr/bin/env node
/**
 * xDownload installer integrity readback (T09). Standalone, dependency-free
 * verifier shipped inside every installer: re-hashes exactly the files listed
 * in SHA256SUMS and checks the installer identity sidecar's contentHash.
 *
 * Usage: node verify-installer.mjs <installer-directory>
 * Exit codes: 0 verified; 2 any missing/extra/changed file or unreadable
 * identity (fail closed — never a partial pass).
 *
 * Contract notes:
 * - SHA256SUMS is the manifest of record: lines are `<sha256>` + two spaces + `<relative
 *   path>`, forward slashes, sorted by path, exactly as composed;
 * - installer-identity.json.contentHash covers exactly the SHA256SUMS file
 *   set (the sidecars themselves are outside the hash by construction);
 * - any extra file in the directory that the manifest does not list is a
 *   violation (an installer is a closed tree).
 */
/* global process */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function sha256File(full) {
  return createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}

function main() {
  const root = path.resolve(process.argv[2] ?? '.');
  const sumsPath = path.join(root, 'SHA256SUMS');
  const identityPath = path.join(root, 'installer-identity.json');
  const fail = (message) => {
    process.stderr.write(`verify-installer: FAIL ${message}\n`);
    process.exitCode = 2;
  };
  if (!fs.existsSync(sumsPath) || !fs.existsSync(identityPath)) {
    fail(`missing SHA256SUMS or installer-identity.json under ${root}`);
    return;
  }
  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  } catch {
    fail('installer-identity.json is not valid JSON');
    return;
  }
  const listed = new Map();
  for (const line of fs.readFileSync(sumsPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    if (match === null) {
      fail(`SHA256SUMS line is malformed: '${line.slice(0, 80)}'`);
      return;
    }
    listed.set(match[2], match[1]);
  }
  // Walk the tree; the file set must equal the manifest exactly. The two
  // manifest-apparatus sidecars are excluded from the unlisted-file check by
  // construction (SHA256SUMS cannot list itself; the identity sidecar covers
  // exactly the listed set).
  const APPARATUS = new Set(['SHA256SUMS', 'installer-identity.json']);
  const actual = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const relative = path.relative(root, full).split(path.sep).join('/');
        if (APPARATUS.has(relative)) continue;
        actual.set(relative, sha256File(full));
      }
    }
  };
  walk(root);
  for (const [relative, expected] of listed) {
    if (APPARATUS.has(relative)) {
      fail(`manifest apparatus file must not be listed in SHA256SUMS: ${relative}`);
      return;
    }
    const found = actual.get(relative);
    if (found === undefined) {
      fail(`listed file missing: ${relative}`);
      return;
    }
    if (found !== expected) {
      fail(`hash mismatch for ${relative}`);
      return;
    }
  }
  for (const relative of actual.keys()) {
    if (!listed.has(relative)) {
      fail(`unlisted file present: ${relative}`);
      return;
    }
  }
  // The identity sidecar must re-hash the same manifest file set.
  const canonical = JSON.stringify({
    files: [...listed.entries()]
      .map(([file, sha]) => ({
        path: file,
        sha256: sha,
        bytes: fs.statSync(path.join(root, file)).size,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
  const recomputed = createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (recomputed !== identity.contentHash) {
    fail(
      `installer identity contentHash mismatch (recorded ${identity.contentHash}, recomputed ${recomputed})`,
    );
    return;
  }
  process.stdout.write(
    `verify-installer: PASS ${String(listed.size)} files, content sha256-${recomputed} (v${String(identity.contentVersion)})\n`,
  );
}

main();
