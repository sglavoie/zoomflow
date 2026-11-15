import { expect, test, type Page } from '@playwright/test';
import { comparesVisuals, openFolder, openView, previewReady, projectFolder, source, visualSkipReason } from './helpers';
import { selectMenuOption } from './menu';

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const query = (page: Page) => palette(page).getByRole('combobox', { name: 'Find a command' });
const command = (page: Page, name: string) => palette(page).getByRole('option', { name, exact: true });
async function open(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(query(page)).toBeFocused();
}
async function run(page: Page, name: string) {
  await open(page);
  await query(page).fill(name);
  await command(page, name).click();
  await expect(palette(page)).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, key, { value: undefined, configurable: true });
  });
  await page.goto('/');
  await previewReady(page);
});

for (const from of ['canvas', 'editor'] as const) test(`opens from the ${from}, isolates keys and returns focus on Escape`, async ({ page }) => {
  const origin = from === 'canvas' ? page.locator('#viewer .zf-stage') : source(page);
  await origin.focus();
  const before = await source(page).textContent();
  await open(page);
  await query(page).fill('no such command');
  await expect(palette(page).getByRole('option')).toHaveCount(0);
  await expect(palette(page).getByRole('status')).toHaveText('No matching commands.');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+Shift+/');
  await expect(page.locator('#d2-reference')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(origin).toBeFocused();
  expect(await source(page).textContent()).toBe(before);
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
});

test('filters by substring with word starts first and runs the selected command', async ({ page }) => {
  await open(page);
  // Format has an interior "ma"; New mind map starts a word with it.
  await query(page).fill('MA');
  const names = await palette(page).getByRole('option').allTextContents();
  expect(names.indexOf('New mind map')).toBeLessThan(names.findIndex(name => name.startsWith('Format')));
  await query(page).fill('tHeMe:');
  await expect(palette(page).getByRole('option')).toHaveCount(3);
  await page.keyboard.press('ArrowUp');
  await expect(command(page, 'Theme: System')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(command(page, 'Theme: Dark')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme button[value="dark"]')).toHaveAttribute('aria-pressed', 'true');
});

test('lists board display names and opens examples through the picker even after it was filtered', async ({ page }) => {
  await run(page, 'Go to board: Charge');
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(page).toHaveURL(/#\/checkout\/charge$/);
  await page.locator('#diagram-search').evaluate((element: HTMLInputElement) => {
    element.value = 'not an example';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await open(page);
  await query(page).fill('Open example:');
  await expect(palette(page).getByRole('option')).toHaveCount(9);
  await command(page, 'Open example: Flowchart basics').click();
  await expect(page.locator('#filename')).toHaveText('flowchart.d2');
  await previewReady(page);
});

test('omits unavailable controls and refreshes Present availability', async ({ page }) => {
  await open(page);
  await expect(command(page, 'Present')).toHaveCount(0);
  await expect(command(page, 'Edit flow')).toHaveCount(1);
  await expect(command(page, 'Edit mind map')).toHaveCount(0);
  await command(page, 'Walkthrough').click();
  await expect(page.locator('.zf-walkthrough')).toBeVisible();
  await run(page, 'Present');
  await expect(page.locator('[data-presentation]')).toBeVisible();
  await open(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-presentation]')).toBeVisible();
  await run(page, 'Present');
  await expect(page.locator('[data-presentation]')).toHaveCount(0);
  await page.getByRole('button', { name: 'End walkthrough' }).click();
  await source(page).fill('a -> b');
  await previewReady(page);
  await open(page);
  await expect(command(page, 'Edit flow')).toHaveCount(0);
  await expect(command(page, 'Edit mind map')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('#format-source').evaluate((button: HTMLButtonElement) => { button.disabled = true; });
  await open(page);
  await expect(palette(page).getByRole('option', { name: /^Format/ })).toHaveCount(0);
});

test('stands down during composition and another modal, and hands focus to commands that open dialogs', async ({ page }) => {
  await source(page).focus();
  await source(page).dispatchEvent('compositionstart');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeHidden();
  await source(page).dispatchEvent('compositionend');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, isComposing: true, bubbles: true })));
  await expect(palette(page)).toBeHidden();
  await run(page, 'Keyboard shortcuts');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText('Command palette');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeHidden();
  await expect(shortcuts.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();
  await page.keyboard.press('Escape');
  await run(page, 'New flow');
  await expect(page.locator('#flow-builder')).toBeVisible();
  expect(await page.locator('#flow-builder').evaluate(element => element.contains(document.activeElement))).toBe(true);
});

test('dispatches source, formatting, reference, export and layout controls', async ({ page }) => {
  await source(page).fill('a->b');
  await previewReady(page);
  await run(page, 'Format');
  await expect(source(page)).toHaveText('a -> b');
  await run(page, 'Hide Source');
  await expect(page.locator('#source-pane')).toBeHidden();
  await run(page, 'Show Source');
  await expect(page.locator('#source-pane')).toBeVisible();
  await run(page, 'D2 reference');
  await expect(page.locator('#d2-reference')).toBeVisible();
  await run(page, 'Export');
  await expect(page.locator('#header-more-content')).toBeVisible();
  await run(page, 'Layout: Split · tabs');
  await expect(page.locator('#workspace')).toHaveAttribute('data-layout', 'tabs');
  await run(page, 'Layout: Single');
  await expect(page.locator('#workspace')).toHaveAttribute('data-layout', 'single');
});

test('file opening preserves the native file chooser activation', async ({ page }) => {
  await open(page);
  await query(page).fill('Open .d2');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'palette.d2', mimeType: 'text/plain', buffer: Buffer.from('palette -> opened') });
  await expect(page.locator('#filename')).toHaveText('palette.d2');
  await previewReady(page);
  await expect(page.locator('#viewer [data-shape-id="palette"]')).toBeVisible();
});

test('View menu opens the palette, contains Tab, and restores focus to View', async ({ page }) => {
  await openView(page);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await expect(query(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(palette(page).getByRole('button', { name: 'Close command palette' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(query(page)).toBeFocused();
  await palette(page).getByRole('button', { name: 'Close command palette' }).click();
  await expect(page.locator('#workspace-view > summary')).toBeFocused();
});

for (const layout of ['tabs', 'quad']) test(`commands follow the last focused pane in ${layout} layout`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await selectMenuOption(page, '#layout', layout);
  await page.locator('#pane-choose-b').click();
  await page.locator('#example-options .example-option').filter({ hasText: 'Flowchart basics' }).click();
  await previewReady(page, 'b');
  await page.locator('#viewer-b .zf-stage').focus();
  await run(page, 'Fullscreen');
  await expect(page.locator('#pane-b')).toHaveAttribute('data-fullscreen', '');
  await expect(page.locator('#pane-a')).not.toHaveAttribute('data-fullscreen', '');
  await page.keyboard.press('Escape');
  await page.locator('#viewer .zf-stage').focus();
  await run(page, 'Go to board: Checkout');
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('#viewer-b .zf-stage')).toHaveAttribute('data-board', 'root');
  if (layout === 'tabs') await page.locator('#mobile-source-b').click();
  await page.locator('#editor-b .cm-content').focus();
  await open(page);
  await query(page).fill('Save .d2');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('flowchart.d2');
});

test('Find command uses the control’s current shortcut and opens diagram search', async ({ page }) => {
  await open(page);
  await expect(command(page, 'Find in diagram').locator('kbd')).toContainText('Shift+F');
  await command(page, 'Find in diagram').click();
  await expect(page.getByRole('dialog', { name: 'Find in diagram', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await openFolder(page, projectFolder);
  await previewReady(page);
  await open(page);
  // In a project the shortcut belongs to Find in project, not Find in diagram.
  await expect(command(page, 'Find in diagram').locator('kbd')).toHaveCount(0);
  await command(page, 'Find in diagram').click();
  await expect(page.getByRole('dialog', { name: 'Find in diagram', exact: true })).toBeVisible();
});

test('Overview follows the existing fit control’s availability', async ({ page }) => {
  await open(page);
  await expect(command(page, 'Overview')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await run(page, 'Overview');
  await expect(page.locator('#viewer .zf-fit')).toBeDisabled();
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`palette ${theme} ${width} @visual`, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await run(page, `Theme: ${theme === 'light' ? 'Light' : 'Dark'}`);
    await open(page);
    await expect(palette(page)).toHaveScreenshot(`palette-${theme}-${width}.png`);
    expect(await palette(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
