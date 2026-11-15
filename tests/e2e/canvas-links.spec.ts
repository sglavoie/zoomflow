import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus, openBoards, closeBoards } from './helpers';

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
  await expect(page.getByRole('link', { name: 'Open Child board', exact: true })).toBeVisible();
  await previewReady(page);
  await selectMenuOption(page, '#export-format', 'html');
  const pending = page.waitForEvent('download'); await downloadExport(page);
  const file = info.outputPath('directions.html'); await (await pending).saveAs(file);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(file).href);
  for (const target of [page, offline]) {
    const child = target.getByRole('link', { name: 'Open Child board', exact: true });
    await expect(child).toHaveAttribute('data-link-direction', 'child');
    await child.click();
    const parent = target.getByRole('link', { name: 'Return to Order flow', exact: true });
    const peer = target.getByRole('link', { name: 'Visit Peer board', exact: true });
    const deeper = target.getByRole('link', { name: 'Open Deeper board', exact: true });
    await expect(parent).toHaveAttribute('data-link-direction', 'parent');
    await expect(peer).toHaveAttribute('data-link-direction', 'peer');
    const arrows = await Promise.all([parent, peer, deeper].map((link) => link.locator('.appendix-icon path').getAttribute('d')));
    expect(new Set(arrows).size).toBe(3);
    // Move off the newly rendered shapes before switching to keyboard focus;
    // a delayed pointerover from the preceding click must not become the last input.
    await target.mouse.move(0, 0);
    await parent.focus();
    await expect(target.locator('.zf-link-hint')).toHaveText('Return to Order flow');
    await peer.hover();
    await expect(target.locator('.zf-link-hint')).toHaveText('Visit Peer board');
    await deeper.click();
    await target.getByRole('link', { name: 'Return to Order flow', exact: true }).click();
    await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  }
});

test('live and offline links distinguish board navigation from external destinations', async ({ page, context }, info) => {
  await page.goto('/');
  await previewReady(page);
  await page.locator('#file').setInputFiles('fixtures/order.d2'); await previewReady(page);
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
  const badge = page.getByRole('link', { name: 'Open a board', exact: true }).locator('.appendix-icon');
  await expect(badge).toHaveCount(1);
  await expect(page.locator('.appendix-icon > title')).toHaveText('Keep this tooltip');
  // The optional count must leave the adjacent authored tooltip unobscured.
  await expect(badge.locator('rect')).toHaveCount(0);
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
  await expect(offline.getByRole('link', { name: 'Open a board' }).locator('.appendix-icon')).toHaveCount(1);
  await expect(offline.getByRole('link', { name: 'Open a board' }).locator('.appendix-icon rect')).toHaveCount(0);
});

test('hover follows the shape while keyboard focus retains a visible selection', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const browse = page.locator('.zf-stage [data-shape-id="Browse"]');
  await browse.hover();
  await expect(browse).toHaveCSS('outline-style', 'none');
  await expect(browse).not.toHaveCSS('filter', 'none');
  const link = page.locator('.zf-stage a[data-board="root.layers.checkout"]');
  await link.locator('[data-shape-id="Checkout"]').hover();
  await expect(link).toHaveCSS('outline-style', 'none');
  await expect(link.locator('.zf-depth-2')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 12, -12)');
  await expect(link.locator('[data-shape-id="Checkout"]')).toHaveCSS('outline-style', 'none');
  // Keyboard navigation back up restores focus to the link leading down.
  await link.locator('.appendix-icon').click();
  await page.locator('.zf-breadcrumbs button').first().focus();
  await page.keyboard.press('Enter');
  await page.mouse.move(0, 0);
  await expect(link).toBeFocused();
  await expect(link.locator('[data-shape-id="Checkout"]')).toHaveClass(/zf-canvas-selected/);
  await expect(page.locator('.zf-selection-ring')).toBeVisible();
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
  // The circle is 32px across; Playwright may include its stroke.
  const size = async () => (await badge.boundingBox())!.width;
  const initial = await size();
  expect(initial).toBeGreaterThanOrEqual(31.9);
  expect(initial).toBeLessThanOrEqual(33.5);
  for (let i = 0; i < 5; i++) {
    await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  }
  await page.setViewportSize({ width: 1050, height: 600 });
  await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Overview (fit diagram)', exact: true }).click();
  await page.locator('a[data-link-direction="child"]').first().locator('.appendix-icon').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
});

for (const mode of ['live', 'connected layers', 'offline'] as const) test(`link badge edges remain clickable while zooming out in ${mode}`, async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'badge-edges.d2', mimeType: 'text/plain',
    buffer: Buffer.from('entry: Open detail {link: layers.detail}\nlayers: {detail: {back: Back {link: _}}}') });
  await previewReady(page);
  if (mode === 'connected layers') {
    await openBoards(page);
    await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
    await closeBoards(page);
    await expect(page.locator('[data-layer-board]')).toHaveCount(2);
  } else if (mode === 'offline') {
    const path = info.outputPath('badge-edges.html');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    await (await pending).saveAs(path);
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href);
  }
  const link = page.getByRole('link', { name: mode === 'connected layers' ? 'Return to Badge edges' : 'Open Open detail board', exact: true });
  const circle = link.locator('.appendix-icon circle');
  const out = page.getByRole('button', { name: 'Zoom out', exact: true });
  for (let i = 0; i <= 6; i++) {
    // Bounding boxes include clipped content. Hit-test near the circle's top, right and
    // bottom edges to verify it is actually painted beyond the shrinking SVG viewports.
    await expect.poll(() => circle.evaluate(node => {
      const box = node.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      return [[x, y - 14], [x + 14, y], [x, y + 14]].every(([px, py]) =>
        document.elementFromPoint(px, py)?.closest('a') === node.closest('a'));
    }), { timeout: 5000 }).toBe(true);
    if (i < 6) await out.click();
  }
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('10%');
  const box = (await circle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 14, box.y + box.height / 2);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', mode === 'connected layers' ? 'root' : 'root.layers.detail');
});


test('fallback link hints stay beside their subject and follow the viewport', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('direction: right\nFirst -> Docs -> Last\nDocs.link: https://example.com');
  await previewReady(page);
  const link = page.getByRole('link', { name: 'Open external link: Docs (new tab)', exact: true });
  await link.hover();
  const hint = page.locator('.zf-link-hint');
  await expect(hint).toBeVisible();
  const check = async () => {
    const box = (await link.locator('[data-shape-id]').boundingBox())!;
    const label = (await hint.boundingBox())!;
    expect(Math.abs(label.x + label.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
    expect(Math.min(Math.abs(label.y - box.y - box.height), Math.abs(box.y - label.y - label.height))).toBeLessThan(12);
  };
  await check();
  const before = (await link.boundingBox())!.width;
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => (await link.boundingBox())!.width).toBeGreaterThan(before);
  await expect.poll(async () => {
    const box = (await link.locator('[data-shape-id]').boundingBox())!, label = (await hint.boundingBox())!;
    return Math.abs(label.x + label.width / 2 - box.x - box.width / 2);
  }).toBeLessThan(2);
  await check();
});
