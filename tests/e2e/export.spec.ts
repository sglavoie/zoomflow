import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus, board, drill, comparesVisuals, regularFont, openFolder } from './helpers';
import { download } from './export-helpers';

test.use({ colorScheme: 'light', reducedMotion: 'reduce' });

const { unzipSync } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('fflate') as {
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>;
};

test('fits the exported root canvas around every shape and label without clipping', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  const path = await download(page, 'svg', info);
  const exported = await context.newPage();
  await exported.goto(pathToFileURL(path).href);
  const bounds = await exported.locator('svg').first().evaluate((root: SVGSVGElement) => {
    const graph = root.querySelector('svg')!;
    const inverse = root.getScreenCTM()!.inverse();
    const boxes = [...graph.querySelectorAll<SVGGraphicsElement>('g rect, g path, g text')]
      .filter(node => !node.closest('defs'))
      .flatMap(node => {
        const box = node.getBBox();
        const transform = inverse.multiply(node.getScreenCTM()!);
        return [new DOMPoint(box.x, box.y).matrixTransform(transform),
          new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(transform)];
      });
    return { width: root.viewBox.baseVal.width, height: root.viewBox.baseVal.height,
      left: Math.min(...boxes.map(point => point.x)), top: Math.min(...boxes.map(point => point.y)),
      right: Math.max(...boxes.map(point => point.x)), bottom: Math.max(...boxes.map(point => point.y)) };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(20);
  expect(bounds.top).toBeGreaterThanOrEqual(20);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width - 20);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height - 20);
  await exported.close();
});

test('downloads every board as PNG in a ZIP with nested folders and remembers the format', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'boards.d2', mimeType: 'text/plain', buffer: Buffer.from(`
Public: Share this
Secret: Private detail
layers: {
  Details: {a: Detail; layers: {Nested: {b: Nested detail}}}
  Empty: {}
  "Details.png": {c: Another detail}
}
scenarios: {Alternative: {d: Alternative}}
steps: {Later: {e: Later}}
`) });
  await previewReady(page);
  const secret = page.locator('.zf-stage [data-shape-id="Secret"]');
  await secret.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from export', exact: true }).click();
  await expect(secret).toHaveAttribute('data-export-hidden', '');
  await selectMenuOption(page, '#theme', 'dark');
  const root = await readFile(await download(page, 'png', info));
  await selectMenuOption(page, '#export-format', 'png-zip');
  await expect(page.locator('#export')).toHaveText('Download PNG ZIP');
  await expect(page.locator('#export-scope')).toHaveText('Entire diagram · 7 boards · PNG ZIP · 1 hidden shape omitted');
  const path = await download(page, 'png-zip', info);
  expect(path).toMatch(/boards-png\.zip$/);
  const files = unzipSync(await readFile(path));
  expect(Object.keys(files).sort()).toEqual([
    'root.png', 'Details.png', 'Details/Nested.png', 'Empty.png', '@Details.png.png',
    '@scenarios/Alternative.png', '@steps/Later.png',
  ].sort());
  for (const png of Object.values(files)) {
    expect(Buffer.from(png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBeGreaterThan(0);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(20)).toBeGreaterThan(0);
  }
  // The ZIP root uses the same theme and hidden-shape choices as a current-board PNG.
  expect(Buffer.from(files['root.png'])).toEqual(root);
  expect(Buffer.from(files['Details.png'])).not.toEqual(root);
  await page.reload(); await previewReady(page);
  await expect(page.locator('#export-format input[value="png-zip"]')).toBeChecked();
});

test('PNG ZIP includes every linked project file once and keeps repeated board IDs separate', async ({ page }, info) => {
  const folder = info.outputPath('png-project');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/index.d2`, 'Start: {link: ./other.d2}\nlayers: {"@files": {a: Reserved name}}');
  await writeFile(`${folder}/other.d2`, 'Back: {link: ./index.d2}\nlayers: {Detail: {b: Linked detail}}');
  await writeFile(`${folder}/unused.d2`, 'Unused');
  await page.goto('/'); await previewReady(page);
  await openFolder(page, folder); await previewReady(page);
  await selectMenuOption(page, '#export-format', 'png-zip');
  await expect(page.locator('#export-scope')).toHaveText('Entire diagram and the files it links to · 2 boards · PNG ZIP');
  const path = await download(page, 'png-zip', info);
  expect(path).toMatch(/index-png\.zip$/);
  const files = unzipSync(await readFile(path));
  expect(Object.keys(files)).toEqual(['root.png', '@files.png', '@@files/other.d2/root.png', '@@files/other.d2/Detail.png']);
  for (const png of Object.values(files)) expect(Buffer.from(png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
  expect(files['root.png']).not.toEqual(files['@@files/other.d2/root.png']);
});

test('downloads the current SVG and PNG and matches the root PNG snapshot', { tag: '@visual' }, async ({ page, browserName }, info) => {
  const fonts = new Set<string>();
  page.on('response', (response) => {
    const face = response.url().match(/SourceSansPro-(Regular|Bold|Italic|Semibold)(-[\w-]+)?\.ttf/);
    if (face && response.ok()) fonts.add(face[1]);
  });
  await page.goto('/');
  await board(page, 'root');
  expect([...fonts].sort()).toEqual(['Bold', 'Italic', 'Regular', 'Semibold']);
  const png = await readFile(await download(page, 'png', info));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  // The PNG is a page rendering, so like other baselines it is compared in Chromium on macOS.
  if (comparesVisuals(browserName)) expect(png).toMatchSnapshot('order-root.png', { maxDiffPixelRatio: 0.005 });
  await drill(page, 'root.layers.checkout');
  await drill(page, 'root.layers.checkout.layers.charge');
  const svg = await readFile(await download(page, 'svg', info), 'utf8');
  expect(svg).toContain('Capture');
  expect(svg).not.toContain('Browse');
  expect(svg).toContain('data:application/font-woff;base64,');
  const childPng = await readFile(await download(page, 'png', info));
  expect(childPng.equals(png)).toBe(false);
  const zip = await readFile(await download(page, 'zip', info));
  expect(zip.subarray(0, 2).toString()).toBe('PK');
});

test('copies the same curated board PNG as Download PNG and reports clipboard failure', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('.zf-stage [data-shape-id="Browse"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from export', exact: true }).click();
  await selectMenuOption(page, '#theme', 'dark');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        const png = await items[0].getType('image/png');
        (window as any).copiedPng = Array.from(new Uint8Array(await png.arrayBuffer()));
      },
    } });
  });
  await selectMenuOption(page, '#export-format', 'png');
  const copy = page.locator('#copy-board-png');
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.locator('#export-status')).toHaveText('PNG copied to clipboard.');
  const copied = Buffer.from(await page.evaluate(() => (window as any).copiedPng as number[]));
  expect(copied.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(copied).toEqual(await readFile(await download(page, 'png', info)));

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        await items[0].getType('image/png');
        throw new Error('Permission denied');
      },
    } });
  });
  await selectMenuOption(page, '#export-format', 'png');
  await copy.click();
  await expect(page.locator('#export-status')).toContainText('Permission denied. Use Download PNG.');
  await expect(page.locator('#export')).toBeEnabled();
});

test('uses the shipped font bytes for compilation instead of silently falling back', async ({ page }) => {
  await page.route(regularFont, (route) => route.fulfill({
    contentType: 'font/ttf', body: 'invalid font bytes',
  }));
  await page.goto('/');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#compile-error')).toContainText(/font/i);
  await expect(page.locator('.zf-stage svg')).toHaveCount(0);
});

test('inlines remote images for PNG and reports a placeholder when fetching fails', async ({ page }, info) => {
  await page.route('https://assets.example/icon.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>',
  }));
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles({ name: 'image.d2', mimeType: 'text/plain', buffer: Buffer.from('Picture: {icon: https://assets.example/icon.svg}') });
  await expect(page.locator('#filename')).toHaveText('image.d2');
  // The filename changes before compilation; wait for the new diagram before exporting.
  await expect(page.locator('.zf-stage [data-shape-id="Picture"]')).toBeVisible();
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  const svg = await readFile(await download(page, 'svg', info), 'utf8');
  expect(svg).toContain('data:image/svg+xml;base64,');
  expect(svg).not.toContain('https://assets.example');
  await download(page, 'png', info);
  await page.unroute('https://assets.example/icon.svg');
  await page.route('https://assets.example/icon.svg', (route) => route.abort());
  await download(page, 'png', info);
  // The viewer keeps its own alert region in the page, empty until it has a message.
  await expect(page.getByRole('alert').filter({ hasText: 'used a placeholder' })).toBeVisible();
});

test('invalid current file cannot export the previous diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#file').setInputFiles({ name: 'bad.d2', mimeType: 'text/plain', buffer: Buffer.from('broken: {') });
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('Preview out of date');
  await source(page).fill('fixed: Current file');
  await expect(page.locator('#export')).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  expect(download.suggestedFilename()).toBe('bad-root.svg');
  expect(await readFile(await download.path(), 'utf8')).toContain('Current file');
});

test('export progress and completion appear beside the export action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#export')).toBeEnabled();
  await page.locator('#header-more-toggle').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  expect(download.suggestedFilename()).toBe('order.html');
  await expect(page.locator('#export-status')).toContainText('Download started');
  await expect(page.locator('#export-status')).toBeVisible();
});

test('source changes cancel an export already embedding images', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'image.d2', mimeType: 'text/plain',
    buffer: Buffer.from('Picture: {icon: https://assets.example/slow.svg}') });
  await expect(page.locator('.zf-stage [data-shape-id="Picture"]')).toBeVisible();
  await expect(page.locator('#export')).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested!: () => void;
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('https://assets.example/slow.svg', async (route) => {
    requested();
    await gate;
    await route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>' });
  });
  let downloads = 0;
  page.on('download', () => { ++downloads; });
  await downloadExport(page);
  await requestSeen;
  await source(page).fill('new: Current source');
  release();
  await expect(page.locator('#activity-status')).toContainText('Export canceled because the source changed.');
  expect(downloads).toBe(0);
  await expect(page.locator('#export')).toBeEnabled();
});

test('edits invalidate exports immediately without flashing progress, errors lead to their source', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await source(page).fill('a: Updated');
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('.zf-stage')).not.toHaveAttribute('data-preview-state', 'updating');
  await expect(page.locator('.zf-stage')).toContainText('Updated');
  await source(page).fill('a: First line\nbroken: {');
  await expect(page.locator('#compile-error')).toContainText('Line 2');
  await page.getByRole('button', { name: 'Go to error' }).click();
  await expect(source(page)).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-preview-state', 'stale');
  await expect(page.locator('#export')).toBeDisabled();
});

test('export choices explain outcomes and fit a short phone viewport', async ({ page }) => {
  await stubAiStatus(page);
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#export-format', 'html');
  const menu = page.locator('#header-more-content');
  await expect(page.getByRole('radio', { name: /Interactive diagram HTML/ })).toBeChecked();
  await expect(menu).toContainText('Every board, with drill-down navigation');
  await expect(menu).toContainText('Current board image');
  await expect(menu).toContainText('All boards as SVG');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(450);
  await page.reload(); await previewReady(page);
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#export-format input[value="html"]')).toBeChecked();
});

test('export defaults follow board count until an explicit choice, including across reloads', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  const selected = page.locator('#export-format input:checked');
  await expect(selected).toHaveValue('html');
  await source(page).fill('one: Single board'); await previewReady(page);
  await expect(selected).toHaveValue('svg');
  await source(page).fill('one: {link: layers.child}\nlayers: {child: {a: Detail}}'); await previewReady(page);
  await expect(selected).toHaveValue('html');
  await selectMenuOption(page, '#export-format', 'png');
  await page.locator('#header-more-toggle').click();
  await source(page).fill('one: Single board'); await previewReady(page);
  await expect(selected).toHaveValue('png');
  await page.reload(); await previewReady(page);
  await expect(selected).toHaveValue('png');
});

test('clicking the recommended format makes it explicit even without preference storage', async ({ page }) => {
  await stubAiStatus(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'zoomflow.export-format') throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/'); await previewReady(page);
  const selected = page.locator('#export-format input:checked');
  await expect(selected).toHaveValue('html');
  await page.locator('#header-more-toggle').click();
  await page.locator('#export-format input[value="html"]').click();
  await page.locator('#header-more-toggle').click();
  await source(page).fill('one: Single board'); await previewReady(page);
  await expect(selected).toHaveValue('html');
});

test('export stays disabled until the running export finishes', async ({ page }) => {
  let hold = false;
  let release: (() => void) | undefined;
  await page.route('https://assets.example/icon.svg', async (route) => {
    const reply = () => route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>' });
    if (hold) release = () => void reply();
    else await reply();
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'image.d2', mimeType: 'text/plain', buffer: Buffer.from('Picture: {icon: https://assets.example/icon.svg}') });
  await expect(page.locator('.zf-stage [data-shape-id="Picture"]')).toBeVisible();
  await previewReady(page);
  await selectMenuOption(page, '#export-format', 'svg');
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  hold = true;
  const exportButton = page.locator('#export');
  await exportButton.click();
  await expect(exportButton).toBeDisabled();
  await expect.poll(() => Boolean(release)).toBe(true);
  // Changing the format refreshes the export label but must not re-enable the running export.
  await page.locator('#export-format input[value="png"]').check();
  await expect(page.locator('#copy-board-png')).toBeDisabled();
  await page.locator('#export-format input[value="svg"]').check();
  await expect(exportButton).toBeDisabled();
  release!();
  await expect(exportButton).toBeEnabled();
  await expect.poll(() => downloads).toEqual(['image-root.svg']);
});
