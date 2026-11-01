import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { exportProjectArchive, readProjectArchive } from '../../packages/core/src/project-archive';
import { editorText, openFolder, previewReady, source } from './helpers';
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
    Side: Side {link: layers.Side}
    layers: {
      Deep: { Leaf: Deep leaf }
      Side: { Leaf: Side leaf }
    }
  }
}
`;
async function curate(page: Page, board = 'root') {
  const shape = page.locator(`#viewer [data-shape-board="${board}"][data-shape-id="Secret"]`);
  await shape.focus(); await page.keyboard.press('h');
  await expect(shape).toHaveAttribute('data-export-hidden', '');
}
async function downloadProject(page: Page, info: TestInfo, filename = 'project.zoomflow.zip') {
  await openDownloads(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Zoomflow project', exact: true }).click();
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toMatch(/\.zoomflow\.zip$/);
  const path = info.outputPath(filename);
  await downloaded.saveAs(path);
  await page.locator('#header-more-toggle').click();
  return path;
}
async function openProject(page: Page, path: string) {
  const projects = await page.locator('.project-group').count();
  await page.locator('#example-picker summary').click();
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open Zoomflow project', exact: true }).click();
  await (await pending).setFiles(path);
  await expect(page.locator('.project-group')).toHaveCount(projects + 1);
  await previewReady(page);
}

test('a curated diagram reopens in a fresh browser with editable source, visibility and layer depth intact', async ({ page, browser }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'Launch.d2', mimeType: 'text/plain', buffer: Buffer.from(diagram) });
  await previewReady(page);
  const depth = page.getByRole('spinbutton', { name: 'Layer depth', exact: true });
  await depth.fill('1'); await depth.press('Enter');
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(2);
  await curate(page); await curate(page, 'root.layers.Detail');
  const path = await downloadProject(page, info);
  const backup = readProjectArchive(await readFile(path));
  expect(backup.entry).toBe('Launch.d2');
  expect(backup.files[0].source).toBe(diagram);

  const fresh = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    const restored = await fresh.newPage();
    await restored.goto(page.url().split('#')[0]); await previewReady(restored);
    await openProject(restored, path);
    expect(await editorText(restored)).toBe(diagram);
    await expect(restored.getByRole('spinbutton', { name: 'Layer depth', exact: true })).toHaveValue('1');
    await expect(restored.locator('#viewer [data-layer-board]')).toHaveCount(2);
    await expect(restored.locator('#viewer [data-export-hidden]')).toHaveCount(2);
    await selectMenuOption(restored, '#export-format', 'svg');
    const pending = restored.waitForEvent('download'); await downloadExport(restored);
    const svgPath = info.outputPath('restored.svg'); await (await pending).saveAs(svgPath);
    const svg = await readFile(svgPath, 'utf8');
    expect(svg).toContain('Keep root'); expect(svg).toContain('Keep detail');
    expect(svg).not.toContain('Private root'); expect(svg).not.toContain('Private detail');
    await restored.reload(); await previewReady(restored);
    await expect(restored.locator('#viewer [data-export-hidden]')).toHaveCount(2);
    await expect(restored.getByRole('spinbutton', { name: 'Layer depth', exact: true })).toHaveValue('1');
    await source(restored).fill(`${diagram}\nAdded: Still editable\n`); await previewReady(restored);
    await expect(restored.locator('#viewer .zf-stage')).toContainText('Still editable');
    await expect(restored.locator('#viewer [data-export-hidden]')).toHaveCount(2);
  } finally { await fresh.close(); }
});

test('project backups include imports, unlinked errors and unvisited file curation after reload', async ({ page, browser }, info) => {
  const folder = info.outputPath('Archive atlas');
  await mkdir(`${folder}/nested`, { recursive: true });
  const index = '...@./shared.d2\nNext: {link: ./nested/other.d2}\n';
  const other = '...@../shared.d2\nSecret: Private project\nPublic: Keep project\nBack: {link: ../index.d2}\n';
  await writeFile(`${folder}/index.d2`, index);
  await writeFile(`${folder}/shared.d2`, 'Imported: Shared source\n');
  await writeFile(`${folder}/nested/other.d2`, other);
  await writeFile(`${folder}/unlinked.d2`, 'broken: {\n');
  await page.goto('/'); await previewReady(page);
  await openFolder(page, folder); await previewReady(page);
  await page.locator('#viewer a[data-file="./nested/other.d2"]').click(); await previewReady(page);
  await curate(page);
  const latest = `${other}Extra: Unsaved project edit\n`;
  await source(page).fill(latest); await previewReady(page);
  await page.locator('#viewer a[data-file="../index.d2"]').click(); await previewReady(page);
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
  await page.reload(); await previewReady(page);
  const path = await downloadProject(page, info);
  const backup = readProjectArchive(await readFile(path));
  expect(backup.files.map(file => file.path)).toEqual(['index.d2', 'nested/other.d2', 'shared.d2', 'unlinked.d2']);
  expect(backup.files.find(file => file.path === 'nested/other.d2')?.source).toBe(latest);
  expect(backup.files.find(file => file.path === 'unlinked.d2')?.source).toBe('broken: {\n');
  const fresh = await browser.newContext();
  try {
    const restored = await fresh.newPage();
    await restored.goto(page.url().split('#')[0]); await previewReady(restored);
    await openProject(restored, path);
    await expect(restored.locator('#viewer .zf-stage')).toContainText('Shared source');
    await restored.locator('#viewer a[data-file="./nested/other.d2"]').click(); await previewReady(restored);
    expect(await editorText(restored)).toBe(latest);
    await expect(restored.locator('#viewer [data-shape-id="Secret"]')).toHaveAttribute('data-export-hidden', '');
    await expect(restored.locator('#viewer .zf-stage')).toContainText('Shared source');
    // Preserve the selected entry instead of always reopening index.d2.
    const nestedBackup = await downloadProject(restored, info, 'nested.zoomflow.zip');
    expect(readProjectArchive(await readFile(nestedBackup)).entry).toBe('nested/other.d2');
    await openProject(restored, nestedBackup);
    expect(await editorText(restored)).toBe(latest);
    await expect(restored.locator('#viewer [data-shape-id="Secret"]')).toHaveAttribute('data-export-hidden', '');
    await restored.locator('#example-picker summary').click();
    await expect(restored.getByRole('button', { name: 'Remove Archive atlas project drafts', exact: true })).toHaveCount(2);
  } finally { await fresh.close(); }
});

for (const mode of ['all', 'custom'] as const) test(`restores a nested layer starting board with ${mode} branches`, async ({ page, browser }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'Layers.d2', mimeType: 'text/plain', buffer: Buffer.from(diagram) });
  await previewReady(page);
  await page.locator('#viewer a[data-board="root.layers.Detail"]').click();
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.Detail');
  await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
  await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(3);
  if (mode === 'custom') {
    await page.locator('.board-outline summary').click();
    await page.getByRole('checkbox', { name: 'Show Deep layer', exact: true }).uncheck();
    await expect(page.locator('#viewer [data-layer-board]')).toHaveCount(2);
    await page.keyboard.press('Escape');
  }
  const path = await downloadProject(page, info);
  const fresh = await browser.newContext();
  try {
    const restored = await fresh.newPage();
    await restored.goto(page.url().split('#')[0]); await previewReady(restored);
    await openProject(restored, path);
    await expect(restored.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.Detail');
    await expect(restored.locator('#viewer [data-layer-board]')).toHaveCount(mode === 'all' ? 3 : 2);
    if (mode === 'custom') await expect(restored.getByRole('spinbutton', { name: 'Layer depth', exact: true })).toHaveAttribute('placeholder', 'Custom');
    else await expect(restored.getByRole('checkbox', { name: 'Show all layers', exact: true })).toBeChecked();
  } finally { await fresh.close(); }
});

test('invalid archives leave the current document intact and damaged view metadata still opens its source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.locator('#project-archive').setInputFiles({ name: 'broken.zoomflow.zip', mimeType: 'application/zip', buffer: Buffer.from('not a ZIP') });
  await expect(page.locator('#file-status')).toContainText('Could not read project ZIP');
  expect(await editorText(page)).toBe(original);
  await expect(page.locator('#draft-options .project-group')).toHaveCount(0);
  const bytes = exportProjectArchive({ name: 'Recovered', entry: 'main.d2', files: [{ path: 'main.d2', source: diagram, view: '{damaged' }] });
  await page.locator('#viewer').evaluate((target, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'recovered.zoomflow.zip', { type: 'application/zip' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, [...bytes]);
  await expect(page.locator('.project-group')).toHaveCount(1);
  await previewReady(page);
  expect(await editorText(page)).toBe(diagram);
  await expect(page.locator('#file-status')).toBeHidden();
  await expect(page.locator('#viewer [data-export-hidden]')).toHaveCount(0);
});
