import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { board, chooseExample, editorText, previewReady, source, openBoards, openShapeActions, closeBoards } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });
const shape = (page: Page, id: string, board = 'root') => page.locator(`.zf-stage [data-shape-board="${board}"][data-shape-id="${id}"]`);
const panel = (page: Page) => page.locator('.canvas-branches');
const arrows = (page: Page) => page.locator('.zf-stage [data-connection-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-connection-id')));
async function focused(node: Locator) {
  await expect.poll(() => node.evaluate(element => (element.closest('a') ?? element) === document.activeElement)).toBe(true);
}
async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
}
async function custom(page: Page, text: string) {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(text); await previewReady(page);
}

test('drags builder flow branches while keeping outgoing arrows, attached boards and the flow form editable', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/);
  const original = await editorText(page);
  await dragTo(page, shape(page, 'step_4'), shape(page, 'step_1'));
  await expect(shape(page, 'step_1')).toHaveClass(/zf-branch-target/);
  await page.mouse.up(); await previewReady(page);
  const changed = await editorText(page);
  expect(changed).toContain('step_1 -> step_4: "Yes" {class: zf-yes}');
  expect(changed).toContain('step_4 -> step_5: ""');
  expect(changed).toContain('step_4.link: layers."Build and test"');
  await focused(shape(page, 'step_4'));
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  expect(await editorText(page)).toBe(changed);
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit flow' }).getByLabel('Connection 3 from', { exact: true })).toHaveValue('step_1');
});

test('reparents a custom D2 node with its detail board, saves it, and restores the exact source with undo', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles('fixtures/order.d2'); await previewReady(page);
  const original = await editorText(page);
  await dragTo(page, shape(page, 'Checkout'), shape(page, 'Docs'));
  await page.mouse.up(); await previewReady(page); await board(page, 'root');
  const changed = await editorText(page);
  expect(changed.startsWith(original)).toBe(true);
  expect(await arrows(page)).toEqual(expect.arrayContaining(['(Docs -> Checkout)[0]', '(Checkout -> Receipt)[0]']));
  expect(await arrows(page)).not.toContain('(Browse -> Checkout)[0]');
  await focused(shape(page, 'Checkout'));
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+s');
  const saved = await download;
  expect(await readFile(await saved.path(), 'utf8')).toBe(changed);
  await source(page).fill('temporary: Other diagram'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: saved.suggestedFilename(), mimeType: 'text/plain', buffer: await readFile(await saved.path()) }); await previewReady(page);
  expect(await arrows(page)).toContain('(Docs -> Checkout)[0]');
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).locator('.appendix-icon').click();
  await board(page, 'root.layers.checkout');
  await expect(shape(page, 'Cart', 'root.layers.checkout')).toBeVisible();
});

test('moves merges from the keyboard picker, preserves labels and styles, and rejects cyclic drops', async ({ page }) => {
  const original = '# Custom flow\na -> child: Yes {style.stroke: purple}\nc -> child: Also\nchild -> leaf\nleaf -> child: Retry\nb';
  await custom(page, original);
  await shape(page, 'child').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  const destination = panel(page).getByLabel('New parent node');
  await expect(destination).toBeFocused();
  await expect(destination.locator('option')).toHaveText(['a', 'c', 'b']);
  await destination.selectOption('b'); await destination.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Move branch', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await previewReady(page);
  expect(await arrows(page)).toEqual(expect.arrayContaining(['(b -> child)[0]', '(b -> child)[1]', '(child -> leaf)[0]', '(leaf -> child)[0]']));
  const changed = await editorText(page);
  expect(changed).toContain('style.stroke: "purple"');
  await dragTo(page, shape(page, 'child'), shape(page, 'leaf'));
  await expect(page.locator('.zf-branch-target')).toHaveCount(0);
  await page.mouse.up();
  expect(await editorText(page)).toBe(changed);
  await shape(page, 'child').click();
  await openShapeActions(page);
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  expect(await editorText(page)).toBe(changed);
});

test('edits the right custom board on a connected canvas and rejects drops onto another board', async ({ page }) => {
  const original = 'a -> child\nb\nlayers: {detail: {a -> child -> leaf; b}}';
  await custom(page, original);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check(); await previewReady(page);
  await closeBoards(page);
  const nested = 'root.layers.detail';
  await dragTo(page, shape(page, 'child', nested), shape(page, 'b'));
  await page.mouse.up();
  expect(await editorText(page)).toBe(original);
  await dragTo(page, shape(page, 'child', nested), shape(page, 'b', nested));
  await page.mouse.up(); await previewReady(page);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-layer-root', 'root');
  const connections = await page.locator('.zf-stage [data-connection-id]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('data-connection-board'), node.getAttribute('data-connection-id')]));
  expect(connections).toContainEqual(['root', '(a -> child)[0]']);
  expect(connections).toContainEqual([nested, '(b -> child)[0]']);
  expect(connections).not.toContainEqual([nested, '(a -> child)[0]']);
  await focused(shape(page, 'child', nested));
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
});

test('invalidates custom parent pickers on source changes', async ({ page }) => {
  await custom(page, 'a -> child\nb');
  await shape(page, 'child').click();
  await openShapeActions(page);
  await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).click();
  await source(page).fill('x -> y'); await previewReady(page);
  await expect(panel(page)).toBeHidden();
  expect(await editorText(page)).toBe('x -> y');
});

test.describe('touch graph branches', () => {
  test.use({ hasTouch: true });
  test('keeps a tapped custom node on the phone canvas and offers a usable parent picker', async ({ page }) => {
    await custom(page, 'a -> child -> leaf\nb');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-preview').tap();
    await shape(page, 'child').tap();
    await expect(page.locator('#mobile-preview')).toHaveAttribute('aria-pressed', 'true');
    await openShapeActions(page);
    await page.getByRole('menuitem', { name: 'Move branch…', exact: true }).tap();
    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await panel(page).getByLabel('New parent node').selectOption('b');
    await panel(page).getByRole('button', { name: 'Move branch', exact: true }).tap(); await previewReady(page);
    expect(await arrows(page)).toContain('(b -> child)[0]');
    await focused(shape(page, 'child'));
  });
  test('holds then drags a custom D2 node with real touch input', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Trusted touch sequences use Chromium CDP; picker and mouse gestures run in every engine.');
    await custom(page, 'a -> child -> leaf\nb');
    const a = (await shape(page, 'child').boundingBox())!;
    const b = (await shape(page, 'b').boundingBox())!;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }] });
    await expect(page.locator('.branch-drag-hint')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await previewReady(page);
    expect(await arrows(page)).toEqual(expect.arrayContaining(['(b -> child)[0]', '(child -> leaf)[0]']));
  });
});
