import { defineConfig, devices } from '@playwright/test';
import { devPort, devURL, previewPort, previewURL } from './tests/e2e/servers';

// Vite is a devDependency of apps/web only, so the root has no `vite` bin. Run that
// package's copy directly instead of through a nested `pnpm --filter` process.
const vite = 'node apps/web/node_modules/vite/bin/vite.js';
// Production mode needs `pnpm build` output first; CI builds before browser tests. The
// behavioral projects then load the bundle, which starts about a third faster than the
// dev server's modules. Tests that import source modules pin `devURL` themselves.
const production = Boolean(process.env.CI || process.env.ZOOMFLOW_PRODUCTION_E2E);
const appURL = production ? previewURL : devURL;
const productionSpec = /production\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  forbidOnly: !!process.env.CI,
  // CI retries a failed test once. A test that passes on retry does not fail the run;
  // tests/e2e/flaky-reporter.ts reports it as a warning instead.
  retries: process.env.CI ? 1 : 0,
  // Tests share no state, so they spread across workers and shards one by one rather
  // than file by file; otherwise the largest spec file sets the length of a CI shard.
  fullyParallel: true,
  workers: 2,
  use: { baseURL: appURL, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${vite} apps/web --host 127.0.0.1 --port ${devPort} --strictPort`,
      url: devURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...production ? [{
      command: `${vite} preview apps/web --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: previewURL,
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
        use: { ...devices['Desktop Chrome'], baseURL: previewURL } },
      { name: 'production-webkit', testMatch: productionSpec,
        use: { ...devices['Desktop Safari'], baseURL: previewURL } },
    ] : [],
  ],
});
