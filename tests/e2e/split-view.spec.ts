import { expect, test, type Page } from '@playwright/test';
import { openDownloads } from './menu';

async function ready(page: Page, suffix = '') {
  await expect(page.locator(`#preview-status${suffix}`)).toHaveText('Preview ready');
  await expect(page.locator(`#viewer${suffix}`)).toHaveAttribute('aria-busy', 'false');
}
async function chooseSecond(page: Page, title: RegExp) {
  await page.locator('#pane-choose-b').click();
  await page.locator('.example-menu').getByRole('button', { name: title }).and(page.locator('.example-option')).click();
  await ready(page, '-b');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await ready(page);
});

test('split tabs edit two documents independently and keep board navigation per pane', async ({ page }) => {
  await page.selectOption('#layout', 'tabs');
  await expect(page.locator('#workspace')).toHaveAttribute('data-layout', 'tabs');
  await expect(page.locator('#pane-empty-b')).toBeVisible();
  await expect(page.locator('#pane-document-b')).toHaveText(/Choose a diagram/);
  await chooseSecond(page, /Flowchart basics/);
  await expect(page.locator('#pane-document-b')).toHaveText(/flowchart\.d2/);
  await expect(page.locator('#filename')).toHaveText('flowchart.d2');

  // Each pane switches between its preview and its source.
  await expect(page.locator('#source-pane-b')).toBeHidden();
  await page.locator('#mobile-source-b').click();
  await expect(page.locator('#source-pane-b')).toBeVisible();
  await expect(page.locator('#preview-pane-b')).toBeHidden();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.locator('#editor-b .cm-content').fill('first -> second');
  await page.locator('#mobile-preview-b').click();
  await expect(page.locator('#viewer-b [data-shape-id="first"]')).toBeVisible();
  await ready(page, '-b');
  await expect(page.locator('#pane-document-b .draft-unsaved')).toBeVisible();
  await expect(page.locator('#viewer [data-shape-id="Browse"]')).toBeVisible();
  await expect(page.locator('#pane-document .draft-unsaved')).toBeHidden();

  // The first pane owns the page URL; the second navigates in memory.
  await page.locator('#viewer .zf-stage a[href="root.layers.checkout"]').click();
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  expect(await page.evaluate(() => location.hash)).toBe('#/checkout');
  await expect(page.locator('#viewer-b .zf-stage')).toHaveAttribute('data-board', 'root');
  await page.locator('#viewer-b .zf-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.locator('#viewer .zf-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
});

test('a document opens in only one pane and header commands follow the active pane', async ({ page }) => {
  await page.selectOption('#layout', 'tabs');
  await chooseSecond(page, /Flowchart basics/);
  await page.locator('#pane-document').click();
  await expect(page.locator('.example-option', { hasText: 'Flowchart basics' }).locator('.example-elsewhere')).toBeVisible();
  await page.locator('.example-option', { hasText: 'Flowchart basics' }).click();
  await expect(page.locator('#pane-document')).toHaveText(/order\.d2/);
  await expect(page.locator('#pane-b')).toHaveAttribute('data-active', '');
  await expect(page.locator('#filename')).toHaveText('flowchart.d2');

  await openDownloads(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source (.d2)' }).click();
  expect((await pending).suggestedFilename()).toBe('flowchart.d2');
  await page.locator('#header-more-toggle').click();

  await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#pane-a')).toHaveAttribute('data-active', '');
  await expect(page.locator('#filename')).toHaveText('order.d2');
});

test('all views show both diagrams and sources, survive reload and adapt to narrower windows', async ({ page }) => {
  await page.selectOption('#layout', 'quad');
  await chooseSecond(page, /Sequence diagram/);
  for (const id of ['#preview-pane', '#source-pane', '#preview-pane-b', '#source-pane-b']) await expect(page.locator(id)).toBeVisible();
  const diagram = (await page.locator('#preview-pane-b').boundingBox())!;
  const editor = (await page.locator('#source-pane-b').boundingBox())!;
  expect(diagram.y + diagram.height).toBeLessThan(editor.y);
  expect((await page.locator('#preview-pane').boundingBox())!.x).toBeLessThan(diagram.x);

  const divider = page.getByRole('separator', { name: 'Resize the two documents' });
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');

  await page.reload();
  await ready(page);
  await ready(page, '-b');
  await expect(page.locator('#workspace')).toHaveAttribute('data-layout', 'quad');
  await expect(page.locator('#pane-document-b')).toHaveText(/sequence\.d2/);
  await expect(divider).toHaveAttribute('aria-valuenow', '25');

  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.locator('#workspace')).toHaveAttribute('data-layout', 'tabs');
  await expect(page.locator('#layout')).toHaveValue('quad');
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('#pane-b')).toBeHidden();
  await page.locator('#pane-switch').click();
  await expect(page.locator('#pane-b')).toBeVisible();
  await expect(page.locator('#pane-a')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(700);
});

test('the second pane can start empty and closes with the split', async ({ page }) => {
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-start-empty-b').click();
  await expect(page.locator('#pane-document-b')).toHaveText(/untitled\.d2/);
  await expect(page.locator('#editor-b .cm-content')).toBeFocused();
  await page.locator('#editor-b .cm-content').fill('x -> y');
  await expect(page.locator('#viewer-b [data-shape-id="x"]')).toBeVisible();

  await page.selectOption('#layout', 'single');
  await expect(page.locator('#pane-b')).toBeHidden();
  await expect(page.locator('#pane-divider')).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  // The draft is kept and can be opened in the single pane.
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options')).toContainText('untitled.d2');
  await page.keyboard.press('Escape');

  await page.selectOption('#layout', 'tabs');
  await expect(page.locator('#pane-empty-b')).toBeVisible();
});

test('closing the split releases the second pane\'s page-level listeners until it reopens', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners: { type: string; signal?: AbortSignal }[] = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (this === window || this === document) listeners.push({ type, signal: typeof options === 'object' ? options.signal : undefined });
      return add.call(this, type, listener, options);
    };
    (window as unknown as { keyListeners: () => number }).keyListeners = () =>
      listeners.filter(({ type, signal }) => ['keydown', 'keyup', 'blur', 'pointerdown'].includes(type) && !signal?.aborted).length;
  });
  await page.reload();
  await ready(page);
  const keyListeners = () => page.evaluate(() => (window as unknown as { keyListeners: () => number }).keyListeners());
  await page.selectOption('#layout', 'tabs');
  await chooseSecond(page, /Flowchart basics/);
  const open = await keyListeners();
  await page.selectOption('#layout', 'single');
  await expect(page.locator('#pane-b')).toBeHidden();
  // The second viewer's Escape/Backspace key, its viewport's Space pan keys (keydown, keyup, blur),
  // fullscreen's Escape key, canvas guidance's input tracking (keydown, pointerdown), the link preview's
  // Escape key, and the board menu's and boards outline's outside presses (pointerdown).
  expect(await keyListeners()).toBe(open - 10);

  await page.selectOption('#layout', 'tabs');
  expect(await keyListeners()).toBe(open);
  await chooseSecond(page, /Flowchart basics/);
  // The reopened pane pans with Space + drag again.
  const stage = page.locator('#viewer-b .zf-stage');
  await page.locator('#viewer-b').getByRole('button', { name: 'Zoom in' }).click();
  // Space on the zoom buttons presses them, so return focus to the canvas first.
  await stage.focus();
  await stage.hover({ position: { x: 40, y: 40 } });
  await page.keyboard.down('Space');
  await expect(stage).toHaveClass(/zf-pan-ready/);
  await page.keyboard.up('Space');
  await expect(stage).not.toHaveClass(/zf-pan-ready/);
  await page.locator('#viewer-b').getByRole('button', { name: 'Fullscreen' }).click();
  await expect(page.locator('#pane-b')).toHaveAttribute('data-fullscreen', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pane-b')).not.toHaveAttribute('data-fullscreen');
});

test('split view keeps one main landmark, distinct editors and per-pane divider sizes', async ({ page }) => {
  await expect(page.locator('#example-picker > summary')).toHaveAttribute('aria-label', 'order.d2 — choose a diagram');
  await page.getByRole('textbox', { name: 'D2 source', exact: true }).fill('a: Changed');
  await expect(page.locator('#example-picker > summary')).toHaveAttribute('aria-label', 'order.d2, unsaved changes — choose a diagram');
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-start-empty-b').click();
  await ready(page, '-b');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Second live preview' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'D2 source', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'D2 source, second diagram', exact: true })).toBeVisible();
  await expect(page.locator('#show-diagnostics')).toHaveText('Diagnostics');
  const first = page.locator('#source-divider');
  const second = page.locator('#source-divider-b');
  const initial = await first.getAttribute('aria-valuenow');
  await second.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const changed = await second.getAttribute('aria-valuenow');
  expect(changed).not.toBe(initial);
  await page.reload(); await ready(page);
  await expect(first).toHaveAttribute('aria-valuenow', initial!);
  await expect(second).toHaveAttribute('aria-valuenow', changed!);
});
