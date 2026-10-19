import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { downloadExport, selectMenuOption } from './menu';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function selectSource(page: Page, text: string) {
  await page.locator('#editor').evaluate(async (el, text) => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length } });
  }, text);
}
async function insideStage(page: Page, selector: string) {
  const stage = (await page.locator('.zf-stage').boundingBox())!;
  const shape = (await page.locator(selector).boundingBox())!;
  expect(shape.x).toBeGreaterThanOrEqual(stage.x);
  expect(shape.y).toBeGreaterThanOrEqual(stage.y);
  expect(shape.x + shape.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(shape.y + shape.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
}

test('explicit reveal frames an offscreen shape with minimal pan and only zooms out when necessary', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const svg = page.locator('.zf-stage > svg');
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await zoom.click(); await zoom.click();
  const before = await svg.getAttribute('viewBox');
  await selectSource(page, 'Receipt');
  expect(await svg.getAttribute('viewBox')).toBe(before);
  await page.locator('#reveal-source').click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  expect((await svg.getAttribute('viewBox'))!.split(' ')[2]).toBe(before!.split(' ')[2]);
  for (let i = 0; i < 4; i++) await zoom.click();
  const width = Number((await svg.getAttribute('viewBox'))!.split(' ')[2]);
  await page.locator('#reveal-source').click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  expect(Number((await svg.getAttribute('viewBox'))!.split(' ')[2])).toBeGreaterThan(width);
  const revealed = await svg.getAttribute('viewBox');
  await page.locator('#reveal-source').click();
  expect(await svg.getAttribute('viewBox')).toBe(revealed);
});

test('a large diagram is one Tab stop, arrow keys move spatially and focus stays visible', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await source(page).fill(`direction: right\n${Array.from({ length: 30 }, (_, i) => `node${i}`).join(' -> ')}`);
  await expect(page.locator('[data-shape-id="node29"]')).toBeVisible(); await ready(page);
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const stage = page.locator('.zf-stage');
  const zoomedWidth = (await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ')[2];
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-shape-id="node0"]')).toBeFocused();
  await insideStage(page, '[data-shape-id="node0"]');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-shape-id="node1"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-shape-id="node29"]')).toBeFocused();
  await insideStage(page, '[data-shape-id="node29"]');
  expect((await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ')[2]).toBe(zoomedWidth);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-shape-id="node28"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(stage.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-shape-id="node29"]')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('node0');
});

test('project dirty indicators and counts follow edits, undo, saving and reload', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'nodes.d2', createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
  });
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await ready(page);
  const choose = async (path: string) => {
    await page.locator('#example-picker summary').click();
    await page.locator(`.example-option[title="browser-project/${path}"]`).click();
  };
  await choose('lib/nodes.d2');
  await source(page).fill('Imported: Changed');
  await choose('main.d2');
  await source(page).press('ControlOrMeta+End');
  await source(page).press('Enter');
  await source(page).pressSequentially('extra: Added');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('2 unsaved');
  await expect(page.locator('.project-group .draft-unsaved:visible')).toHaveCount(2);
  await page.locator('#example-picker summary').click();
  await page.reload(); await ready(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('2 unsaved');
  await page.locator('.example-option[title="browser-project/lib/nodes.d2"]').click();
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('1 unsaved');
  await expect(page.locator('.example-option[title="browser-project/lib/nodes.d2"] .draft-unsaved')).toBeHidden();
  await page.locator('#example-picker summary').click();
  await source(page).fill('Imported: Another edit');
  await source(page).press('ControlOrMeta+z');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('1 unsaved');
});

test('typing indents nested D2, closing braces dedent, and layers can be folded', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await source(page).fill('layers: {');
  await source(page).press('End'); await source(page).press('Enter');
  await source(page).pressSequentially('detail: {');
  await source(page).press('Enter');
  await source(page).pressSequentially('a: Nested');
  // CodeMirror already inserted the inner closing brace. Continue after it.
  await source(page).press('ArrowDown'); await source(page).press('End');
  await source(page).press('Enter'); await source(page).pressSequentially('}');
  await expect(source(page)).toHaveText('layers: {\n  detail: {\n    a: Nested\n  }\n}', { useInnerText: true });
  await ready(page);
  await source(page).press('ControlOrMeta+Home');
  await source(page).press(process.platform === 'darwin' ? 'Meta+Alt+[' : 'Control+Shift+[');
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
  await page.locator('.cm-foldPlaceholder').click();
  await expect(source(page)).toContainText('a: Nested');
});

test('a stalled preview can restart without losing the good diagram or latest edits', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).workersCreated = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); (window as any).workersCreated++; }
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
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
  await page.goto('/'); await ready(page);
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
  await expect(page.locator('.zf-stage')).toContainText('Latest edit'); await ready(page);
  await expect(page.locator('#engine-notice')).toBeHidden();
  expect(await page.evaluate(() => (window as any).workersCreated)).toBe(2);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: Stalled revision');
});

test.describe('touch and offline navigation', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  test('link cues stay legible and keyboard navigation works in the offline HTML', async ({ page, context }, info) => {
    await page.goto('/'); await ready(page);
    await expect(page.locator('.zf-pan-hint')).toBeVisible();
    await expect(page.locator('.zf-pan-hint')).toContainText('Pinch to zoom');
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download'); await downloadExport(page);
    const file = info.outputPath('touch-navigation.html'); await (await pending).saveAs(file);
    const offline = await context.newPage(); await context.setOffline(true);
    await offline.goto(pathToFileURL(file).href);
    for (const target of [page, offline]) {
      const badges = target.locator('.appendix-icon circle');
      expect(await badges.count()).toBeGreaterThan(0);
      for (const badge of await badges.all()) expect((await badge.boundingBox())!.width).toBeGreaterThanOrEqual(23.9);
      await expect(target.locator('.zf-pan-hint')).toBeVisible();
      const hit = target.locator('a[data-link-direction="child"] .zf-link-hit');
      expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
      await target.locator('.zf-stage').focus();
      await target.keyboard.press('Home');
      await expect(target.locator('.zf-stage [tabindex="0"]')).toHaveCount(1);
      await target.keyboard.press('Tab');
      await expect(target.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
      // The badge itself still opens the same board after resizing and zooming.
      await target.locator('a[data-link-direction="child"] .appendix-icon').click();
      await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
    }
  });
});
