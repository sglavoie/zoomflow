import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { download } from './export-helpers';
import { previewReady } from './helpers';

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
      expect(transition.options.duration).toBe(520);
    }
    await expect(stage.locator('.zf-return-highlight')).toBeAttached();
    await expect(stage.locator('.zf-board-snapshot, .zf-board-frame')).toHaveCount(0);
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
      if (this.parentElement?.classList.contains('zf-stage') && (this.tagName.toLowerCase() === 'svg' || this.matches('.zf-board-snapshot, .zf-board-frame'))) {
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
    const frame = stage.querySelector('.zf-board-frame');
    for (const element of [content, snapshot, ...(frame ? [frame] : [])]) for (const animation of element.getAnimations()) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) * progress;
    }
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      const matrix = new DOMMatrix(style.transform);
      return { opacity: Number(style.opacity), scale: matrix.a, scaleY: matrix.d, x: matrix.e, y: matrix.f };
    };
    return { incoming: read(content), outgoing: read(snapshot), frame: frame ? {
      ...frame.getBoundingClientRect().toJSON(), fill: getComputedStyle(frame).backgroundColor, image: getComputedStyle(frame).backgroundImage, opacity: Number(getComputedStyle(frame).opacity),
      stroke: getComputedStyle(frame).borderColor, strokeWidth: Number.parseFloat(getComputedStyle(frame).borderTopWidth), radius: Number.parseFloat(getComputedStyle(frame).borderTopLeftRadius),
    } : null, gridRadius: Number.parseFloat((stage as HTMLElement).style.getPropertyValue('--zf-grid-radius')), width: stage.clientWidth, height: stage.clientHeight };
  }, progress);
}

async function sampleHandoff(page: Page, info: TestInfo, direction: string) {
  await page.locator('.zf-board-snapshot').evaluate(image => (image as HTMLImageElement).decode());
  let sawIncoming = false;
  for (const progress of [0.2, 0.35, 0.4, 0.45, 0.5, 0.6, 0.8, 0.95]) {
    const frame = await sampleMotion(page, progress);
    expect(frame.gridRadius).toBeLessThan(2);
    if (progress <= 0.35) expect(frame.incoming.opacity).toBeCloseTo(0, 6);
    if (progress >= 0.45) expect(frame.outgoing.opacity).toBeCloseTo(0, 6);
    if (frame.incoming.opacity > 0.5) {
      sawIncoming = true;
      expect(frame.outgoing.opacity).toBe(0);
    }
    // Even within the short handoff, the two sets of labels cannot both be legible.
    expect(Math.min(frame.incoming.opacity, frame.outgoing.opacity)).toBeLessThan(0.16);
    if ([0.2, 0.4, 0.6, 0.8].includes(progress)) {
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
  await expect(page.locator('.zf-board-snapshot, .zf-board-frame')).toHaveCount(0);
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

    test('grows the clicked shape into the opened board', async ({ page }, info) => {
      const stage = page.locator('.zf-stage');
      const link = stage.locator('a[data-board="root.layers.checkout"]');
      // Measure and activate in one task: hover decorations and responsive layout
      // must not change between the expected geometry and the captured snapshot.
      const { shape, outer, paint, siblings } = await link.evaluate(link => {
        const shape = link.querySelector('[data-shape-id]')!.getBoundingClientRect().toJSON();
        const stage = link.closest<HTMLElement>('.zf-stage')!;
        const outer = stage.getBoundingClientRect().toJSON();
        outer.x += stage.clientLeft; outer.y += stage.clientTop;
        const surface = link.querySelector<SVGGraphicsElement>('[data-shape-id] rect')!;
        const style = getComputedStyle(surface);
        const id = /#(zf-lit-[\w-]+)/.exec(style.fill)?.[1];
        const gradient = id && [...stage.querySelectorAll('linearGradient')].find(node => node.id === id);
        const stops = gradient ? [...gradient.querySelectorAll('stop')].map(stop => getComputedStyle(stop).stopColor) : [];
        const paint = { fill: stops[0] || style.fill, stops, stroke: style.stroke, radius: Number.parseFloat(style.getPropertyValue('rx')) * surface.getScreenCTM()!.a };
        const siblings = [...stage.querySelectorAll('[data-shape-id]')].filter(node => !link.contains(node)).map(node => node.getBoundingClientRect().toJSON());
        link.querySelector('.appendix-icon')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { shape, outer, paint, siblings };
      });
      await expect(stage).toHaveAttribute('data-transition', 'in');
      const backgrounds = await stage.locator('.zf-board-snapshot').evaluate((image: HTMLImageElement) => {
        const copy = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',')[1]), 'image/svg+xml');
        return [...copy.documentElement.querySelectorAll<SVGElement>(':scope > rect, :scope > svg > rect')].map(rect => rect.style.opacity);
      });
      expect(backgrounds).toEqual(['0']);
      const start = await sampleMotion(page, 0);
      await expect(stage.locator('.zf-board-frame')).toHaveAttribute('aria-hidden', 'true');
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(start.frame![key]).toBeCloseTo(shape[key], 0);
      expect(start.frame!.fill).toBe(paint.fill);
      expect(start.frame!.image).toBe(paint.stops.length ? `linear-gradient(${paint.stops.join(', ')})` : 'none');
      expect(start.frame!.stroke).toBe(paint.stroke);
      expect(start.frame!.radius).toBeCloseTo(paint.radius, 1);
      const hidden = await stage.locator('.zf-board-snapshot').evaluate((image: HTMLImageElement) => {
        const copy = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',')[1]), 'image/svg+xml');
        return copy.querySelector<SVGElement>('a[data-board="root.layers.checkout"]')!.style.opacity;
      });
      expect(hidden).toBe('0');
      expect(start.incoming.scale).toBeCloseTo(shape.width / start.width);
      expect(start.outgoing.scale).toBe(1);
      await sampleHandoff(page, info, 'in');
      if (paint.stops.length) expect((await sampleMotion(page, .8)).frame!.opacity).toBeCloseTo(0, 6);
      const end = await sampleMotion(page, 0.999);
      const zoom = Math.max(end.width / shape.width, end.height / shape.height);
      expect(end.outgoing.scale).toBeCloseTo(zoom, 2);
      expect(end.outgoing.scale).toBeGreaterThan(1.12);
      expect(end.outgoing.x + (shape.x - outer.x + shape.width / 2) * end.outgoing.scale).toBeCloseTo(end.width / 2, 1);
      expect(end.outgoing.y + (shape.y - outer.y + shape.height / 2) * end.outgoing.scale).toBeCloseTo(end.height / 2, 1);
      // Sibling boxes have moved beyond the stage, rather than simply disappearing.
      for (const sibling of siblings) {
        const left = end.outgoing.x + (sibling.x - outer.x) * end.outgoing.scale;
        const top = end.outgoing.y + (sibling.y - outer.y) * end.outgoing.scale;
        expect(left >= end.width || top >= end.height || left + sibling.width * end.outgoing.scale <= 0 || top + sibling.height * end.outgoing.scale <= 0).toBe(true);
      }
      const finalStage = (await stage.boundingBox())!;
      expect(end.frame!.x).toBeCloseTo(finalStage.x + 1, 0);
      expect(end.frame!.y).toBeCloseTo(finalStage.y + 1, 0);
      expect(end.frame!.width).toBeCloseTo(end.width, 0);
      expect(end.frame!.height).toBeCloseTo(end.height, 0);
      await finishMotion(page);
      await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    });

    test('shrinks the board back into its shape', async ({ page }, info) => {
      const stage = page.locator('.zf-stage');
      await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
      await expect(stage).toHaveAttribute('data-transition', 'in');
      await finishMotion(page);
      await page.locator('.zf-breadcrumbs button').first().click();
      await expect(stage).toHaveAttribute('data-transition', 'out');
      // The restored parent may have a different fitted view after its context and
      // breadcrumb layout changes. Measure that destination, not the first visit.
      const destination = await sampleMotion(page, 0.999);
      const shape = (await stage.locator('a[data-board="root.layers.checkout"] [data-shape-id]').boundingBox())!;
      const outer = (await stage.boundingBox())!;
      const snapshotSize = await stage.locator('.zf-board-snapshot').evaluate(image => ({ width: Number.parseFloat((image as HTMLElement).style.width), height: Number.parseFloat((image as HTMLElement).style.height) }));
      const parentPaint = await stage.locator('a[data-board="root.layers.checkout"] [data-shape-id] rect').evaluate(surface => {
        const style = getComputedStyle(surface);
        const scale = Math.hypot((surface as SVGGraphicsElement).getScreenCTM()!.a, (surface as SVGGraphicsElement).getScreenCTM()!.b);
        return { strokeWidth: Number.parseFloat(style.strokeWidth) * scale, radius: Number.parseFloat(style.getPropertyValue('rx')) * scale };
      });
      expect(Math.abs(destination.frame!.strokeWidth - parentPaint.strokeWidth)).toBeLessThan(1);
      expect(destination.frame!.radius).toBeCloseTo(parentPaint.radius, 0);
      const start = await sampleMotion(page, 0);
      expect(start.incoming.scale).toBeCloseTo(Math.max(start.width / destination.frame!.width, start.height / destination.frame!.height), 1);
      expect(start.frame!.x).toBeCloseTo(outer.x + 1, 0);
      expect(start.frame!.y).toBeCloseTo(outer.y + 1, 0);
      expect(start.frame!.width).toBeCloseTo(start.width, 0);
      expect(start.frame!.height).toBeCloseTo(start.height, 0);
      expect(start.outgoing.scale).toBe(1);
      await sampleHandoff(page, info, 'out');
      const end = await sampleMotion(page, 0.999);
      const scale = destination.frame!.width / snapshotSize.width;
      expect(end.outgoing.scale).toBeCloseTo(scale, 2);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(end.frame![key] - shape[key])).toBeLessThan(3);
      expect(end.outgoing.x + snapshotSize.width * end.outgoing.scale / 2).toBeCloseTo(end.frame!.x - outer.x - 1 + end.frame!.width / 2, 1);
      expect(end.outgoing.y + snapshotSize.height * end.outgoing.scaleY / 2).toBeCloseTo(end.frame!.y - outer.y - 1 + end.frame!.height / 2, 1);
      await finishMotion(page);
      await expect(stage.locator('.zf-return-highlight')).toBeAttached();
      await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
    });
  });
}

for (const colorScheme of ['light', 'dark'] as const) test(`offline images retain label fonts and colors in ${colorScheme}`, async ({ page, context }, info) => {
  await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  const path = await download(page, 'html', info);
  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  const stage = page.locator('.zf-stage');
  const expected = await stage.locator(':scope > svg text').first().evaluate(async (text: SVGTextElement) => {
    await document.fonts.ready;
    const style = getComputedStyle(text);
    return { family: style.fontFamily, fill: style.fill, width: text.getComputedTextLength() };
  });
  const minimap = await stage.locator('.zf-minimap img').getAttribute('src');
  await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
  const snapshot = await stage.locator('.zf-board-snapshot').getAttribute('src');
  for (const image of [minimap, snapshot]) {
    // Load each serialized image as its own SVG document: like an img, it
    // cannot inherit font faces or theme classes from the export page.
    const actual = await page.evaluate(async image => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:-10000px;width:1000px;height:600px';
      frame.srcdoc = decodeURIComponent(image!.split(',')[1]);
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
      document.body.append(frame);
      try {
        await loaded;
        const doc = frame.contentDocument!;
        const text = doc.querySelector('text') as SVGTextElement;
        const style = frame.contentWindow!.getComputedStyle(text);
        await doc.fonts.load(`${style.fontSize} ${style.fontFamily}`, text.textContent!);
        return { family: style.fontFamily, fill: style.fill, width: text.getComputedTextLength() };
      } finally { frame.remove(); }
    }, image);
    expect(actual.family).toBe(expected.family);
    expect(actual.fill).toBe(expected.fill);
    expect(actual.width).toBeCloseTo(expected.width, 1);
  }
});

test('leaves no frame after a cancelled drill', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  for (const [type, init] of [
    ['wheel', { deltaY: 1 }],
    ['keydown', { key: 'ArrowRight' }],
    ['pointermove', { buttons: 1, pointerType: 'mouse' }],
    ['zf-suspend', {}],
  ] as const) {
    await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
    await expect(stage).toHaveAttribute('data-transition', 'in');
    await sampleMotion(page, 0.4);
    await stage.dispatchEvent(type, init);
    expect(await stage.evaluate(stage => ({
      moving: stage.dataset.transition ?? null,
      snapshot: Boolean(stage.querySelector('.zf-board-snapshot')),
      frame: Boolean(stage.querySelector('.zf-board-frame')),
      animations: stage.querySelector(':scope > svg')!.getAnimations().length,
    }))).toEqual({ moving: null, snapshot: false, frame: false, animations: 0 });
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
  await expect(stage.locator('.zf-board-frame')).toHaveCount(1);
  expect((await sampleMotion(page, 0.75)).outgoing.opacity).toBe(0);
  await expect(stage).toHaveAttribute('data-transition', 'out');
  await finishMotion(page);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
  await expect(stage.locator(':scope > svg')).toHaveCSS('opacity', '1');
  await expect(stage.locator('.zf-return-highlight')).toBeAttached();
});

test('reduced motion skips zooming and still highlights the return node', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The reduced-motion return ring lasts 600 ms. Keep that lifetime independent
  // of worker load and automation latency while still exercising real renders.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(stage.locator('.zf-board-snapshot, .zf-board-frame')).toHaveCount(0);
  expect(await stage.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(stage.locator('.zf-return-highlight')).toBeAttached();
  expect(await stage.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.clock.runFor(601);
  await expect(stage.locator('.zf-return-highlight')).toHaveCount(0);
});

test('scroll input cancels motion and rapid keyboard navigation restores a stable canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"]').press('Enter');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await stage.dispatchEvent('wheel', { deltaY: 1 });
  await expect(stage.locator('.zf-board-snapshot, .zf-board-frame')).toHaveCount(0);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
  await stage.locator('a[data-board="root.layers.checkout.layers.charge"]').press('Enter');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await stage.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await stage.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(stage.locator('.zf-board-snapshot, .zf-board-frame')).toHaveCount(0);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
});

test('downloaded images exclude the frame during a drill', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
  await sampleMotion(page, 0.4);
  await expect(stage.locator('.zf-board-frame')).toHaveCount(1);
  const svg = await readFile(await download(page, 'svg', info));
  expect(svg.toString()).not.toMatch(/zf-board-frame|zf-board-snapshot/);
  const png = await readFile(await download(page, 'png', info));
  await expect(stage.locator('.zf-board-frame')).toHaveCount(1);
  await finishMotion(page);
  expect(await readFile(await download(page, 'svg', info))).toEqual(svg);
  expect(await readFile(await download(page, 'png', info))).toEqual(png);
});

test('non-rectangular links use a bounded frame without morphing paths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  await previewReady(page);
  const kinds = ['oval', 'diamond', 'cylinder'];
  await page.locator('#file').setInputFiles({ name: 'frames.d2', mimeType: 'text/plain', buffer: Buffer.from(
    kinds.map(kind => `${kind}: ${kind} {shape: ${kind}; link: layers.${kind}; style.fill: "#dcecff"; style.stroke: "#456789"}`).join('\n') +
    '\nlayers: {' + kinds.map(kind => `${kind}: {inside: Inside}`).join('\n') + '}') });
  await previewReady(page);
  const stage = page.locator('.zf-stage');
  for (const kind of kinds) {
    const shape = await stage.locator(`a[data-board="root.layers.${kind}"]`).evaluate(link => {
      const box = link.querySelector('[data-shape-id]')!.getBoundingClientRect().toJSON();
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return box;
    });
    await expect(stage).toHaveAttribute('data-transition', 'in');
    const start = await sampleMotion(page, 0);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(start.frame![key] - shape[key])).toBeLessThan(3);
    expect(start.frame!.radius).toBeLessThanOrEqual(Math.min(24, shape.width / 2, shape.height / 2));
    expect(start.frame!.stroke).toBe('rgb(69, 103, 137)');
    await expect(stage.locator('.zf-board-frame path')).toHaveCount(0);
    await finishMotion(page);
    await page.locator('.zf-breadcrumbs button').first().click();
    await expect(stage).toHaveAttribute('data-transition', 'out');
    await finishMotion(page);
  }
});

test('Boards, search and history preserve the drill direction', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  await previewReady(page);
  const stage = page.locator('.zf-stage');
  await page.locator('.board-outline > summary').click();
  await page.getByRole('navigation', { name: 'Boards', exact: true }).locator('.board-outline-open').filter({ has: page.locator('span', { hasText: /^Checkout$/ }) }).click();
  await expect(stage).toHaveAttribute('data-transition', 'in');
  await finishMotion(page);
  await page.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Find in diagram', exact: true });
  await search.getByRole('searchbox').fill('Charge');
  await search.getByRole('list', { name: 'Search results' }).getByRole('button').filter({ hasText: 'ChargeBoard' }).click();
  await expect(stage).toHaveAttribute('data-transition', 'in');
  await finishMotion(page);
  await page.goBack();
  await expect(stage).toHaveAttribute('data-transition', 'out');
  await finishMotion(page);
  await page.goForward();
  await expect(stage).toHaveAttribute('data-transition', 'in');
  await finishMotion(page);
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(stage).toHaveAttribute('data-transition', 'out');
  await finishMotion(page);
});

test('changing reduced motion removes an active frame immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freezeBoardMotion(page);
  await page.goto('/');
  await previewReady(page);
  const stage = page.locator('.zf-stage');
  await stage.locator('a[data-board="root.layers.checkout"] .appendix-icon').click();
  await expect(stage.locator('.zf-board-frame')).toHaveCount(1);
  await sampleMotion(page, 0.4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(stage.locator('.zf-board-frame, .zf-board-snapshot')).toHaveCount(0);
  await expect(stage.locator(':scope > svg')).toHaveCSS('transform', 'none');
  await expect(stage.locator(':scope > svg')).toHaveCSS('opacity', '1');
});
