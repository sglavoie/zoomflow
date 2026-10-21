import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // D2 initializes a WASM compiler and runs layout in its own worker.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // `pnpm test:coverage` reports what the unit and CLI tests reach. No thresholds.
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/web/src/**'],
      // The per-file table goes to coverage/coverage.txt, which CI adds to the job summary.
      reporter: ['text-summary', ['text', { file: 'coverage.txt' }], 'html'],
    },
  },
});
