import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorText, openFolder, previewReady, withEditorView } from './helpers';
import { devURL } from './servers';
import { atlas, showing, shapeMenu, showingProjectFile } from './atlas-helpers';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
