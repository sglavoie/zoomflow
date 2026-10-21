import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { openDownloads } from './menu';
import { source, previewReady, chooseExample } from './helpers';

async function saved(page: Page) {
  await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
}
async function expectView(page: Page, expected: string) {
  const actual = await page.locator('.zf-stage > svg').evaluate((node) => {
    const svg = node as SVGSVGElement;
    const matrix = svg.getScreenCTM()!;
    return { box: svg.getAttribute('viewBox')!.split(' ').map(Number), xScale: Math.abs(matrix.a), yScale: Math.abs(matrix.d) };
  });
  const prior = expected.split(' ').map(Number);
  // SVG matrix round trips differ by tiny fractions between engines. Assert
  // the restored position and size in screen pixels, not arbitrary SVG units.
  actual.box.forEach((value, i) => expect(Math.abs(value - prior[i]) * (i % 2 ? actual.yScale : actual.xScale)).toBeLessThan(0.25));
}

test('concurrent tabs keep both versions and unrelated drafts after reload', async ({ page, context }) => {
  await page.goto('/'); await previewReady(page);
  const other = await context.newPage(); await other.goto('/'); await previewReady(other);
  await source(page).fill('a: First tab'); await saved(page);
  // The notice stays in the accessibility tree, empty, so its later text is announced.
  await expect(page.getByRole('status').and(page.locator('#draft-conflict-message'))).toHaveText('');
  await expect(page.locator('#draft-conflict-reload')).toBeHidden();
  await other.locator('#file').setInputFiles({ name: 'other.d2', mimeType: 'text/plain', buffer: Buffer.from('other: Unrelated') });
  await previewReady(other);
  await chooseExample(other, /Order flow/);
  await source(other).fill('b: Second tab'); await saved(other);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  // The notice names the affected document and reloads after keeping this tab's edits.
  await expect(page.locator('#draft-conflict-message')).toHaveText(/^Order flow changed in another tab\./);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload', exact: true }).click()]);
  await previewReady(page);
  await expect(page.locator('#draft-conflict-message')).toHaveText('');
  await chooseExample(page, /Order flow \(recovered\)/);
  await expect(source(page)).toHaveText('a: First tab');
  await chooseExample(page, /^Order flow Modified/);
  await expect(source(page)).toHaveText('b: Second tab');
  await chooseExample(page, /other.d2/);
  await expect(source(page)).toHaveText('other: Unrelated');
});

test('project recovery copies keep imports and do not replace the canonical project file', async ({ page, context }) => {
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project');
  await previewReady(page);
  const original = await source(page).innerText();
  const other = await context.newPage(); await other.goto('/'); await previewReady(other);
  await source(page).fill(`${original}\nfirst: First tab`); await previewReady(page); await saved(page);
  await source(other).fill(`${original}\nsecond: Second tab`); await previewReady(other); await saved(other);
  await page.reload(); await previewReady(page);
  await chooseExample(page, /main.d2 \(recovered\)/);
  await expect(source(page)).toContainText('First tab');
  await expect(page.locator('.zf-stage')).toContainText('First tab');
  await expect(page.locator('#compile-error')).toBeHidden();
});

test('documents restore boards, breadcrumbs, zoom and pan; returning to a board restores its view', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
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
  await chooseExample(page, /Flowchart basics/);
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await chooseExample(page, /Order flow/);
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('225%');
  await expectView(page, childBox!);
  await expect(page.locator('.zf-breadcrumbs button')).toHaveText(['Root', 'checkout']);
  await page.locator('.zf-breadcrumbs').getByRole('button', { name: 'Root', exact: true }).click();
  await expect(stage).toHaveAttribute('data-board', 'root');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('150%');
  await expectView(page, rootBox!);
  await page.goBack();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('225%');
});

test('mobile preview exposes the error and opens its source in one tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await source(page).fill('a: Good\nbroken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await page.locator('#mobile-preview').click();
  await expect(page.locator('#mobile-source')).toHaveText('Source · 1 error');
  await expect(page.locator('#mobile-error')).toContainText('Line 2');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.locator('#mobile-error button').click();
  await expect(source(page)).toBeFocused();
  await source(page).fill('a: Fixed'); await previewReady(page);
  await expect(page.locator('#mobile-source')).toHaveText('Source');
  await page.locator('#mobile-preview').click();
  await expect(page.locator('#mobile-error')).toBeHidden();
});

test('workspace is compact and stable, zoom explains its baseline, export describes its scope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await previewReady(page);
  const pane = (await page.locator('#source-pane').boundingBox())!;
  const editor = (await page.locator('#editor').boundingBox())!;
  expect(editor.y - pane.y).toBeLessThan(145);
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('Fit');
  await expect(page.locator('.zf-pan-hint')).toHaveText('Click Checkout to explore');
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
  await expect(page.locator('#export-scope')).toHaveText('Fix source errors to export.');
  await expect(page.locator('#export')).toBeDisabled();
});

test('offline HTML restores each board view and explains zoom', async ({ page, context }, info) => {
  await page.goto('/'); await previewReady(page);
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

test('switching documents restores selection and scroll position', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  const long = Array.from({ length: 120 }, (_, i) => `# comment ${i}`).join('\n') + '\na: Final line';
  await source(page).fill(long);
  await previewReady(page);
  await source(page).press('ControlOrMeta+End');
  await source(page).press('Shift+Home');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  const scroll = await page.locator('.cm-scroller').evaluate((node) => node.scrollTop);
  expect(scroll).toBeGreaterThan(500);
  await chooseExample(page, /Flowchart basics/);
  // Browsers round CodeMirror's top padding differently by a pixel.
  await expect.poll(() => page.locator('.cm-scroller').evaluate((node) => node.scrollTop)).toBeLessThan(3);
  await chooseExample(page, /Order flow/);
  await source(page).focus();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect.poll(() => page.locator('.cm-scroller').evaluate((node, previous) => Math.abs(node.scrollTop - previous), scroll)).toBeLessThan(3);
});
