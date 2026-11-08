import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { selectMenuOption, downloadExport } from './menu';
import { source, previewReady, stubAiStatus } from './helpers';

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

test('hovering a linked shape draws a single outline', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const browse = page.locator('.zf-stage [data-shape-id="Browse"]');
  await browse.hover();
  await expect(browse).toHaveCSS('outline-style', 'solid');
  const link = page.locator('.zf-stage a[data-board="root.layers.checkout"]');
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
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator('a[data-link-direction="child"]').first().click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
});

for (const mode of ['live', 'connected layers', 'offline'] as const) test(`link badge edges remain clickable while zooming out in ${mode}`, async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'badge-edges.d2', mimeType: 'text/plain',
    buffer: Buffer.from('entry: Open detail {link: layers.detail}\nlayers: {detail: {back: Back {link: _}}}') });
  await previewReady(page);
  if (mode === 'connected layers') {
    await page.getByRole('checkbox', { name: 'Show all layers', exact: true }).check();
    await expect(page.locator('[data-layer-board]')).toHaveCount(2);
  } else if (mode === 'offline') {
    const path = info.outputPath('badge-edges.html');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    await (await pending).saveAs(path);
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href);
  }
  const link = page.getByRole('link', { name: mode === 'connected layers' ? 'Return to Root' : 'Open detail board', exact: true });
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

