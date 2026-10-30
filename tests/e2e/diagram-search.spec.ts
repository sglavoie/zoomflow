import { expect, test, type Page } from '@playwright/test';
import { board, chooseExample, editorText, insideStage, openFolder, previewReady, projectFolder, source, withEditorView } from './helpers';

const diagram = `home: Home
layers: {
  Payments: {
    same: Refund approval
    layers: {
      Refunds: {
        same: Refund approval
        same.link: _.layers.Other
      }
      Other: {other: Another board}
    }
  }
}`;
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Find in diagram', exact: true });
const query = (page: Page) => dialog(page).getByRole('searchbox');
const matches = (page: Page) => dialog(page).getByRole('list', { name: 'Search results' }).getByRole('button');
const shape = (page: Page, id: string) => page.locator(`.zf-stage [data-shape-id="${id}"]`);

async function start(page: Page, text = diagram) {
  await page.goto('/'); await previewReady(page);
  if (!await source(page).isVisible()) await page.locator('#mobile-source').click();
  await source(page).fill(text);
  await expect.poll(() => editorText(page)).toBe(text);
  await previewReady(page);
  if (await page.locator('#mobile-preview').isVisible()) await page.locator('#mobile-preview').click();
}
async function find(page: Page, text: string) {
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await query(page).fill(text);
}

test('finds a nested shape by label, frames it and preserves its board ancestry without following its link', async ({ page }) => {
  await start(page);
  await find(page, '  REFUND APPROVAL  ');
  await expect(matches(page)).toHaveCount(2);
  await expect(matches(page)).toHaveText([
    'Refund approvalShape · Root › Payments',
    'Refund approvalShape · Root › Payments › Refunds',
  ]);
  await matches(page).nth(1).click();
  await expect(dialog(page)).toBeHidden();
  await board(page, 'root.layers.Payments.layers.Refunds');
  await expect(shape(page, 'same')).toHaveClass(/zf-source-selected/);
  await expect(shape(page, 'same').locator('..')).toBeFocused();
  await expect(page.locator('.zf-breadcrumbs')).toContainText('Payments');
  await expect(page.locator('.zf-breadcrumbs')).toContainText('Refunds');
  await expect(shape(page, 'same')).toBeInViewport();
  expect(await withEditorView(page, view => {
    const { from, to } = view.state.selection.main;
    return view.state.doc.sliceString(from, to) as string;
  })).toBe('same');
  // Escape after the jump goes to the actual parent, rather than back to the search origin.
  await page.keyboard.press('Escape');
  await board(page, 'root.layers.Payments');
});

test('opens board matches from the keyboard and closes search without navigating or changing source', async ({ page }) => {
  await start(page);
  const before = await editorText(page);
  await source(page).press('ControlOrMeta+Shift+f');
  await expect(query(page)).toBeFocused();
  await query(page).fill('Refunds');
  await expect(matches(page)).toHaveText(['RefundsBoard · Root › Payments › Refunds']);
  await query(page).press('Enter');
  await board(page, 'root.layers.Payments.layers.Refunds');
  await expect(page.locator('.zf-stage')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await query(page).fill('approval');
  await query(page).press('ArrowDown');
  await expect(matches(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(matches(page).last()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(matches(page).first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(query(page)).toBeFocused();
  await query(page).press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Find in diagram', exact: true })).toBeFocused();
  await board(page, 'root.layers.Payments.layers.Refunds');
  expect(await editorText(page)).toBe(before);
  // The existing editor find remains independent of diagram search.
  await source(page).press('ControlOrMeta+f');
  await expect(page.locator('.cm-search')).toBeVisible();
  await expect(dialog(page)).toBeHidden();
});

test('handles empty and missing queries, keeps text literal, and isolates workspace save', async ({ page }) => {
  await start(page, 'x: "Café <img src=x onerror=alert(1)>"');
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Type to find a board or shape.');
  await expect(matches(page)).toHaveCount(0);
  await query(page).fill('nothing like this');
  await expect(dialog(page).getByRole('status')).toHaveText('No matches.');
  await query(page).press('Enter');
  await expect(dialog(page)).toBeVisible();
  await query(page).fill('CAFÉ <');
  await expect(matches(page)).toHaveCount(1);
  await expect(matches(page)).toContainText('Café <img src=x onerror=alert(1)>');
  await expect(dialog(page).locator('img')).toHaveCount(0);
  await query(page).press('ControlOrMeta+s');
  await expect(dialog(page)).toBeVisible();
  await query(page).press('ArrowDown');
  await page.keyboard.press('Backspace');
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close diagram search' }).click();
});

test('updates results with the preview, retains the last good index on errors and clears it on document switch', async ({ page }) => {
  await start(page);
  await source(page).fill('fresh: Newly added topic');
  await expect(page.locator('.zf-stage')).toContainText('Newly added topic');
  await previewReady(page);
  await find(page, 'approval');
  await expect(matches(page)).toHaveCount(0);
  await query(page).fill('newly');
  await expect(matches(page)).toHaveCount(1);
  await query(page).press('Escape');
  await source(page).fill('broken: {');
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'error');
  await find(page, 'newly');
  await expect(matches(page)).toHaveCount(1);
  await matches(page).first().click();
  await expect(shape(page, 'fresh')).toHaveClass(/zf-source-selected/);
  await chooseExample(page, /^Service architecture/);
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await expect(query(page)).toHaveValue('');
  await query(page).fill('newly');
  await expect(matches(page)).toHaveCount(0);
  await query(page).press('Escape');
  await page.locator('#file').setInputFiles({ name: 'invalid.d2', mimeType: 'text/plain', buffer: Buffer.from('invalid: {') });
  await expect(page.locator('#filename')).toHaveText('invalid.d2');
  await expect(page.locator('.diagram-search-trigger')).toBeDisabled();
});

test('finds imported shapes without selecting a different source file', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await openFolder(page, projectFolder);
  await previewReady(page);
  // The shared fixture imports this shape from lib/nodes.d2.
  const before = await editorText(page);
  await find(page, '');
  await query(page).fill('From a local import');
  await matches(page).filter({ hasText: 'Shape · Root' }).first().click();
  await expect(shape(page, 'Imported')).toHaveClass(/zf-source-selected/);
  expect(await editorText(page)).toBe(before);
});

test('works on a narrow screen in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await start(page);
  await find(page, 'approval');
  await expect(dialog(page)).toBeInViewport({ ratio: 1 });
  await expect(matches(page).last()).toBeInViewport();
  await matches(page).last().click();
  await board(page, 'root.layers.Payments.layers.Refunds');
  await expect(page.locator('#pane-a')).toHaveAttribute('data-view', 'preview');
  await expect(shape(page, 'same')).toBeInViewport();
});

test('frames a match on a zoomed board without changing its source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const before = await editorText(page);
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  for (let i = 0; i < 6; i++) await zoom.click();
  await find(page, 'Receipt');
  await matches(page).filter({ hasText: 'Shape · Root' }).first().click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  await expect(shape(page, 'Receipt')).toHaveClass(/zf-source-selected/);
  expect(await editorText(page)).toBe(before);
});

test('search follows the active split pane and hidden panes release their shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await start(page);
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.locator('.example-option').filter({ hasText: 'Flowchart basics' }).click();
  await previewReady(page, 'b');
  const secondSource = page.getByRole('textbox', { name: 'D2 source, second diagram', exact: true });
  await secondSource.fill('second: Separate root\nlayers.Target: {found: Unique second topic}');
  await expect(page.locator('#viewer-b')).toContainText('Separate root');
  await previewReady(page, 'b');
  const hash = await page.evaluate(() => location.hash);
  await secondSource.press('ControlOrMeta+Shift+f');
  await query(page).fill('unique second');
  await expect(matches(page)).toHaveCount(1);
  await matches(page).first().click();
  await expect(page.locator('#viewer-b .zf-stage')).toHaveAttribute('data-board', 'root.layers.Target');
  await expect(page.locator('#viewer-b [data-shape-id="found"]')).toHaveClass(/zf-source-selected/);
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  // Both panes and the existing filename filter must have unique element IDs.
  expect(await page.locator('[id]').evaluateAll(nodes => {
    const ids = nodes.map(node => node.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  })).toEqual([]);
  await page.selectOption('#layout', 'single');
  await source(page).press('ControlOrMeta+Shift+f');
  await expect(page.locator('#diagram-find-dialog')).toBeVisible();
  await expect(page.locator('#diagram-find-dialog-b')).not.toHaveAttribute('open', '');
  await query(page).fill('approval');
  await expect(matches(page)).toHaveCount(2);
});
