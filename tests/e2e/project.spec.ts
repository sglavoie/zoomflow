import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('../../fixtures/browser-project', import.meta.url));

test('folder files resolve imports and keep edits across file switches and reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#folder').setInputFiles(folder);
  await expect(page.locator('#filename')).toHaveText('main.d2');
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/lib/nodes.d2"]').click();
  await page.getByRole('textbox', { name: 'D2 source' }).fill('Imported: Changed through project');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/main.d2"]').click();
  await expect(page.locator('.zf-stage')).toContainText('Changed through project');
  await page.locator('#header-more-toggle').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-project').click()]);
  expect(download.suggestedFilename()).toBe('browser-project.zip');
  await expect(page.locator('#export-status')).toContainText('Project source download started');
  await page.reload();
  await expect(page.locator('#filename')).toHaveText('main.d2');
  await expect(page.locator('.zf-stage')).toContainText('Changed through project');
});

test('an error in an imported file opens that file at the reported source', async ({ page }) => {
  await page.goto('/');
  await page.locator('#folder').setInputFiles(folder);
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/lib/nodes.d2"]').click();
  await page.getByRole('textbox', { name: 'D2 source' }).fill('Imported: {');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/main.d2"]').click();
  await expect(page.locator('#compile-error')).toContainText('lib/nodes.d2');
  await page.getByRole('button', { name: 'Open lib/nodes.d2' }).click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await expect(page.getByRole('textbox', { name: 'D2 source' })).toBeFocused();
});

test('saving uses a file handle after the user chooses a destination', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { savedSource?: string; showSaveFilePicker?: () => Promise<unknown> }).showSaveFilePicker = async () => ({
      name: 'saved.d2',
      createWritable: async () => ({ write: async (text: string) => { (window as typeof window & { savedSource?: string }).savedSource = text; },
        close: async () => {}, abort: async () => {} }),
    });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'D2 source' }).fill('saved: First');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { savedSource?: string }).savedSource)).toBe('saved: First');
  await page.getByRole('textbox', { name: 'D2 source' }).fill('saved: Second');
  await expect(page.locator('#draft-status')).toContainText('File has unsaved changes');
  await page.locator('#save-file').click();
  expect(await page.evaluate(() => (window as typeof window & { savedSource?: string }).savedSource)).toBe('saved: Second');
});

test('an opened file can be saved back to its original handle', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { savedOriginal?: string; showOpenFilePicker?: () => Promise<unknown[]> }).showOpenFilePicker = async () => [{
      name: 'original.d2', getFile: async () => new File(['original: Before'], 'original.d2', { type: 'text/plain' }),
      createWritable: async () => ({ write: async (text: string) => {
        (window as typeof window & { savedOriginal?: string }).savedOriginal = text;
      }, close: async () => {}, abort: async () => {} }),
    }];
  });
  await page.goto('/');
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('original.d2');
  await page.getByRole('textbox', { name: 'D2 source' }).fill('original: After');
  await page.locator('#save-file').click();
  expect(await page.evaluate(() => (window as typeof window & { savedOriginal?: string }).savedOriginal)).toBe('original: After');
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
});

test('directory access opens nested imports and saves an edited file back to its handle', async ({ page }) => {
  await page.addInitScript(() => {
    const fileHandle = (name: string, source: string) => ({ kind: 'file', name,
      getFile: async () => new File([source], name, { type: 'text/plain' }),
      createWritable: async () => ({ write: async (text: string) => {
        (window as typeof window & { savedProjectSource?: string }).savedProjectSource = text;
      }, close: async () => {}, abort: async () => {} }),
    });
    (window as typeof window & { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker = async () => ({
      kind: 'directory', name: 'my-project',
      async *values() {
        yield fileHandle('main.d2', '...@lib/nodes\nImported -> Other');
        yield { kind: 'directory', name: 'lib', async *values() {
          yield fileHandle('nodes.d2', 'Imported: Imported from folder');
        } };
      },
    });
  });
  await page.goto('/');
  await page.locator('#open-folder').click();
  await expect(page.locator('.zf-stage')).toContainText('Imported from folder');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="my-project/lib/nodes.d2"]').click();
  await page.getByRole('textbox', { name: 'D2 source' }).fill('Imported: Saved through folder handle');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { savedProjectSource?: string }).savedProjectSource))
    .toBe('Imported: Saved through folder handle');
});
