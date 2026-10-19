import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { downloadExport, selectMenuOption } from './menu';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
}
async function cursorAt(page: Page, text: string) {
  await page.locator('#editor').evaluate(async (el, text) => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    const from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length }, scrollIntoView: true });
    view.focus();
  }, text);
}

test('reading source leaves the board and history alone; explicit reveal works on desktop and phone', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const history = await page.evaluate(() => window.history.length);
  await cursorAt(page, 'Capture');
  await expect(page.locator('#reveal-source')).toBeEnabled();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await page.locator('#reveal-source').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-source-selected')).toHaveAttribute('data-shape-id', 'Capture');
  await expect(page.locator('.zf-stage')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-source').click();
  await cursorAt(page, 'Browse');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await source(page).press('ControlOrMeta+Shift+Enter');
  await expect(page.locator('#preview-pane')).toBeVisible();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-source-selected')).toHaveAttribute('data-shape-id', 'Browse');
});

test('routine editing keeps status copy steady and exposes recovery details without layout movement', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const before = await page.locator('#editor').boundingBox();
  await source(page).fill('a: First edit');
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
  await expect(page.locator('#draft-status')).toHaveAttribute('title', /Browser draft saved/);
  await page.evaluate(() => {
    const el = document.querySelector('#draft-status')!;
    const updates: string[] = [];
    (window as typeof window & { statusUpdates: string[] }).statusUpdates = updates;
    new MutationObserver(() => updates.push(el.textContent!)).observe(el, { childList: true, subtree: true });
  });
  await source(page).press('End');
  await source(page).pressSequentially(' updated', { delay: 80 });
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
  await ready(page);
  expect(await page.evaluate(() => (window as typeof window & { statusUpdates: string[] }).statusUpdates)).toEqual([]);
  await expect(page.locator('#preview-status')).toBeHidden();
  await expect(page.locator('#lint-summary')).toBeHidden();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(before!.y);
});

test('saving an example creates a named copy with its history, export names and reload identity', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { showSaveFilePicker?: () => Promise<unknown> };
    target.showSaveFilePicker = async () => ({ name: 'checkout-design.d2', createWritable: async () => ({
      write: async () => {}, close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await ready(page);
  const original = await source(page).textContent();
  await source(page).fill('saved: After');
  await expect(page.locator('.zf-stage')).toContainText('After'); await ready(page);
  await source(page).press('ControlOrMeta+s');
  await expect(page.locator('#filename')).toHaveText('checkout-design.d2');
  await expect(page).toHaveTitle('checkout-design.d2 — Zoomflow');
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText(original!);
  await expect(page).toHaveTitle('• checkout-design.d2 — Zoomflow');
  await source(page).press('ControlOrMeta+Shift+z');
  await expect(source(page)).toHaveText('saved: After');
  await expect(page.locator('.zf-stage')).toContainText('After');
  await ready(page);
  await selectMenuOption(page, '#export-format', 'svg');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  expect((await pending).suggestedFilename()).toBe('checkout-design-root.svg');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options')).toContainText('Saved copy of Order flow');
  await page.getByRole('button', { name: 'Restore original example: Order flow' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await expect(source(page)).toHaveText('saved: After');
  await page.reload(); await ready(page);
  await expect(page.locator('#filename')).toHaveText('checkout-design.d2');
  await expect(page).toHaveTitle('checkout-design.d2 — Zoomflow');
  await expect(source(page)).toHaveText('saved: After');
});

test('link badges distinguish children, ancestors and peers in the live and offline viewers', async ({ page, context }, info) => {
  await page.goto('/'); await ready(page);
  await source(page).fill(`Child: {link: layers.child}
layers: {
  child: {
    Parent: {link: _}
    Peer: {link: _.layers.peer}
    Deeper: {link: layers.deep}
    layers: {deep: {Home: {link: _._}}}
  }
  peer: {Back: {link: _}}
}`);
  await expect(page.getByRole('link', { name: 'Open child board', exact: true })).toBeVisible();
  await ready(page);
  await selectMenuOption(page, '#export-format', 'html');
  const pending = page.waitForEvent('download'); await downloadExport(page);
  const file = info.outputPath('directions.html'); await (await pending).saveAs(file);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(file).href);
  for (const target of [page, offline]) {
    const child = target.getByRole('link', { name: 'Open child board', exact: true });
    await expect(child).toHaveAttribute('data-link-direction', 'child');
    await child.click();
    const parent = target.getByRole('link', { name: 'Return to Root', exact: true });
    const peer = target.getByRole('link', { name: 'Visit peer board', exact: true });
    const deeper = target.getByRole('link', { name: 'Open deep board', exact: true });
    await expect(parent).toHaveAttribute('data-link-direction', 'parent');
    await expect(peer).toHaveAttribute('data-link-direction', 'peer');
    const arrows = await Promise.all([parent, peer, deeper].map((link) => link.locator('.appendix-icon path').getAttribute('d')));
    expect(new Set(arrows).size).toBe(3);
    // Move off the newly rendered shapes before switching to keyboard focus;
    // a delayed pointerover from the preceding click must not become the last input.
    await target.mouse.move(0, 0);
    await parent.focus();
    await expect(target.locator('.zf-link-hint')).toHaveText('Return to Root');
    await peer.hover();
    await expect(target.locator('.zf-link-hint')).toHaveText('Visit peer board');
    await deeper.click();
    await target.getByRole('link', { name: 'Return to Root', exact: true }).click();
    await expect(target.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  }
});

test('a slow save preserves later edits and does not rename a document opened in the meantime', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'saved-copy.d2', createWritable: async () => ({
      write: async (text: string) => { (window as any).written = text; await new Promise<void>((resolve) => { (window as any).finishSave = resolve; }); },
      close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await ready(page);
  await page.locator('#file').setInputFiles({ name: 'original.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Original') });
  await expect(page.locator('#filename')).toHaveText('original.d2'); await ready(page);
  await source(page).fill('a: Saved revision');
  await source(page).press('ControlOrMeta+s');
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishSave)).toBe('function');
  await expect(page.locator('#activity-status')).toHaveText('Saving file…');
  await source(page).fill('a: Later edit');
  await page.locator('#file').setInputFiles({ name: 'unrelated.d2', mimeType: 'text/plain', buffer: Buffer.from('b: Unrelated') });
  await expect(page.locator('#filename')).toHaveText('unrelated.d2');
  await page.evaluate(() => (window as any).finishSave());
  await expect(page.locator('#save-file')).toBeEnabled();
  await expect(page).toHaveTitle('unrelated.d2 — Zoomflow');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option').filter({ hasText: 'saved-copy.d2' }).click();
  await expect(source(page)).toHaveText('a: Later edit');
  await expect(page).toHaveTitle('• saved-copy.d2 — Zoomflow');
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  expect(await page.evaluate(() => (window as any).written)).toBe('a: Saved revision');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options .example-option')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Remove saved-copy.d2 draft', exact: true })).toBeVisible();
});

test('canceling a slow file save clears progress and retains the original document identity', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'canceled.d2', createWritable: async () => ({
      write: async () => new Promise((_resolve, reject) => { (window as any).cancelSave = () => reject(new DOMException('Canceled', 'AbortError')); }),
      close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await ready(page);
  await source(page).fill('a: Keep this');
  await source(page).press('ControlOrMeta+s');
  await expect(page.locator('#activity-status')).toHaveText('Saving file…');
  await page.evaluate(() => (window as any).cancelSave());
  await expect(page.locator('#activity-status')).toBeHidden();
  await expect(page.locator('#save-file')).toBeEnabled();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await expect(source(page)).toHaveText('a: Keep this');
  await expect(page).toHaveTitle('• order.d2 — Zoomflow');
});

test('saving a project file copy keeps its import path and updates its visible identity', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'main-copy.d2', createWritable: async () => ({
      write: async () => {}, close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project');
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await page.locator('#save-file').click();
  await expect(page.locator('#filename')).toHaveText('main-copy.d2');
  await expect(page).toHaveTitle('main-copy.d2 — Zoomflow');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.example-option[title="browser-project/main.d2"]')).toContainText('main.d2 → main-copy.d2');
  await page.locator('.example-option[title="browser-project/lib/nodes.d2"]').click();
  await source(page).fill('Imported: Updated import');
  await page.locator('#example-picker summary').click();
  await page.locator('.example-option[title="browser-project/main.d2"]').click();
  await expect(page.locator('.zf-stage')).toContainText('Updated import');
  await expect(page.locator('#filename')).toHaveText('main-copy.d2');
  await page.reload(); await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Updated import');
  await expect(page).toHaveTitle('main-copy.d2 — Zoomflow');
});
