import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFolder, previewReady, source, withEditorView } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Check project', exact: true });
const issues = (page: Page, path: string) => dialog(page).getByRole('list', { name: `Issues in ${path}`, exact: true });
let temporary: string;
test.beforeEach(async ({ page }) => {
  temporary = mkdtempSync(join(tmpdir(), 'zoomflow-project-check-'));
  const folder = join(temporary, 'atlas');
  mkdirSync(join(folder, 'lib'), { recursive: true });
  const files = {
    'index.d2': 'home: Home {link: "./target.d2#/Before"}',
    'caller.d2': 'other: Other {link: "./target.d2#/Before"}',
    'target.d2': 'layers.After: {step}',
    'lib/shared.d2': 'shared: Shared {link: ../missing.d2}',
    'imported.d2': '# Longer text than the import\n...@lib/shared',
    'broken.d2': 'broken: {',
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Check project', exact: true })).toBeHidden();
  await openFolder(page, folder);
  await previewReady(page);
});
test.afterEach(() => rmSync(temporary, { recursive: true, force: true }));
async function check(page: Page, pane = '#pane-a') {
  await page.locator(pane).getByRole('button', { name: 'Check project', exact: true }).click();
  await expect(dialog(page)).toContainText('Checked 6 files.');
}
async function choose(page: Page, path: string) {
  await page.locator('#example-picker summary').click();
  await page.locator(`.example-option[title="atlas/${path}"]`).click();
}
async function chooseSecond(page: Page, path: string) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.getByRole('region', { name: 'atlas project', exact: true }).getByRole('button', { name: 'atlas', exact: true }).click();
  await page.locator(`.example-option[title="atlas/${path}"]`).click();
  await previewReady(page, 'b');
  await page.locator('#pane-document').click();
}

test('checks unvisited and unlinked files, using fresh target boards, and opens an issue at its source', async ({ page }) => {
  await check(page);
  await expect(issues(page, 'index.d2')).toContainText('Link targets missing board "Before" in "target.d2"');
  await expect(issues(page, 'caller.d2')).toContainText('Link targets missing board "Before" in "target.d2"');
  await expect(issues(page, 'broken.d2')).toContainText('Error:');
  await expect(issues(page, 'imported.d2')).toContainText('lib/shared.d2:1:');
  await expect(issues(page, 'lib/shared.d2')).toContainText('Link targets missing file "missing.d2"');
  await issues(page, 'caller.d2').getByRole('button').click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/caller.d2');
  await expect(source(page)).toBeFocused();
  expect(await withEditorView(page, view => view.state.doc.toString())).toBe('other: Other {link: "./target.d2#/Before"}');
  expect(await withEditorView(page, view => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to))).toBe('other');
  await choose(page, 'index.d2');
  await previewReady(page);
  expect(await withEditorView(page, view => view.state.doc.toString())).toBe('home: Home {link: "./target.d2#/Before"}');
});

test('reports a clean project and follows the active pane when checking a different project', async ({ page }) => {
  const clean = join(temporary, 'clean');
  mkdirSync(clean);
  writeFileSync(join(clean, 'index.d2'), 'a: Clean diagram');
  await page.selectOption('#layout', 'tabs');
  await page.locator('#pane-choose-b').click();
  await page.keyboard.press('Escape');
  await openFolder(page, clean);
  await previewReady(page, 'b');
  await page.locator('#pane-b').getByRole('button', { name: 'Check project', exact: true }).click();
  await expect(dialog(page)).toContainText('Checked 1 file.');
  await expect(dialog(page)).toContainText('0 errors, 0 warnings.');
  await expect(dialog(page).getByRole('list')).toHaveCount(0);
  await page.locator('#missing-backlink-b').evaluate((input: HTMLInputElement) => input.click());
  await expect(dialog(page)).toContainText('Sources or check options changed.');
  await dialog(page).getByRole('button', { name: 'Check again' }).click();
  await expect(dialog(page)).toContainText('Checked 1 file.');
  await page.keyboard.press('Escape');
  await check(page);
  await expect(issues(page, 'caller.d2')).toContainText('missing board "Before"');
});

test('opens compiler errors and imported locations in the file that owns the range', async ({ page }) => {
  await check(page);
  await issues(page, 'broken.d2').getByRole('button').first().click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/broken.d2');
  await expect(source(page)).toBeFocused();
  await expect(page.locator('#compile-error')).toBeVisible();
  // Check remains available even while the active file does not compile.
  await check(page);
  await issues(page, 'imported.d2').getByRole('button').click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/lib/shared.d2');
  await expect(source(page)).toBeFocused();
  expect(await withEditorView(page, view => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to))).toBe('shared');
});

test('uses unsaved target edits after leaving the file and does not trust its earlier board names', async ({ page }) => {
  await choose(page, 'target.d2');
  await previewReady(page);
  await source(page).fill('layers.Before: {step}');
  await choose(page, 'index.d2');
  await previewReady(page);
  await check(page);
  await expect(issues(page, 'index.d2')).toHaveCount(0);
  await expect(issues(page, 'caller.d2')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Close project check' }).click();
  await choose(page, 'target.d2');
  await source(page).fill('layers.Renamed: {step}');
  await choose(page, 'index.d2');
  await previewReady(page);
  await check(page);
  await expect(issues(page, 'index.d2')).toContainText('missing board "Before"');
  await expect(issues(page, 'caller.d2')).toContainText('missing board "Before"');
});

test('invalidates completed results after another pane edits, then activates its existing source editor', async ({ page }) => {
  await chooseSecond(page, 'lib/shared.d2');
  await check(page);
  await page.locator('#editor-b').evaluate(element => {
    const view = (element.querySelector('.cm-content') as any).cmTile.root.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'shared: Changed {link: ../other-missing.d2}' } });
  });
  await expect(dialog(page)).toContainText('Sources or check options changed.');
  await expect(dialog(page).getByRole('list')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Check again' }).click();
  await expect(dialog(page)).toContainText('Checked 6 files.');
  await expect(issues(page, 'imported.d2')).toContainText('other-missing.d2');
  await issues(page, 'imported.d2').getByRole('button').click();
  await expect(page.locator('#pane-b')).toHaveAttribute('data-active', '');
  await expect(page.locator('#editor-b .cm-content')).toBeFocused();
  await expect(page.locator('#pane-document')).toContainText('index.d2');
  expect(await page.locator('#editor-b').evaluate(element => {
    const view = (element.querySelector('.cm-content') as any).cmTile.root.view;
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  })).toBe('shared');
});

test('fits narrow dark screens, restores focus on Escape and keeps shortcuts inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await check(page);
  await expect(dialog(page)).toBeInViewport({ ratio: 1 });
  const hash = await page.evaluate(() => location.hash);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await page.keyboard.press('ControlOrMeta+s');
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Check project', exact: true })).toBeFocused();
  await check(page);
  await issues(page, 'imported.d2').getByRole('button').click();
  await expect(source(page)).toBeFocused();
  await expect(source(page)).toBeVisible();
});
