import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { board, chooseExample, comparesVisuals, editorText, openFromBadge, previewReady, selectSource, visualSkipReason } from './helpers';
import { downloadExport, selectMenuOption } from './menu';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const stage = (page: Page) => page.locator('.zf-stage');
const layers = (page: Page) => stage(page).locator('[data-layer-board]');
const layerShape = (page: Page, board: string, shape: string) =>
  stage(page).locator(`[data-shape-board="${board}"][data-shape-id="${shape}"]`);
async function open(page: Page) {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/);
  await previewReady(page);
}

test('shows connected nested layers and toggles branches without changing the source', async ({ page }) => {
  await open(page);
  const source = await editorText(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  await expect(stage(page).locator('[data-layer-link]')).toHaveCount(3);
  await page.locator('.board-outline summary').click();
  const parent = page.getByRole('checkbox', { name: 'Show Plan the launch layer', exact: true });
  const child = page.getByRole('checkbox', { name: 'Show Onboarding layer', exact: true });
  await parent.uncheck();
  await expect(layers(page)).toHaveCount(2);
  await expect(child).toBeChecked();
  await expect(child).toBeDisabled();
  await parent.check();
  await expect(layers(page)).toHaveCount(4);
  await child.uncheck();
  await expect(layers(page)).toHaveCount(3);
  await expect(parent).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).uncheck();
  await expect(layers(page)).toHaveCount(0);
  await board(page, 'root');
  expect(await editorText(page)).toBe(source);
});

test('edits a shape in its own layer when IDs repeat and keeps the expanded view through undo', async ({ page }) => {
  await open(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  const target = layerShape(page, 'root.layers.Build and test', 'step_1');
  await target.click();
  await board(page, 'root.layers.Build and test');
  await expect(page.getByRole('group', { name: 'Selected: Freeze features' })).toBeVisible();
  await expect(stage(page).locator('.zf-selection-ring')).toHaveCount(1);
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename Freeze features', exact: true }).fill('Freeze release');
  await page.keyboard.press('Enter');
  await previewReady(page);
  await expect(layers(page)).toHaveCount(4);
  await expect(layerShape(page, 'root.layers.Build and test', 'step_1')).toContainText('Freeze release');
  await expect(layerShape(page, 'root', 'step_1')).toContainText('New idea');
  await stage(page).press('ControlOrMeta+z');
  await previewReady(page);
  await expect(layerShape(page, 'root.layers.Build and test', 'step_1')).toContainText('Freeze features');
  await expect(layers(page)).toHaveCount(4);
});

test('expands a nested board and toggles its descendants without showing the document root', async ({ page }) => {
  await open(page);
  await openFromBadge(page, 'Open Plan the launch board');
  const parent = 'root.layers.Plan the launch';
  const child = `${parent}.layers.Onboarding`;
  await board(page, parent);
  await page.locator('.board-outline summary').click();
  await page.getByRole('checkbox', { name: 'Show Onboarding layer', exact: true }).check();
  await expect(layers(page)).toHaveCount(2);
  await expect(stage(page)).toHaveAttribute('data-layer-root', parent);
  await expect(stage(page).locator('[data-layer-board="root"]')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Show Plan the launch layer', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Show Build and test layer', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Show Onboarding layer', exact: true }).uncheck();
  await expect(layers(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(2);
  await openFromBadge(page, 'Open Onboarding board');
  await board(page, child);
  await expect(stage(page)).toHaveAttribute('data-layer-root', child);
  await expect(layers(page)).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Root', exact: true }).click();
  await board(page, 'root');
  await expect(layers(page)).toHaveCount(4);
  await page.goBack();
  await board(page, child);
  await expect(layers(page)).toHaveCount(1);
  await page.goForward();
  await board(page, 'root');
  await expect(layers(page)).toHaveCount(4);
});

test('can make a selected child the starting board of an expanded view', async ({ page }) => {
  await open(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  const child = 'root.layers.Plan the launch';
  await layerShape(page, child, 'n_1').click();
  await board(page, child);
  await expect(layers(page)).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(stage(page)).toHaveAttribute('data-layer-root', child);
  await expect(layers(page)).toHaveCount(2);
  await expect(stage(page).locator('[data-layer-board="root"]')).toHaveCount(0);
});

test('shares a child centre with its parent and restores it in a focused view', async ({ page }) => {
  await open(page);
  const source = await editorText(page);
  const child = 'root.layers.Plan the launch';
  const center = layerShape(page, child, 'n');
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  await expect(center).toHaveCount(0);
  await expect(layerShape(page, 'root', 'step_2')).toContainText('Plan the launch');
  await expect(stage(page).locator('[data-merged-root]')).toHaveCount(1);
  await expect(stage(page).locator('path[data-layer-edge]')).toHaveCount(4);
  // A distinct child entry (Sign up) stays visible even though its parent topic opens that board.
  await expect(layerShape(page, `${child}.layers.Onboarding`, 'step_1')).toContainText('Sign up');
  await openFromBadge(page, 'Open Plan the launch board');
  await board(page, child);
  await expect(center).toContainText('Plan the launch');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Root', exact: true }).click();
  await expect(center).toHaveCount(0);
  // Source reveal can still focus and edit a centre that is shared in the larger view.
  await layerShape(page, child, 'n_1').click();
  await board(page, child);
  await selectSource(page, 'n: "Plan the launch"');
  await page.getByRole('textbox', { name: 'D2 source', exact: true }).press('ControlOrMeta+Shift+Enter');
  await expect(stage(page)).toHaveAttribute('data-layer-root', child);
  await expect(center).toContainText('Plan the launch');
  expect(await editorText(page)).toBe(source);
});

test('merges repeated centres across generated detail boards while keeping the focused centre', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New mind map', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a mind map' });
  await dialog.getByRole('textbox', { name: 'Topics' }).fill('Plan\n  Branch\n    Child\n      Leaf');
  await dialog.getByLabel('Detail boards').selectOption('1');
  await dialog.getByRole('button', { name: 'Create mind map', exact: true }).click();
  await previewReady(page);
  const source = await editorText(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(3);
  await expect(stage(page).locator('[data-merged-root]')).toHaveCount(2);
  await expect(stage(page).locator('[data-shape-id="n"]')).toHaveCount(1);
  await expect(layerShape(page, 'root', 'n')).toContainText('Plan');
  await openFromBadge(page, 'Open Branch board');
  await board(page, 'root.layers.Branch');
  await expect(layers(page)).toHaveCount(2);
  await expect(layerShape(page, 'root.layers.Branch', 'n')).toContainText('Branch');
  await expect(layerShape(page, 'root.layers.Branch.layers.Child', 'n')).toHaveCount(0);
  expect(await editorText(page)).toBe(source);
});

test('exports just the visible layers together as SVG and PNG', async ({ page }, info) => {
  await open(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  await page.locator('.board-outline summary').click();
  await page.getByRole('checkbox', { name: 'Show Onboarding layer', exact: true }).uncheck();
  await expect(layers(page)).toHaveCount(3);
  await page.keyboard.press('Escape');
  await selectMenuOption(page, '#export-format', 'svg');
  await expect(page.locator('#export-scope')).toContainText('Visible layers');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const download = await pending;
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const svg = await readFile(path, 'utf8');
  expect(svg).toContain('data-layer-canvas');
  expect(svg).toContain('data-layer-board="root.layers.Plan the launch"');
  expect(svg).toContain('data-merged-root="n"');
  expect(svg).not.toContain('data-shape-id="n"');
  expect(svg).not.toContain('data-layer-board="root.layers.Plan the launch.layers.Onboarding"');
  expect(svg).not.toContain('zf-selection-ring');
  await selectMenuOption(page, '#export-format', 'png');
  const pngPending = page.waitForEvent('download');
  await downloadExport(page);
  const png = await pngPending;
  const pngPath = info.outputPath(png.suggestedFilename());
  await png.saveAs(pngPath);
  expect((await readFile(pngPath)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('expands and collapses layers on a phone without overflowing the page', async ({ page }) => {
    await open(page);
    await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
    await expect(layers(page)).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator('.board-outline summary').tap();
    await page.getByRole('checkbox', { name: 'Show Plan the launch layer', exact: true }).uncheck();
    await expect(layers(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) test(`connected canvas appearance in ${theme}`, { tag: '@visual' }, async ({ page, browserName }) => {
  test.skip(!comparesVisuals(browserName), visualSkipReason);
  await page.emulateMedia({ colorScheme: theme });
  await open(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(layers(page)).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  await expect(stage(page)).toHaveScreenshot(`connected-layers-${theme}.png`);
});
