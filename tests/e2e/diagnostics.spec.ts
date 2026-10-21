import { expect, test } from '@playwright/test';
import { source, previewReady, chooseProjectFile } from './helpers';

/** Compiler and lint diagnostics: summaries, locations and navigation to source. */

test('diagnostics open every imported location without marking unrelated local text', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await previewReady(page);
  await chooseProjectFile(page, 'lib/nodes.d2');
  await source(page).fill('Imported: {shape: invalid}\nOther: {shape: invalid}');
  await chooseProjectFile(page, 'main.d2');
  await expect(page.locator('#compile-error')).toBeVisible();
  await source(page).press('ControlOrMeta+Shift+m');
  await expect(page.locator('#diagnostics-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#diagnostics-panel')).toBeHidden();
  await expect(source(page)).toBeFocused();
  await page.locator('#show-diagnostics').click();
  const rows = page.locator('#diagnostics-panel li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('lib/nodes.d2:2:');
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await rows.nth(1).getByRole('button').click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('invalid');
  await source(page).fill('a\nlayers: {unused: {b}}'); await previewReady(page);
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('#diagnostics-panel')).toContainText('lib/nodes.d2:2:10');
  await page.locator('#diagnostics-panel li button').click();
  await expect(source(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('unused');
});

test('unlocated compiler failures stay in the list without a fabricated line-one marker', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const request = message as { type?: string; id?: number };
        if (request.type === 'compile') {
          this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, type: 'error', error: 'Layout could not finish' } }));
        } else if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('#compile-error')).toContainText('Source location unavailable');
  await expect(page.locator('#compile-error')).not.toContainText('Line 1');
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await expect(page.locator('#go-to-error')).toBeDisabled();
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('#diagnostics-panel li')).toContainText('Source location unavailable');
  await expect(page.locator('#diagnostics-panel li button')).toHaveCount(0);
});

test('diagnostics use one summary and keep the editor in place through failure and recovery', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  const before = (await page.locator('#editor').boundingBox())!;
  await source(page).fill('a: Good\nbroken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#ready-summary')).toBeHidden();
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(before.y);
  await page.locator('#go-to-error').click();
  await expect(source(page)).toBeFocused();
  await source(page).fill('a: Fixed');
  await previewReady(page);
  await expect(page.locator('#go-to-error')).toBeHidden();
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('#ready-summary')).toBeHidden();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(before.y);
});
