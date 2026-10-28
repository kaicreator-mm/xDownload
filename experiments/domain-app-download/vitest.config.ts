import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Research PoC config: runs ONLY this experiment's tests. The repo-root
// workspace packages stay untouched; @xdownload/direct-acquisition is aliased
// to its existing TS source (consumed as-is, no rebuild), matching the pack
// rule that the experiment consumes the *actual* implementation.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "@xdownload/direct-acquisition": fileURLToPath(
        new URL("../../packages/direct-acquisition/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["experiments/domain-app-download/tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
