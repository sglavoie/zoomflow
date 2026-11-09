import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { editorText, previewReady, source } from './helpers';
import { readFlow } from '../../apps/web/src/flow-model';

test.use({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
const shape = (page: Page, id: string) => page.locator(`#viewer [data-shape-id="${id}"]`);
async function open(page: Page) { await page.goto('/'); await previewReady(page); }
async function quick(page: Page) {
  await page.locator('#create-open > summary').click();
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  return page.getByRole('dialog', { name: 'Create a flow' });
}

test('fresh workspace teaches direct editing, keeps attached boards, and remembers the chosen layout', async ({ page }) => {
  await open(page);
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.locator('.canvas-coach')).toBeVisible();
  await shape(page, 'Browse').dblclick();
  await page.getByRole('textbox', { name: 'Rename Browse', exact: true }).fill('Discover');
  await page.keyboard.press('Enter'); await previewReady(page);
  await expect(shape(page, 'Browse')).toContainText('Discover');
  await expect(page.locator('.canvas-coach')).toContainText('Keep the idea moving');
  await page.getByRole('button', { name: 'Add next step', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).fill('Choose items');
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Enter'); await previewReady(page);
  await expect(page.locator('.canvas-coach')).toContainText('There’s more inside');
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).locator('.appendix-icon').click();
  await page.getByRole('link', { name: 'Open charge board', exact: true }).locator('.appendix-icon').click();
  await expect(shape(page, 'step_2')).toContainText('Capture');
  await page.locator('#toggle-source').click();
  await page.reload(); await previewReady(page);
  await expect(page.locator('#source-pane')).toBeVisible();
  await expect(page.locator('.canvas-coach')).toBeHidden();
  expect(await editorText(page)).toContain('Discover');
});

test('existing workspaces retain the former source layout when migrating', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zoomflow.selection.v2', 'order.d2'));
  await open(page);
  await expect(page.locator('#source-pane')).toBeVisible();
});

test('quick start connects a list, preserves it in the full builder, and creates an editable draft', async ({ page }) => {
  await open(page);
  const dialog = await quick(page);
  await dialog.getByLabel('Flow name', { exact: true }).fill('Shipping');
  await dialog.getByLabel('Steps, one per line', { exact: true }).fill('Pack\n\nShip\nDeliver');
  await expect(dialog.locator('.zf-stage')).toContainText('Deliver');
  await dialog.getByRole('button', { name: 'Full builder', exact: true }).click();
  await expect(dialog.getByLabel('Step 2 name', { exact: true })).toHaveValue('Ship');
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  const flow = readFlow(await editorText(page))!;
  expect(flow.steps.map(step => step.label)).toEqual(['Pack', 'Ship', 'Deliver']);
  expect(flow.connections).toEqual([{ from: 'step_1', to: 'step_2', label: '' }, { from: 'step_2', to: 'step_3', label: '' }]);
  await shape(page, 'step_2').dblclick();
  await expect(page.getByRole('textbox', { name: 'Rename Ship', exact: true })).toBeFocused();
});

test('insert splits only the chosen labelled connection, preserves its decision, and undoes cleanly', async ({ page }) => {
  await open(page);
  const dialog = await quick(page);
  await dialog.getByRole('button', { name: 'Full builder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approval with Yes / No', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  const original = await editorText(page);
  await page.locator('#viewer [data-flow-connection="1"]').focus();
  await page.getByRole('button', { name: 'Insert step', exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Rename New step', exact: true });
  await expect(rename).toBeFocused(); await rename.fill('Prepare'); await rename.press('Enter'); await previewReady(page);
  const flow = readFlow(await editorText(page))!;
  expect(flow.connections).toContainEqual({ from: 'step_2', to: 'step_5', label: 'Yes' });
  expect(flow.connections).toContainEqual({ from: 'step_5', to: 'step_3', label: '' });
  expect(flow.connections).toContainEqual({ from: 'step_2', to: 'step_4', label: 'No' });
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
});

test('connection hover exposes an insertion handle at the arrow, including horizontal arrows', async ({ page }) => {
  await open(page);
  const point = await page.locator('#viewer [data-flow-connection="0"] path.connection').evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(point.x, point.y);
  const insert = page.getByRole('button', { name: 'Insert step between Browse and Checkout', exact: true });
  await expect(insert).toBeVisible(); await insert.click();
  await expect(page.getByRole('textbox', { name: 'Rename New step', exact: true })).toBeFocused();
});

test('an empty board can start a flow or mind map without opening source syntax', async ({ page }) => {
  await open(page); await page.locator('#toggle-source').click();
  await source(page).fill(''); await previewReady(page);
  await page.getByRole('button', { name: 'Add first step', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Rename First step', exact: true });
  await expect(name).toBeFocused(); await name.fill('Begin'); await name.press('Enter'); await previewReady(page);
  await expect(shape(page, 'step_1')).toContainText('Begin');
  await source(page).fill(''); await previewReady(page);
  await page.getByRole('button', { name: 'Start mind map', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a mind map board' }).getByRole('button', { name: 'Add board', exact: true }).click();
  await previewReady(page); await expect(page.getByRole('button', { name: 'Edit mind map', exact: true })).toBeVisible();
});

test('edits animate surviving shapes and reduced motion skips that animation', async ({ page }) => {
  await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const watch = () => page.evaluate(() => new Promise<number>(resolve => {
    document.querySelector('#viewer .zf-stage')!.addEventListener('zf-boardchange', () => requestAnimationFrame(() => {
      resolve(document.querySelector('#viewer .zf-stage')!.getAnimations({ subtree: true }).filter(animation =>
        (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'transform' in frame)).length);
    }), { once: true });
  }));
  await shape(page, 'Browse').click();
  const motion = watch();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  expect(await motion).toBeGreaterThan(0);
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await shape(page, 'Browse').click(); const reduced = watch();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  expect(await reduced).toBe(0);
});

test('walkthrough follows choices, visits nested boards, returns, and works offline', async ({ page, context }, testInfo) => {
  await open(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await guide.getByRole('button', { name: 'Explore checkout', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Charge', exact: true }).click();
  await guide.getByRole('button', { name: 'Explore charge', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Capture', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Receipt', exact: true }).click();
  await guide.getByRole('button', { name: 'Return to checkout', exact: true }).click();
  await expect(guide).toContainText('Charge');
  await guide.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const download = await downloaded; const path = testInfo.outputPath('walkthrough.html'); await download.saveAs(path);
  expect(await readFile(path, 'utf8')).toContain('walkthrough');
  await context.setOffline(true);
  const offline = await context.newPage(); await offline.goto(`file://${path}`);
  await offline.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await offline.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await offline.getByRole('button', { name: 'Explore checkout', exact: true }).click();
  await expect(offline.locator('.zf-walkthrough')).toContainText('Cart');
  await expect(offline.locator('.zf-walkthrough-muted').first()).toBeAttached();
});

test('style controls preserve attachments and filled shapes follow dark mode', async ({ page }) => {
  await open(page);
  await page.locator('.board-appearance > details > summary').click();
  await page.locator('.board-appearance').getByRole('button', { name: 'Elevated', exact: true }).click(); await previewReady(page);
  await expect(page.getByRole('link', { name: 'Open checkout board', exact: true })).toBeVisible();
  await page.locator('#workspace-view > summary').click();
  await page.locator('#theme button[value="dark"]').click();
  await expect.poll(() => shape(page, 'Browse').locator('.shape rect').evaluate(node => getComputedStyle(node).fill)).toBe('rgb(38, 54, 76)');
  await expect.poll(() => shape(page, 'Browse').locator('text').evaluate(node => getComputedStyle(node).fill)).toBe('rgb(228, 234, 242)');
});

test('phone keeps the canvas prominent and creation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  expect((await page.locator('#viewer .zf-stage').boundingBox())!.y).toBeLessThan(245);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const dialog = await quick(page);
  await dialog.getByLabel('Steps, one per line', { exact: true }).fill('First\nNext');
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  await expect(shape(page, 'step_2')).toContainText('Next');
});


test('walkthrough waits for branch choices, supports loops and backtracking, and keeps unused arrows dim', async ({ page }) => {
  await open(page); await page.locator('#toggle-source').click();
  await source(page).fill('start -> decision\ndecision -> done: Yes\ndecision -> start: Retry'); await previewReady(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  await guide.getByRole('button', { name: 'Next: decision', exact: true }).click();
  await expect(guide.getByRole('button', { name: 'Yes → done', exact: true })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Retry → start', exact: true })).toBeVisible();
  await expect(page.locator('#viewer [data-connection-id]:not(.zf-walkthrough-muted)')).toHaveCount(1);
  await guide.getByRole('button', { name: 'Retry → start', exact: true }).click();
  await expect(guide).toContainText('Step 3 · start');
  await guide.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(guide).toContainText('Step 2 · decision');
  await expect(page.locator('#viewer [data-connection-id]:not(.zf-walkthrough-muted)')).toHaveCount(1);
  await guide.getByRole('button', { name: 'Yes → done', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(guide).toContainText('Step 3 · done');
  await guide.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('button', { name: 'Walkthrough', exact: true })).toBeFocused();
});

test('walkthrough and zoom controls remain separate in fullscreen and on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await open(page);
  const zoom = page.getByRole('group', { name: 'Diagram zoom' });
  const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
  const controls = (await zoom.boundingBox())!;
  expect(controls.x + controls.width).toBeLessThanOrEqual((await fullscreen.boundingBox())!.x);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await fullscreen.click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  const box = (await zoom.boundingBox())!;
  expect((await guide.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await expect(guide).toContainText('Step 2 · Checkout');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(guide).toBeVisible();
});
