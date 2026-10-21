import { defineConfig, devices } from '@playwright/test';

const vite = 'node apps/web/node_modules/vite/bin/vite.js';
// The production smoke test needs `pnpm build` output first; CI builds before browser tests.
const production = Boolean(process.env.CI || process.env.ZOOMFLOW_PRODUCTION_E2E);
const productionSpec = /production\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${vite} apps/web --host 127.0.0.1 --port 4173 --strictPort`,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...production ? [{
      command: `${vite} preview apps/web --host 127.0.0.1 --port 4174 --strictPort`,
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }] : [],
  ],
  projects: [
    { name: 'chromium', testIgnore: productionSpec, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: productionSpec, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: productionSpec, use: { ...devices['Desktop Safari'] } },
    ...production ? [{ name: 'production', testMatch: productionSpec,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' } }] : [],
  ],
});
