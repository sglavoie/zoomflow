import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { chooseExample, editorText, openFolder, previewReady, source, openBoards, closeBoards } from './helpers';
import { downloadExport, openDownloads, selectMenuOption } from './menu';

test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const diagram = `Public: Keep root
Secret: Private root
Branch: Branch {link: layers.Detail}
layers: {
  Detail: {
    Public: Keep detail
    Secret: Private detail
    Deep: Deep {link: layers.Deep}
    layers: { Deep: { Leaf: Deep leaf } }
  }
  Other: { Public: Keep other }
}
`;
const hidden = (page: Page, board = 'root') => page.locator(`#viewer [data-shape-board="${board}"][data-shape-id="Secret"]`);
async function load(page: Page) {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(diagram); await previewReady(page);
}
async function toggle(page: Page, board = 'root') {
  await hidden(page, board).focus(); await page.keyboard.press('h');
  await expect(hidden(page, board)).toHaveAttribute('data-export-hidden', '');
}
async function saved(page: Page) {
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
}

test('reload preserves curation and exports the same connected diagram; reset restores every board', async ({ page }, info) => {
  await load(page);
  const depth = page.getByRole('spinbutton', { name: 'Layer depth', exact: true, includeHidden: true });
  await openBoards(page);
  await depth.fill('1'); await depth.press('Enter');
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await toggle(page);
  await toggle(page, 'root.layers.Detail');
  await saved(page);
  for (const round of ['before', 'after']) {
    if (round === 'after') {
      await page.reload(); await previewReady(page);
      await expect(depth).toHaveValue('1');
      await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
      await expect(hidden(page)).toHaveAttribute('data-export-hidden', '');
      await expect(hidden(page, 'root.layers.Detail')).toHaveAttribute('data-export-hidden', '');
      expect(await editorText(page)).toBe(diagram);
    }
    await selectMenuOption(page, '#export-format', 'svg');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const path = info.outputPath(`${round}.svg`);
    await (await pending).saveAs(path);
    const svg = await readFile(path, 'utf8');
    for (const label of ['Private root', 'Private detail', 'Deep leaf']) expect(svg).not.toContain(label);
    for (const label of ['Keep root', 'Keep detail', 'Keep other']) expect(svg).toContain(label);
  }
  await openDownloads(page);
  await page.getByRole('button', { name: 'Reset export visibility', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset export visibility', exact: true })).toBeHidden();
  await expect(page.locator('#export')).toBeFocused();
  await expect(page.locator('#viewer [data-export-hidden]')).toHaveCount(0);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await page.reload(); await previewReady(page);
  await expect(page.locator('#viewer [data-export-hidden]')).toHaveCount(0);
  await expect(depth).toHaveValue('1');
});

test('unedited examples retain layer settings across reload and document switches without dirtying source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await openBoards(page);
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await closeBoards(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await expect(page.locator('#document-unsaved')).toBeHidden();
  await saved(page);
  await page.reload(); await previewReady(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { name: 'Show all layers', exact: true, includeHidden: true })).toBeChecked();
  await chooseExample(page, /^Flowchart basics/); await previewReady(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(0);
  await chooseExample(page, /^Order flow/); await previewReady(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await expect(page.locator('#document-unsaved')).toBeHidden();
});

test('an atlas export uses choices made in the other pane and restores unvisited file choices after reload', async ({ page, context }, info) => {
  const folder = info.outputPath('curated-project');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/index.d2`, 'Next: {link: ./other.d2}\nRoot: Keep root\n');
  await writeFile(`${folder}/other.d2`, 'Secret: Private atlas content\nPublic: Keep project content\n');
  await page.goto('/'); await previewReady(page);
  await openFolder(page, folder); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.locator('#draft-options .project-toggle').click();
  await page.locator('.example-option[title="curated-project/other.d2"]').click();
  await previewReady(page, 'b');
  await page.locator('#viewer-b [data-shape-id="Secret"]').focus(); await page.keyboard.press('h');
  await expect(page.locator('#viewer-b [data-shape-id="Secret"]')).toHaveAttribute('data-export-hidden', '');
  await page.locator('#viewer .zf-stage').click({ position: { x: 5, y: 5 } });
  for (const round of ['other-pane', 'reloaded']) {
    if (round === 'reloaded') {
      // Reload with only the entry file open, so the other file is never mounted in this viewer.
      await selectMenuOption(page, '#layout', 'single');
      await page.reload(); await previewReady(page);
    }
    await selectMenuOption(page, '#export-format', 'atlas');
    const pending = page.waitForEvent('download'); await downloadExport(page);
    const path = info.outputPath(`${round}.html`);
    await (await pending).saveAs(path);
    const offline = await context.newPage();
    await offline.goto(`file://${path}`);
    await offline.locator('.zf-stage a[data-file="./other.d2"]').click();
    await expect(offline.locator('.zf-stage')).toContainText('Keep project content');
    await expect(offline.locator('.zf-stage')).not.toContainText('Private atlas content');
    await offline.getByRole('button', { name: 'Find in atlas', exact: true }).click();
    await offline.getByRole('searchbox').fill('Private atlas content');
    await expect(offline.getByRole('option')).toHaveCount(0);
    await offline.close();
  }
});

test('deleted shapes and layers do not block restored curation, and reset clears inactive choices', async ({ page }) => {
  await load(page); await toggle(page);
  await source(page).fill('Public: Keep root\n'); await previewReady(page);
  await saved(page); await page.reload(); await previewReady(page);
  await expect(page.locator('#viewer [data-export-hidden]')).toHaveCount(0);
  await openDownloads(page);
  await page.getByRole('button', { name: 'Reset export visibility', exact: true }).click();
  await page.locator('#header-more-toggle').click();
  await source(page).fill(diagram); await previewReady(page);
  await expect(hidden(page)).not.toHaveAttribute('data-export-hidden', '');
});

test('restoring an example clears curation and undo restores it', async ({ page }) => {
  await load(page);
  await openBoards(page);
  await page.getByRole('spinbutton', { name: 'Layer depth', exact: true }).fill('1');
  await openBoards(page);
  await page.getByRole('spinbutton', { name: 'Layer depth', exact: true }).press('Enter');
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await toggle(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await previewReady(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(0);
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await previewReady(page);
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  await expect(hidden(page)).toHaveAttribute('data-export-hidden', '');
});
