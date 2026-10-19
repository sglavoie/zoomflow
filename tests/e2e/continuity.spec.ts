import { expect, test, type Page } from '@playwright/test';
import { openDownloads } from './menu';
import { pathToFileURL } from 'node:url';
const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page) {
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function choose(page: Page, name: RegExp) {
  await page.locator('#example-picker summary').click();
  await page.locator('.example-option').filter({ hasText: name }).click();
  await ready(page);
}
async function saved(page: Page) {
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
}

test('concurrent tabs keep both versions and unrelated drafts after reload', async ({ page, context }) => {
  await page.goto('/'); await ready(page);
  const other = await context.newPage(); await other.goto('/'); await ready(other);
  await source(page).fill('a: First tab'); await saved(page);
  await other.locator('#file').setInputFiles({ name: 'other.d2', mimeType: 'text/plain', buffer: Buffer.from('other: Unrelated') });
  await ready(other);
  await choose(other, /Order flow/);
  await source(other).fill('b: Second tab'); await saved(other);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  await page.reload(); await ready(page);
  await choose(page, /Order flow \(recovered\)/);
  await expect(source(page)).toHaveText('a: First tab');
  await choose(page, /^Order flowModified/);
  await expect(source(page)).toHaveText('b: Second tab');
  await choose(page, /other.d2/);
  await expect(source(page)).toHaveText('other: Unrelated');
});

test('project recovery copies keep imports and do not replace the canonical project file', async ({ page, context }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project');
  await ready(page);
  const original = await source(page).innerText();
  const other = await context.newPage(); await other.goto('/'); await ready(other);
  await source(page).fill(`${original}\nfirst: First tab`); await ready(page); await saved(page);
  await source(other).fill(`${original}\nsecond: Second tab`); await ready(other); await saved(other);
  await page.reload(); await ready(page);
  await choose(page, /main.d2 \(recovered\)/);
  await expect(source(page)).toContainText('First tab');
  await expect(page.locator('.zf-stage')).toContainText('First tab');
  await expect(page.locator('#compile-error')).toBeHidden();
});

test('documents restore boards, breadcrumbs, zoom and pan; returning to a board restores its view', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const stage = page.locator('.zf-stage');
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 40);
  await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 50, bounds.y + 70, { steps: 5 });
  await page.mouse.up(); await page.keyboard.up('Space');
  const rootBox = await stage.locator(':scope > svg').getAttribute('viewBox');
  // Use the keyboard to avoid depending on the shape's zoomed position.
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const childBox = await stage.locator(':scope > svg').getAttribute('viewBox');
  await choose(page, /Flowchart basics/);
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await choose(page, /Order flow/);
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('225%');
  (await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ').map(Number).forEach((value, i) => expect(value).toBeCloseTo(Number(childBox!.split(' ')[i]), 5));
  await expect(page.locator('.zf-breadcrumbs button')).toHaveText(['Root', 'checkout']);
  await page.locator('.zf-breadcrumbs').getByRole('button', { name: 'Root', exact: true }).click();
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  (await stage.locator(':scope > svg').getAttribute('viewBox'))!.split(' ').map(Number).forEach((value, i) => expect(value).toBeCloseTo(Number(rootBox!.split(' ')[i]), 5));
  await page.goBack();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('225%');
});

test('mobile preview exposes the error and opens its source in one tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
  await page.locator('#mobile-source').click();
  await source(page).fill('a: Good\nbroken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await page.locator('#mobile-preview').click();
  await expect(page.locator('#mobile-source')).toHaveText('Source · 1 error');
  await expect(page.locator('#mobile-error')).toContainText('Line 2');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.locator('#mobile-error button').click();
  await expect(source(page)).toBeFocused();
  await source(page).fill('a: Fixed'); await ready(page);
  await expect(page.locator('#mobile-source')).toHaveText('Source');
  await page.locator('#mobile-preview').click();
  await expect(page.locator('#mobile-error')).toBeHidden();
});

test('workspace is compact and stable, zoom explains its baseline, export describes its scope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await ready(page);
  const pane = (await page.locator('#source-pane').boundingBox())!;
  const editor = (await page.locator('#editor').boundingBox())!;
  expect(editor.y - pane.y).toBeLessThan(145);
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await expect(page.locator('.zf-pan-hint')).toBeHidden();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.zf-pan-hint')).toBeVisible();
  await expect(page.locator('.zf-zoom-controls span')).toHaveAttribute('aria-label', '150% of fitted size');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).click();
  await openDownloads(page);
  await page.locator('#export-format input[value="svg"]').check();
  await expect(page.locator('#export-scope')).toHaveText('Current board: checkout · SVG');
  await page.locator('#export-format input[value="html"]').check();
  await expect(page.locator('#export-scope')).toHaveText('Entire diagram · 3 boards · Interactive HTML');
  await expect(page.getByRole('radio', { name: /Interactive diagram HTML/ })).toHaveAccessibleName(/drill-down navigation/);
  await page.locator('#export-format input[value="zip"]').check();
  await expect(page.locator('#export-scope')).toHaveText('Entire diagram · 3 boards · SVG ZIP');
  await page.locator('#header-more-toggle').click();
  await source(page).fill('broken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  expect((await page.locator('#editor').boundingBox())!.y).toBe(editor.y);
  await openDownloads(page);
  await expect(page.locator('#export-scope')).toContainText('Compile the current source');
  await expect(page.locator('#export')).toBeDisabled();
});


test('offline HTML restores each board view and explains zoom', async ({ page, context }, info) => {
  await page.goto('/'); await ready(page);
  await openDownloads(page);
  await page.locator('#export-format input[value="html"]').check();
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = info.outputPath('views.html');
  await (await pending).saveAs(file);
  const offline = await context.newPage();
  await context.setOffline(true);
  await offline.goto(pathToFileURL(file).href);
  await expect(offline.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await offline.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(offline.locator('.zf-pan-hint')).toBeVisible();
  await offline.getByRole('link', { name: 'Open checkout board', exact: true }).focus();
  await offline.keyboard.press('Enter');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await offline.keyboard.press('Escape');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(offline.locator('.zf-zoom-controls span')).toHaveText('150%');
});
