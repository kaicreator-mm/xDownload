/**
 * v0.2 T03 — download Domain App composition (sealed BUILD producer).
 *
 * Composes the closed-world K/S/B/C BUILD from:
 *   - the sealed K/S payload bytes under ./payloads/dist/ (verbatim v0.10.3
 *     upstream copies; SHA256SUMS + the #183 PoC BUILD manifest pin their
 *     identity — see payloads/SHA256SUMS);
 *   - the app-owned B policy module (business-download.mjs) and the minimal
 *     C stub capability module (capability-acquisition-stub.mjs; the real
 *     acquisition C/Host belongs to T04).
 *
 * via the public @kaicreator/domain-harness-build `buildV10App` (purely
 * static: zero module evaluation, zero I/O beyond reading the sealed bytes,
 * no clock/randomness). The Standard Primary bytes reproduce the #183 PoC
 * producer's vendoring exactly: SDK bytes + the pure WorkflowRouter spliced
 * into one module by the same template, so the sealed standard-primary
 * moduleSha256 equals the PoC manifest value byte-for-byte.
 *
 * The sealed route uses the frozen T01 operation vocabulary
 * (`acquisition.acquire` from DOWNLOAD_OPERATIONS) and is cross-checked
 * against the T01 route-table grammar before sealing.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildV10App,
  type V10BuiltApp,
  type V10ModuleInput,
  type V10RouteRowInput,
} from '@kaicreator/domain-harness-build';
import { V10_TARGET_PROFILE, type V10PublicIntent } from '@kaicreator/domain-harness-contracts';
import {
  DOWNLOAD_OPERATIONS,
  validateConfirmedIntent,
  validateRouteTable,
  type ConfirmedDownloadIntent,
  type OperationDeclaration,
} from '../contracts/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function readSealedText(relativePath: string): string {
  return readFileSync(HERE + relativePath, 'utf8');
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Sealed module identity recorded by the independent #183 PoC BUILD manifest
 * (experiments/domain-app-download/build/manifest.json, modules[].moduleSha256).
 * The kernel-primary seal IS the raw payload file hash; the standard-primary
 * seal is the composed SDK+router bundle hash (same producer template below).
 */
export const POC183_KERNEL_MODULE_SHA256 = 'e1ed59556f8b447b5f559302a893738eeae1d272e3a30ac4545fedfb1da8a3e7';
export const POC183_STANDARD_MODULE_SHA256 = '93aad26d2c3118548e2be3eefc0bcb9012e20bd6381077b58fbd1d2f59ce4606';

export const APP_ID = 'app:xdownload-download-domain-t03';
export const AUDIENCE = 'aud:xdownload-v02';
export const BUILD_ID = 'xdownload-v02-t03-v1';

/** The sealed K→C external Effect route (frozen T01 vocabulary). */
export const ACQUISITION_ROUTE: V10RouteRowInput = {
  intentId: 'confirmDownload',
  operationId: 'acquisition.acquire',
  capabilityId: 'acquisition',
  handlerId: 'acquire',
};

/** The T01 declaration the sealed route is validated against. */
const SEALED_OPERATION_DECLARATIONS: readonly OperationDeclaration[] = [
  {
    operationId: 'acquisition.acquire',
    capabilityId: 'acquisition',
    handlerId: 'acquire',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
];

function composeStandardPrimary(): { source: string; sha256: string } {
  const sdkSource = readSealedText('payloads/dist/standard-sdk-v1.mjs');
  const routerSource = readSealedText('payloads/dist/workflow-router.mjs');
  // Exact #183 PoC producer template: strip export keywords from the pure
  // WorkflowRouter and re-export routeWorkflowIntent from the vendored bundle.
  const routerBody = routerSource.replace(/^export /gm, '');
  const standardSource = `${sdkSource}
// xDownload #183 PoC BUILD: the pure Standard WorkflowRouter vendored into the
// selected Standard Primary bytes.
const __dhv10RouterBundle = (() => {
${routerBody}
return { routeWorkflowIntent };
})();
export const routeWorkflowIntent = __dhv10RouterBundle.routeWorkflowIntent;
`;
  return { source: standardSource, sha256: sha256Hex(standardSource) };
}

function sealModules(): readonly V10ModuleInput[] {
  const kernelSource = readSealedText('payloads/dist/kernel-mechanism-v1.mjs');
  const kernelSha256 = sha256Hex(kernelSource);
  if (kernelSha256 !== POC183_KERNEL_MODULE_SHA256) {
    throw new Error(
      `DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed kernel bytes ${kernelSha256} != #183 PoC manifest ${POC183_KERNEL_MODULE_SHA256}`,
    );
  }
  const standard = composeStandardPrimary();
  if (standard.sha256 !== POC183_STANDARD_MODULE_SHA256) {
    throw new Error(
      `DOWNLOAD_PAYLOAD_SEAL_MISMATCH: composed standard bundle ${standard.sha256} != #183 PoC manifest ${POC183_STANDARD_MODULE_SHA256}`,
    );
  }
  const businessSource = readSealedText('business-download.mjs');
  const capabilitySource = readSealedText('capability-acquisition-stub.mjs');

  return [
    {
      packageId: 'v08-kernel-mechanism@v0.10.0',
      role: 'kernel-primary',
      abiVersion: 'v08-kernel-abi/1',
      moduleSource: kernelSource,
      moduleSha256: kernelSha256,
      endpoint: 'occurrence-runtime',
      provides: ['kernel:occurrence-runtime/1'],
      dependencies: [],
      requires: [],
    },
    {
      packageId: 'standard-sdk@v08.1.0.0',
      role: 'standard-primary',
      abiVersion: 'v08-standard-sdk-abi/1',
      moduleSource: standard.source,
      moduleSha256: standard.sha256,
      endpoint: 'rule-interpreter',
      provides: ['standard:interpret/1', 'standard:route/1'],
      dependencies: [],
      requires: [],
    },
    {
      packageId: 'business-download@0.2.0-t03',
      role: 'business',
      abiVersion: 'v08-business-abi/1',
      moduleSource: businessSource,
      moduleSha256: sha256Hex(businessSource),
      endpoint: 'business-policy',
      provides: ['business:policy/1', 'intent:confirmDownload'],
      dependencies: [],
      requires: [],
    },
    {
      packageId: 'capability-acquisition-stub@0.2.0-t03',
      role: 'capability',
      abiVersion: 'v08-capability-abi/1',
      moduleSource: capabilitySource,
      moduleSha256: sha256Hex(capabilitySource),
      endpoint: 'capability-endpoint',
      provides: ['capability:acquisition/1'],
      capabilityId: 'acquisition',
      handlers: [{ operationId: ACQUISITION_ROUTE.operationId, handler: ACQUISITION_ROUTE.handlerId }],
      externalEffect: true,
      dependencies: [],
      requires: [],
    },
  ];
}

export interface BuiltDownloadDomainApp {
  readonly built: V10BuiltApp;
  readonly routes: readonly V10RouteRowInput[];
}

/**
 * Seal the download Domain App. Throws a typed DOWNLOAD_PAYLOAD_SEAL_MISMATCH
 * if the sealed payload bytes no longer match the #183 PoC manifest identity,
 * and a CONTRACT_BINDING_MISMATCH-refusing composition if the route ever
 * leaves the frozen T01 operation vocabulary.
 */
export function buildDownloadDomainApp(): BuiltDownloadDomainApp {
  const modules = sealModules();
  const routes: readonly V10RouteRowInput[] = [ACQUISITION_ROUTE];

  // T01 authority cross-check before anything is sealed: the route must name
  // an operation of the frozen DOWNLOAD_OPERATIONS vocabulary and match the
  // sealed capability/handler binding exactly.
  const routeCheck = validateRouteTable(routes, SEALED_OPERATION_DECLARATIONS);
  if (!routeCheck.ok) {
    throw new Error(
      `CONTRACT_BINDING_MISMATCH: ${routeCheck.diagnostics[0]?.code ?? 'unknown'} — sealed route refused`,
    );
  }

  const built = buildV10App({
    appId: APP_ID,
    audience: AUDIENCE,
    targetProfile: V10_TARGET_PROFILE,
    modules,
    routes,
    hardBudget: { maxStepsPerTurn: 16, maxWorkUnitsPerTurn: 64 },
    buildId: BUILD_ID,
  });

  // Post-seal self-check: every sealed module's bytes still hash to its own
  // sealed moduleSha256, and the K/S seals equal the #183 PoC manifest values.
  verifySealedModules(built);
  const sealedKernel = built.modules.find((module) => module.role === 'kernel-primary');
  const sealedStandard = built.modules.find((module) => module.role === 'standard-primary');
  if (sealedKernel?.moduleSha256 !== POC183_KERNEL_MODULE_SHA256) {
    throw new Error('DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed kernel-primary lost the #183 PoC manifest hash');
  }
  if (sealedStandard?.moduleSha256 !== POC183_STANDARD_MODULE_SHA256) {
    throw new Error('DOWNLOAD_PAYLOAD_SEAL_MISMATCH: sealed standard-primary lost the #183 PoC manifest hash');
  }

  return { built, routes };
}

/**
 * Host-side pre-load integrity check: every sealed module's bytes must still
 * hash to its recorded moduleSha256 BEFORE `load` runs (the public load
 * consumes an already-trusted prebuilt App and does not re-verify bytes).
 */
export function verifySealedModules(built: Pick<V10BuiltApp, 'modules'>): void {
  for (const module of built.modules) {
    if (sha256Hex(module.moduleSource) !== module.moduleSha256) {
      throw new Error(`SEALED_BUILD_MODULE_ALTERED: ${module.packageId} bytes no longer match the sealed moduleSha256`);
    }
  }
}

export interface ConfirmDownloadRequestOptions {
  /** Explicit occurrence message id; defaults to `msg-<requestId>`. */
  readonly messageId?: string;
}

/**
 * Seal a caller-supplied record into a public download intent through the
 * canonical T01 no-widening validation: unknown fields, raw locators and
 * out-of-bound sizes are refused here, before any K admission exists.
 */
export function confirmDownloadRequest(
  candidate: unknown,
  options?: ConfirmDownloadRequestOptions,
): { intent: V10PublicIntent; confirmed: ConfirmedDownloadIntent } {
  const check = validateConfirmedIntent(candidate);
  if (!check.ok) {
    throw new Error(
      `CONFIRMED_INTENT_INVALID: ${check.diagnostics[0]?.code ?? 'unknown'} — intent refused before send`,
    );
  }
  const confirmed = check.value;
  return {
    confirmed,
    intent: {
      intentType: 'confirmDownload',
      instanceKey: `download-${confirmed.requestId}`,
      messageId: options?.messageId ?? `msg-${confirmed.requestId}`,
      input: confirmed as unknown as Record<string, unknown>,
    },
  };
}

/** The frozen T01 operation vocabulary, re-exported for composition consumers. */
export const SEALED_OPERATION_VOCABULARY = DOWNLOAD_OPERATIONS;
