import { expect, test, type Page } from '@playwright/test';
import { board, withEditorView } from './helpers';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');
const shape = (page: Page, id: string) => page.locator(`.zf-stage [data-shape-id="${id}"]`);
const stage = (page: Page) => page.locator('.zf-stage');
const entries = (page: Page) => page.evaluate(() => history.length);
test.use({ viewport: { width: 1440, height: 900 } });

// Root with two topics named A, on boards “A” and “A 2”, and B: a mind map with one detail board per branch.
const map = `# Created with the Zoomflow mind map builder.
# Level 1 topics with subtopics open as detail boards.
...@zoomflow
direction: right

n: "Root" {class: zf-topic}
n_1: "A" {class: [zf-branch; zf-accent-1]; link: layers."A"}
n_2: "A" {class: [zf-branch; zf-accent-2]; link: layers."A 2"}
n_3: "B" {class: [zf-branch; zf-accent-3]; link: layers."B"}

n -- n_1: {class: zf-accent-1}
n -- n_2: {class: zf-accent-2}
n -- n_3: {class: zf-accent-3}

layers: {
  "A": {
    direction: right

    n: "A" {class: [zf-topic; zf-accent-1]}
    n_1: "first child" {class: [zf-branch; zf-accent-1]}

    n -- n_1: {class: zf-accent-1}
  }
  "A 2": {
    direction: right

    n: "A" {class: [zf-topic; zf-accent-2]}
    n_1: "second child" {class: [zf-branch; zf-accent-2]}

    n -- n_1: {class: zf-accent-2}
  }
  "B": {
    direction: right

    n: "B" {class: [zf-topic; zf-accent-3]}
    n_1: "only child" {class: [zf-branch; zf-accent-3]}

    n -- n_1: {class: zf-accent-3}
  }
}
`;

async function open(page: Page, id: string) {
  await page.goto('/'); await ready(page);
  await withEditorView(page, (view, _, text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }), map);
  await ready(page);
  await stage(page).locator(`a[data-board="${id}"] .appendix-icon`).click();
  await board(page, id);
}

test('removing a detail board’s last subtopic goes up to its centre, and undo comes back', async ({ page }) => {
  await open(page, 'root.layers.A');
  const visited = await entries(page);
  await shape(page, 'n_1').click();
  await page.keyboard.press('Delete');
  await ready(page);
  // The board is gone, and the other A's board now has its name: the board above shows the centre, in place in history.
  await board(page, 'root');
  await expect(shape(page, 'n_1')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Selected: A' })).toBeVisible();
  expect(await entries(page)).toBe(visited);
  await stage(page).press('ControlOrMeta+z');
  await ready(page);
  await board(page, 'root.layers.A');
  await expect(stage(page)).toContainText('first child');
});

test('undo and redo of a renamed detail board centre follow the board', async ({ page }) => {
  await open(page, 'root.layers.B');
  await shape(page, 'n').click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename B' }).fill('Bee');
  await page.keyboard.press('Enter');
  await ready(page);
  await board(page, 'root.layers.Bee');
  await stage(page).press('ControlOrMeta+z');
  await ready(page);
  await board(page, 'root.layers.B');
  await expect(page.getByText(/not found/)).toHaveCount(0);
  await stage(page).press('ControlOrMeta+Shift+z');
  await ready(page);
  await board(page, 'root.layers.Bee');
});

test('renaming a detail board centre and adding a subtopic at once keeps one history entry', async ({ page }) => {
  await open(page, 'root.layers.B');
  const visited = await entries(page);
  await shape(page, 'n').click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename B' }).fill('Bee');
  await page.keyboard.press('ControlOrMeta+Enter');
  await ready(page);
  await board(page, 'root.layers.Bee');
  await expect(page.getByRole('textbox', { name: 'Rename New topic' })).toBeFocused();
  expect(await entries(page)).toBe(visited);
});

test('Backspace in a shape’s menu or on its selection bar stays on the board', async ({ page }) => {
  await open(page, 'root.layers.B');
  await shape(page, 'n_1').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for only child' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(menu).toBeVisible();
  await board(page, 'root.layers.B');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('group', { name: 'Selected: only child' }).getByRole('button', { name: 'Rename' }).focus();
  await page.keyboard.press('Backspace');
  await board(page, 'root.layers.B');
  await expect(stage(page)).toContainText('only child');
});
