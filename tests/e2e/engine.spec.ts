import { expect, test } from '@playwright/test';
import { source, previewReady } from './helpers';

/** Diagram engine startup, slow previews and restarts. */

test('a stalled preview can restart without losing the good diagram or latest edits', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).workersCreated = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); (window as any).workersCreated++; }
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const request = message as { type?: string };
        if (request.type === 'compile' && (window as any).holdCompile) {
          (window as any).compileHeld = true;
          (window as any).holdCompile = false;
          return; // Leave a real worker request pending until disposal rejects it.
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.clock.install();
  await page.evaluate(() => { (window as any).holdCompile = true; });
  await source(page).fill('a: Stalled revision');
  await expect.poll(() => page.evaluate(() => (window as any).compileHeld)).toBe(true);
  await page.clock.fastForward(600); // Keep these edits in separate undo groups.
  await source(page).press('ControlOrMeta+a');
  await source(page).pressSequentially('b: Latest edit');
  await page.clock.fastForward(16_000);
  await expect(page.getByRole('button', { name: 'Restart preview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).workersCreated)).toBe(1);
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await expect(source(page)).toHaveText('b: Latest edit');
  await page.locator('#retry-engine').click();
  await expect(page.locator('.zf-stage')).toContainText('Latest edit'); await previewReady(page);
  await expect(page.locator('#engine-notice')).toBeHidden();
  expect(await page.evaluate(() => (window as any).workersCreated)).toBe(2);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: Stalled revision');
});

test('startup failure offers retry without source diagnostics or lost edits', async ({ page }) => {
  let fail = true;
  await page.route( /SourceSansPro-Regular\.ttf$/, (route) => fail ? route.abort() : route.continue());
  await page.goto('/');
  await expect(page.locator('#retry-engine')).toBeVisible();
  await expect(page.locator('#engine-message')).toContainText('could not start');
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await source(page).fill('kept: My edits survived');
  await expect(page.locator('#retry-engine')).toBeVisible();
  fail = false;
  await page.locator('#retry-engine').click();
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('My edits survived');
  await expect(page.locator('#engine-notice')).toBeHidden();
});

test('slow initial download explains the wait while source remains editable', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/@d2lang_d2\.js/, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#engine-message')).toContainText('first download');
    await source(page).fill('a: Edited during startup');
  } finally { release(); }
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('Edited during startup');
});

for (const failure of ['module', 'worker'] as const) {
  test(`retries a failed ${failure} initialization`, async ({ page }) => {
    if (failure === 'module') {
      await page.route(/@d2lang_d2\.js/, (route) => route.abort(), { times: 1 });
    } else {
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        let fail = true;
        window.Worker = class extends NativeWorker {
          postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
            if (fail && (message as { type?: string }).type === 'init') {
              fail = false;
              this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', error: 'Simulated initialization failure' } }));
            } else if (Array.isArray(options)) super.postMessage(message, options);
            else super.postMessage(message, options);
          }
        };
      });
    }
    await page.goto('/');
    await expect(page.locator('#retry-engine')).toBeVisible();
    await expect(page.locator('#compile-error')).toBeHidden();
    await page.locator('#retry-engine').click();
    await previewReady(page);
    await expect(page.locator('.zf-stage')).toContainText('Checkout');
  });
}
