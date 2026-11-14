import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { download } from './export-helpers';

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
          if (Array.isArray(args[0]) && args[0][0]?.transform) transitions.push({ frames: args[0], options: args[1] });
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
      expect(transition.options.duration).toBe(380);
    }
    await expect(stage.locator('.zf-return-highlight')).toBeAttached();
    await expect(stage.locator('.zf-board-snapshot')).toHaveCount(0);
    await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    await expect.poll(async () => (await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon circle').boundingBox())!.width).toBeCloseTo(originalBadgeWidth, 0);
  });
}

// Pause at creation, before even a slow CI browser can finish the transition. Seeking
// the real animations then samples computed styles, not just the supplied keyframes.
async function freezeBoardMotion(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      const animation = animate.apply(this, args);
      if (this.parentElement?.classList.contains('zf-stage') && (this.tagName.toLowerCase() === 'svg' || this.classList.contains('zf-board-snapshot'))) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
}

async function sampleMotion(page: Page, progress: number) {
  return page.locator('.zf-stage').evaluate((stage, progress) => {
    const content = stage.querySelector(':scope > svg')!;
    const snapshot = stage.querySelector('.zf-board-snapshot')!;
    for (const element of [content, snapshot]) for (const animation of element.getAnimations()) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) * progress;
    }
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      const matrix = new DOMMatrix(style.transform);
      return { opacity: Number(style.opacity), scale: matrix.a, x: matrix.e, y: matrix.f };
    };
    return { incoming: read(content), outgoing: read(snapshot), width: stage.clientWidth, height: stage.clientHeight };
  }, progress);
}

async function sampleHandoff(page: Page, info: TestInfo, direction: string) {
  await page.locator('.zf-board-snapshot').evaluate(image => (image as HTMLImageElement).decode());
  let sawIncoming = false;
  for (const progress of [0.25, 0.35, 0.4, 0.45, 0.5, 0.75, 0.95]) {
    const frame = await sampleMotion(page, progress);
    if (progress <= 0.35) expect(frame.incoming.opacity).toBeCloseTo(0, 6);
    if (progress >= 0.45) expect(frame.outgoing.opacity).toBeCloseTo(0, 6);
    if (frame.incoming.opacity > 0.5) {
      sawIncoming = true;
      expect(frame.outgoing.opacity).toBe(0);
    }
    // Even within the short handoff, the two sets of labels cannot both be legible.
    expect(Math.min(frame.incoming.opacity, frame.outgoing.opacity)).toBeLessThan(0.16);
    if ([0.25, 0.5, 0.75].includes(progress)) {
      const path = info.outputPath(`${direction}-${progress * 100}.png`);
      await page.locator('.zf-stage').screenshot({ path, animations: 'allow' });
      await info.attach(`${direction} at ${progress * 100}%`, { path, contentType: 'image/png' });
    }
  }
  expect(sawIncoming).toBe(true);
}

async function finishMotion(page: Page) {
  await page.locator('.zf-stage').evaluate(stage => {
    for (const animation of stage.getAnimations({ subtree: true })) animation.finish();
  });
  await expect(page.locator('.zf-board-snapshot')).toHaveCount(0);
}

for (const runtime of ['live', 'offline']) for (const colorScheme of ['light', 'dark'] as const) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${runtime} ${colorScheme} ${viewport.width}`, () => {
    test.use({ colorScheme, reducedMotion: 'no-preference', viewport });

    test.beforeEach(async ({ page, context }, info) => {
      await freezeBoardMotion(page);
      await page.goto('/');
      await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
      if (runtime === 'offline') {
        const path = await download(page, 'html', info);
        await context.setOffline(true);
        await page.goto(pathToFileURL(path).href);
        await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
      }
    });

    test('zooms into the opened shape without overlapping boards', async ({ page }, info) => {
      const stage = page.locator('.zf-stage');
      const link = stage.locator('a[data-board="root.layers.checkout"]');
      // Measure and activate in one task: hover decorations and responsive layout
      // must not change between the expected geometry and the captured snapshot.
      const { shape, outer } = await link.evaluate(link => {
        const shape = link.querySelector('[data-shape-id]')!.getBoundingClientRect().toJSON();
        const outer = link.closest('.zf-stage')!.getBoundingClientRect().toJSON();
        link.querySelector('.appendix-icon')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { shape, outer };
      });
      await expect(stage).toHaveAttribute('data-transition', 'in');
      const start = await sampleMotion(page, 0);
      expect(start.incoming.scale).toBeLessThan(0.73);
      expect(start.outgoing.scale).toBe(1);
      await sampleHandoff(page, info, 'in');
      const end = await sampleMotion(page, 0.999);
      const zoom = Math.min(end.width / shape.width, end.height / shape.height);
      expect(end.outgoing.scale).toBeCloseTo(zoom, 2);
      expect(end.outgoing.scale).toBeGreaterThan(1.12);
      expect(end.outgoing.x + (shape.x - outer.x + shape.width / 2) * end.outgoing.scale).toBeCloseTo(end.width / 2, 1);
      expect(end.outgoing.y + (shape.y - outer.y + shape.height / 2) * end.outgoing.scale).toBeCloseTo(end.height / 2, 1);
      await finishMotion(page);
      await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    });

    test('zooms back out into the linking shape', async ({ page }, info) => {
      const stage = page.locator('.zf-stage');
      const shape = (await stage.locator('a[data-board="root.layers.checkout"] [data-shape-id]').boundingBox())!;
      const outer = (await stage.boundingBox())!;
      await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
      await expect(stage).toHaveAttribute('data-transition', 'in');
      await finishMotion(page);
      await page.locator('.zf-breadcrumbs button').first().click();
      await expect(stage).toHaveAttribute('data-transition', 'out');
      const start = await sampleMotion(page, 0);
      expect(start.incoming.scale).toBeCloseTo(1.12);
      expect(start.outgoing.scale).toBe(1);
      await sampleHandoff(page, info, 'out');
      const end = await sampleMotion(page, 0.999);
      const scale = Math.max(0.12, Math.min(0.72, Math.max(shape.width / end.width, shape.height / end.height)));
      expect(end.outgoing.scale).toBeCloseTo(scale, 2);
      expect(end.outgoing.x + end.width * end.outgoing.scale / 2).toBeCloseTo(shape.x - outer.x + shape.width / 2, 1);
      expect(end.outgoing.y + end.height * end.outgoing.scale / 2).toBeCloseTo(shape.y - outer.y + shape.height / 2, 1);
      await finishMotion(page);
      await expect(stage.locator('.zf-return-highlight')).toBeAttached();
      await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    });
  });
}

test('wheel, keys and dragging cancel every part of the zoom immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  for (const [type, init] of [
    ['wheel', { deltaY: 1 }],
    ['keydown', { key: 'ArrowRight' }],
    ['pointermove', { buttons: 1, pointerType: 'mouse' }],
  ] as const) {
    await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
    await expect(stage).toHaveAttribute('data-transition', 'in');
    await sampleMotion(page, 0.4);
    await stage.dispatchEvent(type, init);
    expect(await stage.evaluate(stage => ({
      moving: stage.dataset.transition ?? null,
      snapshot: Boolean(stage.querySelector('.zf-board-snapshot')),
      animations: stage.querySelector(':scope > svg')!.getAnimations().length,
    }))).toEqual({ moving: null, snapshot: false, animations: 0 });
    await expect(stage.locator(':scope > svg')).toHaveCSS('opacity', '1');
    await page.locator('.zf-breadcrumbs button').first().click();
    await expect(stage).toHaveAttribute('data-transition', 'out');
    await finishMotion(page);
  }
});

test('a second navigation owns the canvas while the first zoom is still running', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
  await expect(stage).toHaveAttribute('data-transition', 'in');
  await sampleMotion(page, 0.25);
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(stage).toHaveAttribute('data-transition', 'out');
  // Let cancelled animations' promise callbacks run before checking ownership.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(stage.locator('.zf-board-snapshot')).toHaveCount(1);
  expect((await sampleMotion(page, 0.75)).outgoing.opacity).toBe(0);
  await expect(stage).toHaveAttribute('data-transition', 'out');
  await finishMotion(page);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
  await expect(stage.locator(':scope > svg')).toHaveCSS('opacity', '1');
  await expect(stage.locator('.zf-return-highlight')).toBeAttached();
});

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
