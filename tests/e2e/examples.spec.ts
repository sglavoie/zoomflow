import { expect, test, type Page } from '@playwright/test';
import { selectMenuOption, downloadExport } from './menu';
import { comparesVisuals, visualSkipReason, d2Module, source, previewReady, stubAiStatus, openFolder, openView, openBoards } from './helpers';
import { devURL } from './servers';
import { pathToFileURL } from 'node:url';
import { download } from './export-helpers';

async function picturesReady(page: Page, count = 9) {
  await expect.poll(() => page.locator('.example-picture img').evaluateAll(images => images.filter(image =>
    !(image as HTMLImageElement).hidden && (image as HTMLImageElement).naturalWidth > 0).length)).toBe(count);
}

test('example picker shows a picture of each example', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  // Hold only the separate background worker, leaving the user's preview usable.
  await page.route(url => url.pathname === '/src/compiler.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      window.exampleWorkers = (window.exampleWorkers || 0) + 1;
      if (window.exampleWorkers > 1) {
        const compile = d2.compile.bind(d2);
        let first = true;
        d2.compile = async (...args) => {
          if (first) { first = false; await new Promise(resolve => { window.releaseExample = resolve; }); }
          return compile(...args);
        };
      }
    `) });
  });
  await page.goto(devURL); await previewReady(page);
  expect(await page.evaluate(() => (window as any).exampleWorkers)).toBe(1);
  await source(page).fill('draft: My private edited example'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseExample)).toBe('function');
  const rows = page.locator('#example-options .example-row');
  const heights = () => rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
  const before = await heights();
  await expect(page.locator('.example-picture img:not([hidden])')).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseExample());
  await picturesReady(page);
  expect(await heights()).toEqual(before);
  const urls = () => page.locator('.example-picture img').evaluateAll(images => images.map(image => image.getAttribute('src')!));
  const light = await urls();
  const original = decodeURIComponent(light[0]);
  expect(original).toContain('Checkout');
  expect(original).not.toContain('My private edited example');
  await expect(page.locator('.example-picture img:not([alt=""])')).toHaveCount(0);
  await page.locator('#example-picker summary').click();
  await page.locator('#example-picker summary').click();
  expect(await urls()).toEqual(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await urls()).every((url, index) => url !== light[index])).toBe(true);
  await picturesReady(page);
  expect(await heights()).toEqual(before);
  // The intentional lint error still compiles and therefore has a picture.
  await expect(page.locator('#example-options').getByRole('button', { name: 'Find & fix a broken link' }).locator('img')).not.toHaveAttribute('hidden', '');
});

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`example picker pictures in ${theme} at ${width}`, { tag: '@visual' }, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/'); await ready(page);
    await page.locator('#example-picker summary').click();
    await picturesReady(page);
    await expect(page.locator('.example-menu')).toHaveScreenshot(`example-pictures-${theme}-${width}.png`);
  });
}

async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}

async function choose(page: Page, title: string | RegExp, name: string) {
  await page.locator('#example-picker summary').click();
  await page.locator('.example-menu').getByRole('button', { name: title }).and(page.locator('.example-option')).click();
  await expect(page.locator('#filename')).toHaveText(name);
  await ready(page);
  await expect(page.locator('#compile-error')).toBeHidden();
}

const builtIns = [
  ['Order flow', 'order.d2', 3],
  ['Flows & mind maps', 'mixed.d2', 4],
  ['Flowchart basics', 'flowchart.d2', 1],
  ['Service architecture', 'architecture.d2', 2],
  ['Sequence diagram', 'sequence.d2', 1],
  ['Database schema', 'schema.d2', 1],
  ['Layers, scenarios & steps', 'boards.d2', 5],
  ['States & boundary ports', 'states.d2', 2],
  ['Find & fix a broken link', 'diagnostics.d2', 2],
] as const;

test('renders every built-in example with stdlib styling and readable labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await ready(page);
  await expect(page.locator('#example-options .example-option')).toHaveCount(builtIns.length);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [title, name, expectedBoards] of builtIns) {
      await choose(page, title, name);
      await expect(source(page)).toContainText('...@zoomflow');
      const outline = page.locator('.board-outline:visible').first();
      const count = await outline.count() ? await outline.locator('.board-outline-open').count() : 1;
      expect(count, `${name}: all boards are covered`).toBe(expectedBoards);
      // Check detail layers, scenarios and cumulative steps as well as the picker view.
      for (let index = 0; index < count; index++) {
        if (index) {
          await openBoards(page);
          await outline.locator('.board-outline-open').nth(index).click();
          await previewReady(page);
        }
        const stage = page.locator('.zf-stage');
        const board = await stage.getAttribute('data-board');
        await expect(stage.locator('.zf-filled').first(), `${name} ${board} ${theme}`).toBeVisible();
        const surface = stage.locator('.zf-filled > .shape > [fill="#e9f0fa"]').first();
        await expect(surface).toBeVisible();
        const fills = theme === 'light'
          ? ['rgb(237, 242, 248)', 'rgb(255, 243, 219)', 'rgb(227, 243, 235)', 'rgb(238, 233, 248)']
          : ['rgb(38, 54, 76)', 'rgb(68, 55, 33)', 'rgb(32, 61, 54)', 'rgb(52, 45, 73)'];
        expect(fills).toContain(await surface.evaluate(node => getComputedStyle(node).fill));
        await expect(stage.locator('text').first()).toBeVisible();
        // SQL headings live inside .shape; ordinary node labels are its siblings.
        expect(await stage.locator('.zf-filled text[fill="#203044"]').evaluateAll(nodes =>
          [...new Set(nodes.map(node => getComputedStyle(node).fill))])).toEqual([
          theme === 'light' ? 'rgb(32, 48, 68)' : 'rgb(228, 234, 242)',
        ]);
        await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fitted');
        await expect.poll(() => stage.locator('text').evaluateAll(nodes => {
          const labels = nodes.filter(node => node.textContent?.trim() && !node.closest('.appendix-icon'));
          return Math.min(...labels.map(node => parseFloat(getComputedStyle(node).fontSize) *
            Math.abs((node as SVGGraphicsElement).getScreenCTM()!.a)));
        }), { message: `${name} ${board} ${theme}: every fitted label is at least 12 px` }).toBeGreaterThanOrEqual(12);
      }
      if (count > 1) {
        await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button').first().click();
        await ready(page);
      }
    }
  }
});

for (const zoomed of [false, true]) test(`Markdown font loading keeps the fitted bounds stable${zoomed ? ' while zoomed' : ''}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = 0;
  // Deliver the actual embedded font bytes late, so the first fit must use fallback metrics.
  await page.route(url => url.pathname === '/src/compiler.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const render = d2.render.bind(d2);
      d2.render = async (...args) => {
        const svg = await render(...args);
        if (!svg.includes('Try it')) return svg;
        window.delayedDiagramFonts = {};
        let index = 0;
        return svg.replace(/data:application\\/font-woff;base64,([^"]+)/g, (_, data) => {
          const path = '/delayed-diagram-font/' + index++;
          window.delayedDiagramFonts[path] = data;
          return location.origin + path;
        });
      };
    `) });
  });
  await page.route('**/delayed-diagram-font/*', async route => {
    requested++;
    await gate;
    const data = await page.evaluate(path => (window as any).delayedDiagramFonts[path], new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: 'font/woff', body: Buffer.from(data, 'base64') });
  });
  try {
    await page.goto(devURL); await ready(page);
    await choose(page, 'Flowchart basics', 'flowchart.d2');
    await expect.poll(() => requested).toBeGreaterThanOrEqual(3);
    if (zoomed) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    release();
    await page.evaluate(() => document.fonts.ready);
    const frames = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await frames();
    const view = () => page.locator('.zf-stage > svg').getAttribute('viewBox').then(value => value!.split(/\s+/).map(Number));
    const loaded = await view();
    // A real resize remeasures the same loaded fonts. It must not repair a stale first fit.
    await page.setViewportSize({ width: 1439, height: 900 }); await frames();
    await page.setViewportSize({ width: 1440, height: 900 }); await frames();
    const resized = await view();
    for (let index = 0; index < 4; index++) expect(Math.abs(loaded[index] - resized[index])).toBeLessThan(.25);
    await expect(page.locator('.zf-zoom-controls span')).toHaveText(zoomed ? '150%' : 'Fitted');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

async function readableTables(page: Page, theme: 'light' | 'dark') {
  const headings = page.locator('.zf-filled > .shape > text[fill="#203044"]');
  await expect(headings).toHaveText(['Customers', 'Orders', 'Order items']);
  await expect.poll(() => headings.evaluateAll(nodes => [...new Set(nodes.map(node => getComputedStyle(node).fill))]))
    .toEqual([theme === 'light' ? 'rgb(32, 48, 68)' : 'rgb(228, 234, 242)']);
  await expect.poll(() => page.locator('.zf-filled > .shape > text').evaluateAll(nodes => {
    const luminance = (color: string) => {
      const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    return Math.min(...nodes.map(node => {
      const header = node.hasAttribute('fill');
      const surface = node.parentElement!.querySelector(header ? '.class_header' : 'rect.fill-N7')!;
      const ink = luminance(getComputedStyle(node).fill);
      const fill = luminance(getComputedStyle(surface).fill);
      return (Math.max(ink, fill) + .05) / (Math.min(ink, fill) + .05);
    }));
  })).toBeGreaterThanOrEqual(4.5);
}

test('keeps SQL table labels legible live, in frozen SVGs and in offline HTML', async ({ page, browser }, info) => {
  await page.goto('/'); await ready(page);
  await choose(page, 'Database schema', 'schema.d2');
  const offline = await browser.newContext({ offline: true, reducedMotion: 'reduce', storageState: { cookies: [], origins: [] } });
  try {
    const exported = await offline.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await readableTables(page, theme);
      const path = await download(page, 'svg', info);
      // A frozen image keeps the exported palette even in the opposite system theme.
      await exported.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await exported.goto(pathToFileURL(path).href);
      await readableTables(exported, theme);
    }
    const html = await download(page, 'html', info);
    await exported.goto(pathToFileURL(html).href);
    for (const theme of ['light', 'dark'] as const) {
      await exported.emulateMedia({ colorScheme: theme });
      await readableTables(exported, theme);
    }
  } finally { await offline.close(); }
});

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`built-in example styling in ${theme} at ${width}`, { tag: '@visual' }, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/'); await ready(page);
    for (const [title, name] of builtIns) {
      await choose(page, title, name);
      await page.mouse.move(0, 0);
      await expect(page.locator('.zf-stage')).toHaveScreenshot(`example-${name.slice(0, -3)}-${theme}-${width}.png`);
      if (width !== 1440) continue;
      const outline = page.locator('.board-outline:visible').first();
      const count = await outline.count() ? await outline.locator('.board-outline-open').count() : 1;
      for (let index = 1; index < count; index++) {
        await openBoards(page);
        await outline.locator('.board-outline-open').nth(index).click();
        await previewReady(page);
        await page.mouse.move(0, 0);
        await expect(page.locator('.zf-stage')).toHaveScreenshot(`example-${name.slice(0, -3)}-board-${index}-${theme}-${width}.png`);
      }
    }
  });
}

test('examples switch source and preview, start at root and export under their own name', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
  await ready(page, 'root.layers.checkout');
  await choose(page, 'Database schema', 'schema.d2');
  await expect(page.locator('.zf-stage')).toContainText('Customers');
  await expect(source(page)).toContainText('shape: sql_table');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button')).toHaveText(['Database schema']);
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  expect((await pending).suggestedFilename()).toBe('schema-root.svg');
  await choose(page, 'Layers, scenarios & steps', 'boards.d2');
  await page.locator('.zf-stage a[data-board="root.scenarios.failure"]').locator('.appendix-icon').click();
  await ready(page, 'root.scenarios.failure');
  await expect(page.locator('.zf-stage')).toContainText('API unavailable');
  await page.locator('.zf-stage a[data-board="root.steps.cache"]').locator('.appendix-icon').click();
  await ready(page, 'root.steps.cache');
  await page.locator('.zf-stage a[data-board="root.steps.worker"]').locator('.appendix-icon').click();
  await ready(page, 'root.steps.worker');
  await expect(page.locator('.zf-stage')).toContainText('Add cache');
  await expect(page.locator('.zf-stage')).toContainText('Add background jobs');
});

test('keeps edited examples and uploaded files, including a file with an example name', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await source(page).fill('draft: My edited order');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
  await choose(page, 'Flowchart basics', 'flowchart.d2');
  await choose(page, 'Order flow', 'order.d2');
  await expect(source(page)).toHaveText('draft: My edited order');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
  await page.locator('#file').setInputFiles({ name: 'order.d2', mimeType: 'text/plain', buffer: Buffer.from('local: Uploaded file') });
  await expect(page.locator('.zf-stage')).toContainText('Uploaded file');
  await source(page).fill('local: Edited upload');
  await choose(page, 'Service architecture', 'architecture.d2');
  await choose(page, /order\.d2.*Your file/, 'order.d2');
  await expect(page.locator('.zf-stage')).toContainText('Edited upload');
  await choose(page, 'Order flow', 'order.d2');
  await expect(page.locator('.zf-stage')).toContainText('My edited order');
});

test('picker supports keyboard, Escape without navigating, outside dismissal, and narrow dark screens', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
  await ready(page, 'root.layers.checkout');
  const summary = page.locator('#example-picker summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Diagrams and projects' })).toBeVisible();
  await page.keyboard.press('Tab');
  // Firefox also puts scrollable regions in the native Tab order.
  if (await page.locator('.example-menu').evaluate((element) => element === document.activeElement)) {
    await page.keyboard.press('Tab');
  }
  await expect(page.locator('#example-options button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(summary).toBeFocused();
  await expect(page.locator('.example-menu')).toBeHidden();
  await ready(page, 'root.layers.checkout');
  await summary.click();
  await page.locator('header > strong').click();
  await expect(page.locator('.example-menu')).toBeHidden();
  await page.setViewportSize({ width: 601, height: 720 });
  await summary.click();
  await expect.poll(async () => {
    const box = (await page.locator('.example-menu').boundingBox())!;
    return box.x + box.width;
  }).toBeLessThanOrEqual(601);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 720 });
  await expect(page.locator('#header-more-toggle')).toHaveAttribute('aria-expanded', 'false');
  await openView(page);
  await expect(page.locator('#theme')).toBeVisible();
  await selectMenuOption(page, '#theme', 'dark');
  await summary.click();
  const menu = page.locator('.example-menu');
  await expect(menu).toBeVisible();
  // Native details toggle events position the menu asynchronously after opening.
  await expect.poll(async () => {
    const box = (await menu.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 375 && box.y + box.height <= 720;
  }).toBe(true);
  await page.locator('#example-options').getByRole('button', { name: 'Find & fix a broken link' }).click();
  await ready(page);
  await expect(page.locator('#lint-summary')).toHaveText('1 lint error, 1 warning');
});

test('rapid example changes during compiler startup only publish the last selection', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(d2Module, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    for (const name of ['Flowchart basics', 'Database schema', 'Sequence diagram']) {
      await page.locator('#example-picker summary').click();
      await page.locator('#example-options').getByRole('button', { name }).click();
    }
  } finally { release(); }
  await ready(page);
  await expect(page.locator('#filename')).toHaveText('sequence.d2');
  await expect(page.locator('.zf-stage')).toContainText('Place order');
  await expect(page.locator('#compile-error')).toBeHidden();
});

test('picker groups drafts, marks modified examples and restores the original', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  const original = await source(page).textContent();
  await source(page).fill('changed: My draft');
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  const order = page.locator('#example-options').getByRole('button', { name: /Order flow.*Modified/ });
  await expect(order).toContainText('Edited');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(source(page)).toHaveText('changed: My draft');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await previewReady(page);
  await expect(source(page)).toHaveText(original!);
  await source(page).press('ControlOrMeta+z');
  expect(await source(page).textContent()).toBe(original);
  await page.locator('#file').setInputFiles({ name: 'local.d2', mimeType: 'text/plain', buffer: Buffer.from('local: Draft') });
  await page.locator('#example-picker summary').click();
  await expect(page.getByRole('heading', { name: 'Your drafts' })).toBeVisible();
  await expect(page.locator('#draft-options')).toContainText('local.d2');
  await expect(page.locator('#example-options')).not.toContainText('local.d2');
  await page.reload();
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options')).toContainText('Edited');
});

test('large document lists filter projects and collapse inactive groups', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await openFolder(page, 'fixtures/browser-project'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'notes.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Notes') });
  // The file is read asynchronously; the previous document's preview is also ready.
  await expect(page.locator('#filename')).toHaveText('notes.d2'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  const group = page.getByRole('region', { name: 'browser-project project', exact: true });
  const toggle = group.getByRole('button', { name: 'browser-project', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(group.locator('.example-option').first()).toBeHidden();
  const filter = page.getByRole('searchbox', { name: 'Find a diagram or project' });
  await filter.fill('nodes.d2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.example-option:visible')).toHaveCount(1);
  await page.locator('.example-option:visible').click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await page.locator('#example-picker summary').click();
  await filter.fill('no such file');
  await expect(page.getByText('No matching diagrams. Try a filename or project name.')).toBeVisible();
  await page.reload(); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await expect(filter).toHaveValue('no such file');
  await expect(page.getByText('No matching diagrams. Try a filename or project name.')).toBeVisible();
  await filter.fill('');
  await expect(group.locator('.example-option').first()).toBeVisible();
});

test('restoring an example can be canceled or undone with its editing history', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await source(page).fill('a: First edit'); await previewReady(page);
  // Formatting is a real, isolated history event. Consecutive rapid fills may
  // otherwise be one typing group, particularly in Firefox.
  await source(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await source(page).fill('b: Second edit'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore Order flow?' });
  await expect(dialog).toContainText('unsaved changes');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source(page)).toHaveText('b: Second edit');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restore example', exact: true }).click();
  await previewReady(page);
  await expect(source(page)).toContainText('Checkout');
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveText('b: Second edit');
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: First edit');
});

test('editing a restored example retires its undo without overwriting the new work', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await source(page).fill('a: Previous work'); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await expect(page.locator('#document-undo')).toBeVisible();
  await source(page).fill('b: New work');
  await expect(page.locator('#document-undo')).toBeHidden();
  await expect(source(page)).toHaveText('b: New work');
});
