import { expect, test, type Page } from '@playwright/test';
import { downloadExport, openDownloads, selectMenuOption } from './menu';
import { pathToFileURL } from 'node:url';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function choose(page: Page, name: RegExp) {
  await page.locator('#example-picker summary').click();
  await page.locator('.example-menu').getByRole('button', { name }).and(page.locator('.example-option')).click();
  await ready(page);
}

test('same-name documents keep separate undo histories and drafts', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#file').setInputFiles({ name: 'same.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Original A') });
  await ready(page);
  await source(page).fill('a: Edited A');
  await ready(page);
  await page.locator('#file').setInputFiles({ name: 'same.d2', mimeType: 'text/plain', buffer: Buffer.from('b: Original B') });
  await ready(page);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('b: Original B');
  await source(page).fill('b: Edited B');
  await ready(page);
  await choose(page, /same\.d2.*Draft 1/);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: Original A');
  await choose(page, /same\.d2.*Draft 2/);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('b: Original B');
});

test('switching documents restores selection and scroll position', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const long = Array.from({ length: 120 }, (_, i) => `# comment ${i}`).join('\n') + '\na: Final line';
  await source(page).fill(long);
  await ready(page);
  await source(page).press('ControlOrMeta+End');
  await source(page).press('Shift+Home');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  const scroll = await page.locator('.cm-scroller').evaluate((node) => node.scrollTop);
  expect(scroll).toBeGreaterThan(500);
  await choose(page, /Flowchart basics/);
  // Browsers round CodeMirror's top padding differently by a pixel.
  await expect.poll(() => page.locator('.cm-scroller').evaluate((node) => node.scrollTop)).toBeLessThan(3);
  await choose(page, /Order flow/);
  await source(page).focus();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect.poll(() => page.locator('.cm-scroller').evaluate((node, previous) => Math.abs(node.scrollTop - previous), scroll)).toBeLessThan(3);
});

test('picker groups drafts, marks modified examples and restores the original', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const original = await source(page).textContent();
  await source(page).fill('changed: My draft');
  await ready(page);
  await page.locator('#example-picker summary').click();
  const order = page.locator('#example-options').getByRole('button', { name: /Order flow.*Modified/ });
  await expect(order).toContainText('Edited');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await expect(source(page)).toHaveText('changed: My draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await ready(page);
  expect(await source(page).textContent()).toBe(original);
  await source(page).press('ControlOrMeta+z');
  expect(await source(page).textContent()).toBe(original);
  await page.locator('#file').setInputFiles({ name: 'local.d2', mimeType: 'text/plain', buffer: Buffer.from('local: Draft') });
  await page.locator('#example-picker summary').click();
  await expect(page.getByRole('heading', { name: 'Your drafts' })).toBeVisible();
  await expect(page.locator('#draft-options')).toContainText('local.d2');
  await expect(page.locator('#example-options')).not.toContainText('local.d2');
  await page.reload();
  await ready(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options')).toContainText('Edited');
});

test('header stays stable while saving and preferences survive reload', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await ready(page);
  const before = await page.locator('header').boundingBox();
  const title = (await page.locator('header strong').boundingBox())!;
  const open = (await page.locator('.file-button').boundingBox())!;
  const picker = (await page.locator('#example-picker summary').boundingBox())!;
  const center = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(center(title) - center(picker))).toBeLessThan(1);
  expect(Math.abs(center(open) - center(picker))).toBeLessThan(1);
  const status = (await page.locator('#draft-status').boundingBox())!;
  const save = (await page.locator('#save-file').boundingBox())!;
  expect(status.y).toBeGreaterThanOrEqual(save.y + save.height);
  const statusRow = (await page.locator('#work-status').boundingBox())!;
  expect(statusRow.height).toBeLessThanOrEqual(40);
  expect(status.y).toBeGreaterThanOrEqual(statusRow.y);
  expect(status.y + status.height).toBeLessThanOrEqual(statusRow.y + statusRow.height);
  expect(statusRow.y + statusRow.height).toBeLessThanOrEqual((await page.locator('#editor').boundingBox())!.y);
  await source(page).fill('a: Edited');
  expect(await page.locator('header').boundingBox()).toEqual(before);
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
  expect(await page.locator('header').boundingBox()).toEqual(before);
  await selectMenuOption(page, '#theme', 'dark');
  await selectMenuOption(page, '#export-format', 'html');
  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openDownloads(page);
  await expect(page.locator('#export-format')).toHaveValue('html');
  await page.locator('#export-format').press('Escape');
  await expect(page.locator('#header-more-toggle')).toBeFocused();
  await expect(page.locator('#header-more-content')).toBeHidden();
});

test('mobile canvas controls do not cover the diagram', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);
  const canvas = (await page.locator('.zf-stage').boundingBox())!;
  expect(canvas.height).toBeGreaterThan(260);
  expect((await page.locator('header').boundingBox())!.height).toBeLessThan(120);
  for (const selector of ['.zf-zoom-controls', '.zf-fullscreen-toggle']) {
    expect((await page.locator(selector).boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  }
  await openDownloads(page);
  const menu = (await page.locator('#header-more-content').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
});

test('edits invalidate exports immediately without flashing progress, errors lead to their source', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await source(page).fill('a: Updated');
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('.zf-stage')).not.toHaveAttribute('data-preview-state', 'updating');
  await expect(page.locator('.zf-stage')).toContainText('Updated');
  await source(page).fill('a: First line\nbroken: {');
  await expect(page.locator('#compile-error')).toContainText('Line 2');
  await page.getByRole('button', { name: 'Go to error' }).click();
  await expect(source(page)).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-preview-state', 'stale');
  await expect(page.locator('#export')).toBeDisabled();
});

test('live and offline links distinguish board navigation from external destinations', async ({ page, context }, info) => {
  await page.goto('/');
  await ready(page);
  const assertCues = async (target: Page) => {
    const board = target.getByRole('link', { name: 'Open checkout board', exact: true });
    const external = target.getByRole('link', { name: 'Open external link: Docs (new tab)', exact: true });
    await expect(board).toHaveAttribute('data-link-kind', 'board');
    await expect(external).toHaveAttribute('data-link-kind', 'external');
    await expect(board.locator('.appendix-icon')).toHaveCount(1);
    await expect(external.locator('.appendix-icon')).toHaveCount(1);
    expect(await board.locator('.appendix-icon path').getAttribute('d')).not.toBe(await external.locator('.appendix-icon path').getAttribute('d'));
    await board.focus();
    await expect(target.locator('.zf-link-hint')).toHaveText('Open checkout board');
    await board.press('Enter');
    await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  };
  await assertCues(page);
  await selectMenuOption(page, '#export-format', 'html');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  const path = info.outputPath('links.html');
  await download.saveAs(path);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(path).href);
  await assertCues(offline);
});

test('link badges preserve diagram tooltips and support Alt+click source selection', async ({ page, context }, info) => {
  await page.goto('/');
  await ready(page);
  await source(page).fill('a: {link: layers.child; tooltip: Keep this tooltip}\nlayers.child: {b}');
  await ready(page);
  const badge = page.getByRole('link', { name: 'Open child board', exact: true }).locator('.appendix-icon');
  await expect(badge).toHaveCount(1);
  await expect(page.locator('.appendix-icon > title')).toHaveText('Keep this tooltip');
  await badge.click({ modifiers: ['Alt'] });
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('a');
  await selectMenuOption(page, '#export-format', 'html');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  const path = info.outputPath('tooltip.html');
  await download.saveAs(path);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('.appendix-icon > title')).toHaveText('Keep this tooltip');
  await expect(offline.getByRole('link', { name: 'Open child board' }).locator('.appendix-icon')).toHaveCount(1);
});
