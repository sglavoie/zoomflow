import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 720, height: 600 }]) {
  for (const pad of [0, 100]) {
    test(`zoom starts at the rendered shape: ${viewport.width}x${viewport.height}, pad ${pad}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      // Freeze the real Web Animation at time zero and measure its painted DOM
      // on the next frame, rather than asserting an implementation's saved rect.
      await page.addInitScript(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args: Parameters<typeof animate>) {
          const animation = animate.apply(this, args);
          if (this.classList.contains('zf-zoom') && (args[0] as Keyframe[])?.[0]?.transform) {
            animation.pause();
            void animation.ready.then(() => {
              animation.currentTime = 0;
              requestAnimationFrame(() => {
                const rect = this.getBoundingClientRect();
                document.documentElement.dataset.zoomStart = JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
                animation.play();
              });
            });
          }
          return animation;
        };
      });
      await page.goto(`/?pad=${pad}`);
      await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
      await page.evaluate(() => document.fonts.ready);
      const shape = page.locator('.zf-stage a[href="root.layers.checkout"]');
      await shape.hover();
      // Chromium's protocol boundingBox includes SVG stroke extents. The
      // navigation contract uses the anchor's actual DOM client rectangle.
      const box = await shape.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      await shape.click();
      await expect(page.locator('html')).toHaveAttribute('data-zoom-start');
      const start = JSON.parse((await page.locator('html').getAttribute('data-zoom-start'))!) as typeof box;
      for (const axis of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(start[axis] - box[axis]), axis).toBeLessThanOrEqual(2);
      }
      await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
      await expect(page.locator('.zf-zoom')).toHaveCount(0);
    });
  }
}

test('reduced motion skips zoom without losing navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-zoom')).toHaveCount(0);
});
