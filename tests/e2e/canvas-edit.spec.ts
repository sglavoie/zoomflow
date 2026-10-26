import { expect, test, type Page } from '@playwright/test';
import { board, openFromBadge, chooseExample, editorText, source } from './helpers';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');
const shape = (page: Page, id: string) => page.locator(`.zf-stage [data-shape-id="${id}"]`);
const stage = (page: Page) => page.locator('.zf-stage');
test.use({ viewport: { width: 1440, height: 900 } });

async function mixed(page: Page) {
  await page.goto('/'); await ready(page);
  await chooseExample(page, /^Flows & mind maps/);
  await ready(page);
}

test('renames, adds and removes flow steps on the diagram, and undoes there', async ({ page }) => {
  await mixed(page);
  // Selecting a step keeps focus on the diagram, ready for its shortcuts.
  await shape(page, 'step_1').click();
  await expect(shape(page, 'step_1')).toBeFocused();
  // One ring and halo mark the selected step, and move with the selection.
  await expect(shape(page, 'step_1')).toHaveClass(/zf-canvas-selected/);
  await expect(stage(page).locator('.zf-selection-ring')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Selected: New idea' })).toBeVisible();
  await shape(page, 'step_5').click();
  await expect(stage(page).locator('.zf-canvas-selected')).toHaveCount(1);
  await expect(shape(page, 'step_5')).toHaveClass(/zf-canvas-selected/);
  // A click on the background clears the selection.
  await stage(page).click({ position: { x: 5, y: 5 } });
  await expect(stage(page).locator('.zf-selection-ring, .zf-canvas-selected')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /^Selected:/ })).toBeHidden();
  await shape(page, 'step_1').click();
  await page.keyboard.press('F2');
  const rename = page.getByRole('textbox', { name: 'Rename New idea' });
  await expect(rename).toBeFocused();
  await rename.fill('Brainstorm');
  await rename.press('Enter');
  await ready(page);
  await expect(stage(page)).toContainText('Brainstorm');
  await expect(shape(page, 'step_1')).toBeFocused();

  // Tab adds the next step and names it at once.
  await page.keyboard.press('Tab');
  await ready(page);
  const named = page.getByRole('textbox', { name: 'Rename New step' });
  await expect(named).toBeFocused();
  await named.fill('Gather feedback');
  await named.press('Enter');
  await ready(page);
  await expect(stage(page)).toContainText('Gather feedback');
  expect(await editorText(page)).toContain('step_1 -> step_6: ""');

  await shape(page, 'step_6').focus();
  await page.keyboard.press('Delete');
  await ready(page);
  await expect(stage(page)).not.toContainText('Gather feedback');
  await expect(page.locator('#activity-status')).toHaveText('Removed “Gather feedback”. Undo with ⌘Z / Ctrl+Z.');
  await stage(page).press('ControlOrMeta+z');
  await ready(page);
  await expect(stage(page)).toContainText('Gather feedback');
  await stage(page).press('ControlOrMeta+Shift+z');
  await ready(page);
  await expect(stage(page)).not.toContainText('Gather feedback');

  // Double-click renames too, and the selection bar offers the same actions.
  await shape(page, 'step_5').dblclick();
  await page.getByRole('textbox', { name: 'Rename Launched' }).press('Escape');
  await expect(stage(page)).toContainText('Launched');
  await expect(page.getByRole('group', { name: 'Selected: Launched' }).getByRole('button'))
    .toHaveText(['Rename', 'Add next step', 'Delete', 'Add board…']);
});

test('adds subtopics and siblings on a mind map board with Tab and Enter', async ({ page }) => {
  await mixed(page);
  await openFromBadge(page, 'Open Plan the launch board');
  await board(page, 'root.layers.Plan the launch');
  await shape(page, 'n_4').click();
  await page.keyboard.press('Enter');
  await ready(page);
  const sibling = page.getByRole('textbox', { name: 'Rename New topic' });
  await sibling.fill('Budget');
  // Tab names the topic and adds a subtopic under it.
  await sibling.press('Tab');
  await ready(page);
  const child = page.getByRole('textbox', { name: 'Rename New topic' });
  await child.fill('Ads');
  await child.press('Enter');
  await ready(page);
  await expect(stage(page)).toContainText('Budget');
  await expect(stage(page)).toContainText('Ads');
  // The map stays editable as an outline, and its attached flow stays on its topic.
  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit mind map' }).getByRole('textbox', { name: 'Topics' }))
    .toHaveValue(/ {2}Risks\n {2}Budget\n {4}Ads$/);
  await page.getByRole('dialog', { name: 'Edit mind map' }).getByRole('button', { name: 'Cancel' }).click();
  expect(await editorText(page)).toContain('n_3_2.link: layers."Onboarding"');
});

test('going up selects the shape that led down, with its actions', async ({ page }) => {
  await mixed(page);
  await openFromBadge(page, 'Open Build and test board');
  await board(page, 'root.layers.Build and test');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await expect(page.getByRole('group', { name: 'Selected: Build and test' }).getByRole('button', { name: 'Edit flow board', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Build and test board', exact: true })).toBeFocused();
});

test('the boards outline opens and edits any board, and the source follows the board on view', async ({ page }) => {
  await mixed(page);
  await page.getByText('Boards (4)').click();
  const outline = page.getByRole('navigation', { name: 'Boards' });
  await expect(outline.getByRole('button', { name: /^Onboarding/ })).toContainText('Flow');
  await expect(outline.getByRole('button', { name: /^Plan the launch/ })).toContainText('Mind map');
  await outline.getByRole('button', { name: /^Onboarding/ }).click();
  await board(page, 'root.layers.Plan the launch.layers.Onboarding');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button')).toHaveText(['Root', 'Plan the launch', 'Onboarding']);
  // Only the board's own block stays at full strength in the source.
  await expect(source(page).locator('.cm-line:not(.zf-outside-board)').filter({ hasText: 'Guided tour' })).toHaveCount(1);
  await expect(source(page).locator('.cm-line.zf-outside-board').filter({ hasText: 'Freeze features' })).toHaveCount(1);
  await page.getByText('Boards (4)').click();
  await outline.getByRole('button', { name: 'Edit flow Build and test' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit flow' }).getByLabel('Step 1 name')).toHaveValue('Freeze features');
});

test('a link to a board previews it before drilling in', async ({ page }) => {
  await mixed(page);
  await page.getByRole('link', { name: 'Open Build and test board', exact: true }).hover();
  const preview = page.getByRole('tooltip');
  await expect(preview).toContainText('Build and test');
  await expect(preview).toContainText('Flow · 4 steps');
  await expect(preview.locator('img')).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(preview).toBeHidden();
});

test('a step that opens a board selects and renames on click, and opens from its arrow', async ({ page }) => {
  await mixed(page);
  const link = page.getByRole('link', { name: 'Open Plan the launch board', exact: true });
  // A click on the shape selects it and stays on this board.
  await shape(page, 'step_2').click();
  await expect(stage(page)).toHaveAttribute('data-board', 'root');
  await expect(shape(page, 'step_2')).toHaveClass(/zf-canvas-selected/);
  await expect(link).toBeFocused();
  await expect(page.getByRole('group', { name: 'Selected: Plan the launch' }).getByRole('button', { name: 'Edit mind map board' })).toBeVisible();
  // Double-click renames it, and its board keeps opening from it.
  await shape(page, 'step_2').dblclick();
  const rename = page.getByRole('textbox', { name: 'Rename Plan the launch' });
  await rename.fill('Plan it');
  await rename.press('Enter');
  await ready(page);
  await expect(stage(page)).toHaveAttribute('data-board', 'root');
  await expect(stage(page)).toContainText('Plan it');
  expect(await editorText(page)).toContain('step_2.link: layers."Plan the launch"');
  // The arrow badge opens the board, and Enter on the focused link does too.
  await openFromBadge(page, 'Open Plan the launch board');
  await board(page, 'root.layers.Plan the launch');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await link.press('Enter');
  await board(page, 'root.layers.Plan the launch');
  // A topic that opens a board renames on double-click too, and Enter opens its board.
  await shape(page, 'n_3_2').dblclick();
  await page.getByRole('textbox', { name: 'Rename Onboarding' }).press('Escape');
  await expect(stage(page)).toHaveAttribute('data-board', 'root.layers.Plan the launch');
  await page.getByRole('link', { name: 'Open Onboarding board', exact: true }).press('Enter');
  await board(page, 'root.layers.Plan the launch.layers.Onboarding');
});
