import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}

async function choose(page: Page, title: string, name: string) {
  await page.locator('#example-picker summary').click();
  await page.locator('#example-options').getByRole('button', { name: title }).click();
  await expect(page.locator('#filename')).toHaveText(name);
  await ready(page);
  await expect(page.locator('#compile-error')).toBeHidden();
}

test('examples switch source and preview, start at root and export under their own name', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  await choose(page, 'Database schema', 'schema.d2');
  await expect(page.locator('.zf-stage')).toContainText('Customers');
  await expect(page.getByRole('textbox', { name: 'D2 source' })).toContainText('shape: sql_table');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button')).toHaveText(['Root']);
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await pending).suggestedFilename()).toBe('schema-root.svg');
  await choose(page, 'Layers, scenarios & steps', 'boards.d2');
  await page.locator('.zf-stage a[href="root.scenarios.failure"]').click();
  await ready(page, 'root.scenarios.failure');
  await expect(page.locator('.zf-stage')).toContainText('API unavailable');
  await page.locator('.zf-stage a[href="root.steps.cache"]').click();
  await ready(page, 'root.steps.cache');
  await page.locator('.zf-stage a[href="root.steps.worker"]').click();
  await ready(page, 'root.steps.worker');
  await expect(page.locator('.zf-stage')).toContainText('Add cache');
  await expect(page.locator('.zf-stage')).toContainText('Add background jobs');
});

test('keeps edited examples and uploaded files, including a file with an example name', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const source = page.getByRole('textbox', { name: 'D2 source' });
  await source.fill('draft: My edited order');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
  await choose(page, 'Flowchart basics', 'flowchart.d2');
  await choose(page, 'Order flow', 'order.d2');
  await expect(source).toHaveText('draft: My edited order');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
  await page.locator('#file').setInputFiles({ name: 'order.d2', mimeType: 'text/plain', buffer: Buffer.from('local: Uploaded file') });
  await expect(page.locator('.zf-stage')).toContainText('Uploaded file');
  await source.fill('local: Edited upload');
  await choose(page, 'Service architecture', 'architecture.d2');
  await choose(page, 'order.d2 Your file', 'order.d2');
  await expect(page.locator('.zf-stage')).toContainText('Edited upload');
  await choose(page, 'Order flow', 'order.d2');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
});

test('picker supports keyboard, Escape without navigating, outside dismissal, and narrow dark screens', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  const summary = page.locator('#example-picker summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Diagram examples' })).toBeVisible();
  await page.keyboard.press('Tab');
  // Firefox also puts scrollable regions in the native Tab order.
  if (await page.locator('.example-menu').evaluate((element) => element === document.activeElement)) {
    await page.keyboard.press('Tab');
  }
  await expect(page.locator('#example-options button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(summary).toBeFocused();
  await expect(page.locator('.example-menu')).toBeHidden();
  await ready(page, 'root.layers.checkout');
  await summary.click();
  await page.locator('header strong').click();
  await expect(page.locator('.example-menu')).toBeHidden();
  await page.setViewportSize({ width: 601, height: 720 });
  await summary.click();
  await expect.poll(async () => {
    const box = (await page.locator('.example-menu').boundingBox())!;
    return box.x + box.width;
  }).toBeLessThanOrEqual(601);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 720 });
  await page.selectOption('#theme', 'dark');
  await summary.click();
  const menu = page.locator('.example-menu');
  await expect(menu).toBeVisible();
  // Native details toggle events position the menu asynchronously after opening.
  await expect.poll(async () => {
    const box = (await menu.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 375 && box.y + box.height <= 720;
  }).toBe(true);
  await page.locator('#example-options').getByRole('button', { name: 'Find & fix a broken link' }).click();
  await ready(page);
  await expect(page.locator('#lint-summary')).toHaveText('1 lint error(s), 1 warning(s)');
});

test('rapid example changes during compiler startup only publish the last selection', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/@d2lang_d2\.js/, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    for (const name of ['Flowchart basics', 'Database schema', 'Sequence diagram']) {
      await page.locator('#example-picker summary').click();
      await page.locator('#example-options').getByRole('button', { name }).click();
    }
  } finally { release(); }
  await ready(page);
  await expect(page.locator('#filename')).toHaveText('sequence.d2');
  await expect(page.locator('.zf-stage')).toContainText('Place order');
  await expect(page.locator('#compile-error')).toBeHidden();
});
