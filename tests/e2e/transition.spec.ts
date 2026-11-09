import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 720, height: 600 }]) {
  test(`board navigation moves through its node at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof animate>) {
        if (this.parentElement?.classList.contains('zf-stage') && this.tagName.toLowerCase() === 'svg') {
          const root = document.documentElement;
          const transitions = JSON.parse(root.dataset.transitions ?? '[]');
          transitions.push({ frames: args[0], options: args[1] });
          root.dataset.transitions = JSON.stringify(transitions);
        }
        return animate.apply(this, args);
      };
    });
    await page.goto('/');
    const stage = page.locator('.zf-stage');
    await expect(stage).toHaveAttribute('data-board', 'root');
    await expect(page.locator('html')).not.toHaveAttribute('data-transitions');
    const originalBadgeWidth = (await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon circle').boundingBox())!.width;
    await stage.locator('a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await page.locator('.zf-breadcrumbs button').first().click();
    await expect(stage).toHaveAttribute('data-board', 'root');
    const transitions = JSON.parse((await page.locator('html').getAttribute('data-transitions'))!) as
      { frames: Keyframe[]; options: KeyframeAnimationOptions }[];
    expect(transitions).toHaveLength(2);
    for (const transition of transitions) {
      expect(transition.frames[0].transform).toContain('scale(');
      expect(transition.frames[1].transform).toBe('none');
      expect(transition.options.duration).toBeLessThanOrEqual(300);
    }
    await expect(stage.locator('.zf-return-highlight')).toBeAttached();
    await expect(stage.locator('.zf-board-snapshot')).toHaveCount(0);
    await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    await expect.poll(async () => (await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon circle').boundingBox())!.width).toBeCloseTo(originalBadgeWidth, 0);
  });
}

test('reduced motion skips zooming and still highlights the return node', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(stage.locator('.zf-board-snapshot')).toHaveCount(0);
  expect(await stage.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(stage.locator('.zf-return-highlight')).toBeAttached();
  expect(await stage.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test('scroll input cancels motion and rapid keyboard navigation restores a stable canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"]').press('Enter');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await stage.dispatchEvent('wheel', { deltaY: 1 });
  await expect(stage.locator('.zf-board-snapshot')).toHaveCount(0);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
  await stage.locator('a[data-board="root.layers.checkout.layers.charge"]').press('Enter');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await stage.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await stage.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(stage.locator('.zf-board-snapshot')).toHaveCount(0);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
});
