import { selectMenuOption } from './menu';
import { expect, test } from '@playwright/test';
import { openDownloads } from './menu';
import { source, previewReady, stubAiStatus, chooseExample } from './helpers';

/** Documents: drafts, recovery, saving to disk, downloads and removal with undo. */

test('two drafts opened from the same disk file cannot overwrite a pending save', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await stubAiStatus(page);
  await page.addInitScript(() => {
    const probe = (window as any).saveProbe = { source: 'x: Original', version: 1, writes: [] as string[], finish: undefined as (() => void) | undefined };
    (window as any).showOpenFilePicker = async () => [{
      kind: 'file', name: 'shared.d2',
      isSameEntry: async (other: FileSystemHandle) => other.name === 'shared.d2',
      getFile: async () => new File([probe.source], 'shared.d2', { lastModified: probe.version }),
      createWritable: async () => {
        let source = '';
        return {
          write: async (text: string) => { source = text; probe.writes.push(text); },
          close: async () => {
            if (probe.writes.length === 1) await new Promise<void>(resolve => { probe.finish = resolve; });
            probe.source = source; probe.version++;
          },
          abort: async () => {},
        };
      },
    }];
  });
  await page.goto('/');
  await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('shared.d2');
  await source(page).fill('x: First draft');
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-start-empty-b').click();
  await page.locator('#file').click();
  await expect(page.locator('#pane-document-b .pane-document-name')).toHaveText('shared.d2');
  await previewReady(page, 'b');
  await page.locator('#editor-b .cm-content').fill('x: Second draft');
  // Save in the inactive pane must activate it and write on the same click, including in WebKit.
  await page.locator('#save-file').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).saveProbe.finish)).toBe('function');
  await page.locator('#editor-b .cm-content').focus();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#activity-status-b')).toContainText('still in progress');
  expect(await page.evaluate(() => (window as any).saveProbe.writes)).toEqual(['x: First draft']);
  await page.evaluate(() => (window as any).saveProbe.finish());
  await expect(page.locator('#save-file')).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Overwrite file', exact: true }).click();
  await expect(page.locator('#draft-status-b')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).saveProbe.source)).toBe('x: Second draft');
});

test('a slow save follows an example moved to the other pane and prevents overlapping writes', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await stubAiStatus(page);
  await page.addInitScript(() => {
    const probe = (window as any).saveProbe = { picks: 0, writes: [] as string[], finish: undefined as (() => void) | undefined };
    const handle = { kind: 'file', name: 'saved-order.d2',
      getFile: async () => new File([probe.writes.at(-1) ?? ''], 'saved-order.d2', { lastModified: probe.writes.length }),
      createWritable: async () => ({
        write: async (text: string) => { probe.writes.push(text); },
        close: () => probe.writes.length === 1 ? new Promise<void>(resolve => { probe.finish = resolve; }) : Promise.resolve(),
        abort: async () => {},
      }),
    };
    (window as any).showSaveFilePicker = async () => { probe.picks++; return handle; };
  });
  await page.goto('/');
  await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await source(page).fill('x: Source being saved');
  await page.locator('#save-file').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).saveProbe.finish)).toBe('function');
  await chooseExample(page, /Flowchart basics/);
  await page.locator('#pane-choose-b').click();
  await page.locator('.example-option').filter({ hasText: 'Order flow' }).click();
  await previewReady(page, 'b');
  await page.locator('#editor-b .cm-content').fill('x: Later edits');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#activity-status-b')).toContainText('still in progress');
  expect(await page.evaluate(() => (window as any).saveProbe.writes)).toEqual(['x: Source being saved']);
  expect(await page.evaluate(() => (window as any).saveProbe.picks)).toBe(1);
  await page.evaluate(() => (window as any).saveProbe.finish());
  await expect(page.locator('#save-file')).toBeEnabled();
  await expect(page.locator('#filename')).toHaveText('saved-order.d2');
  await expect(page.locator('#pane-document-b .pane-document-name')).toHaveText('saved-order.d2');
  await expect(page.locator('#draft-status-b')).toHaveText('File has unsaved changes');
  await expect(page.locator('#editor-b .cm-content')).toHaveText('x: Later edits');
  await expect(page.locator('#pane-document .pane-document-name')).toHaveText('flowchart.d2');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#draft-status-b')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).saveProbe.writes)).toEqual(['x: Source being saved', 'x: Later edits']);
  expect(await page.evaluate(() => (window as any).saveProbe.picks)).toBe(1);
});

for (const delayed of ['getFile', 'text'] as const) {
  test(`a newer file selection wins when an older ${delayed} finishes last`, async ({ page }) => {
    await stubAiStatus(page);
    await page.addInitScript((delayed) => {
      let count = 0;
      (window as any).showOpenFilePicker = async () => {
        const first = ++count === 1;
        const file = new File([first ? 'old: Older selection' : 'latest: Latest selection'], first ? 'old.d2' : 'latest.d2');
        if (first && delayed === 'text') file.text = () => new Promise(resolve => { (window as any).finishOldOpen = () => resolve('old: Older selection'); });
        return [{ name: file.name, isSameEntry: async () => false,
          getFile: () => first && delayed === 'getFile' ? new Promise(resolve => { (window as any).finishOldOpen = () => resolve(file); }) : Promise.resolve(file) }];
      };
    }, delayed);
    await page.goto('/');
    await previewReady(page);
    await page.locator('#file').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).finishOldOpen)).toBe('function');
    await page.locator('#file').click();
    await expect(page.locator('#filename')).toHaveText('latest.d2');
    await previewReady(page);
    // Release and drain the older read before checking that it cannot activate a draft.
    await page.evaluate(async () => {
      (window as any).finishOldOpen();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await expect(page.locator('#filename')).toHaveText('latest.d2');
    await expect(source(page)).toHaveText('latest: Latest selection');
    await expect(page.locator('.zf-stage')).toContainText('Latest selection');
    await page.locator('#example-picker summary').click();
    await expect(page.locator('#draft-options .example-option')).toHaveCount(1);
  });
}

test('renaming during a pending save keeps the new name and asks for a new file on the next save', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = (window as any).saveProbe = { suggested: '', finish: undefined as (() => void) | undefined };
    const handle = (name: string, slow = false) => ({ name,
      getFile: async () => new File(['a -> b'], name, { lastModified: 1 }),
      createWritable: async () => ({
        write: async () => {},
        close: () => slow ? new Promise<void>(resolve => { probe.finish = resolve; }) : Promise.resolve(),
        abort: async () => {},
      }),
    });
    (window as any).showOpenFilePicker = async () => [handle('work.d2', true)];
    (window as any).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => {
      probe.suggested = suggestedName;
      return handle(suggestedName);
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('work.d2'); await previewReady(page);
  await source(page).fill('a: Edited');
  await page.locator('#save-file').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).saveProbe.finish)).toBe('function');
  await openDownloads(page);
  await page.locator('#export-name').fill('renamed work');
  await page.locator('#export-name').press('Enter');
  await page.evaluate(() => (window as any).saveProbe.finish());
  await expect(page.locator('#save-file')).toBeEnabled();
  await expect(page.locator('#filename')).toHaveText('renamed work.d2');
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await source(page).press('ControlOrMeta+s');
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).saveProbe.suggested)).toBe('renamed work.d2');
});

test('the save shortcut applies a name still being typed before saving', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { suggested?: string; showOpenFilePicker?: () => Promise<unknown[]>; showSaveFilePicker?: (options: { suggestedName: string }) => Promise<unknown> };
    const handle = (name: string) => ({ name, getFile: async () => new File(['a -> b'], name, { lastModified: 1 }),
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) });
    target.showOpenFilePicker = async () => [handle('work.d2')];
    target.showSaveFilePicker = async ({ suggestedName }) => { target.suggested = suggestedName; return handle(suggestedName); };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('work.d2'); await previewReady(page);
  await openDownloads(page);
  await page.locator('#export-name').fill('typed name');
  await page.locator('#export-name').press('ControlOrMeta+s');
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as typeof window & { suggested?: string }).suggested)).toBe('typed name.d2');
  await expect(page.locator('#filename')).toHaveText('typed name.d2');
  // Leaving the field afterwards keeps the file the save chose.
  await page.locator('#export-name').blur();
  await expect(page.locator('#activity-status')).not.toContainText('Save asks where to save it');
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
});

test('a blank or unedited name keeps an opened file linked to it', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { written?: string[]; showOpenFilePicker?: () => Promise<unknown[]>; showSaveFilePicker?: () => Promise<unknown> };
    target.written = [];
    const handle = { name: 'Work.D2', getFile: async () => new File(['a -> b'], 'Work.D2', { lastModified: 1 }),
      createWritable: async () => ({ write: async (text: string) => { target.written!.push(text); }, close: async () => {}, abort: async () => {} }) };
    target.showOpenFilePicker = async () => [handle];
    target.showSaveFilePicker = async () => { throw new Error('Save should write back to Work.D2'); };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('Work.D2'); await previewReady(page);
  await openDownloads(page);
  await expect(page.locator('#export-name')).toHaveValue('Work');
  await page.locator('#export-name').fill('  ');
  await page.locator('#export-name').press('Enter');
  await expect(page.locator('#export-name')).toHaveValue('Work');
  // Saving from the unedited field must not rename `Work.D2` to `Work.d2` and unlink it.
  await page.locator('#export-name').press('ControlOrMeta+s');
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await expect(page.locator('#filename')).toHaveText('Work.D2');
  expect(await page.evaluate(() => (window as typeof window & { written?: string[] }).written)).toEqual(['a -> b']);
});

test('a slow save preserves later edits and does not rename a document opened in the meantime', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => ({ name: 'saved-copy.d2', createWritable: async () => ({
      write: async (text: string) => { (window as any).written = text; await new Promise<void>((resolve) => { (window as any).finishSave = resolve; }); },
      close: async () => {}, abort: async () => {},
    }) });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'original.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Original') });
  await expect(page.locator('#filename')).toHaveText('original.d2'); await previewReady(page);
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
  await page.goto('/'); await previewReady(page);
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
