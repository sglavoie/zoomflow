import { selectMenuOption } from './menu';
import { expect, test } from '@playwright/test';
import { source, previewReady } from './helpers';
import { draftRows } from './documents-helpers';

test('saving asks before overwriting a file that changed on disk since it was opened or saved', async ({ page }) => {
  await page.addInitScript(() => {
    const disk = { text: 'disk: Original', modified: 1 };
    (window as any).disk = disk;
    (window as any).showOpenFilePicker = async () => [{ kind: 'file', name: 'shared.d2',
      getFile: async () => new File([disk.text], 'shared.d2', { type: 'text/plain', lastModified: disk.modified }),
      createWritable: async () => ({ write: async (text: string) => { disk.text = text; disk.modified++; }, close: async () => {}, abort: async () => {} }) }];
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('shared.d2'); await previewReady(page);
  await source(page).fill('disk: First save');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  // Saving again after our own write does not ask.
  await source(page).fill('disk: Second save');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).disk.text)).toBe('disk: Second save');
  // Another program changes the file.
  await page.evaluate(() => { (window as any).disk.text = 'disk: Edited elsewhere'; (window as any).disk.modified = 99; });
  await source(page).fill('disk: Mine');
  await page.locator('#save-file').click();
  const dialog = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(dialog).toContainText('shared.d2 changed outside Zoomflow');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#activity-status')).toHaveText('Save canceled. The file on disk is unchanged.');
  expect(await page.evaluate(() => (window as any).disk.text)).toBe('disk: Edited elsewhere');
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await page.locator('#save-file').click();
  await dialog.getByRole('button', { name: 'Overwrite file', exact: true }).click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).disk.text)).toBe('disk: Mine');
});

test('a second tab checks the disk again after the first tab finishes saving', async ({ page, context }) => {
  await context.addInitScript(() => {
    const read = () => JSON.parse(localStorage.getItem('test-shared-disk') ?? '{"source":"shared: Original","modified":1}') as
      { source: string; modified: number };
    (window as any).showOpenFilePicker = async () => [{
      kind: 'file', name: 'shared.d2', isSameEntry: async () => true,
      queryPermission: async () => 'granted',
      getFile: async () => {
        const disk = read();
        return new File([disk.source], 'shared.d2', { lastModified: disk.modified });
      },
      createWritable: async () => {
        let source = '';
        return {
          write: async (text: string) => {
            source = text;
            if ((window as any).holdCrossTabSave) {
              (window as any).crossTabSaveStarted = true;
              await new Promise<void>(resolve => { (window as any).releaseCrossTabSave = resolve; });
            }
          },
          close: async () => {
            const disk = read();
            localStorage.setItem('test-shared-disk', JSON.stringify({ source, modified: disk.modified + 1 }));
          },
          abort: async () => {},
        };
      },
    }];
  });
  const second = await context.newPage();
  await page.goto('/'); await second.goto('/');
  await page.locator('#file').click(); await second.locator('#file').click();
  await previewReady(page); await previewReady(second);
  await source(page).fill('shared: First tab');
  await source(second).fill('shared: Second tab');
  await page.evaluate(() => { (window as any).holdCrossTabSave = true; });
  await page.locator('#save-file').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).crossTabSaveStarted))).toBe(true);
  await second.locator('#save-file').click();
  await expect(second.locator('#save-file')).toBeDisabled();
  await page.evaluate(() => (window as any).releaseCrossTabSave());
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  const overwrite = second.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(overwrite).toContainText('shared.d2 changed outside Zoomflow');
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('test-shared-disk')!).source)).toBe('shared: First tab');
  await overwrite.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second.locator('#save-file')).toBeEnabled();
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('test-shared-disk')!).source)).toBe('shared: First tab');
});

test('simultaneous saves in both panes each ask before overwriting externally changed files', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => {
    const disks = [{ name: 'first.d2', text: 'first: Original', modified: 1 }, { name: 'second.d2', text: 'second: Original', modified: 1 }];
    (window as any).disks = disks;
    let next = 0;
    (window as any).showOpenFilePicker = async () => {
      const disk = disks[next++];
      return [{ kind: 'file', name: disk.name,
        isSameEntry: async () => false,
        getFile: async () => new File([disk.text], disk.name, { lastModified: disk.modified }),
        createWritable: async () => ({ write: async (text: string) => { disk.text = text; disk.modified++; }, close: async () => {}, abort: async () => {} }) }];
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click(); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.keyboard.press('Escape');
  await page.locator('#file').click(); await previewReady(page, 'b');
  await expect(page.locator('#pane-document-b')).toContainText('second.d2');
  await page.locator('#editor .cm-content').fill('first: Mine');
  await page.locator('#editor-b .cm-content').fill('second: Mine');
  await page.evaluate(() => {
    for (const disk of (window as any).disks) { disk.text = 'external: Keep'; disk.modified = 99; }
    // Both async disk checks start before either can open the modal.
    document.querySelector<HTMLButtonElement>('#save-file')!.click();
    document.querySelector<HTMLButtonElement>('#save-file-b')!.click();
  });
  const dialog = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(dialog).toContainText('first.d2 changed outside Zoomflow');
  await dialog.getByRole('button', { name: 'Overwrite file', exact: true }).click();
  await expect(dialog).toContainText('second.d2 changed outside Zoomflow');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#save-file')).toBeEnabled();
  await expect(page.locator('#save-file-b')).toBeEnabled();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await expect(page.locator('#draft-status-b')).toHaveText('File has unsaved changes');
  expect(await page.evaluate(() => (window as any).disks.map((disk: { text: string }) => disk.text))).toEqual(['first: Mine', 'external: Keep']);
});

test('saving a file that was moved or deleted on disk asks where to save it', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { deleted: false, opened: '', saved: '', pickerCalls: 0, cancelPicker: true };
    (window as any).state = state;
    (window as any).showOpenFilePicker = async () => [{ kind: 'file', name: 'gone.d2',
      getFile: async () => {
        if (state.deleted) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
        return new File(['gone: Original'], 'gone.d2', { type: 'text/plain', lastModified: 1 });
      },
      createWritable: async () => {
        if (state.deleted) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
        return { write: async (text: string) => { state.opened = text; }, close: async () => {}, abort: async () => {} };
      } }];
    (window as any).showSaveFilePicker = async () => {
      state.pickerCalls++;
      if (state.cancelPicker) throw new DOMException('Canceled', 'AbortError');
      return { name: 'moved.d2', getFile: async () => new File([state.saved], 'moved.d2', { lastModified: 2 }),
        createWritable: async () => ({ write: async (text: string) => { state.saved = text; }, close: async () => {}, abort: async () => {} }) };
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('gone.d2'); await previewReady(page);
  await page.evaluate(() => { (window as any).state.deleted = true; });
  await source(page).fill('gone: Mine');
  await page.locator('#save-file').click();
  await expect(page.locator('#activity-status')).toHaveText('The file was moved or deleted; choose where to save.');
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await page.evaluate(() => { (window as any).state.cancelPicker = false; });
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await expect(page.locator('#activity-status')).not.toContainText('moved or deleted');
  // Later saves go to the newly chosen file without asking again.
  await source(page).fill('gone: Again');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).state)).toMatchObject({ opened: '', saved: 'gone: Again', pickerCalls: 2 });
});

test('Save writes back to an opened file after reload and still asks about outside changes', async ({ page, browserName }) => {
  // A real handle from the origin-private file system can be kept in IndexedDB across reloads.
  test.skip(browserName !== 'chromium', 'Writable origin-private file handles');
  await page.addInitScript(() => {
    const w = window as any;
    w.pickerCalls = 0;
    w.showSaveFilePicker = async () => { w.pickerCalls++; throw new DOMException('Canceled', 'AbortError'); };
    w.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('kept.d2')];
    w.writeDisk = async (text: string) => {
      const writable = await (await (await navigator.storage.getDirectory()).getFileHandle('kept.d2', { create: true })).createWritable();
      await writable.write(text); await writable.close();
    };
    w.readDisk = async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('kept.d2')).getFile()).text();
  });
  await page.goto('/'); await previewReady(page);
  await page.evaluate(() => (window as any).writeDisk('kept: Original'));
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('kept.d2'); await previewReady(page);
  await page.reload(); await previewReady(page);
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  await source(page).fill('kept: After reload');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).readDisk())).toBe('kept: After reload');
  // Another program changes the file while the page is closed.
  await page.waitForTimeout(20);
  await page.evaluate(() => (window as any).writeDisk('kept: Edited elsewhere'));
  await page.reload(); await previewReady(page);
  await source(page).fill('kept: Mine');
  await page.locator('#save-file').click();
  const dialog = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => (window as any).readDisk())).toBe('kept: Edited elsewhere');
  expect(await page.evaluate(() => (window as any).pickerCalls)).toBe(0);
});

test('after a reload, Open and Save wait for stored file handles, and handles of lost drafts are removed', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Writable origin-private file handles');
  await page.addInitScript(() => {
    const w = window as any;
    w.pickerCalls = 0;
    w.showSaveFilePicker = async () => { w.pickerCalls++; throw new DOMException('Canceled', 'AbortError'); };
    w.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('kept.d2', { create: true })];
    w.storedKeys = () => new Promise<IDBValidKey[]>((resolve) => {
      const request = indexedDB.open('zoomflow.files');
      request.onsuccess = () => {
        const keys = request.result.transaction('handles', 'readonly').objectStore('handles').getAllKeys();
        keys.onsuccess = () => { resolve(keys.result); request.result.close(); };
      };
    });
    // Stored handles load slowly after the reload, as they may with a busy disk.
    if (sessionStorage.getItem('slow')) {
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        const request = getAll.apply(this, args);
        let handler: ((event: Event) => void) | null = null;
        Object.defineProperty(request, 'onsuccess', { get: () => handler, set: (value) => { handler = value; } });
        request.addEventListener('success', (event) => setTimeout(() => handler?.call(request, event), 1500));
        return request;
      };
    }
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('kept.d2'); await previewReady(page);
  // A handle whose draft is gone, as after clearing site data.
  await page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('ghost.d2', { create: true });
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('zoomflow.files');
      request.onsuccess = () => {
        const transaction = request.result.transaction('handles', 'readwrite');
        transaction.objectStore('handles').put({ handle }, 'file:ghost');
        transaction.oncomplete = () => { request.result.close(); resolve(); };
      };
    });
    sessionStorage.setItem('slow', '1');
  });
  await page.reload();
  // Saving at once writes back rather than asking where to save.
  await source(page).fill('kept: Saved at once');
  await page.locator('#save-file').click();
  await expect(page.locator('#draft-status')).toHaveText('Saved to file');
  expect(await page.evaluate(() => (window as any).pickerCalls)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).storedKeys())).not.toContain('file:ghost');
  // Another program changes the file; opening it at once returns to its draft rather than adding another.
  await page.evaluate(async () => {
    const writable = await (await (await navigator.storage.getDirectory()).getFileHandle('kept.d2')).createWritable();
    await writable.write('kept: Edited elsewhere'); await writable.close();
  });
  await page.reload();
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('kept.d2'); await previewReady(page);
  expect(await draftRows(page, 'kept.d2')).toBe(1);
});

test('refusing to let Zoomflow write a file asks where to save, once', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Writable origin-private file handles');
  await page.addInitScript(() => {
    const w = window as any;
    w.permissionPrompts = 0;
    w.saveDialogs = 0;
    w.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('locked.d2', { create: true })];
    const prototype = FileSystemHandle.prototype as any;
    prototype.queryPermission = async () => 'prompt';
    prototype.requestPermission = async () => { w.permissionPrompts++; return 'denied'; };
    // Answering the permission prompt used up the click that would open the save dialog.
    w.showSaveFilePicker = async () => {
      w.saveDialogs++;
      if (w.saveDialogs === 1) throw new DOMException('Must be handling a user gesture', 'SecurityError');
      throw new DOMException('Canceled', 'AbortError');
    };
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('locked.d2'); await previewReady(page);
  await source(page).fill('locked: Mine');
  await page.locator('#save-file').click();
  await expect(page.locator('#activity-status')).toHaveText('Click Save again to choose where to save.');
  await page.locator('#save-file').click();
  await expect.poll(() => page.evaluate(() => (window as any).saveDialogs)).toBe(2);
  expect(await page.evaluate(() => (window as any).permissionPrompts)).toBe(1);
});
