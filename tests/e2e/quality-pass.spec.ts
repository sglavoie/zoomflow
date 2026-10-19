import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectMenuOption, downloadExport } from './menu';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
});

test('format preserves selection, cursor and scroll inside a large edited document', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const text = Array.from({ length: 80 }, (_, i) => `node${i}:{label:Same}`).join('\n');
  await source(page).fill(text); await ready(page);
  const before = await page.locator('.cm-editor').evaluate(async element => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(element)!;
    const start = view.state.doc.toString().indexOf('node50');
    view.dispatch({ selection: { anchor: start + 6, head: start }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
    view.focus();
    return view.state.doc.sliceString(start, start + 6);
  });
  await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  const scroll = await page.locator('.cm-scroller').evaluate(el => el.scrollTop);
  await source(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(before);
  expect(Math.abs(await page.locator('.cm-scroller').evaluate(el => el.scrollTop) - scroll)).toBeLessThan(4);
  await source(page).press('ControlOrMeta+z');
  await expect.poll(() => source(page).evaluate(async element => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    return EditorView.findFromDOM(element)!.state.doc.toString();
  })).toBe(text);
});

for (const offline of [false, true]) test(`compact breadcrumbs retain every ancestor ${offline ? 'offline' : 'live'}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await ready(page);
  const text = readFileSync('fixtures/lint/nested-navigation.d2', 'utf8').replace('Capture: {link: layers.charge}', 'Capture: {link: _}');
  await page.locator('#file').setInputFiles({ name: 'nested.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await ready(page);
  if (offline) {
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const file = info.outputPath('compact-navigation.html');
    await (await pending).saveAs(file);
    await context.setOffline(true);
    await page.goto(pathToFileURL(file).href);
  }
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const initialHeight = (await crumbs.boundingBox())!.height;
  let id = 'root';
  for (const name of ['checkout', 'charge', 'capture']) {
    id += `.layers.${name}`;
    await page.locator(`.zf-stage a[href="${id}"]`).click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  }
  expect((await crumbs.boundingBox())!.height).toBe(initialHeight);
  await expect(crumbs.getByRole('button')).toHaveText(['Root', '…', 'charge', 'capture']);
  const earlier = crumbs.getByRole('button', { name: 'Earlier boards', exact: true });
  await earlier.click();
  const menu = crumbs.getByRole('group', { name: 'Earlier boards' });
  await expect(menu.getByRole('button', { name: 'checkout', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(earlier).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await earlier.click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.goBack();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
});

test('export choices explain outcomes and fit a short phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto('/'); await ready(page);
  await selectMenuOption(page, '#export-format', 'html');
  const menu = page.locator('#header-more-content');
  await expect(page.getByRole('radio', { name: /Interactive diagram HTML/ })).toBeChecked();
  await expect(menu).toContainText('Every board, with drill-down navigation');
  await expect(menu).toContainText('Current board image');
  await expect(menu).toContainText('All boards as SVG');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(450);
  await page.reload(); await ready(page);
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#export-format input[value="html"]')).toBeChecked();
});

test('large document lists filter projects and collapse inactive groups', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await ready(page);
  await page.locator('#file').setInputFiles({ name: 'notes.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Notes') }); await ready(page);
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
  await filter.fill('');
  await expect(group.locator('.example-option').first()).toBeVisible();
});

test('AI server failures explain recovery and hide technical details initially', async ({ page }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-availability')).toContainText('pnpm dev');
  await expect(page.locator('#ai-availability')).not.toContainText('Unexpected token');
  const details = page.locator('#ai-assistant .ai-error-details');
  await expect(details.locator('pre')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('pre')).toContainText('text/html');
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ai-prompt')).toBeEnabled();
  await expect(details).toBeHidden();
});

test('restoring an example can be canceled or undone with its editing history', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await source(page).fill('a: First edit'); await ready(page);
  // Formatting is a real, isolated history event. Consecutive rapid fills may
  // otherwise be one typing group, particularly in Firefox.
  await source(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await source(page).fill('b: Second edit'); await ready(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore Order flow?' });
  await expect(dialog).toContainText('unsaved changes');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source(page)).toHaveText('b: Second edit');
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restore example', exact: true }).click();
  await ready(page);
  await expect(source(page)).toContainText('Checkout');
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source(page)).toHaveText('b: Second edit');
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a: First edit');
});

test('project removal undo recovers imports, edited files and persisted drafts', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await ready(page);
  const original = await source(page).innerText();
  await source(page).fill(`${original}\nextra: Unsaved work`); await ready(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Remove browser-project project drafts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove browser-project?' });
  await expect(dialog).toContainText('1 file has unsaved changes');
  await dialog.getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await source(page).fill('different: Keep this too'); await ready(page);
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('main.d2'); await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await expect(source(page)).toContainText('Unsaved work');
  await page.reload(); await ready(page);
  await expect(source(page)).toContainText('Unsaved work');
  await page.locator('#example-picker summary').click();
  await page.locator('.example-option').filter({ hasText: 'Order flow' }).click();
  await expect(source(page)).toHaveText('different: Keep this too');
});

test('removed file undo restores its save handle, board view and editor history', async ({ page }) => {
  const text = readFileSync('fixtures/order.d2', 'utf8');
  await page.addInitScript(text => {
    const target = window as typeof window & { written?: string; showOpenFilePicker?: () => Promise<unknown[]> };
    target.showOpenFilePicker = async () => [{ name: 'work.d2', getFile: async () => new File([text], 'work.d2'),
      createWritable: async () => ({ write: async (value: string) => { target.written = value; }, close: async () => {}, abort: async () => {} }) }];
  }, text);
  await page.goto('/'); await ready(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('work.d2'); await ready(page);
  await source(page).fill(`${text}\n# Edited`); await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const box = await page.locator('.zf-stage > svg').getAttribute('viewBox');
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Remove work.d2 draft' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove draft', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('order.d2'); await ready(page);
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('work.d2'); await ready(page);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-stage > svg')).toHaveAttribute('viewBox', box!);
  await source(page).press('ControlOrMeta+s');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { written?: string }).written)).toBe(`${text}\n# Edited`);
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).not.toContainText('# Edited');
});

test('undo notices pause while focused and expire without restoring removed drafts', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.clock.install();
  await page.locator('#file').setInputFiles({ name: 'temporary.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Temporary') });
  await ready(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Remove temporary.d2 draft' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove draft', exact: true }).click();
  const notice = page.locator('#document-undo');
  await notice.getByRole('button', { name: 'Undo', exact: true }).focus();
  await page.clock.fastForward(31_000);
  await expect(notice).toBeVisible();
  await source(page).focus();
  await page.clock.fastForward(31_000);
  await expect(notice).toBeHidden();
  await page.reload(); await ready(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.example-option').filter({ hasText: 'temporary.d2' })).toHaveCount(0);
});

test('editing a restored example retires its undo without overwriting the new work', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await source(page).fill('a: Previous work'); await ready(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Restore original example: Order flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore example', exact: true }).click();
  await expect(page.locator('#document-undo')).toBeVisible();
  await source(page).fill('b: New work');
  await expect(page.locator('#document-undo')).toBeHidden();
  await expect(source(page)).toHaveText('b: New work');
});

test('AI availability timeouts offer a retry without exposing abort exceptions', async ({ page }) => {
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/status', async route => { await gate; await route.fulfill({ json: { available: true } }); });
  try {
    await page.goto('/');
    await page.locator('#ai-assistant > summary').click();
    await page.clock.fastForward(6000);
    await expect(page.locator('#ai-availability')).toContainText('timed out');
    await expect(page.locator('#ai-availability')).not.toContainText('AbortError');
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  } finally { release(); }
});
