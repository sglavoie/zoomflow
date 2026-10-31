import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { openFolder, previewReady, projectFolder, withEditorView } from './helpers';

// Use the ZIP dependency from the package that owns project exports.
const { unzipSync } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('fflate') as {
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>;
};

/** A writable folder with disk contents kept independently of Zoomflow's browser drafts.
 * Reopening reads those contents again; no test writes to the developer's project. */
async function writableProject(page: Page) {
  await page.addInitScript(() => {
    const initial = {
      'index.d2': '...@lib/styles\nHome: Original home',
      'detail.d2': '...@lib/styles\nDetail: Original detail',
      'lib/styles.d2': 'classes: {accent: {style.fill: lightblue}}',
    };
    const disk: Record<string, { source: string; modified: number }> = JSON.parse(localStorage.getItem('test-project-disk') ?? 'null') ??
      Object.fromEntries(Object.entries(initial).map(([path, source]) => [path, { source, modified: 1 }]));
    const probe = {
      disk, order: [] as string[], active: 0, maxActive: 0, hold: '', fail: '', denied: '', deleted: '',
      folderPermission: 'granted' as PermissionState, prompts: 0, release: undefined as (() => void) | undefined,
      persist: () => localStorage.setItem('test-project-disk', JSON.stringify(disk)),
    };
    (window as any).projectSaveProbe = probe;
    const handle = (path: string): any => ({
      kind: 'file', name: path.split('/').at(-1),
      isSameEntry: async (other: any) => other.path === path, path,
      queryPermission: async () => path === probe.denied ? 'denied' : probe.folderPermission,
      requestPermission: async () => { probe.prompts++; return path === probe.denied ? 'denied' : probe.folderPermission; },
      getFile: async () => {
        if (path === probe.deleted) throw new DOMException('File removed', 'NotFoundError');
        return new File([disk[path].source], path, { lastModified: disk[path].modified });
      },
      createWritable: async () => {
        if (path === probe.deleted) throw new DOMException('File removed', 'NotFoundError');
        let source = '';
        return {
          write: async (text: string) => {
            probe.order.push(path);
            probe.active++;
            probe.maxActive = Math.max(probe.maxActive, probe.active);
            source = text;
            if (probe.hold === path) await new Promise<void>(resolve => { probe.release = resolve; });
            if (probe.fail === path) throw new Error('Disk full');
          },
          close: async () => { disk[path] = { source, modified: disk[path].modified + 1 }; probe.persist(); probe.active--; },
          abort: async () => { probe.active--; },
        };
      },
    });
    (window as any).showDirectoryPicker = async () => ({
      kind: 'directory', name: 'save-project',
      queryPermission: async () => probe.folderPermission,
      requestPermission: async () => { probe.prompts++; probe.folderPermission = 'granted'; return 'granted'; },
      async *values() {
        yield handle('index.d2'); yield handle('detail.d2');
        yield { kind: 'directory', name: 'lib', async *values() { yield handle('lib/styles.d2'); } };
      },
    });
    (window as any).showSaveFilePicker = async () => { throw new Error('Batch saves must not open destination pickers'); };
  });
  await page.goto('/');
  if (await page.locator('#open-folder').isVisible()) await page.locator('#open-folder').click(); else { await page.locator('#example-picker summary').click(); await page.locator('#open-folder-picker').click(); }
  await previewReady(page);
}

async function choose(page: Page, path: string) {
  await page.locator('#example-picker summary').click();
  await page.locator(`.example-option[title="save-project/${path}"]`).click();
}

async function editProject(page: Page) {
  await choose(page, 'detail.d2');
  await page.locator('#editor .cm-content').fill('...@lib/styles\nDetail: Changed detail');
  await choose(page, 'lib/styles.d2');
  await page.locator('#editor .cm-content').fill('classes: {accent: {style.fill: gold}}');
  await choose(page, 'index.d2');
  await page.locator('#editor .cm-content').fill('...@lib/styles\nHome: Changed home');
}

async function saveAll(page: Page, count = 3) {
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: `Save all · ${count} ${count === 1 ? 'file' : 'files'}`, exact: true }).click();
  return page.getByRole('dialog', { name: 'Save save-project project', exact: true });
}

test('one save keeps an import and diagrams from both panes on disk when the folder reopens', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await writableProject(page);
  await choose(page, 'detail.d2');
  await page.locator('#editor .cm-content').fill('...@lib/styles\nDetail: Changed detail');
  await choose(page, 'index.d2');
  await page.locator('#editor .cm-content').fill('...@lib/styles\nHome: Changed home');
  await page.selectOption('#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.locator('.project-toggle').click();
  await page.locator('.example-option[title="save-project/lib/styles.d2"]').click();
  await page.locator('#editor-b .cm-content').fill('classes: {accent: {style.fill: gold}}');
  await page.locator('#editor-b .cm-content').focus();
  const dialog = await saveAll(page);
  await expect(dialog.locator('.project-save-status')).toHaveText('3 files saved, 0 skipped, 0 failed.');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.maxActive)).toBe(1);
  expect(await page.evaluate(() => (window as any).projectSaveProbe.order)).toEqual(['detail.d2', 'index.d2', 'lib/styles.d2']);
  await expect(page.locator('#pane-document-b')).toContainText('styles.d2');
  await expect(page.locator('#pane-document .draft-unsaved')).toBeHidden();
  await expect(page.locator('#pane-document-b .draft-unsaved')).toBeHidden();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#example-picker summary')).toBeFocused();
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save all · 0 files' })).toBeDisabled();
  await page.locator('#example-picker summary').click();
  await page.reload();
  await page.selectOption('#layout', 'single');
  await page.locator('#open-folder').click();
  await previewReady(page);
  await expect(page.locator('#editor .cm-content')).toContainText('Changed home');
  await choose(page, 'detail.d2');
  await expect(page.locator('#editor .cm-content')).toContainText('Changed detail');
  await choose(page, 'lib/styles.d2');
  await expect(page.locator('#editor .cm-content')).toContainText('gold');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toBeHidden();
});

test('overwrite cancellation and a write failure keep their files dirty while the batch continues', async ({ page }) => {
  await writableProject(page);
  await editProject(page);
  await page.evaluate(() => {
    const probe = (window as any).projectSaveProbe;
    probe.disk['detail.d2'] = { source: 'Detail: Outside edit', modified: 2 };
    probe.fail = 'index.d2';
  });
  const dialog = await saveAll(page);
  const overwrite = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(overwrite).toContainText('detail.d2');
  await overwrite.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.locator('.project-save-status')).toHaveText('1 file saved, 1 skipped, 1 failed.');
  await expect(dialog).toContainText('detail.d2 — Skipped: Overwrite cancelled');
  await expect(dialog).toContainText('index.d2 — Failed: Disk full');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.disk['detail.d2'].source)).toBe('Detail: Outside edit');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('2 unsaved');
  await page.locator('#example-picker summary').click();
  await page.evaluate(() => { (window as any).projectSaveProbe.fail = ''; });
  const retry = await saveAll(page, 2);
  await overwrite.getByRole('button', { name: 'Overwrite file', exact: true }).click();
  await expect(retry.locator('.project-save-status')).toHaveText('2 files saved, 0 skipped, 0 failed.');
});

test('missing files and denied permissions are skipped without destination pickers', async ({ page }) => {
  await writableProject(page);
  await editProject(page);
  await page.evaluate(() => { const probe = (window as any).projectSaveProbe; probe.deleted = 'detail.d2'; probe.denied = 'index.d2'; });
  const dialog = await saveAll(page);
  await expect(dialog.locator('.project-save-status')).toHaveText('1 file saved, 2 skipped, 0 failed.');
  await expect(dialog).toContainText('file was moved or deleted');
  await expect(dialog).toContainText('Write permission denied');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.order)).toEqual(['lib/styles.d2']);
});

for (const action of ['Escape', 'Close', 'Cancel saving']) test(`${action} stops queued saves and a late completed file updates its saved baseline`, async ({ page }) => {
  await writableProject(page);
  await editProject(page);
  await page.evaluate(() => { (window as any).projectSaveProbe.hold = 'detail.d2'; });
  const dialog = await saveAll(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectSaveProbe.release)).toBe('function');
  if (action === 'Escape') await page.keyboard.press('Escape');
  else await dialog.getByRole('button', { name: action, exact: true }).click();
  if (action === 'Cancel saving') await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  else {
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#example-picker summary')).toBeFocused();
  }
  await page.evaluate(() => (window as any).projectSaveProbe.release());
  await expect.poll(() => page.evaluate(() => (window as any).projectSaveProbe.active)).toBe(0);
  if (action === 'Cancel saving') {
    await expect(dialog.locator('.project-save-status')).toHaveText('Save cancelled. 1 file saved, 2 skipped, 0 failed.');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('2 unsaved');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.order)).toEqual(['detail.d2']);
});

test('edits arriving during saving stay unsaved and Save remaining files saves them', async ({ page }) => {
  await writableProject(page);
  await editProject(page);
  await page.evaluate(() => { (window as any).projectSaveProbe.hold = 'detail.d2'; });
  const dialog = await saveAll(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectSaveProbe.release)).toBe('function');
  await withEditorView(page, view => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Home: Later edit' } }));
  await page.evaluate(() => (window as any).projectSaveProbe.release());
  await expect(dialog.locator('.project-save-status')).toHaveText('3 files saved, 0 skipped, 0 failed.');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.disk['index.d2'].source)).toContain('Changed home');
  await expect(page.locator('#document-unsaved')).not.toHaveAttribute('hidden');
  await dialog.getByRole('button', { name: 'Save remaining files' }).click();
  await expect(dialog.locator('.project-save-status')).toHaveText('1 file saved, 0 skipped, 0 failed.');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.disk['index.d2'].source)).toBe('Home: Later edit');
});

test('folder permission is requested once before sequential writes', async ({ page }) => {
  await writableProject(page);
  await editProject(page);
  await page.evaluate(() => { (window as any).projectSaveProbe.folderPermission = 'prompt'; });
  const dialog = await saveAll(page);
  await expect(dialog.locator('.project-save-status')).toHaveText('3 files saved, 0 skipped, 0 failed.');
  expect(await page.evaluate(() => (window as any).projectSaveProbe.prompts)).toBe(1);
});

test('browsers without writable folder handles offer a project ZIP with paths and current sources', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, projectFolder);
  await previewReady(page);
  await page.locator('#editor .cm-content').fill('Home: Keep this unsaved edit');
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Save all · 1 file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save browser-project project' });
  await expect(dialog.locator('.project-save-status')).toHaveText('0 files saved, 1 skipped, 0 failed.');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download project ZIP' }).click()]);
  expect(download.suggestedFilename()).toBe('browser-project.zip');
  const zip = await readFile(await download.path());
  const files = unzipSync(zip);
  expect(Object.keys(files).sort()).toEqual(['lib/nested.d2', 'lib/nodes.d2', 'main.d2']);
  expect(Buffer.from(files['main.d2']).toString()).toBe('Home: Keep this unsaved edit');
  expect(Buffer.from(files['lib/nodes.d2']).toString()).toContain('From a local import');
  await expect(dialog.locator('.project-save-download-status')).toContainText('Downloading does not clear unsaved changes');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#example-picker summary').click();
  await expect(page.locator('.project-unsaved')).toHaveText('1 unsaved');
});

test('project saves use real file and directory handles restored after reload', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Writable origin-private file handles');
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('kept-project', { create: true });
    (window as any).showSaveFilePicker = async () => { throw new Error('Stored project handles should be reused'); };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('kept-project', { create: true });
    for (const [name, source] of [['index.d2', 'Home: Original'], ['other.d2', 'Other: Original']]) {
      const stream = await (await root.getFileHandle(name, { create: true })).createWritable();
      await stream.write(source); await stream.close();
    }
  });
  await page.locator('#open-folder').click();
  await previewReady(page);
  await page.locator('#editor .cm-content').fill('Home: First changed file');
  await page.locator('#example-picker summary').click();
  await page.locator('.example-option[title="kept-project/other.d2"]').click();
  await page.locator('#editor .cm-content').fill('Other: Second changed file');
  // Reload at once: the save service must wait for IndexedDB restoration before testing permissions.
  await page.reload();
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'Save all · 2 files', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save kept-project project' });
  await expect(dialog.locator('.project-save-status')).toHaveText('2 files saved, 0 skipped, 0 failed.');
  expect(await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('kept-project');
    return Promise.all(['index.d2', 'other.d2'].map(async name => (await (await root.getFileHandle(name)).getFile()).text()));
  })).toEqual(['Home: First changed file', 'Other: Second changed file']);
});

test('save controls fit narrow dark screens and workspace shortcuts stay inside the modal', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await writableProject(page);
  await page.selectOption('#theme', 'dark');
  await page.locator('#mobile-source').click();
  await page.locator('#editor .cm-content').fill('Home: Narrow screen edit');
  const dialog = await saveAll(page, 1);
  await expect(dialog.locator('.project-save-status')).toHaveText('1 file saved, 0 skipped, 0 failed.');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('index.d2');
  await page.screenshot({ path: info.outputPath('project-save-narrow.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#example-picker summary')).toBeFocused();
});
