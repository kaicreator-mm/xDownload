/**
 * T09 browser-artifact node-builtin stubs (owned boundary: the packaging
 * write set ONLY — no surface source is modified).
 *
 * Why this exists: the packaged extension bundle (platform 'browser') pulls
 * in `@xdownload/core-seam` through the barrel export, and that barrel
 * re-exports node-only modules (`server.ts`, `transport-*.ts`, `win-ipc.ts`,
 * `s3..s6-seam12-payload.ts`) whose top-level `import ... from 'node:*'`
 * statements esbuild must RESOLVE even when tree-shaking would later drop
 * the unused bindings. Under `platform: 'browser'` those built-ins cannot
 * resolve, so the real package build failed on every host (T05/T08 legacy,
 * reproduced on a clean baseline during T08 and fixed here at the packaging
 * layer).
 *
 * What the stub does: for the browser artifact ONLY, each `node:*` specifier
 * resolves to a generated stub module whose every export throws on call —
 * fail-closed at runtime, exactly like the broker's own guarded lazy loaders.
 * The browser surface's REACHABLE paths are pure-JSON decoders
 * (`decodeSeamResponse`, `decodeS*Challenge/...`) and never invoke these
 * bindings; the digest/IP/FFI helpers they stub are encode/attest/transport
 * paths owned by Core and the CLI. If a future browser code path ever calls
 * one, it fails LOUDLY instead of silently misbehaving.
 *
 * Fail-closed rules:
 * - the plugin is applied only to artifacts that declare it (the extension);
 *   the node artifacts (cli/core/native-host) keep real built-ins;
 * - the export surface below is the CLOSED union of the `node:*` named
 *   imports in the browser-reachable workspace sources; an unknown name is
 *   an esbuild "no matching export" build error, never a silent hole;
 * - the packaging test asserts the emitted browser bundle contains ZERO
 *   `from "node:…"` specifiers (TEST_MATRIX: browser-bundle-no-node-specifiers).
 */

import type { Plugin } from 'esbuild';

/**
 * The closed union of named imports of each stubbed specifier across the
 * browser-reachable workspace sources (core-seam today). `default` covers
 * `import net from 'node:net'`-shaped default imports. Extending the browser
 * graph with a NEW node: binding requires adding the name HERE — the build
 * fails closed until the surface is consciously reviewed.
 */
const STUBBED_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  'node:crypto': ['createHash', 'randomBytes'],
  'node:net': ['isIP'],
  'node:module': ['createRequire'],
};

const STUBBED_DEFAULTS: ReadonlySet<string> = new Set(['node:net']);

function stubModuleSource(specifier: string): string {
  const named = STUBBED_EXPORTS[specifier] ?? [];
  const lines = [
    `// Generated browser stub for '${specifier}' (build/browser-node-stubs.ts).`,
    `const unavailable = (binding) => {`,
    `  throw new Error(`,
    `    "${specifier}:" + binding + " is not available in the packaged browser zone; " +`,
    `      "this node-only path must never execute in the extension artifact",`,
    `  );`,
    `};`,
    `const throwing = (binding) => (...args) => unavailable(binding);`,
  ];
  for (const name of named) {
    lines.push(`export const ${name} = throwing('${name}');`);
  }
  if (STUBBED_DEFAULTS.has(specifier)) {
    // `import net from 'node:net'`: a default object whose method access
    // yields a throwing function, and whose calls throw — same fail-closed
    // semantics for both `net.connect(...)` and `net["createServer"]`.
    lines.push(`const __default = new Proxy(`, `  {},`, `  {`);
    lines.push(
      `    get: (_target, binding) => {`,
      `      if (typeof binding === 'symbol') return undefined;`,
      `      return throwing(String(binding));`,
      `    },`,
      `    apply: () => unavailable('default'),`,
    );
    lines.push(`  }`, `);`);
    lines.push(`export default __default;`);
  }
  return `${lines.join('\n')}\n`;
}

/** The exact namespace the plugin routes stubbed builtins through. */
export const BROWSER_NODE_STUB_NAMESPACE = 'xd-browser-node-stub';

/**
 * The esbuild plugin: resolve every `node:*` import of the bundles it is
 * attached to into the stub namespace and serve the generated stub module.
 */
export function browserNodeStubsPlugin(): Plugin {
  return {
    name: 'xdownload-browser-node-stubs',
    setup(build) {
      build.onResolve({ filter: /^node:/ }, (args) => {
        // Unknown specifiers resolve too (an empty stub) so the build keeps
        // failing at the CALL site, not at resolution — but a specifier with
        // no declared export surface fails the build outright (fail closed
        // on an unplanned builtin in the browser graph).
        if (STUBBED_EXPORTS[args.path] === undefined && !STUBBED_DEFAULTS.has(args.path)) {
          return {
            errors: [
              {
                text: `node builtin '${args.path}' is not part of the declared browser-stub surface (build/browser-node-stubs.ts); review the browser-reachable import before packaging`,
              },
            ],
          };
        }
        return { path: args.path, namespace: BROWSER_NODE_STUB_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: BROWSER_NODE_STUB_NAMESPACE }, (args) => ({
        contents: stubModuleSource(args.path),
        loader: 'js',
      }));
    },
  };
}
