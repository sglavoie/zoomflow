import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
const folder = fileURLToPath(new URL('../../fixtures/browser-project', import.meta.url));
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}

test('tablet panes stay usable and reference returns to the editor without losing edits', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#mobile-view-switch')).toBeVisible();
  await expect(page.locator('#source-pane')).toBeHidden();
  await page.locator('#mobile-source').click();
  expect((await page.locator('#source-pane').boundingBox())!.width).toBe(768);
  await source(page).fill('tablet: Keep my edits');
  await source(page).press('ControlOrMeta+Shift+/');
  await expect(page.locator('#d2-reference')).toBeVisible();
  await expect(page.locator('#reference-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source(page)).toBeFocused();
  await expect(source(page)).toHaveText('tablet: Keep my edits');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#preview-pane')).toBeVisible();
  await expect(page.locator('#source-pane')).toBeVisible();
  await expect(page.locator('#mobile-view-switch')).toBeHidden();
  await page.setViewportSize({ width: 768, height: 800 });
  await expect(source(page)).toBeVisible();
  await expect(source(page)).toHaveText('tablet: Keep my edits');
});

test('comment shortcut toggles D2 comments and remains undoable', async ({ page }) => {
  await page.goto('/');
  await source(page).fill('a -> b\nb -> c');
  await source(page).press('ControlOrMeta+a');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('# a -> b# b -> c');
  await expect(page.locator('#d2-reference')).toBeHidden();
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a -> bb -> c');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('# a -> b# b -> c');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('a -> bb -> c');
});

test('save shortcut writes to the chosen file and reports disk state beside Save', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { savedSource?: string; showSaveFilePicker?: () => Promise<unknown> }).showSaveFilePicker = async () => ({
      name: 'saved.d2', createWritable: async () => ({
        write: async (text: string) => { (window as typeof window & { savedSource?: string }).savedSource = text; },
        close: async () => {}, abort: async () => {},
      }),
    });
  });
  await page.goto('/');
  await source(page).fill('saved: Shortcut');
  await source(page).press('ControlOrMeta+s');
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { savedSource?: string }).savedSource)).toBe('saved: Shortcut');
  await source(page).fill('saved: Changed again');
  await expect(page.locator('#draft-status')).toContainText('File has unsaved changes');
  await expect(page.locator('#work-status #draft-status')).toBeVisible();
});

test('download fallback is explicit and never claims a disk save or unavailable recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await page.goto('/');
  await expect(page.locator('#save-file')).toHaveText('Download .d2');
  await source(page).fill('download: Keep this');
  const [download] = await Promise.all([page.waitForEvent('download'), source(page).press('ControlOrMeta+s')]);
  expect(await readFile(await download.path(), 'utf8')).toBe('download: Keep this');
  await expect(page.locator('#draft-status')).toContainText('Source download started');
  await expect(page.locator('#draft-status')).toContainText('Browser draft unavailable');
  await expect(page.locator('#draft-status')).not.toContainText('Saved to file');
});

test('diagnostics use one summary and keep the editor in place through failure and recovery', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const before = (await page.locator('#editor').boundingBox())!;
  await source(page).fill('a: Good\nbroken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#ready-summary')).toBeHidden();
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(before.y);
  await page.locator('#go-to-error').click();
  await expect(source(page)).toBeFocused();
  await source(page).fill('a: Fixed');
  await ready(page);
  await expect(page.locator('#go-to-error')).toBeHidden();
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('#ready-summary')).toBeHidden();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(before.y);
});

test('projects group files above examples and removal only affects the chosen project', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'keep.d2', mimeType: 'text/plain', buffer: Buffer.from('keep: My draft') });
  await page.locator('#folder').setInputFiles(folder);
  await ready(page);
  await page.locator('#example-picker summary').click();
  const group = page.getByRole('region', { name: 'browser-project project', exact: true });
  await expect(group.locator('.example-option')).toHaveCount(3);
  await expect(group.locator('.example-row .example-remove')).toHaveCount(0);
  await expect(page.locator('#draft-options > :first-child')).toHaveClass('project-group');
  expect((await page.locator('#draft-options').boundingBox())!.y).toBeLessThan((await page.locator('#example-options').boundingBox())!.y);
  await page.locator('#draft-options .example-option').filter({ hasText: 'keep.d2' }).click();
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options > :first-child')).toContainText('keep.d2');
  const remove = group.getByRole('button', { name: 'Remove browser-project project drafts' });
  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(group).toBeVisible();
  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect(source(page)).toHaveText('keep: My draft');
  await page.reload();
  await ready(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-group')).toHaveCount(0);
  await expect(page.locator('#draft-options')).toContainText('keep.d2');
});

test('appearance is separate from export and desktop canvas controls stay outside the diagram', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#header-more-content')).toBeHidden();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#header-more-content')).toBeHidden();
  const canvas = (await page.locator('.zf-stage').boundingBox())!;
  for (const selector of ['.zf-zoom-controls', '.zf-fullscreen-toggle']) {
    expect((await page.locator(selector).boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  }
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#header-more-content #theme')).toHaveCount(0);
});
