import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { board, openFromBadge, chooseExample, editorText } from './helpers';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');
const shape = (page: Page, id: string) => page.locator(`.zf-stage [data-shape-id="${id}"]`);
test.use({ viewport: { width: 1440, height: 900 } });

async function approvalFlow(page: Page) {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a flow' });
  await dialog.getByRole('button', { name: 'Approval with Yes / No' }).click();
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click();
  await ready(page);
}

test('adds a mind map board to a selected flow step, and edits each board with its own builder', async ({ page }) => {
  await approvalFlow(page);
  await shape(page, 'step_3').click();
  const selected = page.getByRole('group', { name: 'Selected: Complete request' });
  const boards = selected.getByRole('button', { name: 'Add board…', exact: true });
  await expect(boards).toHaveAttribute('aria-expanded', 'false');
  await boards.click();
  await expect(boards).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#${await boards.getAttribute('aria-controls')}`)).toBeVisible();
  // The button closes its menu too.
  await boards.click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(boards).toHaveAttribute('aria-expanded', 'false');
  await boards.click();
  await page.getByRole('menu', { name: 'Actions for Complete request' }).getByRole('menuitem', { name: 'Add mind map board…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a mind map board' });
  await expect(dialog.getByLabel('Board name')).toHaveValue('Complete request');
  await expect(dialog.getByRole('textbox', { name: 'Topics' })).toHaveValue('Complete request\n  First idea\n  Second idea');
  await dialog.getByRole('textbox', { name: 'Topics' }).fill('Complete request\n  Notify team\n  Archive');
  await dialog.getByRole('button', { name: 'Add board', exact: true }).click();
  await ready(page);
  // The new board opens, and its own builder edits it.
  await board(page, 'root.layers.Complete request');
  await expect(page.locator('.zf-stage')).toContainText('Notify team');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Edit mind map' });
  await map.getByRole('textbox', { name: 'Topics' }).fill('Complete request\n  Notify team\n  Archive\n  Celebrate');
  await map.getByRole('button', { name: 'Apply changes', exact: true }).click();
  // The edit button hides while the board recompiles, so the diagram takes focus.
  await expect(page.locator('.zf-stage')).toBeFocused();
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Celebrate');

  // The flow stays editable, and keeps the board on its step.
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  const flow = page.getByRole('dialog', { name: 'Edit flow' });
  await flow.getByLabel('Step 3 name').fill('Done');
  await flow.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Done');
  expect(await editorText(page)).toContain('step_3.link: layers."Complete request"');

  // Removing the step would strand its board, so the builder explains instead.
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await flow.getByRole('button', { name: 'Remove step 3' }).click();
  await flow.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(flow.getByRole('alert')).toHaveText('The step “Done” opens the board “Complete request”. Keep the step, or delete its board in the source first.');
});

test('repairs missing detail imports when editing an existing attached mind map', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#file').setInputFiles({ name: 'nested-map.d2', mimeType: 'text/plain',
    buffer: Buffer.from(readFileSync('fixtures/lint/nested-mind-map.d2', 'utf8')) });
  await ready(page);
  await expect(page.locator('#lint-summary')).toHaveText('0 lint errors, 3 warnings');
  await openFromBadge(page, 'Open Review the request board');
  await board(page, 'root.layers.Review the request');
  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit mind map' }).getByRole('button', { name: 'Apply changes', exact: true }).click();
  await ready(page);
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  expect((await editorText(page)).match(/\.\.\.@zoomflow/g)).toHaveLength(2);
  await openFromBadge(page, 'Open Detail board');
  await board(page, 'root.layers.Review the request.layers.Detail');
  await expect(shape(page, 'n_1')).toContainText('New topic');
});

test('offers the same actions from a context menu and the keyboard', async ({ page }) => {
  await approvalFlow(page);
  await shape(page, 'step_4').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Request changes' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Add next step', 'Delete', 'Add flow board…', 'Add mind map board…', 'Select in source']);
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Select in source' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await shape(page, 'step_4').focus();
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Add flow board…' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a flow board' });
  await dialog.getByLabel('Board name').fill('Changes');
  await dialog.getByRole('button', { name: 'Add board', exact: true }).click();
  await ready(page);
  await board(page, 'root.layers.Changes');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();

  // A shape that opens a builder board offers to edit it.
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await page.getByRole('link', { name: 'Open Changes board', exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Edit flow board…' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit flow' })).toBeVisible();
});

test('offers boards on hand-written diagrams, and selects a shape\'s source from the menu', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('textbox', { name: 'D2 source', exact: true }).fill('a -> b');
  await ready(page);
  await shape(page, 'b').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for b' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Add flow board…', 'Add mind map board…', 'Select in source']);
  await menu.getByRole('menuitem', { name: 'Select in source' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'D2 source', exact: true })).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('b');
});

test('the Flows & mind maps example opens each board in its own builder', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await chooseExample(page, /^Flows & mind maps/);
  await ready(page);
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
  await openFromBadge(page, 'Open Plan the launch board');
  await board(page, 'root.layers.Plan the launch');
  await expect(page.getByRole('button', { name: 'Edit mind map', exact: true })).toBeVisible();
  await openFromBadge(page, 'Open Onboarding board');
  await board(page, 'root.layers.Plan the launch.layers.Onboarding');
  await expect(page.locator('.zf-stage')).toContainText('Invite a teammate');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
});
