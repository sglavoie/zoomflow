import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { editorText, previewReady, source } from './helpers';
import { flowSource, flowTemplate, readFlow } from '../../apps/web/src/flow-model';

const shape = (page: import('@playwright/test').Page, id: string) => page.locator(`#viewer [data-shape-id="${id}"]`);
test.use({ viewport: { width: 1440, height: 1000 } });

test('detail sheets reveal depth on hover and carry their accent into the destination breadcrumb', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await expect(page.locator('#document-title')).toHaveText('Order flow');
  await expect(page.locator('#filename')).toHaveText('order.d2');
  const link = page.getByRole('link', { name: 'Open checkout board', exact: true });
  await expect(link.locator('.zf-depth-sheet')).toHaveCount(2);
  const before = await link.locator('.zf-depth-2').evaluate(node => getComputedStyle(node).transform);
  await link.hover();
  await expect.poll(() => link.locator('.zf-depth-2').evaluate(node => getComputedStyle(node).transform)).not.toBe(before);
  await expect(page.locator('.link-preview')).toBeVisible();
  await link.locator('.appendix-icon').click();
  await expect(page.locator('.zf-breadcrumbs [aria-current]')).toHaveClass(/zf-detail-crumb/);
});

test('adding next continues a labelled path while adding a branch preserves its existing outcome', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const flow = flowTemplate('linear'); flow.connections[0].label = 'Ready';
  await source(page).fill(flowSource(flow)); await previewReady(page);
  await shape(page, 'step_1').click();
  await page.getByRole('button', { name: 'Add next step after Start', exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Rename New step', exact: true });
  await rename.fill('Prepare'); await rename.press('Enter'); await previewReady(page);
  let result = readFlow(await editorText(page))!;
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_4', label: 'Ready' });
  expect(result.connections).toContainEqual({ from: 'step_4', to: 'step_2', label: '' });
  await shape(page, 'step_1').click();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Escape'); await previewReady(page);
  result = readFlow(await editorText(page))!;
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_4', label: 'Ready' });
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_5', label: '' });
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(readFlow(await editorText(page))!.steps.map(step => step.label)).toContain('Prepare');
  await expect(shape(page, 'step_5')).toHaveCount(0);
});

test('filled roles distinguish decisions and outcomes in both themes and elevated changes typography', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const flow = flowTemplate('approval'); flow.look.filled = true;
  await source(page).fill(flowSource(flow)); await previewReady(page);
  const fill = (id: string) => shape(page, id).locator('.shape > *').first().evaluate(node => getComputedStyle(node).fill);
  expect(await fill('step_2')).toBe('rgb(255, 243, 219)');
  expect(await fill('step_3')).toBe('rgb(227, 243, 235)');
  await page.locator('#workspace-view > summary').click(); await page.locator('#theme button[value="dark"]').click();
  await expect.poll(() => fill('step_2')).toBe('rgb(68, 55, 33)');
  await expect.poll(() => fill('step_3')).toBe('rgb(32, 61, 54)');
  const size = await shape(page, 'step_4').locator('text').evaluate(node => getComputedStyle(node).fontSize);
  await page.locator('.board-appearance > details > summary').click();
  await page.locator('.board-appearance').getByRole('button', { name: 'Elevated', exact: true }).click(); await previewReady(page);
  expect(await shape(page, 'step_4').locator('text').evaluate(node => getComputedStyle(node).fontSize)).not.toBe(size);
});

test('presentation isolates the canvas, supports choices and restores controls and focus on Escape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const area = page.locator('.zf-stage-area[data-presentation]');
  await expect(area).toBeVisible();
  expect(await page.locator('header').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await expect(area.locator('.zf-present-title')).toContainText('Order flow');
  await expect(area.locator('.zf-present-title span')).toHaveText('Follow the idea, one step at a time');
  await area.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await area.getByRole('button', { name: 'Explore checkout', exact: true }).click();
  await expect(shape(page, 'Cart')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(area).toHaveCount(0);
  expect(await page.locator('header').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  expect(await editorText(page)).toBe(original);
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
});

test('presentation opens details from nodes, badges and the keyboard, preserving back and nested return paths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  const status = guide.getByRole('status');
  // Re-selecting the current ordinary node should not add duplicate steps.
  await shape(page, 'Browse').click();
  await expect(status).toHaveText('Step 1 · Browse');
  for (const activation of ['node', 'badge', 'Enter', ' ']) {
    const link = page.getByRole('link', { name: 'Open checkout board', exact: true });
    if (activation === 'node') await shape(page, 'Checkout').click();
    else if (activation === 'badge') await link.locator('.appendix-icon').click();
    else { await link.focus(); await link.press(activation); }
    await expect(status).toHaveText('Step 2 · Cart');
    await expect(page.locator('.zf-stage-area[data-presentation]')).toBeVisible();
    await guide.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(status).toHaveText('Step 1 · Browse');
  }
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await shape(page, 'Checkout').click();
  await expect(status).toHaveText('Step 3 · Cart');
  await shape(page, 'Charge').click();
  await expect(status).toContainText('Authorize');
  await guide.getByRole('button', { name: 'Next: Capture', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Receipt', exact: true }).click();
  await guide.getByRole('button', { name: 'Return to checkout', exact: true }).click();
  await expect(status).toContainText('Charge');
  await guide.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  expect(await editorText(page)).toBe(original);
});

test('offline HTML keeps presentation metadata, opens the chosen board and respects explicit deep links', async ({ page, context }, testInfo) => {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.export-presentation > summary').click();
  const title = 'Order <review> & next steps';
  await page.locator('#export-title').fill(title);
  await page.locator('#export-subtitle').fill('A customer’s journey');
  await page.locator('#export-opening-board').selectOption('root.layers.checkout');
  await page.locator('#export-start-mode').selectOption('presentation');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const path = testInfo.outputPath('presentation.html'); await (await downloaded).saveAs(path);
  await context.setOffline(true);
  const offline = await context.newPage(); await offline.goto(`file://${path}`);
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-stage-area[data-presentation]')).toBeVisible();
  await expect(offline.locator('.zf-present-title strong')).toHaveText(title);
  await expect(offline.locator('.zf-present-title span')).toHaveText('A customer’s journey');
  await offline.getByRole('link', { name: 'Open charge board', exact: true }).locator('.appendix-icon').click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(offline.locator('.zf-walkthrough [role="status"]')).toHaveText('Step 2 · Authorize');
  await offline.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await offline.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  await offline.goto(`file://${path}#/checkout/charge`);
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
});

test('framed SVG uses the same title, subtitle and geometry as its thumbnail without changing source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('#export-format input[value="svg"]').check();
  await page.locator('.export-presentation > summary').click();
  await page.locator('#export-frame').check();
  await page.locator('#export-title').fill('Order <flow>');
  await page.locator('#export-subtitle').fill('Ready for the team');
  const thumbnail = page.locator('#export-preview img');
  await expect.poll(() => thumbnail.evaluate(async (node: HTMLImageElement) => node.src ? (await fetch(node.src)).text() : '')).toContain('Ready for the team');
  const preview = await thumbnail.evaluate(async (node: HTMLImageElement) => (await fetch(node.src)).text());
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const svg = await readFile((await (await downloaded).path())!, 'utf8');
  expect(svg).toBe(preview);
  expect(svg).toContain('Order &lt;flow&gt;');
  expect(await editorText(page)).toBe(original);
  await page.reload(); await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.export-presentation > summary').click();
  await expect(page.locator('#export-title')).toHaveValue('Order <flow>');
  await expect(page.locator('#export-frame')).toBeChecked();
});

test('touch coaching uses tap instructions and presentation stays within a narrow screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage(); await page.goto('/'); await previewReady(page);
  await expect(page.locator('.canvas-coach')).toContainText('Tap a step');
  await expect(page.locator('.canvas-coach')).not.toContainText('Double-click');
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const panel = (await page.locator('.zf-walkthrough').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  expect(panel.y + panel.height).toBeLessThanOrEqual(640);
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await context.close();
});

test('leaving presentation restores the editor zoom and keeps it when returning from a detail board', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await page.locator('#viewer .zf-zoom-controls span').textContent();
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Explore checkout', exact: true }).click();
  await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(page.locator('#viewer .zf-zoom-controls span')).toHaveText(zoom!);
});
