import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { board, chooseExample, editorText, openFromBadge, previewReady, source, openBoards, closeBoards } from './helpers';
import { downloadExport, selectMenuOption } from './menu';

test.use({ viewport: { width: 1440, height: 900 } });
const shape = (page: Page, id: string) => page.locator(`.zf-stage [data-shape-id="${id}"]`);
const edge = (page: Page, index: number) => page.locator(`.zf-stage [data-flow-connection="${index}"]`);
const panel = (page: Page) => page.locator('.canvas-connections');

async function createFlow(page: Page) {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Create a flow' });
  await builder.getByLabel('Flow name').fill('Approval');
  await builder.getByLabel('Step 1 name').fill('Submit request');
  await builder.getByLabel('Step 2 name').fill('Approved?');
  await builder.getByLabel('Step 2 type').selectOption('diamond');
  await builder.getByLabel('Step 3 name').fill('Complete');
  await builder.getByRole('button', { name: 'Create flow', exact: true }).click();
  await previewReady(page);
  await expect(edge(page, 1)).toBeAttached();
}

async function startConnection(page: Page, from: string) {
  await shape(page, from).click();
  await page.getByRole('button', { name: 'Connect to…', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

test('builds Yes/No branches on the canvas, undoes and redoes, then saves and reopens an editable flow', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await createFlow(page);
  // Thin arrows have a larger hit path, which is also a real pointer selection target.
  await edge(page, 1).locator('.zf-connection-hit').click();
  await expect(edge(page, 1)).toBeFocused();
  await panel(page).getByLabel('Connection label').fill('Yes');
  await panel(page).getByRole('button', { name: 'Apply label', exact: true }).click();
  await previewReady(page);
  await expect(edge(page, 1)).toHaveAttribute('aria-label', /Yes$/);
  await expect(edge(page, 1)).toHaveClass(/zf-connection-selected/);
  await panel(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await shape(page, 'step_2').click();
  await page.keyboard.press('ControlOrMeta+Enter'); await previewReady(page);
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).fill('Request changes');
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Enter'); await previewReady(page);
  await edge(page, 2).focus(); await page.keyboard.press('F2');
  await panel(page).getByLabel('Connection label').fill('No');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await expect(edge(page, 2)).not.toHaveAttribute('aria-label', /: No$/);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  await expect(edge(page, 2)).toHaveAttribute('aria-label', /: No$/);
  await edge(page, 2).focus(); await page.keyboard.press(' ');
  await panel(page).getByRole('button', { name: 'Done', exact: true }).click();
  // A target chosen directly on the diagram adds an optional label in the same undo transaction.
  await startConnection(page, 'step_4');
  await panel(page).getByLabel('Connection label').fill('Try again');
  await shape(page, 'step_2').click(); await previewReady(page);
  await expect(edge(page, 3)).toHaveAttribute('aria-label', /Request changes to Approved\?: Try again$/);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await expect(edge(page, 3)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await previewReady(page);
  await expect(edge(page, 3)).toBeVisible();
  await edge(page, 3).focus(); await page.keyboard.press('Delete'); await previewReady(page);
  await expect(edge(page, 3)).toHaveCount(0);
  await expect(shape(page, 'step_4')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  const expected = await editorText(page);
  expect(expected).toContain('step_2 -> step_3: "Yes" {class: zf-yes}');
  expect(expected).toContain('step_2 -> step_4: "No" {class: zf-no}');
  expect(expected).toContain('step_4 -> step_2: "Try again"');
  const download = page.waitForEvent('download');
  await page.locator('.zf-stage').focus(); await page.keyboard.press('ControlOrMeta+s');
  const saved = await download;
  expect(await readFile(await saved.path(), 'utf8')).toBe(expected);
  await source(page).fill('temporary: Another diagram'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: saved.suggestedFilename(), mimeType: 'text/plain', buffer: await readFile(await saved.path()) }); await previewReady(page);
  expect(await editorText(page)).toBe(expected);
  await expect(page.locator('.zf-stage [data-flow-connection]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flow' });
  await expect(edit.getByLabel('Connection 2 label', { exact: true })).toHaveValue('Yes');
  await expect(edit.getByLabel('Connection 3 label', { exact: true })).toHaveValue('No');
  await expect(edit.getByLabel('Connection 4 label', { exact: true })).toHaveValue('Try again');
});

test('chooses destinations from the keyboard and edits the intended parallel arrow or loop', async ({ page }) => {
  await createFlow(page);
  await page.locator('.zf-stage').focus(); await page.keyboard.press('End');
  await expect(edge(page, 1)).toBeFocused();
  await page.keyboard.press('Escape');
  // The same Connect to… action is available through a shape's keyboard menu.
  await shape(page, 'step_2').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Connect to…', exact: true }).click();
  await panel(page).getByLabel('Destination step').selectOption('step_3');
  await panel(page).getByLabel('Connection label').fill('Alternative');
  await panel(page).getByRole('button', { name: 'Add connection', exact: true }).click(); await previewReady(page);
  await expect(edge(page, 2)).toHaveAttribute('data-connection-id', '(step_2 -> step_3)[1]');
  await expect(edge(page, 1)).toHaveAttribute('aria-label', 'Connection 2: Approved? to Complete');
  await edge(page, 2).focus(); await page.keyboard.press('Enter');
  await expect(panel(page).getByLabel('Connection label')).toBeFocused();
  await panel(page).getByLabel('Connection label').fill('No');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await expect(edge(page, 1)).toHaveAttribute('aria-label', 'Connection 2: Approved? to Complete');
  await expect(edge(page, 2)).toHaveAttribute('aria-label', /: No$/);
  await page.keyboard.press('Backspace'); await previewReady(page);
  await expect(page.locator('.zf-stage [data-flow-connection]')).toHaveCount(2);
  await startConnection(page, 'step_2');
  await panel(page).getByLabel('Destination step').selectOption('step_2');
  await panel(page).getByLabel('Connection label').fill('Review again');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await expect(edge(page, 2)).toHaveAttribute('data-connection-id', '(step_2 -> step_2)[0]');
  // Label removal is allowed, and its form never interprets Backspace as board navigation.
  await page.keyboard.press('F2');
  await panel(page).getByLabel('Connection label').fill('');
  await panel(page).getByLabel('Connection label').press('Backspace');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await expect(edge(page, 2)).toHaveAttribute('aria-label', 'Connection 3: Approved? to Approved?');
});

test('cancels without changing source and abandons a connection when source or document changes', async ({ page }) => {
  await createFlow(page);
  const original = await editorText(page);
  await startConnection(page, 'step_1');
  await panel(page).getByLabel('Connection label').fill('Discard');
  await panel(page).getByLabel('Connection label').press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(shape(page, 'step_1')).toBeFocused();
  expect(await editorText(page)).toBe(original);
  await startConnection(page, 'step_1');
  await source(page).fill(`${original}\nstep_1.style.fill: red`); await previewReady(page);
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('.zf-stage [data-flow-connection]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect to…', exact: true })).toBeHidden();
  await source(page).fill(original); await previewReady(page);
  await startConnection(page, 'step_1');
  await chooseExample(page, /^Flows & mind maps/);
  await expect(panel(page)).toBeHidden();
  expect(await editorText(page)).not.toContain('Discard');
});

test('edits connections on the correct nested board of a connected canvas and preserves attached boards', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/);
  const original = await editorText(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
  const nested = page.locator('.zf-stage [data-connection-board="root.layers.Plan the launch.layers.Onboarding"][data-flow-connection="0"]');
  await expect(nested).toBeAttached();
  await nested.focus(); await page.keyboard.press('F2');
  await panel(page).getByLabel('Connection label').fill('Welcome');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await expect(nested).toHaveAttribute('aria-label', /: Welcome$/);
  // Identical step IDs on the main flow stay untouched; the other attached flow and mind map survive too.
  const updated = await editorText(page);
  expect(updated.replace('step_1 -> step_2: "Welcome"', 'step_1 -> step_2: ""')).toBe(original);
  await expect(page.locator('.zf-stage [data-connection-board="root"][data-flow-connection="0"]')).not.toHaveAttribute('aria-label', /Welcome/);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
  // Choosing a step on another board cancels the connection instead of connecting repeated IDs across boards.
  await page.locator('.zf-stage [data-shape-board="root"][data-shape-id="step_1"]').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Connect to…', exact: true }).click();
  await page.locator('.zf-stage [data-shape-board="root.layers.Plan the launch.layers.Onboarding"][data-shape-id="step_1"]').focus();
  await expect(panel(page)).toBeHidden();
  expect(await editorText(page)).toBe(original);
});

test('a repeated Backspace while deleting an arrow stays on its nested board', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/);
  await openFromBadge(page, 'Open Plan the launch board');
  await openFromBadge(page, 'Open Onboarding board');
  const nested = 'root.layers.Plan the launch.layers.Onboarding';
  await board(page, nested);
  const before = await page.locator('.zf-stage [data-flow-connection]').count();
  await edge(page, 0).focus();
  // Dispatch within one task to exercise the redraw boundary independently of compiler speed.
  await page.evaluate(() => {
    for (let press = 0; press < 2; press++) document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace', bubbles: true, cancelable: true,
    }));
  });
  await previewReady(page); await board(page, nested);
  await expect(page.locator('.zf-stage [data-flow-connection]')).toHaveCount(before - 1);
  await expect(shape(page, 'step_1')).toBeAttached();
});

test('keeps connection controls usable on a phone and out of diagram exports', async ({ page }) => {
  await createFlow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await edge(page, 1).focus(); await page.keyboard.press('F2');
  const bounds = (await panel(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await panel(page).getByLabel('Connection label').fill('Yes');
  await panel(page).getByLabel('Connection label').press('Enter'); await previewReady(page);
  await selectMenuOption(page, '#export-format', 'svg');
  const download = page.waitForEvent('download'); await downloadExport(page);
  const svg = await readFile(await (await download).path(), 'utf8');
  expect(svg).toContain('Yes');
  expect(svg).not.toMatch(/zf-connection-hit|zf-connection-selected|canvas-connections/);
});

test.describe('touch connections', () => {
  test.use({ hasTouch: true });
  test('taps an arrow to edit it and creates a connection from the destination list on a phone', async ({ page }) => {
    await createFlow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await edge(page, 1).locator('.zf-connection-hit').tap();
    await expect(panel(page)).toBeVisible();
    await panel(page).getByLabel('Connection label').fill('Yes');
    await panel(page).getByRole('button', { name: 'Apply label', exact: true }).tap(); await previewReady(page);
    await panel(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await shape(page, 'step_3').tap();
    await page.getByRole('button', { name: 'Connect to…', exact: true }).tap();
    await panel(page).getByLabel('Destination step').selectOption('step_1');
    await panel(page).getByRole('button', { name: 'Add connection', exact: true }).tap(); await previewReady(page);
    await expect(edge(page, 2)).toHaveAttribute('aria-label', 'Connection 3: Complete to Submit request');
  });
});
