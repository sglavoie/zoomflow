import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { source, previewReady, stubAiStatus, projectFolder } from './helpers';

const folder = fileURLToPath(new URL('../../fixtures/browser-project', import.meta.url));

test('folder files resolve imports and keep edits across file switches and reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#folder').setInputFiles(folder);
  await expect(page.locator('#filename')).toHaveText('main.d2');
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/lib/nodes.d2"]').click();
  await source(page).fill('Imported: Changed through project');
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
  await source(page).fill('Imported: {');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="browser-project/main.d2"]').click();
  await expect(page.locator('#compile-error')).toContainText('lib/nodes.d2');
  await page.getByRole('button', { name: 'Open lib/nodes.d2' }).click();
  await expect(page.locator('#filename')).toHaveText('nodes.d2');
  await expect(source(page)).toBeFocused();
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
  await source(page).fill('saved: First');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { savedSource?: string }).savedSource)).toBe('saved: First');
  await source(page).fill('saved: Second');
  await expect(page.locator('#draft-status')).toContainText('File has unsaved changes');
  await page.locator('#save-file').click();
  expect(await page.evaluate(() => (window as typeof window & { savedSource?: string }).savedSource)).toBe('saved: Second');
});

test('an opened file can be saved back to its original handle', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { savedOriginal?: string; showOpenFilePicker?: () => Promise<unknown[]> }).showOpenFilePicker = async () => [{
      name: 'original.d2', getFile: async () => new File(['original: Before'], 'original.d2', { type: 'text/plain', lastModified: 1 }),
      createWritable: async () => ({ write: async (text: string) => {
        (window as typeof window & { savedOriginal?: string }).savedOriginal = text;
      }, close: async () => {}, abort: async () => {} }),
    }];
  });
  await page.goto('/');
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('original.d2');
  await source(page).fill('original: After');
  await page.locator('#save-file').click();
  expect(await page.evaluate(() => (window as typeof window & { savedOriginal?: string }).savedOriginal)).toBe('original: After');
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
});

test('directory access opens nested imports and saves an edited file back to its handle', async ({ page }) => {
  await page.addInitScript(() => {
    const fileHandle = (name: string, source: string) => ({ kind: 'file', name,
      getFile: async () => new File([source], name, { type: 'text/plain', lastModified: 1 }),
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
  await source(page).fill('Imported: Saved through folder handle');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toContainText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { savedProjectSource?: string }).savedProjectSource))
    .toBe('Imported: Saved through folder handle');
});

test('project dirty indicators and counts follow edits, undo, saving and reload', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'nodes.d2', createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await previewReady(page);
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
  await page.reload(); await previewReady(page);
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

test('saving a project file copy keeps its import path and updates its visible identity', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'main-copy.d2', createWritable: async () => ({
      write: async () => {}, close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await previewReady(page);
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
  await page.reload(); await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('Updated import');
  await expect(page).toHaveTitle('main-copy.d2 — Zoomflow');
});

test('project removal undo recovers imports, edited files and persisted drafts', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await previewReady(page);
  const original = await source(page).innerText();
  await source(page).fill(`${original}\nextra: Unsaved work`); await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Remove browser-project project drafts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove browser-project?' });
  await expect(dialog).toContainText('1 file has unsaved changes');
  await dialog.getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await source(page).fill('different: Keep this too'); await previewReady(page);
  await page.locator('#document-undo').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#filename')).toHaveText('main.d2'); await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await expect(source(page)).toContainText('Unsaved work');
  await page.reload(); await previewReady(page);
  await expect(source(page)).toContainText('Unsaved work');
  await page.locator('#example-picker summary').click();
  await page.locator('.example-option').filter({ hasText: 'Order flow' }).click();
  await expect(source(page)).toHaveText('different: Keep this too');
});

test('projects group files above examples and removal only affects the chosen project', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'keep.d2', mimeType: 'text/plain', buffer: Buffer.from('keep: My draft') });
  await page.locator('#folder').setInputFiles(projectFolder);
  await previewReady(page);
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
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-group')).toHaveCount(0);
  await expect(page.locator('#draft-options')).toContainText('keep.d2');
});
