import { selectMenuOption } from './menu';
import { expect, test } from '@playwright/test';
import { d2Module, regularFont, source, previewReady } from './helpers';

/** Diagram engine startup, slow previews and restarts. */

test('a stalled preview can restart without losing the good diagram or latest edits', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).workersCreated = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); (window as any).workersCreated++; }
      override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const request = message as { type?: string };
        if (request.type === 'compile' && (window as any).holdCompile) {
          (window as any).compileHeld = true;
          (window as any).holdCompile = false;
          return; // Leave a real worker request pending until disposal rejects it.
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.clock.install();
  await page.evaluate(() => { (window as any).holdCompile = true; });
  await source(page).fill('a: Stalled revision');
  await expect.poll(() => page.evaluate(() => (window as any).compileHeld)).toBe(true);
  await page.clock.fastForward(600); // Keep these edits in separate undo groups.
  await source(page).press('ControlOrMeta+a');
  await source(page).pressSequentially('b: Latest edit');
  await page.clock.fastForward(16_000);
  await expect(page.getByRole('button', { name: 'Restart preview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).workersCreated)).toBe(1);
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await expect(source(page)).toHaveText('b: Latest edit');
  await page.locator('#retry-engine').click();
  await expect(page.locator('.zf-stage')).toContainText('Latest edit'); await previewReady(page);
  await expect(page.locator('#engine-notice')).toBeHidden();
  expect(await page.evaluate(() => (window as any).workersCreated)).toBe(2);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: Stalled revision');
});

test('startup failure offers retry without source diagnostics or lost edits', async ({ page }) => {
  let fail = true;
  let aborted = 0;
  await page.route(regularFont, (route) => {
    if (!fail) return route.continue();
    aborted++;
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('#retry-engine')).toBeVisible();
  await expect(page.locator('.zf-stage')).not.toHaveClass(/zf-starter-preview/);
  await expect(page.locator('#engine-message')).toContainText('could not start');
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  const failedStarts = aborted;
  await source(page).fill('kept: My edits survived');
  // The edit's own preview retries startup; let it fail before startup can succeed,
  // or it recovers by itself and Retry disappears before the click.
  await expect.poll(() => aborted).toBeGreaterThan(failedStarts);
  await expect(page.locator('#retry-engine')).toBeVisible();
  fail = false;
  await page.locator('#retry-engine').click();
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('My edits survived');
  await expect(page.locator('#engine-notice')).toBeHidden();
});

test('slow initial download explains the wait while source remains editable', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(d2Module, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.zf-stage')).toHaveClass(/zf-starter-preview/);
    await expect(page.locator('#engine-message')).toContainText('first download');
    await source(page).fill('a: Edited during startup');
    await expect(page.locator('.zf-stage')).not.toHaveClass(/zf-starter-preview/);
  } finally { release(); }
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('Edited during startup');
});

for (const failure of ['module', 'worker'] as const) {
  test(`retries a failed ${failure} initialization`, async ({ page }) => {
    if (failure === 'module') {
      await page.route(d2Module, (route) => route.abort(), { times: 1 });
    } else {
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        let fail = true;
        window.Worker = class extends NativeWorker {
          override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
            if (fail && (message as { type?: string }).type === 'init') {
              fail = false;
              this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', error: 'Simulated initialization failure' } }));
            } else if (Array.isArray(options)) super.postMessage(message, options);
            else super.postMessage(message, options);
          }
        };
      });
    }
    await page.goto('/');
    await expect(page.locator('#retry-engine')).toBeVisible();
    await expect(page.locator('#compile-error')).toBeHidden();
    await page.locator('#retry-engine').click();
    await previewReady(page);
    await expect(page.locator('.zf-stage')).toContainText('Checkout');
  });
}

test('editing the other pane keeps a stalled pane\'s restart notice', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if ((message as { type?: string }).type === 'compile' && (window as any).holdCompile) {
          (window as any).compileHeld = true;
          (window as any).holdCompile = false;
          return;
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-start-empty-b').click();
  await previewReady(page, 'b');
  await page.clock.install();
  await page.evaluate(() => { (window as any).holdCompile = true; });
  await source(page).fill('a: Stalled first pane');
  await expect.poll(() => page.evaluate(() => (window as any).compileHeld)).toBe(true);
  await page.clock.fastForward(16_000);
  const restart = page.getByRole('button', { name: 'Restart preview', exact: true });
  await expect(restart).toBeVisible();
  await page.getByRole('textbox', { name: 'D2 source, second diagram', exact: true }).fill('b: Second pane edit');
  await previewReady(page, 'b');
  await expect(page.locator('#viewer-b .zf-stage')).toContainText('Second pane edit');
  await expect(restart).toBeVisible();
  await expect(page.locator('#retry-engine')).toHaveAttribute('data-restart', 'true');
  await restart.click();
  await previewReady(page);
  await expect(page.locator('#viewer .zf-stage')).toContainText('Stalled first pane');
  await expect(page.locator('#engine-notice')).toBeHidden();
});

for (const { mobile, touch } of [{ mobile: false, touch: false }, { mobile: true, touch: false }, { mobile: true, touch: true }]) {
  test.describe(touch ? 'touch starter' : mobile ? 'phone starter' : 'desktop starter', () => {
    test.use({ hasTouch: touch });
    for (const theme of ['light', 'dark'] as const) {
      test(`starter image matches the live fit on ${mobile ? 'phone' : 'desktop'} in ${theme}`, async ({ page }) => {
        await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.addInitScript(() => localStorage.clear());
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route(d2Module, async route => { await gate; await route.continue(); });
        // Compare the same layout before and after startup. The delayed loading notice
        // changes the stage height; slow-download behavior is covered separately above.
        // Freeze before navigation, with a deterministic future pause target.
        // Using the wall clock here can race installation in Firefox.
        await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
        await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
        let before: { label: string; x: number; y: number; width: number; height: number }[];
        try {
          await page.goto('/', { waitUntil: 'domcontentloaded' });
          const stage = page.locator('.zf-stage');
          await expect(stage).toHaveClass(/zf-starter-preview/);
          await expect(page.locator('#engine-notice')).toBeHidden();
          // Lay out the background SVG invisibly at its actual CSS size to compare label bounds.
          before = await stage.evaluate(async element => {
            const style = getComputedStyle(element);
            const url = style.backgroundImage.slice(5, -2);
            const source = await (await fetch(url)).text();
            const svg = document.importNode(new DOMParser().parseFromString(source, 'image/svg+xml').documentElement, true);
            const bounds = element.getBoundingClientRect();
            const box = document.createElement('div');
            box.style.cssText = `position:fixed;visibility:hidden;left:${bounds.left + element.clientLeft}px;top:${bounds.top + element.clientTop}px;width:${element.clientWidth}px;height:${element.clientHeight}px`;
            svg.setAttribute('style', `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${style.backgroundSize.replace(/ auto$/, '')};height:auto`);
            box.append(svg); document.body.append(box);
            // WebKit's document.fonts.ready also waits for the deliberately held module request.
            // Load just the starter's embedded fonts while preserving the cold-loading layout.
            await Promise.all([...svg.querySelectorAll('text')].map(text => {
              const font = getComputedStyle(text);
              return document.fonts.load(`${font.fontSize} ${font.fontFamily}`, text.textContent ?? '');
            }));
            const result = [...svg.querySelectorAll('text')].map(text => ({ label: text.textContent!, ...text.getBoundingClientRect().toJSON() }));
            box.remove(); return result;
          });
        } finally {
          release();
          await page.clock.resume();
        }
        await previewReady(page);
        await expect(page.locator('#engine-notice')).toBeHidden();
        expect(before.map(text => text.label)).toEqual(['Browse', 'Checkout', 'Receipt']);
        for (const old of before) {
          const live = await page.locator('.zf-stage text').getByText(old.label, { exact: true })
            .evaluate(text => text.getBoundingClientRect().toJSON());
          for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(live[key] - old[key])).toBeLessThan(1);
        }
      });
    }
  });
}
