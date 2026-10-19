import { expect, test, type Page } from '@playwright/test';
const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function choose(page: Page, path: string) {
  await page.locator('#example-picker summary').click();
  await page.locator(`.example-option[title="browser-project/${path}"]`).click();
}

test('mobile project switches retain Source and each file selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await ready(page);
  await page.locator('#mobile-source').click();
  await source(page).press('ControlOrMeta+End');
  await choose(page, 'lib/nodes.d2');
  await expect(source(page)).toBeVisible();
  await source(page).fill('Imported: Updated'); await ready(page);
  await choose(page, 'main.d2');
  await expect(source(page)).toBeVisible();
  await expect(page.locator('#mobile-source')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.zf-stage')).toContainText('Updated');
});

test('keyboard selects ordinary and linked shapes and recompiles retain the focused shape', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const browse = page.getByRole('button', { name: 'Select source for Browse', exact: true });
  await browse.focus(); await page.keyboard.press('Enter');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Browse');
  await browse.focus(); await page.keyboard.press('Space');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Browse');
  const checkout = page.getByRole('link', { name: 'Open checkout board', exact: true });
  await checkout.focus(); await page.keyboard.press('Alt+Enter');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Checkout');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  const text = await source(page).innerText();
  await source(page).fill(`${text}\nnew: Added`);
  await checkout.focus();
  await expect(page.locator('.zf-stage [data-shape-id="new"]')).toBeVisible();
  await expect(checkout).toBeFocused();
  await source(page).fill(`${text}\nnew: Changed`);
  await browse.focus();
  await expect(page.locator('.zf-stage')).toContainText('Changed');
  await expect(browse).toBeFocused();
});

test('diagnostics open every imported location without marking unrelated local text', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await ready(page);
  await choose(page, 'lib/nodes.d2');
  await source(page).fill('Imported: {shape: invalid}\nOther: {shape: invalid}');
  await choose(page, 'main.d2');
  await expect(page.locator('#compile-error')).toBeVisible();
  await source(page).press('ControlOrMeta+Shift+m');
  await expect(page.locator('#diagnostics-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#diagnostics-panel')).toBeHidden();
  await expect(source(page)).toBeFocused();
  await page.locator('#show-diagnostics').click();
  const rows = page.locator('#diagnostics-panel li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('lib/nodes.d2:2:');
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await rows.nth(1).getByRole('button').click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('invalid');
  await source(page).fill('a\nlayers: {unused: {b}}'); await ready(page);
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('#diagnostics-panel')).toContainText('lib/nodes.d2:2:10');
  await page.locator('#diagnostics-panel li button').click();
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('unused');
});

test('wheel units produce equivalent zoom and pinch-wheel remains anchored', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const svg = page.locator('.zf-stage > svg');
  const wheel = (deltaY: number, deltaMode: number) => svg.dispatchEvent('wheel', { deltaY, deltaMode, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  await wheel(-48, 0);
  const pixels = await svg.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await wheel(-3, 1);
  expect(await svg.getAttribute('viewBox')).toBe(pixels);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const height = await page.locator('.zf-stage').evaluate((el) => el.clientHeight);
  await wheel(-48 / height, 2);
  expect(await svg.getAttribute('viewBox')).toBe(pixels);
  await expect(svg).toHaveCSS('touch-action', 'none');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await svg.dispatchEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('122%');
});

test('expanded tools remain scrollable with a short viewport and larger text', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings > summary').click();
  await page.locator('#lint-details > summary').click();
  for (const size of [{ width: 390, height: 844 }, { width: 390, height: 450 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(size.height);
    const editor = (await page.locator('#editor').boundingBox())!;
    expect(editor.height).toBeGreaterThan(70);
    expect(editor.y + editor.height).toBeLessThanOrEqual(size.height + 1);
    expect(await page.locator('.source-tools').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.locator('#ai-prompt').fill('Keep this prompt');
    await source(page).fill('a: Still editable'); await ready(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'button, summary, select, .pane-title, .status-copy, #draft-status, #ai-form input, #ai-form textarea { font-size: 18px !important; }' });
  await source(page).fill('a: Larger text'); await ready(page);
  expect((await page.locator('#editor').boundingBox())!.height).toBeGreaterThan(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
  await ready(page);
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
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Edited during startup');
});

test('pinching from Fit zooms the diagram using real touch input', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies real multi-touch events in Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
  const stage = page.locator('.zf-stage');
  const bounds = (await stage.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }] });
  for (const distance of [40, 50, 60, 70]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - distance, y }, { id: 2, x: x + distance, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.zf-zoom-controls span')).not.toHaveText('Fit');
  const zoom = Number((await page.locator('.zf-zoom-controls span').innerText()).replace('%', ''));
  expect(zoom).toBeGreaterThan(150);
  await expect(stage).toHaveAttribute('data-board', 'root');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
});

test('visual viewport keyboard resize keeps the editor above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await source(page).focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 430 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const bounds = (await page.locator('#editor').boundingBox())!;
  expect(bounds.height).toBeGreaterThan(80);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(431);
  await source(page).fill('a: Keyboard edit'); await ready(page);
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  expect((await page.locator('#editor').boundingBox())!.height).toBeGreaterThan(bounds.height);
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
    await ready(page);
    await expect(page.locator('.zf-stage')).toContainText('Checkout');
  });
}

test('unlocated compiler failures stay in the list without a fabricated line-one marker', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const request = message as { type?: string; id?: number };
        if (request.type === 'compile') {
          this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, type: 'error', error: 'Layout could not finish' } }));
        } else if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('#compile-error')).toContainText('Source location unavailable');
  await expect(page.locator('#compile-error')).not.toContainText('Line 1');
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await expect(page.locator('#go-to-error')).toBeDisabled();
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('#diagnostics-panel li')).toContainText('Source location unavailable');
  await expect(page.locator('#diagnostics-panel li button')).toHaveCount(0);
});
