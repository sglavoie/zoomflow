import { expect, test } from '@playwright/test';
import { previewReady, source } from './helpers';
import { devURL } from './servers';
import { selectMenuOption } from './menu';

// Rewrites /src/compiler.ts, which only the dev server serves as its own module.
test.use({ baseURL: devURL });

test('example pictures yield to edits in either pane and leave failed examples neutral', async ({ page }) => {
  await page.route(url => url.pathname === '/src/compiler.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const probe = window.pictureProbe ||= { workers: 0, held: [], disposed: 0, hold: true, foreground: [] };
      const background = ++probe.workers > 1;
      const compile = d2.compile.bind(d2);
      const dispose = d2.dispose.bind(d2);
      d2.dispose = () => { if (background) probe.disposed++; return dispose(); };
      d2.compile = async (input, options) => {
        if (background) {
          if (probe.hold) await new Promise(resolve => probe.held.push(resolve));
          if (input.inputPath === 'schema.d2') throw new Error('Simulated example failure');
        } else probe.foreground.push(input.fs[input.inputPath]);
        return compile(input, options);
      };
    `) });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.locator('#example-options').getByRole('button', { name: 'Flowchart basics' }).click();
  await expect(page.locator('#viewer-b')).toHaveAttribute('aria-busy', 'false');
  for (const [suffix, text] of [['', 'first: Foreground A'], ['-b', 'second: Foreground B']]) {
    const held = await page.evaluate(() => (window as any).pictureProbe.held.length);
    await expect.poll(() => page.evaluate(() => (window as any).pictureProbe.held.length)).toBeGreaterThan(0);
    const disposed = await page.evaluate(() => (window as any).pictureProbe.disposed);
    await page.locator(`#editor${suffix} .cm-content`).fill(text);
    await expect(page.locator(`#viewer${suffix} .zf-stage`)).toContainText(text.split(': ')[1]);
    await expect(page.locator(`#viewer${suffix}`)).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => page.evaluate(() => (window as any).pictureProbe.disposed)).toBeGreaterThan(disposed);
    await expect.poll(() => page.evaluate(() => (window as any).pictureProbe.held.length)).toBeGreaterThan(held);
  }
  await page.evaluate(() => {
    const probe = (window as any).pictureProbe;
    probe.hold = false;
    for (const release of probe.held) release();
  });
  await page.locator('#example-picker summary').click();
  await expect.poll(() => page.locator('.example-picture img').evaluateAll(images =>
    images.filter(image => !(image as HTMLImageElement).hidden && (image as HTMLImageElement).naturalWidth > 0).length)).toBe(8);
  const failed = page.locator('#example-options').getByRole('button', { name: 'Database schema' });
  await expect(failed.locator('.example-picture')).toBeVisible();
  await expect(failed.locator('img')).toBeHidden();
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('#compile-error-b')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a busy compiler skips superseded previews and compiles the latest edit next', async ({ page }) => {
  // Hold a real compilation at its boundary, without relying on machine speed.
  await page.route((url) => url.pathname === '/src/compiler.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const compile = d2.compile.bind(d2);
      window.previewProbe = { inputs: [], hold: false };
      d2.compile = async (input, options) => {
        window.previewProbe.inputs.push(input.fs[input.inputPath]);
        if (window.previewProbe.hold) {
          window.previewProbe.hold = false;
          await new Promise(resolve => { window.previewProbe.release = resolve; });
        }
        return compile(input, options);
      };
    `) });
  });
  await page.clock.install(); // Step past the 350 ms edit debounce without real waits.
  await page.goto('/');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await page.evaluate(() => {
    const probe = (window as any).previewProbe;
    probe.inputs = []; probe.hold = true;
  });
  await source(page).fill('first: Running');
  await expect.poll(() => page.evaluate(() => typeof (window as any).previewProbe.release)).toBe('function');
  await source(page).fill('second: Superseded');
  await page.clock.runFor(450); // Pass the debounce while first is held.
  await source(page).fill('latest: Keep this');
  await page.clock.runFor(450);
  expect(await page.evaluate(() => (window as any).previewProbe.inputs)).toEqual(['first: Running']);
  await page.evaluate(() => (window as any).previewProbe.release());
  await expect(page.locator('.zf-stage')).toContainText('Keep this');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => (window as any).previewProbe.inputs)).toEqual(['first: Running', 'latest: Keep this']);
  await expect(page.locator('#compile-error')).toBeHidden();
});

test('a failed render keeps the good preview, disables export and offers retry without source errors', async ({ page }) => {
  await page.route((url) => url.pathname === '/src/compiler.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const render = d2.render.bind(d2);
      d2.render = async (...args) => {
        if (window.failNextRender) {
          window.failNextRender = false;
          throw new Error('Simulated render failure');
        }
        return render(...args);
      };
    `) });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await previewReady(page);
  await page.evaluate(() => { (window as any).failNextRender = true; });
  await source(page).fill('latest: Keep this edit');
  await expect(page.locator('#preview-status')).toHaveText('Preview unavailable');
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await expect(page.locator('#export')).toBeDisabled();
  await expect(page.locator('#engine-message')).toContainText('could not be drawn');
  await page.locator('#retry-engine').click();
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('Keep this edit');
  await expect(page.locator('#export')).toBeEnabled();
  expect(errors).toEqual([]);
});
