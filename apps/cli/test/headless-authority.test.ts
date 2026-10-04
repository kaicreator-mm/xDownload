/**
 * TEST_MATRIX suite `headless-operation` + `no-private-lifecycle-authority`:
 * every CLI function operates without Desktop UI, the CLI never owns or
 * requires Core start/stop as an authority prerequisite, holds no private
 * lifecycle state, and no code path bypasses the seam ports.
 */

import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoopbackClientTransport, type ExpectedPeerScope } from '@xdownload/core-seam';
import {
  harnessClient,
  projectTerminal,
  runCli,
  setupContract,
  singleResourceContract,
  startSeam,
  terminalPayload,
  type RunningSeam,
} from './helpers.ts';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const ALLOWED_IMPORT_PREFIXES = ['node:', '@xdownload/core-seam', '@xdownload/domain-contracts'];

async function srcFiles(): Promise<string[]> {
  const names = await readdir(SRC_DIR);
  return names.filter((name) => name.endsWith('.ts')).map((name) => path.join(SRC_DIR, name));
}

describe('headless operation', () => {
  it('the full submit/observe/cancel flow runs with no Desktop UI and no Core lifecycle authority', async () => {
    const seam: RunningSeam = await startSeam();
    // No Desktop, no browser, no daemon manager exists in this process: the
    // CLI operates purely against the seam endpoint it was given.
    const files = new Map([['contract.json', JSON.stringify(singleResourceContract())]]);
    const submit = await runCli(['submit', '--file', 'contract.json'], seam.target, { files });
    expect(submit.exitCode).toBe(0);
    const status = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect((status.json as Record<string, unknown>)['lineage_status']).toBe('ACTIVE');
    const cancel = await runCli(
      ['cancel', '--contract', 'contract-single-001', '--expected-revision', '1'],
      seam.target,
    );
    expect(cancel.exitCode).toBe(0);
    const final = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect((final.json as Record<string, unknown>)['lineage_status']).toBe('CANCELLED');
  });

  it('CLI source imports only Node built-ins and the seam/contract packages', async () => {
    const files = await srcFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const specifier of imports) {
        const allowed =
          specifier.startsWith('.') ||
          ALLOWED_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix));
        expect(allowed, `forbidden import '${specifier}' in ${path.basename(file)}`).toBe(true);
      }
    }
  });

  it('the CLI never starts, stops or composes the Core as an authority prerequisite', async () => {
    const files = await srcFiles();
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text.includes('createCoreSeamServer'), path.basename(file)).toBe(false);
      expect(text.includes('createLoopbackServerTransport'), path.basename(file)).toBe(false);
      expect(text.includes('recordFailedMembers'), path.basename(file)).toBe(false);
    }
  });

  it('no code path bypasses seam authorization: a CLI surface is rejected where it is not admitted', async () => {
    // The seam admits only DESKTOP_UI here; the CLI presents 'CLI', so the
    // per-frame peer authorization rejects it and the CLI projects the typed
    // rejection instead of masking it. This proves both the SurfaceKind
    // presentation and that no side channel exists.
    const desktopOnly: ExpectedPeerScope = {
      installId: 'install-cli-001',
      userId: 'user-cli-001',
      allowedSurfaces: ['DESKTOP_UI'],
    };
    const seam: RunningSeam = await startSeam(desktopOnly);
    const run = await runCli(['status', '--contract', 'contract-single-001'], seam.target);
    expect(run.exitCode).toBe(2);
    const json = run.json as { diagnostics: { code: string; message: string }[] };
    expect(json['diagnostics'][0]?.['code']).toBe('PEER_UNAUTHORIZED');
    expect(json['diagnostics'][0]?.['message']).toContain("'CLI'");
  });
});

describe('no private lifecycle authority', () => {
  it('the CLI holds no state that can resurrect or rewrite terminal truth', async () => {
    const seam: RunningSeam = await startSeam();
    await setupContract(harnessClient(seam.target), singleResourceContract());
    await projectTerminal(
      harnessClient(seam.target),
      'contract-single-001',
      1,
      terminalPayload({
        contractId: 'contract-single-001',
        requestFulfillment: 'UNSATISFIED',
        targetResolution: 'RESOLVED',
        selectionAcquisition: 'FAILED',
        coverage: 'NOT_APPLICABLE',
        stopReason: 'VALIDATION_FAILED',
        passedCount: 0,
        failedCount: 1,
        summaryStatus: 'FAILED',
        outcomes: [{ memberId: 'target-file-001', requiredValidationPassed: false }],
      }),
    );
    // Two independent CLI instances (fresh transports/clients) both read the
    // same Core-owned terminal truth; neither can rewrite it.
    const first = await runCli(['status', '--contract', 'contract-single-001'], seam.target, {
      transport: createLoopbackClientTransport(),
    });
    const second = await runCli(['status', '--contract', 'contract-single-001'], seam.target, {
      transport: createLoopbackClientTransport(),
    });
    expect(first.document).toBe(second.document);
    expect((first.json as Record<string, unknown>)['SelectionAcquisitionStatus']).toBe('FAILED');
    // Attempts to mutate after terminal truth reject at the seam (late cancel).
    const late = await runCli(
      ['cancel', '--contract', 'contract-single-001', '--expected-revision', '2'],
      seam.target,
    );
    expect(late.exitCode).toBe(2);
    const lateJson = late.json as { diagnostics: { code: string }[] };
    expect(lateJson['diagnostics'][0]?.['code']).toBe('LATE_COMMAND');
  });
});
