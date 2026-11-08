import { expect, test } from '@playwright/test';
import { chooseExample, editorText, openShapeActions, previewReady, source } from './helpers';
import { openDownloads, selectMenuOption } from './menu';

test.use({ viewport: { width: 1440, height: 900 } });

test('Source remembers a canvas-first workspace and source actions reveal it', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const sourcePanel = page.locator('#source-pane');
  await page.locator('#toggle-source').click();
  await expect(sourcePanel).toBeHidden();
  await expect(page.locator('#toggle-source')).toHaveAttribute('aria-pressed', 'false');
  await page.reload(); await previewReady(page);
  await expect(sourcePanel).toBeHidden();
  await page.locator('#viewer [data-shape-id="Browse"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select in source' }).click();
  await expect(sourcePanel).toBeVisible();
  await expect(source(page)).toBeFocused();
});

test('builder previews respond to edits and presets without changing the document', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const before = await editorText(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a flow' });
  const preview = dialog.getByRole('region', { name: 'Live diagram preview', exact: true });
  await dialog.getByLabel('Step 1 name').fill('Ship something delightful');
  await dialog.getByRole('button', { name: 'Elevated', exact: true }).click();
  await expect(preview.locator('.zf-stage')).toContainText('Ship something delightful');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.getByLabel('Filled shapes')).toBeChecked();
  await expect(dialog.getByLabel('Shadows')).toBeChecked();
  expect(await editorText(page)).toBe(before);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.zf-stage')).toHaveCount(1);
  await page.getByRole('button', { name: 'New mind map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Create a mind map' });
  await map.getByRole('textbox', { name: 'Topics', exact: true }).fill('Journey\n  Explore\n    Discover\n  Share');
  await map.getByLabel('Detail boards').selectOption('1');
  const live = map.locator('.zf-stage');
  await expect(map.locator('.builder-preview-heading')).toContainText('2 boards');
  await live.getByRole('link', { name: 'Open Explore board', exact: true }).click();
  await expect(live).toContainText('Discover');
  await map.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  expect(await editorText(page)).toBe(before);
  await expect(page.locator('.zf-stage')).toHaveCount(1);
});

test('a deletion offers local Undo and later edits retire the old confirmation', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/); await previewReady(page);
  const step = page.locator('#viewer [data-shape-id="step_1"]');
  await step.click();
  await openShapeActions(page);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(step).toHaveCount(0);
  const confirmation = page.locator('.canvas-feedback');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(step).toBeVisible();
  await step.click(); await page.keyboard.press('Delete');
  await expect(confirmation).toBeVisible();
  await source(page).fill('a: New document content'); await previewReady(page);
  await expect(confirmation).toBeHidden();
});

test('export thumbnail and interactive preview use the same hidden-shape choices', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('Public: Keep me\nSecret: Private text\nDetail: More {link: layers.Detail}\nlayers: {Detail: {a: Inside}}');
  await previewReady(page);
  const secret = page.locator('#viewer [data-shape-id="Secret"]');
  await secret.focus(); await page.keyboard.press('h');
  await expect(secret).toHaveAttribute('data-export-hidden', '');
  await selectMenuOption(page, '#export-format', 'html');
  await openDownloads(page);
  const image = page.locator('#export-preview img');
  await expect(image).toBeVisible();
  const svg = await image.evaluate(async (el: HTMLImageElement) => (await fetch(el.src)).text());
  expect(svg).toContain('Keep me');
  expect(svg).not.toContain('Private text');
  const opened = page.waitForEvent('popup');
  await page.locator('#open-export-preview').click();
  const preview = await opened;
  await expect(preview.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(preview.locator('.zf-stage')).not.toContainText('Private text');
  await preview.locator('a[data-board="root.layers.Detail"]').click();
  await expect(preview.locator('.zf-stage')).toContainText('Inside');
  await preview.close();
});

test('Source visibility belongs to each pane and a hidden second pane cannot collapse the first', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-choose-b').click();
  await page.locator('.example-option').filter({ hasText: 'Flowchart basics' }).click();
  await expect(page.locator('#viewer-b')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-pane-b')).toBeHidden();
  await expect(page.locator('#source-pane')).toBeVisible();
  await selectMenuOption(page, '#layout', 'single');
  await expect(page.locator('#source-pane')).toBeVisible();
  const diagram = (await page.locator('#preview-pane').boundingBox())!;
  const editor = (await page.locator('#source-pane').boundingBox())!;
  expect(editor.x).toBeGreaterThanOrEqual(diagram.x + diagram.width);
  expect(editor.height).toBeGreaterThan(400);
});

test('adding a step briefly highlights the node and incoming connection', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await chooseExample(page, /^Flows & mind maps/); await previewReady(page);
  await page.locator('#viewer [data-shape-id="step_1"]').click();
  await page.getByRole('button', { name: 'Add next step', exact: true }).click();
  await expect(page.locator('#viewer [data-shape-id].zf-edit-highlight')).toHaveCount(1);
  await expect(page.locator('#viewer [data-connection-id].zf-edit-highlight')).toHaveCount(1);
  await expect(page.locator('#viewer .zf-edit-highlight')).toHaveCount(0);
});
