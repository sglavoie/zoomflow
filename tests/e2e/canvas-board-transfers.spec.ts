import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { board, editorText, previewReady, source, openBoards, openShapeActions, closeBoards } from './helpers';

test.use({ viewport: { width: 1600, height: 1000 } });
const map = 'root.layers.Plan the launch';
const onboarding = `${map}.layers.Onboarding`;
const shape = (page: Page, board: string, id: string) => page.locator(`.zf-stage [data-shape-board="${board}"][data-shape-id="${id}"]`);
const fixture = () => readFile(new URL('../../fixtures/mixed-transfers.d2', import.meta.url), 'utf8');
async function open(page: Page) {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(await fixture()); await previewReady(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check(); await previewReady(page);
  await closeBoards(page);
}
async function drag(page: Page, from: Locator, to: Locator) {
  await closeBoards(page);
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await expect(to).toHaveClass(/zf-branch-target/);
  await page.mouse.up(); await previewReady(page);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
}
async function focused(node: Locator) {
  await expect.poll(() => node.evaluate(element => (element.closest('a') ?? element) === document.activeElement)).toBe(true);
}
async function connection(page: Page, child: string, parent: string, anchor: string) {
  const link = page.locator(`.zf-stage path[data-layer-link="${child}"]`);
  await expect(link).toHaveAttribute('data-layer-parent', parent);
  await expect(link).toHaveAttribute('data-layer-source', anchor);
}
async function undoRedo(page: Page, original: string, changed: string) {
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  expect(await editorText(page)).toBe(changed);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
}

test('drags Product’s attached mind-map root onto New idea', async ({ page }) => {
  await open(page);
  const original = await editorText(page);
  await drag(page, shape(page, map, 'n'), shape(page, 'root', 'step_1'));
  await connection(page, map, 'root', 'step_1');
  await focused(shape(page, map, 'n'));
  const changed = await editorText(page);
  await undoRedo(page, original, changed);
  await connection(page, map, 'root', 'step_1');
  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit mind map' }).getByRole('textbox', { name: 'Topics', exact: true })).toHaveValue(/^Product/);
});

test('drags Pricing with Audience and Small teams from the mind map onto Sign up', async ({ page }) => {
  await open(page);
  const original = await editorText(page);
  await drag(page, shape(page, map, 'n_1'), shape(page, onboarding, 'step_1'));
  const pricing = `${onboarding}.layers.Pricing`;
  await connection(page, pricing, onboarding, 'step_1');
  await expect(shape(page, pricing, 'n_1_1')).toContainText('Small teams');
  await expect(page.locator(`.zf-stage [data-layer-board="${map}"]`).locator('[data-shape-id="n_1"]')).toContainText('Onboarding');
  await focused(shape(page, pricing, 'n'));
  const changed = await editorText(page);
  await undoRedo(page, original, changed);
  await focused(shape(page, pricing, 'n'));
  await connection(page, pricing, onboarding, 'step_1');
});

test('drags Launched out of the main flow onto Short videos and saves an editable flow branch', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await open(page);
  const original = await editorText(page);
  await drag(page, shape(page, 'root', 'step_5'), shape(page, map, 'n_3_1_2'));
  const launched = `${map}.layers.Launched`;
  await expect(shape(page, 'root', 'step_5')).toHaveCount(0);
  await connection(page, launched, map, 'n_3_1_2');
  await focused(shape(page, launched, 'step_5'));
  const changed = await editorText(page);
  await undoRedo(page, original, changed);
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+s');
  const saved = await download;
  const buffer = await readFile(await saved.path());
  expect(buffer.toString()).toBe(changed);
  await source(page).fill('temporary: Other diagram'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: saved.suggestedFilename(), mimeType: 'text/plain', buffer }); await previewReady(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check(); await previewReady(page);
  await closeBoards(page);
  await expect(shape(page, launched, 'step_5')).toContainText('Launched');
  await shape(page, launched, 'step_5').click(); await board(page, launched);
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit flow' }).getByLabel('Step 1 name')).toHaveValue('Launched');
});

test('offers cross-board parents for an attached root and accepts a click on another board', async ({ page }) => {
  await open(page);
  await shape(page, map, 'n').click();
  await openShapeActions(page);
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  const picker = page.locator('.canvas-branches');
  await expect(picker.getByLabel('New parent topic').locator('option')).toContainText(['Root › New idea']);
  await shape(page, 'root', 'step_1').click(); await previewReady(page);
  await expect(picker).toBeHidden();
  await connection(page, map, 'root', 'step_1');
});

test('rejects moving Product into its own attached onboarding flow', async ({ page }) => {
  await open(page);
  const original = await editorText(page);
  const from = (await shape(page, map, 'n').boundingBox())!;
  const to = (await shape(page, onboarding, 'step_1').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.locator('.zf-branch-target')).toHaveCount(0);
  await page.mouse.up();
  expect(await editorText(page)).toBe(original);
});

test('keeps hidden-export choices on the moved and renumbered topics through undo, redo and reload', async ({ page }) => {
  await open(page);
  for (const id of ['n_1_1_1', 'n_3_1_2']) {
    await shape(page, map, id).focus(); await page.keyboard.press('h');
    await expect(shape(page, map, id)).toHaveAttribute('data-export-hidden', '');
  }
  const original = await editorText(page);
  await drag(page, shape(page, map, 'n_1'), shape(page, onboarding, 'step_1'));
  const pricing = `${onboarding}.layers.Pricing`;
  await expect(shape(page, pricing, 'n_1_1')).toHaveAttribute('data-export-hidden', '');
  await expect(shape(page, map, 'n_2_1_2')).toHaveAttribute('data-export-hidden', '');
  const changed = await editorText(page);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await expect(shape(page, map, 'n_1_1_1')).toHaveAttribute('data-export-hidden', '');
  await expect(shape(page, map, 'n_3_1_2')).toHaveAttribute('data-export-hidden', '');
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  expect(await editorText(page)).toBe(changed);
  await page.reload(); await previewReady(page);
  await expect(shape(page, pricing, 'n_1_1')).toHaveAttribute('data-export-hidden', '');
  await expect(shape(page, map, 'n_2_1_2')).toHaveAttribute('data-export-hidden', '');
});

test('reveals a transferred branch beyond the visible depth and restores that depth on undo', async ({ page }) => {
  await open(page);
  const depth = page.getByRole('spinbutton', { name: 'Layer depth', exact: true, includeHidden: true });
  await openBoards(page);
  await depth.fill('1'); await depth.press('Enter'); await previewReady(page);
  await drag(page, shape(page, 'root', 'step_5'), shape(page, map, 'n_3_1_2'));
  const launched = `${map}.layers.Launched`;
  await expect(shape(page, launched, 'step_5')).toBeVisible();
  await focused(shape(page, launched, 'step_5'));
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await expect(depth).toHaveValue('1');
  await expect(shape(page, 'root', 'step_5')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  await expect(shape(page, launched, 'step_5')).toBeVisible();
});

test.describe('touch board transfers', () => {
  test.use({ hasTouch: true });
  test('uses the parent picker to move into an occupied topic while keeping its original board', async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-preview').tap();
    await shape(page, 'root', 'step_5').tap();
    await openShapeActions(page);
    await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).tap();
    const panel = page.locator('.canvas-branches');
    await panel.getByLabel('New parent node').selectOption(`@board:${JSON.stringify([map, 'n_2'])}`);
    await panel.getByRole('button', { name: 'Move branch', exact: true }).tap(); await previewReady(page);
    await expect(shape(page, map, 'n_2_1')).toContainText('Launched');
    await focused(shape(page, map, 'n_2_1'));
    await expect(shape(page, onboarding, 'step_1')).toContainText('Sign up');
    await expect(shape(page, 'root', 'step_5')).toHaveCount(0);
  });
  test('holds then drags Pricing from a mind map to the onboarding flow', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Trusted touch sequences use Chromium CDP; picker and mouse gestures run in every engine.');
    await open(page);
    await closeBoards(page);
    const from = (await shape(page, map, 'n_1').boundingBox())!;
    const to = (await shape(page, onboarding, 'step_1').boundingBox())!;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
    await expect(page.locator('.branch-drag-hint')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }] });
    await expect(shape(page, onboarding, 'step_1')).toHaveClass(/zf-branch-target/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await previewReady(page);
    await connection(page, `${onboarding}.layers.Pricing`, onboarding, 'step_1');
  });
});
