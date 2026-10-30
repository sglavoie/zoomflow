import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorText, openFolder, previewReady, withEditorView } from './helpers';
import { devURL } from './servers';

const atlas = fileURLToPath(new URL('../../fixtures/atlas', import.meta.url));
const openFolderMessage = 'Open the folder that contains this file to follow links to other diagrams.';

/** Pane A shows the atlas file at `path`, on `board`, with its preview ready. */
async function showing(page: Page, path: string, board = 'root', pane: 'a' | 'b' = 'a') {
  const suffix = pane === 'b' ? '-b' : '';
  await expect(page.locator(`#viewer${suffix} .zf-stage`)).toHaveAttribute('data-board', board);
  await previewReady(page, pane);
  if (pane === 'a') await expect(page.locator('#filename')).toHaveAttribute('title', `atlas/${path}`);
  else await expect(page.locator('#pane-document-b')).toContainText(path.split('/').at(-1)!);
}

const crumbs = (page: Page, viewer = '#viewer') => page.locator(`${viewer} .zf-breadcrumbs button`);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('file links open other files at their boards, with breadcrumbs across files', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  // A folder opens at its home board, index.d2.
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').focus();
  await page.keyboard.press('Enter');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['index', 'work/index']);

  // The fragment opens the linked file's board.
  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  expect(await page.evaluate(() => location.hash)).toBe('#/Viewer');
  await expect(crumbs(page)).toHaveText(['index', '…', 'work/index', 'projects/zoomflow', 'Viewer']);

  // Escape climbs this file's boards, then returns to the file that opened it.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2');
  // Going up focuses the link back down, whose preview card the next Escape would only dismiss.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['index', 'work/index']);

  // An earlier file's crumb reopens it.
  await crumbs(page).filter({ hasText: /^index$/ }).click();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
});

test('file and atlas map links open filenames containing hash characters', async ({ page }) => {
  const temporary = mkdtempSync(join(tmpdir(), 'zoomflow-hash-links-'));
  const folder = join(temporary, 'atlas');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.d2'), 'Guide: {link: "./C# guide.d2#/Notes"}\n');
  writeFileSync(join(folder, 'C# guide.d2'), 'Home\nlayers: {Notes: {Details}}\n');
  try {
    await page.goto('/');
    await openFolder(page, folder);
    await showing(page, 'index.d2');
    await page.locator('#viewer .zf-stage a[data-file="./C# guide.d2#/Notes"]').click();
    await showing(page, 'C# guide.d2', 'root.layers.Notes');
    await crumbs(page).filter({ hasText: /^index$/ }).click();
    await showing(page, 'index.d2');

    await page.locator('#example-picker > summary').click();
    await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
    await expect(page.locator('#filename')).toHaveText('Atlas map');
    await previewReady(page);
    await page.locator('#viewer .zf-stage a[data-file="./C# guide.d2"]').click();
    await showing(page, 'C# guide.d2');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('browser Back and Forward move across files in the first pane', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await page.locator('#viewer .zf-stage a[data-board="root.layers.Sleep"]').click();
  await showing(page, 'health.d2', 'root.layers.Sleep');
  await expect(crumbs(page)).toHaveText(['index', 'health', 'Sleep']);

  await page.goBack();
  await showing(page, 'health.d2');
  await page.goBack();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
  await page.goForward();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);
  await page.goForward();
  await showing(page, 'health.d2', 'root.layers.Sleep');
  await expect(crumbs(page)).toHaveText(['index', 'health', 'Sleep']);
});

test('review F1 picker trail reset survives reload and history', async ({ page }) => {
  /** At a file's root board, Escape and Backspace have no file to return to. */
  async function rootStays(path: string) {
    for (const key of ['Escape', 'Backspace']) {
      await page.locator('#viewer .zf-stage').focus();
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
      await showing(page, path);
      await expect(crumbs(page)).toHaveText([path.replace(/\.d2$/, '')]);
    }
  }
  const savedFiles = () => page.evaluate(() => history.state?.zoomflowFiles);

  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health']);

  // Choosing another file from the menu starts a new way through files, in history as on screen.
  await page.locator('#example-picker > summary').click();
  await page.locator('.example-option[title="atlas/work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  expect(await savedFiles()).toEqual([]);

  await page.reload();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');

  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  await expect(crumbs(page)).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  await page.goBack();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await page.goBack();
  await showing(page, 'index.d2');
  await expect(crumbs(page)).toHaveText(['index']);
  await page.goForward();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  expect(await savedFiles()).toEqual([]);
  await page.reload();
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');

  await page.goForward();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer');
  await expect(crumbs(page)).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  // The way through files from here leads back to work/index, not to the file chosen away from.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2');
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2');
  await expect(crumbs(page)).toHaveText(['work/index']);
  await rootStays('work/index.d2');
});

test('a link to a missing file says so, and lint reports broken file links', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="atlas/broken/links.d2"]').click();
  await showing(page, 'broken/links.d2');
  await expect(page.locator('#lint-summary')).toHaveText('1 lint error, 1 warning');

  const missing = page.locator('#viewer .zf-stage a[data-file="./missing.d2"]');
  await expect(missing).toHaveAttribute('data-missing', '');
  await missing.hover();
  await expect(page.locator('.link-preview')).toContainText('Missing file: broken/missing');
  await missing.click();
  await expect(page.locator('#viewer .zf-message')).toContainText('Missing file: broken/missing');

  // A missing board opens the file's nearest existing board.
  await page.locator('#viewer .zf-stage a[data-file="../index.d2#/Gone"]').click();
  await showing(page, 'index.d2');
  await expect(page.locator('#viewer .zf-message')).toContainText('Board "Gone" not found; showing Root');
});

test('hovering a file link previews the board it opens', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  await page.locator('#viewer .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').hover();
  const card = page.locator('.link-preview');
  await expect(card).toContainText('projects/zoomflow · Viewer');
  await expect(card).toContainText('2 shapes');
  await expect(card.locator('img')).toBeVisible();
});

test('linked-board previews and the link editor normalize authored routes like navigation', async ({ page }) => {
  const folder = join(mkdtempSync(join(tmpdir(), 'zoomflow-routes-')), 'routes');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.d2'), 'Percent\nAt\nSlash\n\n# Boards that open from shapes on this board.\nPercent.link: "./target.d2#/50%"\nAt.link: "./target.d2#/@home"\nSlash.link: "./target.d2#/Plan/"\n');
  writeFileSync(join(folder, 'target.d2'), 'Home\nlayers: {"50%": {One; Two}; "@home": {One; Two}; Plan: {One; Two}}\n');
  await page.goto('/');
  await openFolder(page, folder);
  await showingProjectFile(page, 'routes', 'index.d2');
  for (const [shape, authored, compiled, label] of [
    ['Percent', '#/50%', '#/50%25', '50%'], ['At', '#/@home', '#/%40home', '@home'], ['Slash', '#/Plan/', '#/Plan', 'Plan'],
  ]) {
    await page.locator(`#viewer .zf-stage a[data-file="./target.d2${authored}"]`).hover();
    const card = page.locator('.link-preview');
    await expect(card).toContainText(`target · ${label}`);
    await expect(card).toContainText('2 shapes');
    await expect(card.locator('img')).toBeVisible();
    await (await shapeMenu(page, shape, shape)).getByRole('menuitem', { name: 'Change linked diagram…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change linked diagram' });
    await expect(dialog.getByLabel('Opens at')).toBeEnabled();
    await expect(dialog.getByLabel('Opens at')).toHaveValue(compiled);
    await expect(dialog.getByLabel('Opens at').locator('option')).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('a file link in a single opened file asks for its folder', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await page.locator('#file').setInputFiles(`${atlas}/index.d2`);
  await expect(page.locator('#filename')).toHaveText('index.d2');
  await previewReady(page);
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await expect(page.locator('#viewer .zf-message')).toContainText(openFolderMessage);
  await expect(page.locator('#filename')).toHaveText('index.d2');
});

test('the second pane follows file links on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.selectOption('#layout', 'tabs');
  await page.locator('#pane-choose-b').click();
  const project = page.locator('#draft-options .project-toggle');
  // The menu folds projects the target pane is not showing once it opens.
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await project.click();
  await page.locator('#draft-options .example-option[title="atlas/work/index.d2"]').click();
  await showing(page, 'work/index.d2', 'root', 'b');

  await page.locator('#viewer-b .zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
  await showing(page, 'projects/zoomflow.d2', 'root.layers.Viewer', 'b');
  await expect(crumbs(page, '#viewer-b')).toHaveText(['work/index', 'projects/zoomflow', 'Viewer']);
  // The second pane keeps its way through files in memory; the first pane and the page URL stay put.
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
  expect(await page.evaluate(() => location.hash)).toBe('#/');
  await expect(crumbs(page)).toHaveText(['index']);

  await page.locator('#viewer-b .zf-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await showing(page, 'projects/zoomflow.d2', 'root', 'b');
  await page.locator('#viewer-b .zf-stage').focus();
  await page.keyboard.press('Escape');
  await showing(page, 'work/index.d2', 'root', 'b');
  await expect(crumbs(page, '#viewer-b')).toHaveText(['work/index']);
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root');
});

const shapeMenu = async (page: Page, id: string, name: string) => {
  await page.locator(`#viewer .zf-stage [data-shape-id="${id}"]`).click({ button: 'right' });
  return page.getByRole('menu', { name: `Actions for ${name}` });
};

test('links a shape to another file and board, changes and removes the link, and undoes it', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  // A link written in the shape itself only opens from here.
  let menu = await shapeMenu(page, 'Zoomflow', 'Zoomflow');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open diagram', 'Select in source']);
  await page.keyboard.press('Escape');

  menu = await shapeMenu(page, 'Inbox', 'Inbox');
  await expect(menu.getByRole('menuitem')).toHaveText(['Add flow board…', 'Add mind map board…', 'Link to diagram…', 'New linked diagram…', 'Select in source']);
  await menu.getByRole('menuitem', { name: 'Link to diagram…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link to a diagram' });
  await expect(dialog.getByLabel('Diagram file').locator('option')).toHaveText(['broken/links', 'health', 'index', 'projects/zoomflow']);
  // The D2 reference shortcut stays out of the dialog, like the other modal dialogs.
  await page.keyboard.press('Control+Shift+/');
  await expect(page.locator('#d2-reference')).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Diagram file').selectOption('health.d2');
  await expect(dialog.getByLabel('Opens at').locator('option')).toHaveText(['Its home board', 'Sleep']);
  await dialog.getByLabel('Opens at').selectOption({ label: 'Sleep' });
  await dialog.getByRole('button', { name: 'Link', exact: true }).click();
  await previewReady(page);
  expect(await editorText(page)).toContain('\n\n# Boards that open from shapes on this board.\nInbox.link: "../health.d2#/Sleep"\n');
  await expect(page.locator('#viewer .zf-stage a[data-file="../health.d2#/Sleep"]')).toHaveCount(1);

  // A linked shape opens, changes or removes its link.
  menu = await shapeMenu(page, 'Inbox', 'Inbox');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open diagram', 'Change linked diagram…', 'Remove link', 'Select in source']);
  await menu.getByRole('menuitem', { name: 'Change linked diagram…' }).click();
  const change = page.getByRole('dialog', { name: 'Change linked diagram' });
  await expect(change.getByLabel('Diagram file')).toHaveValue('health.d2');
  await expect(change.getByLabel('Opens at')).toHaveValue('#/Sleep');
  await change.getByLabel('Diagram file').selectOption('projects/zoomflow.d2');
  await change.getByRole('button', { name: 'Change link', exact: true }).click();
  await previewReady(page);
  expect(await editorText(page)).toContain('Inbox.link: "../projects/zoomflow.d2"');
  await (await shapeMenu(page, 'Inbox', 'Inbox')).getByRole('menuitem', { name: 'Remove link' }).click();
  await previewReady(page);
  expect(await editorText(page)).not.toContain('Inbox.link');

  // Undo brings each link back.
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await previewReady(page);
  expect(await editorText(page)).toContain('Inbox.link: "../projects/zoomflow.d2"');
  await page.keyboard.press('ControlOrMeta+z');
  await previewReady(page);
  expect(await editorText(page)).toContain('Inbox.link: "../health.d2#/Sleep"');

  await (await shapeMenu(page, 'Inbox', 'Inbox')).getByRole('menuitem', { name: 'Open diagram' }).click();
  await showing(page, 'health.d2', 'root.layers.Sleep');
  await expect(crumbs(page)).toHaveText(['index', '…', 'work/index', 'health', 'Sleep']);
});

test('creates a new linked flow that opens, stays editable, and links on from its steps', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await (await shapeMenu(page, 'Exercise', 'Exercise')).getByRole('menuitem', { name: 'New linked diagram…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New linked diagram' });
  await expect(dialog.getByLabel('File name')).toHaveValue('Exercise');
  await dialog.getByLabel('Flow').check();
  await dialog.getByRole('button', { name: 'Create and open', exact: true }).click();
  // Without the folder's handle, the new file is a project draft that Save asks where to put.
  await showing(page, 'Exercise.d2');
  await expect(crumbs(page)).toHaveText(['index', 'health', 'Exercise']);
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await page.locator('#example-picker summary').click();
  await expect(page.locator('#draft-options .example-option[title="atlas/Exercise.d2"]')).toBeVisible();
  await page.locator('#example-picker summary').click();

  // The flow's steps link to other files too, and the flow builder keeps those links.
  await page.locator('#viewer .zf-stage [data-shape-id="step_3"]').click();
  const boards = page.getByRole('group', { name: 'Selected: Done' }).getByRole('button', { name: 'Add board…', exact: true });
  await boards.click();
  await page.getByRole('menu', { name: 'Actions for Done' }).getByRole('menuitem', { name: 'Link to diagram…' }).click();
  const link = page.getByRole('dialog', { name: 'Link to a diagram' });
  await link.getByLabel('Diagram file').selectOption('index.d2');
  await link.getByRole('button', { name: 'Link', exact: true }).click();
  await previewReady(page);
  expect(await editorText(page)).toContain('step_3.link: "./index.d2"');
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  const flow = page.getByRole('dialog', { name: 'Edit flow' });
  await flow.getByLabel('Step 3 name').fill('Finished');
  await flow.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await previewReady(page);
  await expect(page.locator('#viewer .zf-stage')).toContainText('Finished');
  expect(await editorText(page)).toContain('step_3.link: "./index.d2"');

  // The file it came from links to the new file.
  await crumbs(page).filter({ hasText: 'health' }).click();
  await showing(page, 'health.d2');
  expect(await editorText(page)).toContain('\n# Boards that open from shapes on this board.\nExercise.link: "./Exercise.d2"\n');
  await expect(page.locator('#viewer .zf-stage a[data-file="./Exercise.d2"]')).not.toHaveAttribute('data-missing', '');
});

test('finishing a linked file write after switching projects keeps it in its original project', async ({ page }) => {
  await page.addInitScript(() => {
    let opened = 0;
    const projects = ['first', 'second'].map(name => {
      const files: Record<string, string> = { 'index.d2': 'Topic\n' };
      const handle = (filename: string) => ({
        kind: 'file', name: filename,
        getFile: async () => new File([files[filename]], filename, { lastModified: 1 }),
        isSameEntry: async () => false,
        createWritable: async () => ({
          async write(source: string) {
            if (filename === 'Detail.d2') await new Promise<void>(resolve => { (window as any).finishLinkedWrite = resolve; });
            files[filename] = source;
          },
          close: async () => {}, abort: async () => {},
        }),
      });
      return {
        kind: 'directory', name,
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        async *values() { for (const filename of Object.keys(files)) yield handle(filename); },
        async getFileHandle(filename: string, options?: { create?: boolean }) {
          if (!(filename in files) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
          files[filename] ??= '';
          return handle(filename);
        },
      };
    });
    (window as any).showDirectoryPicker = async () => projects[opened++];
  });
  async function chooseFolder(name: string) {
    await page.locator('#example-picker > summary').click();
    await page.locator('#open-folder-picker').click();
    await expect(page.locator('#filename')).toHaveAttribute('title', `${name}/index.d2`);
    await previewReady(page);
  }
  await page.goto('/'); await previewReady(page);
  await chooseFolder('first');
  await (await shapeMenu(page, 'Topic', 'Topic')).getByRole('menuitem', { name: 'New linked diagram…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New linked diagram' });
  await dialog.getByLabel('File name').fill('Detail');
  await dialog.getByRole('button', { name: 'Create and open', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishLinkedWrite)).toBe('function');

  // The second project deliberately has the same source and shape ID as the first.
  await chooseFolder('second');
  await page.evaluate(() => (window as any).finishLinkedWrite());
  await page.locator('#example-picker > summary').click();
  await expect(page.locator('.example-option[title="first/Detail.d2"]')).toHaveCount(1);
  await expect(page.locator('.example-option[title="second/Detail.d2"]')).toHaveCount(0);
  await expect(page.locator('#filename')).toHaveAttribute('title', 'second/index.d2');
  expect(await editorText(page)).toBe('Topic\n');
  await page.getByRole('button', { name: 'first', exact: true }).click();
  await page.locator('.example-option[title="first/Detail.d2"]').click();
  await previewReady(page);
  expect(await editorText(page)).toContain('# Created with the Zoomflow flow builder.');
});

test('the atlas map draws every project file and file link, groups unlinked files, and opens a file on click', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
  await expect(page.locator('#filename')).toHaveText('Atlas map');
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/Atlas map');
  await previewReady(page);

  const stage = page.locator('#viewer .zf-stage');
  const files = stage.locator('a[data-file]');
  await expect(files).toHaveCount(5);
  for (const path of ['index', 'health', 'work/index', 'projects/zoomflow', 'broken/links']) {
    await expect(stage.locator(`a[data-file="./${path}.d2"]`)).toHaveCount(1);
  }
  await expect(stage.locator('a[data-missing]')).toHaveCount(0);
  await expect(stage).toContainText('Not linked from anywhere');
  await expect(stage).toContainText('Viewer');
  // The map is generated: its source cannot be typed over or saved over a project file.
  await expect(page.locator('#editor .cm-content')).toHaveAttribute('aria-readonly', 'true');
  await expect(page.locator('#save-file')).toBeHidden();
  await expect(page.locator('#draft-status')).toHaveText('Atlas map · read-only, drawn from the project files');
  expect(await editorText(page)).toContain('Not linked from anywhere');

  await stage.locator('a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await expect(crumbs(page)).toHaveText(['health']);
  await expect(page.locator('#save-file')).toBeVisible();
  // Back returns to the map, as it would to a file.
  await page.goBack();
  await expect(page.locator('#filename')).toHaveText('Atlas map');
  await previewReady(page);
  await expect(files).toHaveCount(5);

  // The map is not kept: a reload shows the project file the pane showed before it, here the one Back came from.
  await page.reload();
  await showing(page, 'health.d2');
});

test('New atlas starts a mind map home board in an empty folder and links a file from each topic', async ({ page }) => {
  await page.addInitScript(() => {
    // An empty folder the browser can write to; written files land in `window.atlasFiles`.
    const written: Record<string, string> = Object.create(null);
    (window as typeof window & { atlasFiles?: Record<string, string> }).atlasFiles = written;
    const fileHandle = (name: string) => ({
      kind: 'file', name,
      getFile: async () => new File([written[name] ?? ''], name, { lastModified: 1 }),
      createWritable: async () => ({ write: async (text: string) => { written[name] = text; }, close: async () => {}, abort: async () => {} }),
      isSameEntry: async (other: { name: string }) => other.name === name,
    });
    (window as typeof window & { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker = async () => ({
      kind: 'directory', name: 'my-atlas',
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      async *values() { for (const name of Object.keys(written)) yield fileHandle(name); },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!(name in written) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
        written[name] ??= '';
        return fileHandle(name);
      },
    });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: 'New atlas in an empty folder' }).click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'my-atlas/index.d2');
  await previewReady(page);
  await expect(page.locator('#activity-status')).toHaveText('Created index.d2. Add a subtopic for each area, then choose New linked diagram… on it to add the file it opens.');
  const written = () => page.evaluate(() => (window as typeof window & { atlasFiles: Record<string, string> }).atlasFiles);
  expect((await written())['index.d2']).toContain('"my-atlas"');

  // Each area is a topic added on the home board, and each topic links its own new file.
  for (const [topic, name] of [['n_1', 'Health'], ['n_2', 'Work']]) {
    await page.locator('#viewer .zf-stage [data-shape-id="n"]').click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await previewReady(page);
    const rename = page.getByRole('textbox', { name: 'Rename New topic' });
    await rename.fill(name);
    await rename.press('Enter');
    await previewReady(page);
    await (await shapeMenu(page, topic, name)).getByRole('menuitem', { name: 'New linked diagram…' }).click();
    const dialog = page.getByRole('dialog', { name: 'New linked diagram' });
    await expect(dialog.getByLabel('File name')).toHaveValue(name);
    await dialog.getByRole('button', { name: 'Create and open', exact: true }).click();
    await expect(page.locator('#filename')).toHaveAttribute('title', `my-atlas/${name}.d2`);
    await previewReady(page);
    // The folder's handle writes the new file into it, so it is saved rather than a draft.
    await expect(page.locator('#draft-status')).not.toHaveText('File has unsaved changes');
    await page.locator('#viewer .zf-stage').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#filename')).toHaveAttribute('title', 'my-atlas/index.d2');
    await previewReady(page);
  }
  expect(Object.keys(await written()).sort()).toEqual(['Health.d2', 'Work.d2', 'index.d2']);
  // The home board stays a mind map that links both files.
  await expect(page.getByRole('button', { name: 'Edit mind map', exact: true })).toBeVisible();
  await expect(page.locator('#viewer .zf-stage a[data-file="./Health.d2"]')).toHaveCount(1);
  await expect(page.locator('#viewer .zf-stage a[data-file="./Work.d2"]')).toHaveCount(1);
});

test('New atlas without folder access starts a draft project', async ({ page }) => {
  await page.addInitScript(() => { delete (window as typeof window & { showDirectoryPicker?: unknown }).showDirectoryPicker; });
  await page.goto('/'); await previewReady(page);
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: 'New atlas in an empty folder' }).click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/index.d2');
  await previewReady(page);
  await expect(page.locator('#activity-status')).toContainText('the atlas is a draft');
  // Linking needs a folder project, which the draft is; with no other file yet, there is nothing to link to.
  const menu = await shapeMenu(page, 'n', 'atlas');
  await expect(menu.getByRole('menuitem', { name: 'New linked diagram…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Link to diagram…' })).toHaveCount(0);
});

/** A folder `name` whose index.d2 links to target.d2, which draws and boards only what it imports from parts.d2. */
function importingProject(name: string, parts: string) {
  const folder = join(mkdtempSync(join(tmpdir(), 'zoomflow-imports-')), name);
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.d2'), 'Go: { link: ./target.d2 }\nInbox\n');
  writeFileSync(join(folder, 'target.d2'), '...@parts\n');
  writeFileSync(join(folder, 'parts.d2'), parts);
  return folder;
}

/** The linked target's hover card and the boards Link to diagram offers for it, from the first pane's index.d2. */
async function expectLinkedTarget(page: Page, shapes: string, boards: string[]) {
  const link = page.locator('#viewer .zf-stage a[data-file="./target.d2"]');
  await link.hover();
  const card = page.locator('.link-preview');
  await expect(card).toContainText('target');
  await expect(card).toContainText(shapes);
  await expect(card.locator('img')).toBeVisible();
  await page.locator('#viewer .zf-stage').hover({ position: { x: 5, y: 5 } });
  await expect(card).toBeHidden();

  await (await shapeMenu(page, 'Inbox', 'Inbox')).getByRole('menuitem', { name: 'Link to diagram…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link to a diagram' });
  await dialog.getByLabel('Diagram file').selectOption('target.d2');
  await expect(dialog.getByLabel('Opens at').locator('option')).toHaveText(['Its home board', ...boards]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
}

async function showingProjectFile(page: Page, project: string, path: string) {
  await expect(page.locator('#filename')).toHaveAttribute('title', `${project}/${path}`);
  await previewReady(page);
}

test('review F2 linked preview refreshes after an imported source changes', async ({ page }) => {
  const folder = importingProject('imports', 'Alpha\nlayers: { Near: { n } }\n');
  await page.goto('/');
  await openFolder(page, folder);
  await showingProjectFile(page, 'imports', 'index.d2');
  await expectLinkedTarget(page, '1 shape', ['Near']);

  // Edit only the imported file; the linked file's own text stays the same.
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="imports/parts.d2"]').click();
  await showingProjectFile(page, 'imports', 'parts.d2');
  await withEditorView(page, (view) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Alpha\nBeta\nlayers: { Far: { f } }\n' } }));
  await previewReady(page);
  await page.locator('#example-picker summary').click();
  await page.locator('#draft-options .example-option[title="imports/index.d2"]').click();
  await showingProjectFile(page, 'imports', 'index.d2');
  await expectLinkedTarget(page, '2 shapes', ['Far']);
});

test('review F2 linked preview belongs to the selected project', async ({ page }) => {
  // Both projects have the same index.d2 and target.d2; only what target.d2 imports differs.
  const first = importingProject('first', 'Alpha\nlayers: { Near: { n } }\n');
  const second = importingProject('second', 'Alpha\nBeta\nlayers: { Far: { f } }\n');
  await page.goto('/');
  await openFolder(page, first);
  await showingProjectFile(page, 'first', 'index.d2');
  await expectLinkedTarget(page, '1 shape', ['Near']);

  await openFolder(page, second);
  await showingProjectFile(page, 'second', 'index.d2');
  await expectLinkedTarget(page, '2 shapes', ['Far']);

  await page.locator('#example-picker summary').click();
  // The menu folds the project this pane is not showing.
  const project = page.locator('#draft-options .project-toggle', { hasText: 'first' });
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await project.click();
  await page.locator('#draft-options .example-option[title="first/index.d2"]').click();
  await showingProjectFile(page, 'first', 'index.d2');
  await expectLinkedTarget(page, '1 shape', ['Near']);
});

test('review F5 atlas map rejects AI source changes', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ available: true }) }));
  const requests: string[] = [];
  await page.route('**/api/ai', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request.source);
    // A valid replacement that would redraw the map as a single, unrelated shape.
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Replaced it.', source: 'file_1: Altered' }) });
  });
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
  await expect(page.locator('#filename')).toHaveText('Atlas map');
  await previewReady(page);
  const stage = page.locator('#viewer .zf-stage');
  await expect(stage.locator('a[data-file]')).toHaveCount(5);
  const map = await editorText(page);

  await page.locator('#ai-assistant > summary').click();
  const prompt = page.getByRole('textbox', { name: 'Ask AI about this diagram' });
  await prompt.fill('Rename the home file');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toHaveText(
    'Replaced it. The proposed source change was not applied. The atlas map is drawn from the project files and is read-only. Open a file to edit it.');
  expect(requests).toEqual([map]);
  expect(await editorText(page)).toBe(map);
  await expect(page.locator('#ai-undo')).toBeHidden();
  await expect(stage.locator('a[data-file]')).toHaveCount(5);
  for (const path of ['index', 'health', 'work/index', 'projects/zoomflow', 'broken/links']) {
    await expect(stage.locator(`a[data-file="./${path}.d2"]`)).toHaveCount(1);
  }
  await expect(stage).not.toContainText('Altered');

  // A project file opened from the map still takes the AI's change.
  await stage.locator('a[data-file="./health.d2"]').click();
  await showing(page, 'health.d2');
  await prompt.fill('Replace it');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toContainText('Diagram updated. Replaced it.');
  expect(await editorText(page)).toBe('file_1: Altered');
  await expect(stage).toContainText('Altered');
});

test('a file link written in an imported file opens from the folder of the file that wrote it', async ({ page }) => {
  const folder = join(mkdtempSync(join(tmpdir(), 'zoomflow-imports-')), 'nested');
  mkdirSync(join(folder, 'sub'), { recursive: true });
  writeFileSync(join(folder, 'index.d2'), '...@sub/part\n');
  writeFileSync(join(folder, 'sub/part.d2'), 'Go: { link: ./other.d2 }\n');
  writeFileSync(join(folder, 'sub/other.d2'), 'Arrived\n');
  await page.goto('/');
  await openFolder(page, folder);
  await showingProjectFile(page, 'nested', 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./sub/other.d2"]').click();
  await showingProjectFile(page, 'nested', 'sub/other.d2');
  await expect(crumbs(page)).toHaveText(['index', 'sub/other']);
});

test.describe('with a held compiler', () => {
  // Rewrites /src/compiler.ts, which only the dev server serves as its own module.
  test.use({ baseURL: devURL });

  test('opening another file while the atlas map draws keeps that file', async ({ page }) => {
    await page.route((url) => url.pathname === '/src/compiler.ts', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain('const d2 = new D2();');
      await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
        const d2 = new D2();
        const compile = d2.compile.bind(d2);
        window.atlasProbe = { hold: false };
        d2.compile = async (input, options) => {
          if (window.atlasProbe.hold) {
            window.atlasProbe.hold = false;
            await new Promise(resolve => { window.atlasProbe.release = resolve; });
          }
          return compile(input, options);
        };
      `) });
    });
    await page.goto('/');
    await openFolder(page, atlas);
    await showing(page, 'index.d2');
    await page.evaluate(() => { (window as any).atlasProbe.hold = true; });
    await page.locator('#example-picker > summary').click();
    await page.getByRole('button', { name: 'Atlas map of the atlas project' }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).atlasProbe.release)).toBe('function');

    await page.locator('#example-picker > summary').click();
    await page.locator('.example-option[title="atlas/health.d2"]').click();
    await showing(page, 'health.d2');
    await page.evaluate(() => (window as any).atlasProbe.release());
    await page.waitForTimeout(500);
    await showing(page, 'health.d2');
    await expect(page.locator('#filename')).not.toHaveText('Atlas map');
  });
});
