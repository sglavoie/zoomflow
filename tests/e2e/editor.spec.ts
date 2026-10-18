import { expect, test, type Page } from '@playwright/test';

const sourceInput = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function replace(page: Page, source: string) {
  await sourceInput(page).click();
  await sourceInput(page).press('ControlOrMeta+a');
  await page.keyboard.insertText(source);
}
async function findSource(page: Page, text: string) {
  await sourceInput(page).click();
  await sourceInput(page).press('ControlOrMeta+f');
  const search = page.locator('.cm-search input[name="search"]');
  await page.getByLabel('match case', { exact: true }).check();
  await search.fill('');
  // CodeMirror commits search queries on keyup/change, not input alone.
  await search.pressSequentially(text);
  await search.press('Enter');
  await search.press('Escape');
}

test('live edits retain the last good render on syntax errors and recover with diagnostics cleared', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  const before = await page.locator('.zf-stage').innerHTML();
  await sourceInput(page).click();
  await sourceInput(page).press('ControlOrMeta+End');
  // Appending by keyboard exercises CodeMirror input and the debounce path.
  await page.keyboard.insertText('\nbroken: {');
  await expect(page.locator('#compile-error')).toContainText('maps must be terminated');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible();
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
  expect(await page.locator('.zf-stage').innerHTML()).toBe(before);
  await ready(page, 'root.layers.checkout');
  // Editing keys must stay inside CodeMirror, even while a nested board is open.
  await sourceInput(page).press('Backspace');
  await sourceInput(page).press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await replace(page, 'fresh: Recovered');
  await expect(page.locator('.zf-stage')).toContainText('Recovered');
  await ready(page);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
});

test('clicking shapes selects exact source and selecting source highlights the matching shape', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await replace(page, '😀: Emoji\nbox: {a: Nested}\na: Root\na -> box.a\nbeta: Beta');
  const nested = page.locator('.zf-stage [data-shape-id="box.a"]');
  await expect(nested).toBeVisible();
  await nested.click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('a');
  await expect(nested).toHaveClass(/zf-source-selected/);
  // The selected nested identifier is distinguished from the root's same name.
  await page.keyboard.insertText('renamed');
  await expect(page.locator('.zf-stage [data-shape-id="box.renamed"]')).toBeVisible();
  await findSource(page, 'beta');
  await expect(page.locator('.zf-stage [data-shape-id="beta"]')).toHaveClass(/zf-source-selected/);
  await expect(page.locator('.zf-stage [data-shape-id="a"]')).not.toHaveClass(/zf-source-selected/);
  await page.locator('.zf-stage [data-shape-id="😀"]').click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('😀');
});

test('source selection opens its board, linked shapes still drill, and file loading replaces editor text', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await findSource(page, 'Capture');
  await ready(page, 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-stage [data-shape-id="Capture"]')).toHaveClass(/zf-source-selected/);
  await page.keyboard.insertText('Captured');
  await expect(page.locator('.zf-stage [data-shape-id="Captured"]')).toBeVisible();
  await ready(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('button', { name: 'Root', exact: true }).click();
  await ready(page);
  const checkout = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await checkout.click({ modifiers: ['Alt'] });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Checkout');
  await ready(page);
  await checkout.click();
  await ready(page, 'root.layers.checkout');
  await page.locator('#file').setInputFiles({ name: 'new.d2', mimeType: 'text/plain', buffer: Buffer.from('new: New document') });
  await expect(sourceInput(page)).toHaveText('new: New document');
  await expect(page.locator('.zf-stage')).toContainText('New document');
  await ready(page);
});

test('edits during compiler startup publish only the newest source', async ({ page }) => {
  await page.goto('/');
  await replace(page, 'stale: {');
  await replace(page, 'latest: Latest preview');
  await expect(page.locator('.zf-stage')).toContainText('Latest preview');
  await ready(page);
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.zf-stage [data-shape-id="latest"]')).toBeVisible();
});
