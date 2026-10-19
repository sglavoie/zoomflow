import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('mobile source editor is visible with secondary controls collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  const editor = page.locator('#editor');
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  expect((await editor.boundingBox())!.y).toBeLessThan(700);
  await expect(page.locator('#header-more-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#ai-assistant')).not.toHaveAttribute('open');
  await expect(page.locator('#lint-details')).not.toHaveAttribute('open');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  await page.getByRole('textbox', { name: 'D2 source' }).fill('mobile: Editable');
  await expect(page.locator('.zf-stage')).toContainText('Editable');
});

test('draft recovers after reload and D2 source downloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.getByRole('textbox', { name: 'D2 source' }).fill('draft: Recovered');
  await expect(page.locator('#draft-status')).toContainText(/browser draft/i);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'D2 source' })).toContainText('draft: Recovered');
  await expect(page.locator('.zf-stage')).toContainText('Recovered');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download source (.d2)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('order.d2');
  expect(await readFile(await download.path(), 'utf8')).toBe('draft: Recovered');
  await expect(page.locator('#draft-status')).toContainText('Source download started');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'D2 source' })).toContainText('draft: Recovered');
  await expect(page.locator('#draft-status')).toContainText('Browser draft saved');
  await page.locator('#file').setInputFiles({ name: 'custom.d2', mimeType: 'text/plain', buffer: Buffer.from('uploaded: Original') });
  await page.getByRole('textbox', { name: 'D2 source' }).fill('uploaded: Edited');
  await page.reload();
  await expect(page.locator('#filename')).toHaveText('custom.d2');
  await expect(page.getByRole('textbox', { name: 'D2 source' })).toContainText('uploaded: Edited');
  await expect(page.locator('#draft-status')).toContainText(/browser draft/i);
});

test('uploaded drafts can be removed without affecting other diagrams', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'old.d2', mimeType: 'text/plain', buffer: Buffer.from('old: Draft') });
  await page.locator('#file').setInputFiles({ name: 'active.d2', mimeType: 'text/plain', buffer: Buffer.from('active: Keep') });
  await page.locator('#example-picker summary').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove old.d2 draft' }).click();
  await expect(page.locator('#filename')).toHaveText('active.d2');
  await expect(page.locator('.zf-stage')).toContainText('Keep');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove active.d2 draft' }).click();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await page.reload();
  await page.locator('#example-picker summary').click();
  await expect(page.getByRole('button', { name: 'Remove old.d2 draft' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove active.d2 draft' })).toHaveCount(0);
});

test('D2 syntax tokens remain visible in light and dark themes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.zf-token-comment').first()).toBeVisible();
  await expect(page.locator('.zf-token-keyword').first()).toBeVisible();
  await expect(page.locator('.zf-token-property').first()).toBeVisible();
  await expect(page.locator('.zf-token-url').first()).toBeVisible();
  await expect(page.locator('.zf-token-operator').first()).toBeVisible();
  const light = await page.locator('.zf-token-comment').first().evaluate((node) => getComputedStyle(node).color);
  await page.locator('#theme').selectOption('dark');
  const dark = await page.locator('.zf-token-comment').first().evaluate((node) => getComputedStyle(node).color);
  expect(dark).not.toBe(light);
});

test('invalid current file cannot export the previous diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#file').setInputFiles({ name: 'bad.d2', mimeType: 'text/plain', buffer: Buffer.from('broken: {') });
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('Preview out of date');
  await page.getByRole('textbox', { name: 'D2 source' }).fill('fixed: Current file');
  await expect(page.locator('#export')).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  expect(download.suggestedFilename()).toBe('bad-root.svg');
  expect(await readFile(await download.path(), 'utf8')).toContain('Current file');
});

test('source changes cancel an export already embedding images', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'image.d2', mimeType: 'text/plain',
    buffer: Buffer.from('Picture: {icon: https://assets.example/slow.svg}') });
  await expect(page.locator('.zf-stage [data-shape-id="Picture"]')).toBeVisible();
  await expect(page.locator('#export')).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested!: () => void;
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('https://assets.example/slow.svg', async (route) => {
    requested();
    await gate;
    await route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>' });
  });
  let downloads = 0;
  page.on('download', () => { ++downloads; });
  await page.locator('#export').click();
  await requestSeen;
  await page.getByRole('textbox', { name: 'D2 source' }).fill('new: Current source');
  release();
  await expect(page.locator('#activity-status')).toContainText('Export canceled because the source changed.');
  expect(downloads).toBe(0);
  await expect(page.locator('#export')).toBeEnabled();
});

test('preview zooms and pans, then fits again', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('.zf-stage > svg');
  await expect(svg).toBeVisible();
  const box = async () => svg.getAttribute('viewBox').then((value) => value!.split(/\s+/).map(Number));
  const original = await box();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await box();
  expect(zoomed[2]).toBeLessThan(original[2]);
  const bounds = (await svg.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.25, { steps: 6 });
  await page.mouse.up();
  const panned = await box();
  expect(panned.slice(0, 2)).not.toEqual(zoomed.slice(0, 2));
  const linked = page.locator('.zf-stage a[href="root.layers.checkout"]');
  const target = (await linked.boundingBox())!;
  const beforeLinkedPan = await box();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 - 35, target.y + target.height / 2 - 25, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await box()).slice(0, 2)).not.toEqual(beforeLinkedPan.slice(0, 2));
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await page.getByRole('button', { name: 'Fit diagram' }).click();
  expect(await box()).toEqual(original);
});

test('live edits keep the current view, while opening another diagram fits it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  const source = page.getByRole('textbox', { name: 'D2 source' });
  await source.press('ControlOrMeta+End');
  await source.press('Enter');
  await source.pressSequentially('Note: Keeps the view');
  await expect(page.locator('.zf-stage')).toContainText('Keeps the view');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  await page.locator('#file').setInputFiles({ name: 'fresh.d2', mimeType: 'text/plain', buffer: Buffer.from('fresh: Fits again') });
  await expect(page.locator('.zf-stage')).toContainText('Fits again');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('100%');
});

test('mobile first fit fills the canvas and diagnostics lead to the source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  const coverage = await page.locator('.zf-stage').evaluate((stage) => {
    const shapes = [...stage.querySelectorAll('[data-shape-id]')].map((shape) => shape.getBoundingClientRect());
    return (Math.max(...shapes.map((box) => box.right)) - Math.min(...shapes.map((box) => box.left))) /
      stage.getBoundingClientRect().width;
  });
  expect(coverage).toBeGreaterThan(0.8);
  await page.getByRole('textbox', { name: 'D2 source' }).fill('broken: {');
  await expect(page.locator('#preview-status')).toHaveText('Preview out of date');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-preview-state', 'stale');
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('.cm-panel-lint')).toBeVisible();
  await expect(page.locator('.cm-panel-lint .cm-diagnostic').first()).toBeVisible();
});

test('keyboard board navigation retains focus and announces the new board', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await link.focus();
  await link.press('Enter');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-stage')).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('aria-label', 'checkout diagram');
  await expect(page.locator('#viewer .zf-visually-hidden')).toHaveText('checkout board');
  await page.keyboard.press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-stage')).toBeFocused();
});

test('exported HTML retains keyboard focus during drill-down', async ({ page, context }, info) => {
  await page.goto('/');
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#export-format').selectOption('html');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  const svg = offline.locator('.zf-stage > svg');
  const initialWidth = Number((await svg.getAttribute('viewBox'))!.split(/\s+/)[2]);
  await offline.getByRole('button', { name: 'Zoom in' }).click();
  expect(Number((await svg.getAttribute('viewBox'))!.split(/\s+/)[2])).toBeLessThan(initialWidth);
  const link = offline.locator('.zf-stage a[href="root.layers.checkout"]');
  await link.focus();
  await link.press('Enter');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-stage')).toBeFocused();
  await expect(offline.locator('.zf-visually-hidden')).toHaveText('checkout board');
});
