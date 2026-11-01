import { expect, test, type Locator, type Page } from '@playwright/test';
import { board, chooseExample, editorText, openFromBadge, previewReady, source } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });
const shape = (page: Page, id: string, board = 'root') => page.locator(`.zf-stage [data-shape-board="${board}"][data-shape-id="${id}"]`);
const panel = (page: Page) => page.locator('.canvas-branches');
const initial = 'Plan\n  Launch\n    Interviews\n      Notes\n  Research\n    Interviews';

async function focusedShape(element: Locator) {
  await expect.poll(() => element.evaluate(node => (node.closest('a') ?? node) === document.activeElement)).toBe(true);
}

async function createMap(page: Page, outline = initial, split = '0') {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'New mind map', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Create a mind map' });
  await builder.getByLabel('Mind map name').fill('Plan');
  await builder.getByRole('textbox', { name: 'Topics', exact: true }).fill(outline);
  await builder.getByLabel('Detail boards').selectOption(split);
  await builder.getByRole('button', { name: 'Create mind map', exact: true }).click();
  await previewReady(page);
}

async function outline(page: Page) {
  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Edit mind map' });
  const result = await builder.getByRole('textbox', { name: 'Topics', exact: true }).inputValue();
  await builder.getByRole('button', { name: 'Cancel', exact: true }).click();
  return result;
}

async function dragTo(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
}

test('moves a subtree by dragging, keeps the builder editable, and follows selection through undo and redo', async ({ page }) => {
  await createMap(page);
  const original = await editorText(page);
  await dragTo(page, shape(page, 'n_1_1'), shape(page, 'n_2'));
  await expect(shape(page, 'n_2')).toHaveClass(/zf-branch-target/);
  await expect(page.locator('.branch-drag-hint')).toContainText('Research');
  await page.mouse.up(); await previewReady(page);
  await expect(shape(page, 'n_2_2')).toBeFocused();
  await expect(shape(page, 'n_2_2_1')).toContainText('Notes');
  const moved = await editorText(page);
  expect(moved).not.toBe(original);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await expect(shape(page, 'n_1_1')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  expect(await editorText(page)).toBe(moved);
  await expect(shape(page, 'n_2_2')).toBeFocused();
  expect(await outline(page)).toBe('Plan\n  Launch\n  Research\n    Interviews\n    Interviews\n      Notes');
});

test('chooses a parent from the keyboard menu or diagram, and promotes a subtree to the root', async ({ page }) => {
  await createMap(page);
  await shape(page, 'n_1_1').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  await expect(panel(page).getByLabel('New parent topic')).toBeFocused();
  await expect(panel(page).getByLabel('New parent topic').locator('option')).toHaveText(['Plan', 'Plan › Research', 'Plan › Research › Interviews']);
  await panel(page).getByLabel('New parent topic').selectOption('n_2');
  await panel(page).getByRole('button', { name: 'Move branch', exact: true }).click(); await previewReady(page);
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: 'Move branch…', exact: true }).click();
  await shape(page, 'n').click(); await previewReady(page);
  await expect(shape(page, 'n_3')).toBeFocused();
  expect(await outline(page)).toBe('Plan\n  Launch\n  Research\n    Interviews\n  Interviews\n    Notes');
});

test('cancels invalid drops and Escape without changing source or opening a topic board', async ({ page }) => {
  await createMap(page, initial, '2');
  const original = await editorText(page);
  await dragTo(page, shape(page, 'n_1'), shape(page, 'n_1_1'));
  await expect(page.locator('.zf-branch-target')).toHaveCount(0);
  await page.mouse.up();
  await board(page, 'root');
  expect(await editorText(page)).toBe(original);
  await dragTo(page, shape(page, 'n_1'), shape(page, 'n_2'));
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.branch-drag-hint')).toBeHidden();
  expect(await editorText(page)).toBe(original);
  // Dropping outside the canvas cancels as well.
  await dragTo(page, shape(page, 'n_1'), shape(page, 'n_2'));
  await page.mouse.move(2, 2); await page.mouse.up();
  expect(await editorText(page)).toBe(original);
});

test('moves between generated boards from the picker and restores a disappeared board on undo', async ({ page }) => {
  await createMap(page, initial, '1');
  await openFromBadge(page, 'Open Launch board'); await board(page, 'root.layers.Launch');
  const original = await editorText(page);
  await shape(page, 'n_1', 'root.layers.Launch').click();
  await page.getByRole('button', { name: 'Move branch…', exact: true }).click();
  await panel(page).getByLabel('New parent topic').selectOption('n_2');
  await panel(page).getByRole('button', { name: 'Move branch', exact: true }).click(); await previewReady(page);
  await board(page, 'root.layers.Research');
  await focusedShape(shape(page, 'n_2', 'root.layers.Research'));
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await board(page, 'root.layers.Launch');
  expect(await editorText(page)).toBe(original);
  await focusedShape(shape(page, 'n_1', 'root.layers.Launch'));
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  await board(page, 'root.layers.Research');
});

test('drags on a nested connected layer while its attached board stays on the moved subtree', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check(); await previewReady(page);
  const map = 'root.layers.Plan the launch';
  const original = await editorText(page);
  // Product (n_3) contains Onboarding, which opens an independently editable flow.
  await dragTo(page, shape(page, 'n_3', map), shape(page, 'n_2', map));
  await page.mouse.up(); await previewReady(page);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
  expect(await editorText(page)).toContain('n_2_3_2.link: layers."Onboarding"');
  await expect(shape(page, 'n_2_3', map)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
});

test('drags from a generated detail board to a parent on another visible layer', async ({ page }) => {
  await createMap(page, initial, '1');
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check(); await previewReady(page);
  const original = await editorText(page);
  await dragTo(page, shape(page, 'n_1', 'root.layers.Launch'), shape(page, 'n_2'));
  await expect(shape(page, 'n_2')).toHaveClass(/zf-branch-target/);
  await page.mouse.up(); await previewReady(page);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
  await focusedShape(shape(page, 'n_2', 'root.layers.Research'));
  await expect(shape(page, 'n_1', 'root.layers.Research.layers.Interviews')).toContainText('Notes');
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await focusedShape(shape(page, 'n_1', 'root.layers.Launch'));
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
});

test('drops stale pickers when source changes and keeps move controls inside a phone viewport', async ({ page }) => {
  await createMap(page);
  await shape(page, 'n_1_1').click();
  await page.getByRole('button', { name: 'Move branch…', exact: true }).click();
  await source(page).fill('custom: Changed diagram'); await previewReady(page);
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Move branch…', exact: true })).toBeHidden();
  await createMap(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await shape(page, 'n_1_1').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  const bounds = (await panel(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test.describe('touch branches', () => {
  test.use({ hasTouch: true });
  test('holds then drags a branch, while ordinary touch dragging still pans', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Trusted touch sequences use Chromium CDP; picker and mouse gestures run in every engine.');
    await createMap(page, 'Plan\n  Launch\n  Research');
    const from = (await shape(page, 'n_1').boundingBox())!;
    const to = (await shape(page, 'n_2').boundingBox())!;
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(page.locator('.branch-drag-hint')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await previewReady(page);
    expect(await outline(page)).toBe('Plan\n  Research\n    Launch');
    const before = await editorText(page);
    const topic = (await shape(page, 'n_1').boundingBox())!;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: topic.x + topic.width / 2, y: topic.y + topic.height / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: topic.x + topic.width / 2 + 30, y: topic.y + topic.height / 2 }] });
    await expect(page.locator('.zf-stage')).toHaveClass(/zf-panning/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.branch-drag-hint')).toBeHidden();
    expect(await editorText(page)).toBe(before);
  });
});
