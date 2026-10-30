import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorText, openFolder, previewReady, source, withEditorView } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Find in project', exact: true });
const query = (page: Page) => dialog(page).getByRole('searchbox');
const matches = (page: Page) => dialog(page).getByRole('list', { name: 'Search results' }).getByRole('button');
const stage = (page: Page, suffix = '') => page.locator(`#viewer${suffix} .zf-stage`);

let temporary: string;
test.beforeEach(async ({ page }) => {
  temporary = mkdtempSync(join(tmpdir(), 'zoomflow-project-search-'));
  const folder = join(temporary, 'atlas');
  mkdirSync(join(folder, 'finance'), { recursive: true });
  mkdirSync(join(folder, 'lib'));
  const files = {
    'index.d2': 'home: Atlas home {link: root.layers.Start}\nlayers.Start: {start: Starting board}',
    'finance/C# refunds.d2': 'home: Finance\nlayers: {Refunds: {step: Refund approval; step.link: _.layers.Other}\nOther: {other: Another board}}',
    'work.d2': 'step: Refund approval',
    'lib/labels.d2': 'shared: Old imported label',
    'imported.d2': '...@lib/labels',
    'broken.d2': 'broken: {',
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);
  await page.goto('/');
  await openFolder(page, folder);
  await previewReady(page);
});
test.afterEach(() => rmSync(temporary, { recursive: true, force: true }));

async function find(page: Page, text: string) {
  await page.locator('#pane-a').getByRole('button', { name: 'Find in project', exact: true }).click();
  await query(page).fill(text);
}
async function settled(page: Page) {
  await expect(dialog(page).getByRole('status').filter({ hasText: 'Searched 6 files.' })).toBeVisible();
}
async function chooseSecond(page: Page, path: string) {
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.getByRole('region', { name: 'atlas project', exact: true }).getByRole('button', { name: 'atlas', exact: true }).click();
  await page.locator(`.example-option[title="atlas/${path}"]`).click();
  await previewReady(page, 'b');
  await page.locator('#pane-document').click();
}

test('finds a shape in an unvisited, unlinked file, frames it and returns through browser history', async ({ page }) => {
  await stage(page).locator('a[data-board="root.layers.Start"]').click();
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Start');
  await source(page).press('ControlOrMeta+Shift+f');
  await expect(query(page)).toBeFocused();
  await query(page).fill('  REFUND APPROVAL  ');
  await expect(matches(page)).toHaveCount(2);
  await settled(page);
  await expect(matches(page).first()).toHaveText('Refund approvalShape · finance/C# refunds.d2 · Root › Refunds');
  await query(page).press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/finance/C# refunds.d2');
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Refunds');
  await previewReady(page);
  const shape = stage(page).locator('[data-shape-id="step"]');
  await expect(shape).toHaveClass(/zf-source-selected/);
  await expect(shape).toBeInViewport();
  await expect(shape.locator('..')).toBeFocused();
  expect(await withEditorView(page, view => view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to))).toBe('step');
  await expect(page.locator('.zf-breadcrumbs')).toContainText('index');
  await page.goBack();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/index.d2');
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Start');
  await previewReady(page);
  await page.goForward();
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Refunds');
  await previewReady(page);
  await stage(page).focus();
  await page.keyboard.press('Escape');
  await expect(stage(page)).toHaveAttribute('data-board', 'root');
  await stage(page).focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/index.d2');
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Start');
});

test('reports broken files, keeps other results usable and remains available when the current file has errors', async ({ page }) => {
  await source(page).fill('invalid: {');
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'error');
  const before = await editorText(page);
  await find(page, 'Refunds');
  await settled(page);
  await expect(matches(page)).toHaveText(['RefundsBoard · finance/C# refunds.d2 · Root › Refunds']);
  await expect(dialog(page)).toContainText('Could not search broken.d2:');
  await expect(dialog(page)).toContainText('index.d2:');
  await expect(dialog(page).getByRole('button', { name: 'Retry search' })).toBeVisible();
  await query(page).press('Escape');
  await expect(page.getByRole('button', { name: 'Find in project', exact: true })).toBeFocused();
  expect(await editorText(page)).toBe(before);
  await find(page, 'Refunds');
  await matches(page).first().click();
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Refunds');
  await previewReady(page);
});

test('refreshes labels from unsaved imports, including edits in the other pane while search is open', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await chooseSecond(page, 'lib/labels.d2');
  await find(page, 'Old imported label');
  await settled(page);
  await expect(matches(page)).toHaveCount(2);
  // An edit from another pane invalidates the entire index, including files importing that source.
  await page.locator('#editor-b').evaluate(element => {
    const view = (element.querySelector('.cm-content') as any).cmTile.root.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'shared: Fresh imported label' } });
  });
  await query(page).fill('Fresh imported label');
  await expect(matches(page)).toHaveCount(2);
  await settled(page);
  await expect(matches(page)).toHaveText([
    'Fresh imported labelShape · imported.d2 · Root',
    'Fresh imported labelShape · lib/labels.d2 · Root',
  ]);
  await matches(page).first().click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/imported.d2');
  await expect(stage(page).locator('[data-shape-id="shared"]')).toHaveClass(/zf-source-selected/);
  await expect(stage(page)).toContainText('Fresh imported label');
});

test('activates a result already open in the other pane without duplicating its document', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await chooseSecond(page, 'work.d2');
  const hash = await page.evaluate(() => location.hash);
  await find(page, 'Refund approval');
  await expect(matches(page)).toHaveCount(2);
  await matches(page).filter({ hasText: 'work.d2' }).click();
  await expect(page.locator('#pane-b')).toHaveAttribute('data-active', '');
  await expect(page.locator('#pane-document')).toContainText('index.d2');
  await expect(stage(page, '-b').locator('[data-shape-id="step"]')).toHaveClass(/zf-source-selected/);
  await expect(stage(page, '-b').locator('[data-shape-id="step"]')).toBeFocused();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test('supports narrow dark screens and keeps diagram-only search available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await find(page, 'Refund approval');
  await expect(matches(page)).toHaveCount(2);
  await expect(dialog(page)).toBeInViewport({ ratio: 1 });
  await matches(page).filter({ hasText: 'work.d2' }).click();
  await expect(stage(page)).toContainText('Refund approval');
  await previewReady(page);
  await expect(page.locator('#pane-a')).toHaveAttribute('data-view', 'preview');
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  const local = page.getByRole('dialog', { name: 'Find in diagram', exact: true });
  await local.getByRole('searchbox').fill('Atlas home');
  await expect(local.getByRole('list', { name: 'Search results' }).getByRole('button')).toHaveCount(0);
});

test('searches from the atlas map and returns to it from the result', async ({ page }) => {
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
  await expect(page.locator('#filename')).toHaveText('Atlas map');
  await previewReady(page);
  await find(page, 'Refund approval');
  await expect(matches(page)).toHaveCount(2);
  await matches(page).filter({ hasText: 'work.d2' }).click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/work.d2');
  await previewReady(page);
  await expect(page.locator('.zf-breadcrumbs')).toContainText('Atlas map');
  await stage(page).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#filename')).toHaveText('Atlas map');
  await previewReady(page);
});
