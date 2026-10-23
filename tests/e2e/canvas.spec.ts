import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus, selectSource, cursorAt, insideStage } from './helpers';

/** Diagram canvas: zoom, pan, fit, keyboard and touch navigation, link badges and source reveal. */

test('preview zooms and pans, then fits again', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('.zf-stage > svg');
  await expect(svg).toBeVisible();
  const box = async () => svg.getAttribute('viewBox').then((value) => value!.split(/\s+/).map(Number));
  const original = await box();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await box();
  expect(zoomed[2]).toBeLessThan(original[2]);
  const bounds = (await svg.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.25, { steps: 6 });
  await page.mouse.up();
  const panned = await box();
  expect(panned.slice(0, 2)).not.toEqual(zoomed.slice(0, 2));
  const linked = page.locator('.zf-stage a[href="root.layers.checkout"]');
  const target = (await linked.boundingBox())!;
  const beforeLinkedPan = await box();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 - 35, target.y + target.height / 2 - 25, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await box()).slice(0, 2)).not.toEqual(beforeLinkedPan.slice(0, 2));
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await page.getByRole('button', { name: 'Fit diagram' }).click();
  expect(await box()).toEqual(original);
});

test('zoom out reaches 10% with the diagram centered, then fits again', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('.zf-stage > svg');
  await expect(svg).toBeVisible();
  const box = async () => (await svg.getAttribute('viewBox'))!.split(/\s+/).map(Number);
  const original = await box();
  const out = page.getByRole('button', { name: 'Zoom out' });
  const fit = page.getByRole('button', { name: 'Fit diagram' });

  await out.click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('67%');
  await expect(fit).toBeEnabled();
  for (let i = 0; i < 5; i++) await out.click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('10%');
  await expect(out).toBeDisabled();
  const zoomedOut = await box();
  expect(zoomedOut[2]).toBeCloseTo(original[2] * 10);
  expect(zoomedOut[0] + zoomedOut[2] / 2).toBeCloseTo(original[0] + original[2] / 2);
  expect(zoomedOut[1] + zoomedOut[3] / 2).toBeCloseTo(original[1] + original[3] / 2);

  await fit.click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
  expect(await box()).toEqual(original);
});

test('live edits keep the current view, while opening another diagram fits it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  await source(page).press('ControlOrMeta+End');
  await source(page).press('Enter');
  await source(page).pressSequentially('Note: Keeps the view');
  await expect(page.locator('.zf-stage')).toContainText('Keeps the view');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  await page.locator('#file').setInputFiles({ name: 'fresh.d2', mimeType: 'text/plain', buffer: Buffer.from('fresh: Fits again') });
  await expect(page.locator('.zf-stage')).toContainText('Fits again');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
});

test('keyboard board navigation retains focus and announces the new board', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await link.focus();
  await link.press('Enter');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-stage')).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('aria-label', 'checkout diagram');
  await expect(page.locator('#viewer .zf-visually-hidden')).toHaveText('checkout board');
  await page.keyboard.press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  // Going up returns to the link that led down, not the stage.
  await expect(link).toBeFocused();
});

test('explicit reveal frames an offscreen shape with minimal pan and only zooms out when necessary', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const svg = page.locator('.zf-stage > svg');
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await zoom.click(); await zoom.click();
  const before = await svg.getAttribute('viewBox');
  await selectSource(page, 'Receipt');
  expect(await svg.getAttribute('viewBox')).toBe(before);
  await page.locator('#reveal-source').click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  expect((await svg.getAttribute('viewBox'))!.split(' ')[2]).toBe(before!.split(' ')[2]);
  for (let i = 0; i < 4; i++) await zoom.click();
  const width = Number((await svg.getAttribute('viewBox'))!.split(' ')[2]);
  await page.locator('#reveal-source').click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  expect(Number((await svg.getAttribute('viewBox'))!.split(' ')[2])).toBeGreaterThan(width);
  const revealed = await svg.getAttribute('viewBox');
  await page.locator('#reveal-source').click();
  expect(await svg.getAttribute('viewBox')).toBe(revealed);
});

test('a large diagram is one Tab stop, arrow keys move spatially and focus stays visible', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`direction: right\n${Array.from({ length: 30 }, (_, i) => `node${i}`).join(' -> ')}`);
  await expect(page.locator('[data-shape-id="node29"]')).toBeVisible(); await previewReady(page);
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const stage = page.locator('.zf-stage');
  const zoomedWidth = (await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ')[2];
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-shape-id="node0"]')).toBeFocused();
  await insideStage(page, '[data-shape-id="node0"]');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-shape-id="node1"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-shape-id="node29"]')).toBeFocused();
  await insideStage(page, '[data-shape-id="node29"]');
  expect((await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ')[2]).toBe(zoomedWidth);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-shape-id="node28"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(stage.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-shape-id="node29"]')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('node0');
});

test.describe('touch and offline navigation', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  test('link cues stay legible and keyboard navigation works in the offline HTML', async ({ page, context }, info) => {
    await page.goto('/'); await previewReady(page);
    await expect(page.locator('.zf-pan-hint')).toBeVisible();
    await expect(page.locator('.zf-pan-hint')).toContainText('Pinch to zoom');
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download'); await downloadExport(page);
    const file = info.outputPath('touch-navigation.html'); await (await pending).saveAs(file);
    const offline = await context.newPage(); await context.setOffline(true);
    await offline.goto(pathToFileURL(file).href);
    for (const target of [page, offline]) {
      const badges = target.locator('.appendix-icon circle');
      expect(await badges.count()).toBeGreaterThan(0);
      for (const badge of await badges.all()) expect((await badge.boundingBox())!.width).toBeGreaterThanOrEqual(23.9);
      await expect(target.locator('.zf-pan-hint')).toBeVisible();
      const hit = target.locator('a[data-link-direction="child"] .zf-link-hit');
      expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
      await target.locator('.zf-stage').focus();
      await target.keyboard.press('Home');
      await expect(target.locator('.zf-stage [tabindex="0"]')).toHaveCount(1);
      await target.keyboard.press('Tab');
      await expect(target.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
      // The badge itself still opens the same board after resizing and zooming.
      await target.locator('a[data-link-direction="child"] .appendix-icon').click();
      await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
    }
  });
});

test('reading source leaves the board and history alone; explicit reveal works on desktop and phone', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const history = await page.evaluate(() => window.history.length);
  await cursorAt(page, 'Capture');
  await expect(page.locator('#reveal-source')).toBeEnabled();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await page.locator('#reveal-source').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-source-selected')).toHaveAttribute('data-shape-id', 'Capture');
  await expect(page.locator('.zf-stage')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-source').click();
  await cursorAt(page, 'Browse');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await source(page).press('ControlOrMeta+Shift+Enter');
  await expect(page.locator('#preview-pane')).toBeVisible();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-source-selected')).toHaveAttribute('data-shape-id', 'Browse');
});

test('link badges distinguish children, ancestors and peers in the live and offline viewers', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`Child: {link: layers.child}
layers: {
  child: {
    Parent: {link: _}
    Peer: {link: _.layers.peer}
    Deeper: {link: layers.deep}
    layers: {deep: {Home: {link: _._}}}
  }
  peer: {Back: {link: _}}
}`);
  await expect(page.getByRole('link', { name: 'Open child board', exact: true })).toBeVisible();
  await previewReady(page);
  await selectMenuOption(page, '#export-format', 'html');
  const pending = page.waitForEvent('download'); await downloadExport(page);
  const file = info.outputPath('directions.html'); await (await pending).saveAs(file);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(file).href);
  for (const target of [page, offline]) {
    const child = target.getByRole('link', { name: 'Open child board', exact: true });
    await expect(child).toHaveAttribute('data-link-direction', 'child');
    await child.click();
    const parent = target.getByRole('link', { name: 'Return to Root', exact: true });
    const peer = target.getByRole('link', { name: 'Visit peer board', exact: true });
    const deeper = target.getByRole('link', { name: 'Open deep board', exact: true });
    await expect(parent).toHaveAttribute('data-link-direction', 'parent');
    await expect(peer).toHaveAttribute('data-link-direction', 'peer');
    const arrows = await Promise.all([parent, peer, deeper].map((link) => link.locator('.appendix-icon path').getAttribute('d')));
    expect(new Set(arrows).size).toBe(3);
    // Move off the newly rendered shapes before switching to keyboard focus;
    // a delayed pointerover from the preceding click must not become the last input.
    await target.mouse.move(0, 0);
    await parent.focus();
    await expect(target.locator('.zf-link-hint')).toHaveText('Return to Root');
    await peer.hover();
    await expect(target.locator('.zf-link-hint')).toHaveText('Visit peer board');
    await deeper.click();
    await target.getByRole('link', { name: 'Return to Root', exact: true }).click();
    await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  }
});

test('keyboard selects ordinary and linked shapes and recompiles retain the focused shape', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const browse = page.getByRole('button', { name: 'Select source for Browse', exact: true });
  await browse.focus(); await page.keyboard.press('Enter');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Browse');
  await browse.focus(); await page.keyboard.press('Space');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Browse');
  const checkout = page.getByRole('link', { name: 'Open checkout board', exact: true });
  await checkout.focus(); await page.keyboard.press('Alt+Enter');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Checkout');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  const text = await source(page).innerText();
  await source(page).fill(`${text}\nnew: Added`);
  await checkout.focus();
  await expect(page.locator('.zf-stage [data-shape-id="new"]')).toBeVisible();
  await expect(checkout).toBeFocused();
  await source(page).fill(`${text}\nnew: Changed`);
  await browse.focus();
  await expect(page.locator('.zf-stage')).toContainText('Changed');
  await expect(browse).toBeFocused();
});

test('wheel units produce equivalent zoom and pinch-wheel remains anchored', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const svg = page.locator('.zf-stage > svg');
  const wheel = (deltaY: number, deltaMode: number) => svg.dispatchEvent('wheel', { deltaY, deltaMode, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  await wheel(-48, 0);
  const pixels = await svg.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await wheel(-3, 1);
  expect(await svg.getAttribute('viewBox')).toBe(pixels);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const height = await page.locator('.zf-stage').evaluate((el) => el.clientHeight);
  await wheel(-48 / height, 2);
  expect(await svg.getAttribute('viewBox')).toBe(pixels);
  await expect(svg).toHaveCSS('touch-action', 'none');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await svg.dispatchEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('122%');
});

test('pinching from Fit zooms the diagram using real touch input', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies real multi-touch events in Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await previewReady(page);
  const stage = page.locator('.zf-stage');
  const bounds = (await stage.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }] });
  for (const distance of [40, 50, 60, 70]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - distance, y }, { id: 2, x: x + distance, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.zf-zoom-controls span')).not.toHaveText('Fit');
  const zoom = Number((await page.locator('.zf-zoom-controls span').innerText()).replace('%', ''));
  expect(zoom).toBeGreaterThan(150);
  await expect(stage).toHaveAttribute('data-board', 'root');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
});

test('live and offline links distinguish board navigation from external destinations', async ({ page, context }, info) => {
  await page.goto('/');
  await previewReady(page);
  const assertCues = async (target: Page) => {
    const board = target.getByRole('link', { name: 'Open checkout board', exact: true });
    const external = target.getByRole('link', { name: 'Open external link: Docs (new tab)', exact: true });
    await expect(board).toHaveAttribute('data-link-kind', 'board');
    await expect(external).toHaveAttribute('data-link-kind', 'external');
    await expect(board.locator('.appendix-icon')).toHaveCount(1);
    await expect(external.locator('.appendix-icon')).toHaveCount(1);
    expect(await board.locator('.appendix-icon path').getAttribute('d')).not.toBe(await external.locator('.appendix-icon path').getAttribute('d'));
    await board.focus();
    await expect(target.locator('.zf-link-hint')).toHaveText('Open checkout board');
    await board.press('Enter');
    await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  };
  await assertCues(page);
  await selectMenuOption(page, '#export-format', 'html');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  const path = info.outputPath('links.html');
  await download.saveAs(path);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(path).href);
  await assertCues(offline);
});

test('link badges preserve diagram tooltips and support Alt+click source selection', async ({ page, context }, info) => {
  await page.goto('/');
  await previewReady(page);
  await source(page).fill('a: {link: layers.child; tooltip: Keep this tooltip}\nlayers.child: {b}');
  await previewReady(page);
  const badge = page.getByRole('link', { name: 'Open child board', exact: true }).locator('.appendix-icon');
  await expect(badge).toHaveCount(1);
  await expect(page.locator('.appendix-icon > title')).toHaveText('Keep this tooltip');
  await badge.click({ modifiers: ['Alt'] });
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('a');
  await selectMenuOption(page, '#export-format', 'html');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadExport(page)]);
  const path = info.outputPath('tooltip.html');
  await download.saveAs(path);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('.appendix-icon > title')).toHaveText('Keep this tooltip');
  await expect(offline.getByRole('link', { name: 'Open child board' }).locator('.appendix-icon')).toHaveCount(1);
});

for (const offline of [false, true]) test(`compact breadcrumbs retain every ancestor ${offline ? 'offline' : 'live'}`, async ({ page, context }, info) => {
  await stubAiStatus(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const text = readFileSync('fixtures/lint/nested-navigation.d2', 'utf8').replace('Capture: {link: layers.charge}', 'Capture: {link: _}');
  await page.locator('#file').setInputFiles({ name: 'nested.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await previewReady(page);
  if (offline) {
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const file = info.outputPath('compact-navigation.html');
    await (await pending).saveAs(file);
    await context.setOffline(true);
    await page.goto(pathToFileURL(file).href);
  }
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const initialHeight = (await crumbs.boundingBox())!.height;
  let id = 'root';
  for (const name of ['checkout', 'charge', 'capture']) {
    id += `.layers.${name}`;
    await page.locator(`.zf-stage a[href="${id}"]`).click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  }
  expect((await crumbs.boundingBox())!.height).toBe(initialHeight);
  await expect(crumbs.getByRole('button')).toHaveText(['Root', '…', 'charge', 'capture']);
  const earlier = crumbs.getByRole('button', { name: 'Earlier boards', exact: true });
  await earlier.click();
  const menu = crumbs.getByRole('group', { name: 'Earlier boards' });
  await expect(menu.getByRole('button', { name: 'checkout', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(earlier).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await earlier.click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.goBack();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
});

test('canvas guidance follows navigation, mouse, keyboard and zoom context', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const hint = page.locator('.zf-pan-hint');
  await expect(hint).toHaveText('Click Checkout to explore');
  await expect(page.locator('.zf-stage a[href="https://d2lang.com/tour/intro/"]')).toBeVisible();
  const browse = page.locator('.zf-stage [data-shape-id="Browse"]');
  await browse.hover();
  await expect(hint).toHaveText('Click to select this shape’s source');
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(hint).toHaveText('Click Charge to explore');
  await page.locator('.zf-stage').focus();
  await page.keyboard.press('Home');
  await expect(hint).toContainText('Enter');
  await expect(hint).not.toContainText('Click');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(hint).toHaveText('Space + drag to pan · Scroll to zoom');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(hint).toHaveText('Click Charge to explore');
});

test('hovering a linked shape draws a single outline', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const browse = page.locator('.zf-stage [data-shape-id="Browse"]');
  await browse.hover();
  await expect(browse).toHaveCSS('outline-style', 'solid');
  const link = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await link.locator('[data-shape-id="Checkout"]').hover();
  await expect(link).toHaveCSS('outline-style', 'solid');
  await expect(link.locator('[data-shape-id="Checkout"]')).toHaveCSS('outline-style', 'none');
  // Returning by mouse focuses the link back down for keyboard users, without outlining it.
  await link.click();
  await page.getByRole('link', { name: 'Return to Root', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS('outline-style', 'none');
});

for (const offline of [false, true]) test(`link badges keep their screen size through zoom and resize ${offline ? 'offline' : 'live'}`, async ({ page, context }, info) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  if (offline) {
    await page.locator('#header-more-toggle').click();
    const pending = page.waitForEvent('download'); await page.locator('#export').click();
    const path = info.outputPath('diagram.html'); await (await pending).saveAs(path);
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href);
  }
  const badge = page.locator('a[data-link-direction="child"] .appendix-icon circle').first();
  // The circle is 24px across; Playwright may include its 1px stroke.
  const size = async () => (await badge.boundingBox())!.width;
  const initial = await size();
  expect(initial).toBeGreaterThanOrEqual(23.9);
  expect(initial).toBeLessThanOrEqual(25.1);
  for (let i = 0; i < 5; i++) {
    await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  }
  await page.setViewportSize({ width: 1050, height: 600 });
  await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator('a[data-link-direction="child"]').first().click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
});

test('appearance is separate from export and desktop canvas controls stay outside the diagram', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await expect(page.locator('#header-more-content')).toBeHidden();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#header-more-content')).toBeHidden();
  const canvas = (await page.locator('.zf-stage').boundingBox())!;
  for (const selector of ['.zf-zoom-controls', '.zf-fullscreen-toggle']) {
    expect((await page.locator(selector).boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  }
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#header-more-content #theme')).toHaveCount(0);
});
