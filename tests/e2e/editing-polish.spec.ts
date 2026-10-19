import { expect, test, type Page } from '@playwright/test';
import { selectMenuOption } from './menu';
import { pathToFileURL } from 'node:url';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
const ready = async (page: Page) => {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
});

test('phone composer keeps prompt and Send or Cancel together, with settings reachable below', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai', async route => {
    await gate;
    await route.fulfill({ json: { source: null, reply: 'Done.' } }).catch(() => {});
  });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-provider')).toBeHidden();
  for (const size of [{ width: 390, height: 640 }, { width: 390, height: 450 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(size.height);
    await expect.poll(async () => {
      const tools = (await page.locator('.source-tools').boundingBox())!;
      const prompt = (await page.locator('#ai-prompt').boundingBox())!;
      const send = (await page.locator('#ai-send').boundingBox())!;
      return prompt.y >= tools.y && send.y >= tools.y && Math.max(prompt.y + prompt.height, send.y + send.height) <= tools.y + tools.height;
    }).toBe(true);
    const editor = (await page.locator('#editor').boundingBox())!;
    expect(editor.height).toBeGreaterThanOrEqual(79);
    expect(editor.y + editor.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.locator('#ai-prompt').fill('Explain this');
  await page.locator('#ai-send').click();
  await expect(page.locator('#ai-cancel')).toBeVisible();
  await expect(page.locator('#ai-send')).toBeHidden();
  const tools = (await page.locator('.source-tools').boundingBox())!;
  const cancel = (await page.locator('#ai-cancel').boundingBox())!;
  expect(cancel.y + cancel.height).toBeLessThanOrEqual(tools.y + tools.height);
  await page.locator('#ai-cancel').click(); release();
  await expect(page.locator('#ai-prompt')).toHaveValue('Explain this');
  await page.locator('.ai-settings > summary').click();
  await page.locator('#ai-provider').selectOption('codex');
  await expect(page.locator('#ai-availability')).toContainText('Codex is ready');
});

test('unsaved marker survives activity, errors and downloads, and follows disk save and undo', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'kept.d2', createWritable: async () => ({
      write: async () => {}, close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await ready(page);
  const marker = page.locator('#document-unsaved');
  await expect(marker).toBeHidden();
  await source(page).fill('a:{label:Changed}');
  await expect(marker).toBeVisible();
  await ready(page);
  await page.locator('#format-source').click();
  await expect(page.locator('#format-status')).toBeVisible();
  await expect(marker).toBeVisible();
  await ready(page);
  await selectMenuOption(page, '#export-format', 'svg');
  const download = page.waitForEvent('download');
  await page.locator('#export').click(); await download;
  await expect(page.locator('#activity-status')).toContainText('Download started');
  await expect(marker).toBeVisible();
  await page.locator('#header-more-toggle').click();
  await source(page).fill('a: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(marker).toBeVisible();
  await source(page).fill('a: Saved'); await ready(page);
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await expect(marker).toBeHidden();
  await source(page).press('ControlOrMeta+z');
  await expect(marker).toBeVisible();
});

test('wrapped source retains its nesting columns after resize and edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await source(page).fill(`group: {\n    child: This is a long label that should wrap across several visual lines while keeping its nesting visible\n}`);
  const line = page.locator('.cm-line').filter({ hasText: 'child: This' });
  await expect(line).toHaveClass(/zf-indented-line/);
  for (const width of [390, 540]) {
    await page.setViewportSize({ width, height: 640 });
    // Compare the first non-whitespace glyph with the first glyph on each
    // wrapped row; checking CSS alone wouldn't catch a wrong text-indent.
    const rows = await line.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rows: { x: number; y: number }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.textContent!.length; i++) {
          if (/\s/.test(node.textContent![i])) continue;
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (!rows.some(row => Math.abs(row.y - r.y) < 1)) rows.push({ x: r.x, y: r.y });
        }
      }
      return rows;
    });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) expect(Math.abs(row.x - rows[0].x)).toBeLessThan(1);
  }
  await source(page).fill('plain: No indentation');
  await expect(page.locator('.zf-indented-line')).toHaveCount(0);
});

test('export defaults follow board count until an explicit choice, including across reloads', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const selected = page.locator('#export-format input:checked');
  await expect(selected).toHaveValue('html');
  await source(page).fill('one: Single board'); await ready(page);
  await expect(selected).toHaveValue('svg');
  await source(page).fill('one: {link: layers.child}\nlayers: {child: {a: Detail}}'); await ready(page);
  await expect(selected).toHaveValue('html');
  await selectMenuOption(page, '#export-format', 'png');
  await page.locator('#header-more-toggle').click();
  await source(page).fill('one: Single board'); await ready(page);
  await expect(selected).toHaveValue('png');
  await page.reload(); await ready(page);
  await expect(selected).toHaveValue('png');
});

test('clicking the recommended format makes it explicit even without preference storage', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'zoomflow.export-format') throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/'); await ready(page);
  const selected = page.locator('#export-format input:checked');
  await expect(selected).toHaveValue('html');
  await page.locator('#header-more-toggle').click();
  await page.locator('#export-format input[value="html"]').click();
  await page.locator('#header-more-toggle').click();
  await source(page).fill('one: Single board'); await ready(page);
  await expect(selected).toHaveValue('html');
});

for (const offline of [false, true]) test(`link badges keep their screen size through zoom and resize ${offline ? 'offline' : 'live'}`, async ({ page, context }, info) => {
  await page.goto('/'); await ready(page);
  if (offline) {
    await page.locator('#header-more-toggle').click();
    const pending = page.waitForEvent('download'); await page.locator('#export').click();
    const path = info.outputPath('diagram.html'); await (await pending).saveAs(path);
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href);
  }
  const badge = page.locator('a[data-link-direction="child"] .appendix-icon circle').first();
  // The circle is 24px across; Playwright may include its 1px stroke.
  const size = async () => (await badge.boundingBox())!.width;
  const initial = await size();
  expect(initial).toBeGreaterThanOrEqual(23.9);
  expect(initial).toBeLessThanOrEqual(25.1);
  for (let i = 0; i < 5; i++) {
    await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  }
  await page.setViewportSize({ width: 1050, height: 600 });
  await expect.poll(async () => Math.abs(await size() - initial)).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator('a[data-link-direction="child"]').first().click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
});

test('AI edits highlight only changed lines, preserve selection and undo, and remain until dismissed or switching', async ({ page }) => {
  const before = 'a: First\nb: Kept\nc: Last';
  const after = 'a: Updated\nb: Kept\nc: Changed';
  await page.route('**/api/ai', route => route.fulfill({ json: { source: after, reply: 'Updated the outer nodes.' } }));
  await page.clock.install();
  await page.goto('/'); await ready(page);
  await source(page).fill(before); await ready(page);
  await page.locator('#editor').evaluate(async el => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    const from = view.state.doc.toString().indexOf('Kept');
    view.dispatch({ selection: { anchor: from, head: from + 4 } });
  });
  await page.locator('#ai-assistant > summary').click();
  const send = async () => {
    await page.locator('#ai-prompt').fill('Update the outer nodes'); await page.locator('#ai-send').click();
    await expect(page.locator('#ai-status')).toContainText('Diagram updated.');
    await expect(page.locator('.zf-ai-changed')).toHaveText(['a: Updated', 'c: Changed']);
    await expect(page.locator('#ai-change-summary')).toHaveText('Changes at 2 source lines.');
  };
  await send();
  const selected = await page.locator('#editor').evaluate(async el => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  });
  expect(selected).toBe('Kept');
  await page.locator('#ai-undo').click();
  await expect(source(page)).toHaveText(before, { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await send();
  await page.clock.fastForward(16_000);
  await expect(page.locator('.zf-ai-changed')).toHaveText(['a: Updated', 'c: Changed']);
  await page.locator('#ai-dismiss-highlights').click();
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await expect(page.locator('#ai-undo')).toBeVisible();
  await page.locator('#ai-undo').click(); await send();
  await page.locator('#file').setInputFiles({ name: 'other.d2', mimeType: 'text/plain', buffer: Buffer.from('other: Unrelated') });
  await expect(source(page)).toHaveText('other: Unrelated');
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: /^Order flow/ }).click();
  await expect(source(page)).toHaveText(after, { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
});

test('AI deletions reveal their location and Undo on a short phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 450 });
  await page.route('**/api/ai', route => route.fulfill({ json: { source: 'a: Keep\nc: Keep', reply: 'Removed the middle node.' } }));
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await source(page).fill('a: Keep\nb: Remove\nc: Keep'); await ready(page);
  await page.locator('#ai-assistant > summary').click();
  await page.locator('#ai-prompt').fill('Remove the middle node');
  await page.locator('#ai-send').click();
  await expect(page.locator('.zf-ai-changed')).toHaveText(['c: Keep']);
  await expect(page.locator('#ai-change-summary')).toContainText('including deletions');
  await expect.poll(async () => {
    const tools = (await page.locator('.source-tools').boundingBox())!;
    const undo = (await page.locator('#ai-undo').boundingBox())!;
    return undo.y >= tools.y && undo.y + undo.height <= tools.y + tools.height;
  }).toBe(true);
  await page.locator('#ai-undo').click();
  await expect(source(page)).toHaveText('a: Keep\nb: Remove\nc: Keep', { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
});
