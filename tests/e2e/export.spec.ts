import { selectMenuOption, downloadExport } from './menu';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function board(page: Page, id: string) {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
}
async function drill(page: Page, id: string) {
  await page.locator(`.zf-stage a[href="${id}"]`).click();
  await board(page, id);
}
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

test('downloads the current SVG and PNG and matches the root PNG snapshot', async ({ page }, info) => {
  const fonts = new Set<string>();
  page.on('response', (response) => {
    const face = response.url().match(/SourceSansPro-(Regular|Bold|Italic|Semibold)\.ttf/);
    if (face && response.ok()) fonts.add(face[1]);
  });
  await page.goto('/');
  await board(page, 'root');
  expect([...fonts].sort()).toEqual(['Bold', 'Italic', 'Regular', 'Semibold']);
  const png = await readFile(await download(page, 'png', info));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png).toMatchSnapshot('order-root.png', { maxDiffPixelRatio: 0.001 });
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
  await page.route('**/SourceSansPro-Regular.ttf', (route) => route.fulfill({
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
  await expect(page.locator('a[href="https://example.com/docs"]')).toHaveAttribute('target', '_blank');
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

test('HTML export keeps the selected dark theme and shared viewer controls', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  await selectMenuOption(page, '#theme', 'dark');
  const path = await download(page, 'html', info);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  await board(offline, 'root');
  expect(await offline.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(17, 23, 34)');
  expect(await offline.locator('.zf-zoom-controls').evaluate((node) => getComputedStyle(node).position)).toBe('absolute');
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
  await expect(page.getByRole('alert')).toContainText('used a placeholder');
});
