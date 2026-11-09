import { expect, test } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { selectMenuOption, downloadExport } from './menu';
import { previewReady, board, drill, openFolder } from './helpers';
import { download } from './export-helpers';

test.use({ colorScheme: 'light', reducedMotion: 'reduce' });

test('opens a single HTML file offline and drills every level with history and backlinks', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  // This fixture includes ancestor and external links; the introductory example uses breadcrumbs.
  await page.locator('#file').setInputFiles('fixtures/order.d2'); await previewReady(page);
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
  const font = await page.locator('.zf-stage text').first().evaluate(async (text) => {
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
  await page.getByRole('button', { name: 'Order', exact: true }).first().click();
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
  await expect(page.locator('.zf-stage a[data-board="root.layers.A"]')).toBeVisible();
  const path = await download(page, 'html', info);
  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  await drill(page, 'root.layers.A');
  await drill(page, 'root.layers.B');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle', 'A', 'B']);
  await drill(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle', 'A']);
  await page.reload();
  await board(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle', 'A']);
  await page.goBack();
  await board(page, 'root.layers.B');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle', 'A', 'B']);
  await page.goForward();
  await board(page, 'root.layers.A');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle', 'A']);
  await page.keyboard.press('Backspace');
  await board(page, 'root');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Cycle']);
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
  await offline.getByRole('button', { name: 'Overview (fit diagram)' }).click();
  const link = offline.locator('.zf-stage a[data-board="root.layers.checkout"]');
  // A board link's address is the board's route, so a new tab or a copied link opens that board.
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^#\//);
  await link.focus();
  await link.press('Enter');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-stage')).toBeFocused();
  await expect(offline.locator('.zf-visually-hidden')).toHaveText('checkout board');
  const copied = await context.newPage();
  await copied.goto(pathToFileURL(path).href + href);
  await expect(copied.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
});

test('exported HTML returns keyboard focus to the link it came from when going up', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  const path = await download(page, 'html', info);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  await board(offline, 'root');
  const stage = offline.locator('.zf-stage');
  const checkout = offline.locator('.zf-stage a[data-board="root.layers.checkout"]');
  await checkout.focus();
  await checkout.press('Enter');
  await board(offline, 'root.layers.checkout');
  const charge = offline.locator('.zf-stage a[data-board="root.layers.checkout.layers.charge"]');
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
  await offline.locator('.zf-breadcrumbs').getByRole('button').first().press('Enter');
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
  expect([light.badge, light.ink]).toEqual(['rgb(255, 255, 255)', 'rgb(130, 114, 180)']);
  await offline.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await colors()).stage).not.toBe(light.stage);
  const dark = await colors();
  expect(dark.stage).toBe(dark.board);
  expect([dark.badge, dark.ink]).toEqual(['rgb(24, 34, 49)', 'rgb(130, 114, 180)']);
  await offline.emulateMedia({ colorScheme: 'light' });
  await expect.poll(colors).toEqual(light);
});

test('interactive HTML is titled with the document name without its .d2 extension', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  const html = await readFile(await download(page, 'html', info), 'utf8');
  expect(html).toContain('<title>Order</title>');
  expect(html).toContain('<header><h1>Order</h1></header>');
});

test('exports a folder project as one offline atlas and links file SVGs in the ZIP', async ({ page, context }, info) => {
  await page.goto('/');
  await openFolder(page, fileURLToPath(new URL('../../fixtures/atlas', import.meta.url)));
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/index.d2');
  await previewReady(page);
  await selectMenuOption(page, '#export-format', 'atlas');
  await expect(page.locator('#export-scope')).toHaveText('This file and every file it links to · Interactive atlas HTML');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const result = await pending;
  expect(result.suggestedFilename()).toBe('index-atlas.html');
  const path = info.outputPath(result.suggestedFilename());
  await result.saveAs(path);
  await expect(page.locator('#export')).toBeEnabled();
  const html = await readFile(path, 'utf8');
  // Every file the home board reaches, and none it does not.
  for (const file of ['health.d2', 'work%2Findex.d2', 'projects%2Fzoomflow.d2']) expect(html).toContain(`#/@file/${file}`);
  expect(html).not.toContain('broken');

  // ZIP entry names are stored as plain text; core tests cover the rewritten links.
  const zip = (await readFile(await download(page, 'zip', info))).toString('latin1');
  for (const file of ['root.svg', '@files/health.d2/root.svg', '@files/work/index.d2/root.svg', '@files/projects/zoomflow.d2/Viewer.svg']) expect(zip).toContain(file);

  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  const stage = offline.locator('.zf-stage');
  const crumbs = offline.locator('.zf-breadcrumbs button');
  await expect(stage).toHaveAttribute('data-file', 'index.d2');
  await offline.locator('.zf-stage a[data-file="./work/index.d2"]').click();
  await expect(stage).toHaveAttribute('data-file', 'work/index.d2');
  expect(await offline.evaluate(() => location.hash)).toBe('#/@file/work%2Findex.d2');
  await expect(crumbs).toHaveText(['index', 'work/index']);
  // The fragment opens the linked file's board.
  await offline.locator('.zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await expect(stage).toHaveAttribute('data-file', 'projects/zoomflow.d2');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.Viewer');
  await expect(crumbs).toHaveText(['index', '…', 'work/index', 'projects/zoomflow', 'Viewer']);
  // Back moves across files; a reload keeps the place and its trail.
  await offline.goBack();
  await expect(stage).toHaveAttribute('data-file', 'work/index.d2');
  await offline.reload();
  await expect(stage).toHaveAttribute('data-file', 'work/index.d2');
  await expect(crumbs).toHaveText(['index', 'work/index']);
  await stage.focus();
  await offline.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-file', 'index.d2');
  await expect(crumbs).toHaveText(['index']);
});
