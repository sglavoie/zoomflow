import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // D2 initializes a WASM compiler and runs layout in its own worker.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
