import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus, board, drill, comparesVisuals, regularFont } from './helpers';

async function download(page: Page, format: string, info: TestInfo) {
  await selectMenuOption(page, '#export-format', format);
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const result = await pending;
  const path = info.outputPath(result.suggestedFilename());
  await result.saveAs(path);
  await expect(page.locator('#export')).toBeEnabled();
  return path;
}

test.use({ colorScheme: 'light', reducedMotion: 'reduce' });

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

test('uses the shipped font bytes for compilation instead of silently falling back', async ({ page }) => {
  await page.route(regularFont, (route) => route.fulfill({
    contentType: 'font/ttf', body: 'invalid font bytes',
  }));
  await page.goto('/');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#compile-error')).toContainText(/font/i);
  await expect(page.locator('.zf-stage svg')).toHaveCount(0);
});

test('opens a single HTML file offline and drills every level with history and backlinks', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  const path = await download(page, 'html', info);
  const html = await readFile(path, 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=|d2\.wasm/);
  // Boards share one font subset per face instead of embedding their own.
  expect(html.match(/@font-face/g)).toHaveLength(1);
  expect(html).toContain('@font-face{font-family:zf-font-bold;');
  await page.goto('about:blank');
  const network: string[] = [];
  context.on('request', (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await context.route(/^https?:/, (route) => route.abort());
  await context.setOffline(true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path).href);
  await board(page, 'root');
  await expect(page.locator('.zf-stage')).toContainText('Browse');
  await drill(page, 'root.layers.checkout');
  await drill(page, 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-stage')).toContainText('Capture');
  const font = await page.locator('.zf-stage text.text-bold').first().evaluate(async (text) => {
    await document.fonts.ready;
    return { family: getComputedStyle(text).fontFamily.replace(/"/g, ''), loaded: document.fonts.check(`16px ${getComputedStyle(text).fontFamily}`, text.textContent!) };
  });
  expect(font).toEqual({ family: 'zf-font-bold', loaded: true });
  const colors = await page.locator('.zf-stage').evaluate((stage) => ({
    stage: getComputedStyle(stage).backgroundColor,
    board: getComputedStyle(stage.querySelector('svg svg > rect')!).fill,
    alignment: stage.querySelector('svg')!.getAttribute('preserveAspectRatio'),
  }));
  expect(colors.stage).toBe(colors.board);
  expect(colors.alignment).toBe('xMidYMid meet');
  await page.reload();
  await board(page, 'root.layers.checkout.layers.charge');
  await page.keyboard.press('Escape');
  await board(page, 'root.layers.checkout');
  await page.goBack();
  await board(page, 'root.layers.checkout.layers.charge');
  await page.goForward();
  await board(page, 'root.layers.checkout');
  await drill(page, 'root');
  await drill(page, 'root.layers.checkout');
  await drill(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('button', { name: 'Root', exact: true }).first().click();
  await board(page, 'root');
  await expect(page.locator('a[href="https://d2lang.com/tour/intro/"]')).toHaveAttribute('target', '_blank');
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

test('HTML export follows its reader\'s color scheme and shares viewer controls', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  await selectMenuOption(page, '#theme', 'dark');
  const path = await download(page, 'html', info);
  const offline = await context.newPage();
  await offline.emulateMedia({ colorScheme: 'light' });
  await offline.goto(pathToFileURL(path).href);
  await board(offline, 'root');
  const background = () => offline.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await background()).toBe('rgb(244, 246, 249)');
  await offline.emulateMedia({ colorScheme: 'dark' });
  expect(await background()).toBe('rgb(17, 23, 34)');
  const canvas = (await offline.locator('.zf-stage').boundingBox())!;
  expect((await offline.locator('.zf-zoom-controls').boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  expect(await offline.locator('.zf-visually-hidden').evaluate((node) => ({
    width: getComputedStyle(node).width, height: getComputedStyle(node).height,
    overflow: getComputedStyle(node).overflow,
  }))).toEqual({ width: '1px', height: '1px', overflow: 'hidden' });
});

test('exports cyclic links and collapses breadcrumb loops offline', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles('fixtures/cycle.d2');
  await expect(page.locator('#filename')).toHaveText('cycle.d2');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.zf-stage a[href="root.layers.A"]')).toBeVisible();
  const path = await download(page, 'html', info);
  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  await drill(page, 'root.layers.A');
  await drill(page, 'root.layers.B');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'A', 'B']);
  await drill(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'A']);
  await page.reload();
  await board(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'A']);
  await page.goBack();
  await board(page, 'root.layers.B');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'A', 'B']);
  await page.goForward();
  await board(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'A']);
  await page.keyboard.press('Backspace');
  await board(page, 'root');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root']);
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

test('exported HTML retains keyboard focus during drill-down', async ({ page, context }, info) => {
  await page.goto('/');
  await expect(page.locator('#export')).toBeEnabled();
  await selectMenuOption(page, '#export-format', 'html');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  const svg = offline.locator('.zf-stage > svg');
  const initialWidth = Number((await svg.getAttribute('viewBox'))!.split(/\s+/)[2]);
  await offline.getByRole('button', { name: 'Zoom in' }).click();
  expect(Number((await svg.getAttribute('viewBox'))!.split(/\s+/)[2])).toBeLessThan(initialWidth);
  await offline.getByRole('button', { name: 'Zoom out' }).click();
  await offline.getByRole('button', { name: 'Zoom out' }).click();
  await expect(offline.locator('.zf-zoom-controls span')).toHaveText('67%');
  await offline.getByRole('button', { name: 'Fit diagram' }).click();
  const link = offline.locator('.zf-stage a[href="root.layers.checkout"]');
  await link.focus();
  await link.press('Enter');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-stage')).toBeFocused();
  await expect(offline.locator('.zf-visually-hidden')).toHaveText('checkout board');
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
  await page.locator('#export-format input[value="svg"]').check();
  await expect(exportButton).toBeDisabled();
  release!();
  await expect(exportButton).toBeEnabled();
  await expect.poll(() => downloads).toEqual(['image-root.svg']);
});

test('exported HTML returns keyboard focus to the link it came from when going up', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  const path = await download(page, 'html', info);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  await board(offline, 'root');
  const stage = offline.locator('.zf-stage');
  const checkout = offline.locator('.zf-stage a[href="root.layers.checkout"]');
  await checkout.focus();
  await checkout.press('Enter');
  await board(offline, 'root.layers.checkout');
  const charge = offline.locator('.zf-stage a[href="root.layers.checkout.layers.charge"]');
  await charge.focus();
  await charge.press('Enter');
  await board(offline, 'root.layers.checkout.layers.charge');
  await expect(stage).toBeFocused();
  // A held key repeats: only the first press goes up.
  const repeated = await offline.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(repeated).toBe(false);
  await board(offline, 'root.layers.checkout.layers.charge');
  await offline.keyboard.press('Escape');
  await board(offline, 'root.layers.checkout');
  await expect(charge).toBeFocused();
  await offline.keyboard.press('Backspace');
  await board(offline, 'root');
  await expect(checkout).toBeFocused();
  // A breadcrumb to an ancestor does the same, even across two levels.
  await checkout.press('Enter');
  await board(offline, 'root.layers.checkout');
  await charge.focus();
  await charge.press('Enter');
  await board(offline, 'root.layers.checkout.layers.charge');
  await offline.locator('.zf-breadcrumbs').getByRole('button', { name: 'Root', exact: true }).press('Enter');
  await board(offline, 'root');
  await expect(checkout).toBeFocused();
  // The focused link is revealed inside the visible canvas.
  const bounds = (await checkout.boundingBox())!;
  const canvas = (await stage.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(canvas.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
});

test('exported HTML restyles its canvas and link badges when the reader switches color scheme', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  const path = await download(page, 'html', info);
  const offline = await context.newPage();
  await offline.emulateMedia({ colorScheme: 'light' });
  await offline.goto(pathToFileURL(path).href);
  await board(offline, 'root');
  const colors = () => offline.locator('.zf-stage').evaluate((stage) => ({
    stage: getComputedStyle(stage).backgroundColor,
    board: getComputedStyle(stage.querySelector('svg svg > rect')!).fill,
    badge: getComputedStyle(stage.querySelector('.appendix-icon circle')!).fill,
    ink: getComputedStyle(stage.querySelector('.appendix-icon circle')!).stroke,
  }));
  const light = await colors();
  expect(light.stage).toBe(light.board);
  expect([light.badge, light.ink]).toEqual(['rgb(255, 255, 255)', 'rgb(82, 101, 125)']);
  await offline.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await colors()).stage).not.toBe(light.stage);
  const dark = await colors();
  expect(dark.stage).toBe(dark.board);
  expect([dark.badge, dark.ink]).toEqual(['rgb(24, 34, 49)', 'rgb(173, 187, 205)']);
  await offline.emulateMedia({ colorScheme: 'light' });
  await expect.poll(colors).toEqual(light);
});

test('interactive HTML is titled with the document name without its .d2 extension', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  const html = await readFile(await download(page, 'html', info), 'utf8');
  expect(html).toContain('<title>order</title>');
  expect(html).toContain('<header><h1>order</h1></header>');
});
