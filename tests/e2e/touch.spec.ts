import { expect, test } from '@playwright/test';
import { comparesVisuals, source, previewReady, selectSource } from './helpers';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });

test('the touch canvas exposes readable cues and a zoom hint before any gesture', async ({ page, browserName }) => {
  await page.goto('/'); await previewReady(page);
  await expect(page.locator('.zf-pan-hint')).toHaveText('Tap Checkout to explore · Pinch to zoom');
  if (comparesVisuals(browserName)) await expect(page).toHaveScreenshot('touch-canvas.png');
  await page.setViewportSize({ width: 844, height: 390 });
  // Link cues resize on the next animation frame after the viewport changes.
  await expect.poll(() => page.locator('.appendix-icon circle').evaluateAll((badges) =>
    badges.length ? Math.min(...badges.map((badge) => badge.getBoundingClientRect().width)) : 0)).toBeGreaterThanOrEqual(23.9);
});

test('touch hit areas share available space without covering neighboring shapes', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  const nodes = Array.from({ length: 12 }, (_, i) => `n${i}`);
  await source(page).fill(`direction: right\n${nodes.map((id) => `${id}: {link: layers.child}`).join('\n')}\n${nodes.join(' -> ')}\nlayers: {child: {a: Detail}}`);
  await expect(page.locator('[data-shape-id="n11"]')).toBeAttached(); await previewReady(page);
  await page.locator('#mobile-preview').click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const areas = await page.locator('.zf-link-hit').evaluateAll((nodes) => nodes.map((node) => {
      const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    expect(areas).toHaveLength(12);
    for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i], b = areas[j];
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(width > 0.1 && height > 0.1).toBe(false);
    }
  }
});

test('reveal from the hidden mobile preview frames the selected shape after the pane opens', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.locator('#mobile-source').click();
  await selectSource(page, 'Receipt');
  await source(page).press('ControlOrMeta+Shift+Enter');
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const stage = (await page.locator('.zf-stage').boundingBox())!;
  const shape = (await page.locator('[data-shape-id="Receipt"]').boundingBox())!;
  expect(shape.x).toBeGreaterThanOrEqual(stage.x);
  expect(shape.x + shape.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(shape.y).toBeGreaterThanOrEqual(stage.y);
  expect(shape.y + shape.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
});
