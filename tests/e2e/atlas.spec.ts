import { selectMenuOption } from './menu';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFolder, previewReady } from './helpers';
import { atlas, openFolderMessage, showing, crumbs, shapeMenu, showingProjectFile } from './atlas-helpers';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('file links open other files at their boards, with breadcrumbs across files', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  // A folder opens at its home board, index.d2.
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').focus();
  await page.keyboard.press('Enter');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['index', 'work/index']);

  // The fragment opens the linked file's board.
  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  expect(await page.evaluate(() => location.hash)).toBe('#/Viewer');
  await expect(crumbs(page)).toHaveText(['index', '…', 'work/index', 'projects/zoomflow', 'Viewer']);

  // Escape climbs this file's boards, then returns to the file that opened it.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2');
  // Going up focuses the link back down, whose preview card the next Escape would only dismiss.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['index', 'work/index']);

  // An earlier file's crumb reopens it.
  await crumbs(page).filter({ hasText: /^index$/ }).click();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
});

test('file and atlas map links open filenames containing hash characters', async ({ page }) => {
  const temporary = mkdtempSync(join(tmpdir(), 'zoomflow-hash-links-'));
  const folder = join(temporary, 'atlas');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.d2'), 'Guide: {link: "./C# guide.d2#/Notes"}\n');
  writeFileSync(join(folder, 'C# guide.d2'), 'Home\nlayers: {Notes: {Details}}\n');
  try {
    await page.goto('/');
    await openFolder(page, folder);
    await showing(page, 'index.d2');
    await page.locator('#viewer .zf-stage a[data-file="./C# guide.d2#/Notes"]').click();
    await showing(page, 'C# guide.d2', 'root.layers.Notes');
    await crumbs(page).filter({ hasText: /^index$/ }).click();
    await showing(page, 'index.d2');

    await page.locator('#example-picker > summary').click();
    await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
    await expect(page.locator('#filename')).toHaveText('Atlas map');
    await previewReady(page);
    await page.locator('#viewer .zf-stage a[data-file="./C# guide.d2"]').click();
    await showing(page, 'C# guide.d2');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('browser Back and Forward move across files in the first pane', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await page.locator('#viewer .zf-stage a[data-board="root.layers.Sleep"]').click();
  await showing(page, 'health.d2', 'root.layers.Sleep');
  await expect(crumbs(page)).toHaveText(['index', 'health', 'Sleep']);

  await page.goBack();
  await showing(page, 'health.d2');
  await page.goBack();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
  await page.goForward();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);
  await page.goForward();
  await showing(page, 'health.d2', 'root.layers.Sleep');
  await expect(crumbs(page)).toHaveText(['index', 'health', 'Sleep']);
});

test('review F1 picker trail reset survives reload and history', async ({ page }) => {
  /** At a file's root board, Escape and Backspace have no file to return to. */
  async function rootStays(path: string) {
    for (const key of ['Escape', 'Backspace']) {
      await page.locator('#viewer .zf-stage').focus();
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
      await showing(page, path);
      await expect(crumbs(page)).toHaveText([path.replace(/\.d2$/, '')]);
    }
  }
  const savedFiles = () => page.evaluate(() => history.state?.zoomflowFiles);

  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);

  // Choosing another file from the menu starts a new way through files, in history as on screen.
  await page.locator('#example-picker > summary').click();
  await page.locator('.example-option[title="atlas/work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  expect(await savedFiles()).toEqual([]);

  await page.reload();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');

  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  await expect(crumbs(page)).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  await page.goBack();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await page.goBack();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
  await page.goForward();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  expect(await savedFiles()).toEqual([]);
  await page.reload();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');

  await page.goForward();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  await expect(crumbs(page)).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  // The way through files from here leads back to work/index, not to the file chosen away from.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2');
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');
});

test('a link to a missing file says so, and lint reports broken file links', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="atlas/broken/links.d2"]').click();
  await showing(page, 'broken/links.d2');
  await expect(page.locator('#lint-summary')).toHaveText('1 lint error, 1 warning');

  const missing = page.locator('#viewer .zf-stage a[data-file="./missing.d2"]');
  await expect(missing).toHaveAttribute('data-missing', '');
  await missing.hover();
  await expect(page.locator('.link-preview')).toContainText('Missing file: broken/missing');
  await missing.click();
  await expect(page.locator('#viewer .zf-message')).toContainText('Missing file: broken/missing');

  // A missing board opens the file's nearest existing board.
  await page.locator('#viewer .zf-stage a[data-file="../index.d2#/Gone"]').click();
  await showing(page, 'index.d2');
  await expect(page.locator('#viewer .zf-message')).toContainText('Board "Gone" not found; showing Root');
});

test('hovering a file link previews the board it opens', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').hover();
  const card = page.locator('.link-preview');
  await expect(card).toContainText('projects/zoomflow · Viewer');
  await expect(card).toContainText('2 shapes');
  await expect(card.locator('img')).toBeVisible();
});

test('linked-board previews and the link editor normalize authored routes like navigation', async ({ page }) => {
  const folder = join(mkdtempSync(join(tmpdir(), 'zoomflow-routes-')), 'routes');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.d2'), 'Percent\nAt\nSlash\n\n# Boards that open from shapes on this board.\nPercent.link: "./target.d2#/50%"\nAt.link: "./target.d2#/@home"\nSlash.link: "./target.d2#/Plan/"\n');
  writeFileSync(join(folder, 'target.d2'), 'Home\nlayers: {"50%": {One; Two}; "@home": {One; Two}; Plan: {One; Two}}\n');
  await page.goto('/');
  await openFolder(page, folder);
  await showingProjectFile(page, 'routes', 'index.d2');
  for (const [shape, authored, compiled, label] of [
    ['Percent', '#/50%', '#/50%25', '50%'], ['At', '#/@home', '#/%40home', '@home'], ['Slash', '#/Plan/', '#/Plan', 'Plan'],
  ]) {
    await page.locator(`#viewer .zf-stage a[data-file="./target.d2${authored}"]`).hover();
    const card = page.locator('.link-preview');
    await expect(card).toContainText(`target · ${label}`);
    await expect(card).toContainText('2 shapes');
    await expect(card.locator('img')).toBeVisible();
    await (await shapeMenu(page, shape, shape)).getByRole('menuitem', { name: 'Change linked diagram…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change linked diagram' });
    await expect(dialog.getByLabel('Opens at')).toBeEnabled();
    await expect(dialog.getByLabel('Opens at')).toHaveValue(compiled);
    await expect(dialog.getByLabel('Opens at').locator('option')).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('a file link in a single opened file asks for its folder', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await page.locator('#file').setInputFiles(`${atlas}/index.d2`);
  await expect(page.locator('#filename')).toHaveText('index.d2');
  await previewReady(page);
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await expect(page.locator('#viewer .zf-message')).toContainText(openFolderMessage);
  await expect(page.locator('#filename')).toHaveText('index.d2');
});

test('the second pane follows file links on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await selectMenuOption(page, '#layout', 'tabs');
  await page.locator('#pane-choose-b').click();
  const project = page.locator('#draft-options .project-toggle');
  // The menu folds projects the target pane is not showing once it opens.
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await project.click();
  await page.locator('#draft-options .example-option[title="atlas/work/index.d2"]').click();
  await showing(page, 'work/index.d2', 'root', 'b');

  await page.locator('#viewer-b .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer', 'b');
  await expect(crumbs(page, '#viewer-b')).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  // The second pane keeps its way through files in memory; the first pane and the page URL stay put.
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
  expect(await page.evaluate(() => location.hash)).toBe('#/');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer-b .zf-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2', 'root', 'b');
  await page.locator('#viewer-b .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2', 'root', 'b');
  await expect(crumbs(page, '#viewer-b')).toHaveText(['work/index']);
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
});

test('a file link written in an imported file opens from the folder of the file that wrote it', async ({ page }) => {
  const folder = join(mkdtempSync(join(tmpdir(), 'zoomflow-imports-')), 'nested');
  mkdirSync(join(folder, 'sub'), { recursive: true });
  writeFileSync(join(folder, 'index.d2'), '...@sub/part\n');
  writeFileSync(join(folder, 'sub/part.d2'), 'Go: { link: ./other.d2 }\n');
  writeFileSync(join(folder, 'sub/other.d2'), 'Arrived\n');
  await page.goto('/');
  await openFolder(page, folder);
  await showingProjectFile(page, 'nested', 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./sub/other.d2"]').click();
  await showingProjectFile(page, 'nested', 'sub/other.d2');
  await expect(crumbs(page)).toHaveText(['index', 'sub/other']);
});
