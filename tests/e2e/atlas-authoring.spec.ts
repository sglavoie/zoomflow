import { expect, test, } from '@playwright/test';
import { editorText, openFolder, previewReady } from './helpers';
import { atlas, showing, crumbs, shapeMenu, } from './atlas-helpers';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('links a shape to another file and board, changes and removes the link, and undoes it', async ({ page }) => {
  await page.goto('/');
  await openFolder(page, atlas);
  await showing(page, 'index.d2');
  await page.locator('#viewer .zf-stage a[data-file="./work/index.d2"]').click();
  await showing(page, 'work/index.d2');
  // A link written in the shape itself only opens from here.
  let menu = await shapeMenu(page, 'Zoomflow', 'Zoomflow');
  await expect(menu.getByRole('menuitem')).toHaveText(['Move branch…', 'Open diagram', 'Hide from export', 'Select in source']);
  await page.keyboard.press('Escape');

  menu = await shapeMenu(page, 'Inbox', 'Inbox');
  await expect(menu.getByRole('menuitem')).toHaveText(['Move branch…', 'Add flow board…', 'Add mind map board…', 'Link to diagram…', 'New linked diagram…', 'Hide from export', 'Select in source']);
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
  await expect(menu.getByRole('menuitem')).toHaveText(['Move branch…', 'Open diagram', 'Change linked diagram…', 'Remove link', 'Hide from export', 'Select in source']);
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
  const boards = page.getByRole('group', { name: 'Selected: Done' }).getByRole('button', { name: 'More shape actions', exact: true });
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
