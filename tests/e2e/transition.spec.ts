import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 720, height: 600 }]) {
  test(`board navigation fades in place at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof animate>) {
        if (this.parentElement?.classList.contains('zf-stage')) {
          const root = document.documentElement;
          const fades = JSON.parse(root.dataset.fades ?? '[]');
          fades.push({ frames: args[0], options: args[1] });
          root.dataset.fades = JSON.stringify(fades);
        }
        return animate.apply(this, args);
      };
    });
    await page.goto('/');
    const stage = page.locator('.zf-stage');
    await expect(stage).toHaveAttribute('data-board', 'root');
    await expect(page.locator('html')).not.toHaveAttribute('data-fades');

    await stage.locator('a[data-board="root.layers.checkout"]').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Root' }).click();
    await expect(stage).toHaveAttribute('data-board', 'root');

    const fades = JSON.parse((await page.locator('html').getAttribute('data-fades'))!) as
      { frames: Keyframe[]; options: KeyframeAnimationOptions }[];
    expect(fades).toHaveLength(2);
    for (const fade of fades) {
      expect(fade.frames).toHaveLength(2);
      expect(Number(fade.frames[0].opacity)).toBeLessThan(1);
      expect(fade.frames[1].opacity).toBe(1);
      expect(fade.frames.every((frame) => Object.keys(frame).every((key) => key === 'opacity'))).toBe(true);
      expect(fade.options.duration).toBeLessThanOrEqual(200);
    }
    await expect(page.locator('.zf-zoom')).toHaveCount(0);
  });
}

test('reduced motion skips the fade without losing navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      if (this.parentElement?.classList.contains('zf-stage')) document.documentElement.dataset.faded = 'true';
      return animate.apply(this, args);
    };
  });
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"]').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('html')).not.toHaveAttribute('data-faded');
});
