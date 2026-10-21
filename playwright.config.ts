import { defineConfig, devices } from '@playwright/test';

// Vite is a devDependency of apps/web only, so the root has no `vite` bin. Run that
// package's copy directly instead of through a nested `pnpm --filter` process.
const vite = 'node apps/web/node_modules/vite/bin/vite.js';
// Give each concurrent Playwright invocation its own ZOOMFLOW_E2E_PORT (and port + 1).
const port = Number(process.env.ZOOMFLOW_E2E_PORT ?? 4173);
const previewPort = port + 1;
// The production smoke test needs `pnpm build` output first; CI builds before browser tests.
const production = Boolean(process.env.CI || process.env.ZOOMFLOW_PRODUCTION_E2E);
const productionSpec = /production\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  forbidOnly: !!process.env.CI,
  // A retry still runs in CI so a flaky test is reported, but it fails the run.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: 2,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${vite} apps/web --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...production ? [{
      command: `${vite} preview apps/web --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: `http://127.0.0.1:${previewPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }] : [],
  ],
  projects: [
    { name: 'chromium', testIgnore: productionSpec, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: productionSpec, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: productionSpec, use: { ...devices['Desktop Safari'] } },
    // WebKit also loads the bundle: the vendored D2 build carries a WebKit-specific patch.
    ...production ? [
      { name: 'production', testMatch: productionSpec,
        use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${previewPort}` } },
      { name: 'production-webkit', testMatch: productionSpec,
        use: { ...devices['Desktop Safari'], baseURL: `http://127.0.0.1:${previewPort}` } },
    ] : [],
  ],
});
