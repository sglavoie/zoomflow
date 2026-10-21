import { expect, test, type Page } from '@playwright/test';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus } from './helpers';

async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}

async function choose(page: Page, title: string | RegExp, name: string) {
  await page.locator('#example-picker summary').click();
  await page.locator('.example-menu').getByRole('button', { name: title }).and(page.locator('.example-option')).click();
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
  await downloadExport(page);
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
  await choose(page, /order\.d2.*Your file/, 'order.d2');
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
  await expect(page.getByRole('region', { name: 'Diagrams and projects' })).toBeVisible();
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
  await page.locator('header > strong').click();
  await expect(page.locator('.example-menu')).toBeHidden();
  await page.setViewportSize({ width: 601, height: 720 });
  await summary.click();
  await expect.poll(async () => {
    const box = (await page.locator('.example-menu').boundingBox())!;
    return box.x + box.width;
  }).toBeLessThanOrEqual(601);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 720 });
  await expect(page.locator('#header-more-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#theme')).toBeVisible();
  await selectMenuOption(page, '#theme', 'dark');
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
  await expect(page.locator('#lint-summary')).toHaveText('1 lint error, 1 warning');
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

test('picker groups drafts, marks modified examples and restores the original', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  const original = await source(page).textContent();
  await source(page).fill('changed: My draft');
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  const order = page.locator('#example-options').getByRole('button', { name: /Order flow.*Modified/ });
  await expect(order).toContainText('Edited');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(source(page)).toHaveText('changed: My draft');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await previewReady(page);
  await expect(source(page)).toHaveText(original!);
  await source(page).press('ControlOrMeta+z');
  expect(await source(page).textContent()).toBe(original);
  await page.locator('#file').setInputFiles({ name: 'local.d2', mimeType: 'text/plain', buffer: Buffer.from('local: Draft') });
  await page.locator('#example-picker summary').click();
  await expect(page.getByRole('heading', { name: 'Your drafts' })).toBeVisible();
  await expect(page.locator('#draft-options')).toContainText('local.d2');
  await expect(page.locator('#example-options')).not.toContainText('local.d2');
  await page.reload();
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options')).toContainText('Edited');
});

test('large document lists filter projects and collapse inactive groups', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'notes.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Notes') }); await previewReady(page);
  await page.locator('#example-picker summary').click();
  const group = page.getByRole('region', { name: 'browser-project project', exact: true });
  const toggle = group.getByRole('button', { name: 'browser-project', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(group.locator('.example-option').first()).toBeHidden();
  const filter = page.getByRole('searchbox', { name: 'Find a diagram or project' });
  await filter.fill('nodes.d2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.example-option:visible')).toHaveCount(1);
  await page.locator('.example-option:visible').click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await page.locator('#example-picker summary').click();
  await filter.fill('no such file');
  await expect(page.getByText('No matching diagrams. Try a filename or project name.')).toBeVisible();
  await filter.fill('');
  await expect(group.locator('.example-option').first()).toBeVisible();
});

test('restoring an example can be canceled or undone with its editing history', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await source(page).fill('a: First edit'); await previewReady(page);
  // Formatting is a real, isolated history event. Consecutive rapid fills may
  // otherwise be one typing group, particularly in Firefox.
  await source(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await source(page).fill('b: Second edit'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore Order flow?' });
  await expect(dialog).toContainText('unsaved changes');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source(page)).toHaveText('b: Second edit');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restore example', exact: true }).click();
  await previewReady(page);
  await expect(source(page)).toContainText('Checkout');
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveText('b: Second edit');
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: First edit');
});

test('editing a restored example retires its undo without overwriting the new work', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await source(page).fill('a: Previous work'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await expect(page.locator('#document-undo')).toBeVisible();
  await source(page).fill('b: New work');
  await expect(page.locator('#document-undo')).toBeHidden();
  await expect(source(page)).toHaveText('b: New work');
});
