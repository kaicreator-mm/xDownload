import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // T014 (bounded F2 tooling wiring): apps/* now hosts the desktop UI
    // adapter, so its component/interaction tests join the unit run. No
    // environment/transform changes; still the same Node vitest runner.
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
});
