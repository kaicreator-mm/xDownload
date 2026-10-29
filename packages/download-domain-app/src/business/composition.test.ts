/**
 * v0.2 T03 — composition seal tests (node:test, real bytes, no mocks).
 *
 * Proves the sealed K/S payload byte identity against the #183 PoC BUILD
 * manifest, the frozen T01 route vocabulary of the sealed composition, and
 * the T01 no-widening gate on confirmDownloadRequest.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ACQUISITION_ROUTE,
  APP_ID,
  POC183_KERNEL_MODULE_SHA256,
  POC183_STANDARD_MODULE_SHA256,
  buildDownloadDomainApp,
  confirmDownloadRequest,
  verifySealedModules,
} from './composition.ts';
import { DOWNLOAD_OPERATIONS } from '../contracts/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('sealed K/S payload bytes', () => {
  it('on-disk payload files still hash to the committed SHA256SUMS lines', () => {
    const sums = readFileSync(path.join(HERE, 'payloads', 'SHA256SUMS'), 'utf8')
      .split(/\r?\n/)
      .map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null);
    assert.ok(sums.length >= 3, 'SHA256SUMS must record the three sealed payload files');
    for (const entry of sums) {
      const recorded = entry[1];
      const relativePath = entry[2];
      if (recorded === undefined || relativePath === undefined) {
        throw new Error('malformed SHA256SUMS entry');
      }
      const actual = createHash('sha256')
        .update(readFileSync(path.join(HERE, 'payloads', relativePath), 'utf8'), 'utf8')
        .digest('hex');
      assert.equal(actual, recorded, `sealed payload ${relativePath} drifted from SHA256SUMS`);
    }
  });

  it('seals kernel-primary and standard-primary to the exact #183 PoC manifest module hashes', () => {
    const { built } = buildDownloadDomainApp();
    const sealedKernel = built.modules.find((module) => module.role === 'kernel-primary');
    const sealedStandard = built.modules.find((module) => module.role === 'standard-primary');
    assert.ok(sealedKernel, 'composition must seal a kernel-primary module');
    assert.ok(sealedStandard, 'composition must seal a standard-primary module');
    assert.equal(sealedKernel.moduleSha256, POC183_KERNEL_MODULE_SHA256);
    assert.equal(sealedStandard.moduleSha256, POC183_STANDARD_MODULE_SHA256);
    // The kernel seal IS the raw payload file hash.
    assert.equal(
      createHash('sha256')
        .update(
          readFileSync(path.join(HERE, 'payloads', 'dist', 'kernel-mechanism-v1.mjs'), 'utf8'),
          'utf8',
        )
        .digest('hex'),
      POC183_KERNEL_MODULE_SHA256,
    );
  });

  it('seals a closed four-module app with no model provider surface', () => {
    const { built } = buildDownloadDomainApp();
    assert.equal(built.appId, APP_ID);
    assert.deepEqual(
      built.modules.map((module) => module.role).sort(),
      ['business', 'capability', 'kernel-primary', 'standard-primary'],
    );
    for (const module of built.modules) {
      assert.ok(
        !(module.provides ?? []).some((provided) => provided.startsWith('provider:')),
        `module ${module.packageId} must not provide a model provider`,
      );
    }
    assert.equal(built.loadOrder.length, 4);
  });

  it('host-side pre-load verification refuses altered sealed module bytes', () => {
    const { built } = buildDownloadDomainApp();
    verifySealedModules(built); // control: clean build verifies
    const tampered = structuredClone(built);
    const business = tampered.modules.find((module) => module.role === 'business');
    assert.ok(business, 'business module must exist');
    const altered = {
      ...tampered,
      modules: tampered.modules.map((module) =>
        module.role === 'business' ? { ...module, moduleSource: `${module.moduleSource}\n// tampered` } : module,
      ),
    };
    assert.throws(() => verifySealedModules(altered), /SEALED_BUILD_MODULE_ALTERED/);
    void business;
  });
});

describe('sealed route uses the frozen T01 vocabulary', () => {
  it('the acquisition route names operation acquisition.acquire from DOWNLOAD_OPERATIONS', () => {
    const { routes, built } = buildDownloadDomainApp();
    assert.deepEqual(routes, [ACQUISITION_ROUTE]);
    assert.deepEqual(built.routes, [
      {
        intentId: 'confirmDownload',
        operationId: 'acquisition.acquire',
        capabilityId: 'acquisition',
        handlerId: 'acquire',
      },
    ]);
    assert.ok(DOWNLOAD_OPERATIONS.includes(ACQUISITION_ROUTE.operationId as (typeof DOWNLOAD_OPERATIONS)[number]));
    const capability = built.modules.find((module) => module.role === 'capability');
    assert.ok(capability, 'capability module must exist');
    assert.equal(capability.capabilityId, 'acquisition');
    assert.equal(capability.externalEffect, true);
    assert.deepEqual(capability.handlers, [{ operationId: 'acquisition.acquire', handler: 'acquire' }]);
  });

  it('the sealed B policy binds effect:acquire to the K→C external route with await terminal', async () => {
    const policyModule = (await import(
      pathToFileURL(path.join(HERE, 'business-download.mjs')).href
    )) as {
      getPolicy: () => {
        workflowDefinition: { workflowKey: string; guards: unknown[] };
        intentBindings: Record<string, unknown>;
        effectBindings: Record<
          string,
          {
            resource: { key: string; operation: string };
            external: { await: string; permitTtlMs: number };
          }
        >;
      };
    };
    const policy = policyModule.getPolicy();
    assert.equal(policy.workflowDefinition.workflowKey, 'download-acquisition');
    assert.ok(policy.intentBindings.confirmDownload, 'intent confirmDownload must be bound');
    const binding = policy.effectBindings['effect:acquire'];
    assert.ok(binding, 'effect:acquire must be bound');
    assert.deepEqual(binding.resource, { key: 'acquisition', operation: 'acquisition.acquire' });
    assert.ok(DOWNLOAD_OPERATIONS.includes(binding.resource.operation as (typeof DOWNLOAD_OPERATIONS)[number]));
    assert.equal(binding.external.await, 'terminal');
    assert.ok(binding.external.permitTtlMs >= 1 && binding.external.permitTtlMs <= 3_600_000);
  });
});

describe('confirmDownloadRequest applies the T01 no-widening gate before send', () => {
  const validIntent = {
    requestId: 't03-seal',
    lineageId: 't03-lineage',
    targetRef: 'ref:fixture/t03-seal.bin',
    outputRootScope: '/tmp/xd-t03-out',
    allowedOperation: 'acquisition.acquire',
    slice: 'S1',
    digestAnchor: 'a'.repeat(64),
    declaredBytes: 4096,
    caller: { actor: 'zcode:xd-v02-t03-builder-agent', sessionRef: 'session:t03-test' },
  };

  it('seals a valid confirmed intent into a public confirmDownload request', () => {
    const { confirmed, intent } = confirmDownloadRequest(validIntent);
    assert.equal(confirmed.requestId, 't03-seal');
    assert.equal(intent.intentType, 'confirmDownload');
    assert.equal(intent.instanceKey, 'download-t03-seal');
    assert.equal(intent.messageId, 'msg-t03-seal');
    assert.equal(intent.input, confirmed as unknown as Record<string, unknown>);
  });

  it('refuses scope widening (unknown field) before any send', () => {
    assert.throws(
      () => confirmDownloadRequest({ ...validIntent, extraField: 'not allowed' }),
      /SCOPE_WIDENING_REFUSED/,
    );
  });

  it('refuses a raw-locator targetRef (locator substitution)', () => {
    assert.throws(
      () => confirmDownloadRequest({ ...validIntent, targetRef: 'https://evil.example/file.bin' }),
      /LOCATOR_SUBSTITUTION_REJECTED/,
    );
  });

  it('refuses a declaredBytes above the T01 contract bound', () => {
    assert.throws(
      () => confirmDownloadRequest({ ...validIntent, declaredBytes: 1_099_511_627_777 }),
      /MALFORMED_REQUIRED_FIELD/,
    );
  });
});
