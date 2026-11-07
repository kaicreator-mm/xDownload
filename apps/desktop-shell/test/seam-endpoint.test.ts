/**
 * T07 desktop-shell seam-endpoint resolution tests — fail-closed resolution
 * of the ONE seam endpoint (explicit loopback dev/smoke override or the
 * existing per-user install binding), with the peer identity always coming
 * from the same verified source.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installBindingPaths,
  resolveSeamAccess,
  SEAM_LOOPBACK_OVERRIDE_ENV,
  SHELL_INSTALL_ID_ENV,
  SHELL_USER_ID_ENV,
} from '../src/main/seam-endpoint.ts';
import { canonicalPipeName } from '../src/main/validators.ts';

describe('resolveSeamAccess', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'xd-shell-endpoint-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function writeConfig(core: unknown): void {
    const paths = installBindingPaths(home);
    mkdirSync(paths.installDir, { recursive: true });
    writeFileSync(
      paths.configPath,
      `${JSON.stringify({ hostName: 'x', allowedOrigins: [], core })}\n`,
      'utf8',
    );
  }

  it('resolves the explicit loopback override with its paired dev identity', () => {
    const access = resolveSeamAccess({
      home,
      env: {
        [SEAM_LOOPBACK_OVERRIDE_ENV]: '127.0.0.1:41234',
        [SHELL_INSTALL_ID_ENV]: 'shellsmoke',
        [SHELL_USER_ID_ENV]: 'shelluser',
      },
    });
    expect(access.endpoint).toEqual({
      kind: 'loopback',
      host: '127.0.0.1',
      port: 41234,
      source: 'explicit-override',
    });
    expect(access.peer).toEqual({ installId: 'shellsmoke', userId: 'shelluser' });
  });

  it('refuses the override without a valid paired identity (no fallback)', () => {
    const missing = resolveSeamAccess({
      home,
      env: { [SEAM_LOOPBACK_OVERRIDE_ENV]: '127.0.0.1:41234' },
    });
    expect(missing.endpoint.kind).toBe('refused');
    expect(missing.peer).toBeUndefined();

    const invalid = resolveSeamAccess({
      home,
      env: {
        [SEAM_LOOPBACK_OVERRIDE_ENV]: '127.0.0.1:41234',
        [SHELL_INSTALL_ID_ENV]: 'bad id',
        [SHELL_USER_ID_ENV]: 'shelluser',
      },
    });
    expect(invalid.endpoint.kind).toBe('refused');
    expect(invalid.peer).toBeUndefined();
  });

  it('refuses a non-loopback override instead of falling back to config', () => {
    writeConfig({
      installId: 'xdownload',
      userId: 'user_1',
      pipeName: canonicalPipeName('xdownload'),
    });
    const access = resolveSeamAccess({
      home,
      env: {
        [SEAM_LOOPBACK_OVERRIDE_ENV]: 'example.com:80',
        [SHELL_INSTALL_ID_ENV]: 'shellsmoke',
        [SHELL_USER_ID_ENV]: 'shelluser',
      },
    });
    expect(access.endpoint.kind).toBe('refused');
  });

  it('resolves the install binding to the canonical pipe with the same identity', () => {
    writeConfig({
      installId: 'xdownload',
      userId: 'user_1',
      pipeName: canonicalPipeName('xdownload'),
    });
    const access = resolveSeamAccess({ home, env: {} });
    expect(access.endpoint).toEqual({
      kind: 'pipe',
      pipeName: canonicalPipeName('xdownload'),
      source: 'install-config',
    });
    expect(access.peer).toEqual({ installId: 'xdownload', userId: 'user_1' });
  });

  it('refuses an install binding whose pipe is not the canonical namespace', () => {
    writeConfig({ installId: 'xdownload', userId: 'user_1', pipeName: '\\\\.\\pipe\\other' });
    const access = resolveSeamAccess({ home, env: {} });
    expect(access.endpoint.kind).toBe('refused');
    expect(access.peer).toBeUndefined();
  });

  it('refuses a malformed install config instead of guessing', () => {
    const paths = installBindingPaths(home);
    mkdirSync(paths.installDir, { recursive: true });
    writeFileSync(paths.configPath, '{not json', 'utf8');
    const access = resolveSeamAccess({ home, env: {} });
    expect(access.endpoint.kind).toBe('refused');
  });

  it('refuses a config without a valid core block', () => {
    writeConfig({ installId: 'xdownload' });
    const access = resolveSeamAccess({ home, env: {} });
    expect(access.endpoint.kind).toBe('refused');
  });

  it('reports unconfigured (truthful degraded state) when no binding exists', () => {
    const access = resolveSeamAccess({ home, env: {} });
    expect(access.endpoint.kind).toBe('unconfigured');
    expect(access.peer).toBeUndefined();
  });
});
