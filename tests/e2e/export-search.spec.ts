import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { board, insideStage, openFolder, previewReady, source } from './helpers';
import { downloadExport, selectMenuOption } from './menu';

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Find in/ });
const query = (page: Page) => dialog(page).getByRole('searchbox');
const matches = (page: Page) => dialog(page).getByRole('list', { name: 'Search results' }).getByRole('button');

async function exportHtml(page: Page, info: TestInfo, format = 'html') {
  await selectMenuOption(page, '#export-format', format);
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('search.html');
  await (await pending).saveAs(path);
  await expect(page.locator('#export')).toBeEnabled();
  await page.goto('about:blank');
  await page.context().setOffline(true);
  const requests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path).href);
  await board(page, 'root');
  return requests;
}

async function find(page: Page, text: string) {
  await page.getByRole('button', { name: /^Find in (diagram|atlas)$/ }).click();
  await query(page).fill(text);
}

test('offline diagram search opens hidden nested shapes, scenarios and steps with history', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await previewReady(page);
  await source(page).fill(`home: Home
layers: {
  Payments: {
    layers: {
      Refunds: {
        same: Refund approval {link: root}
      }
    }
  }
}
scenarios: {Alternative: {same: Scenario approval}}
steps: {Later: {same: Step approval}}`);
  await previewReady(page);
  const network = await exportHtml(page, info);
  await find(page, '  REFUND APPROVAL  ');
  await expect(matches(page)).toHaveText(['Refund approvalShape · Root › Payments › Refunds']);
  await query(page).press('Enter');
  await board(page, 'root.layers.Payments.layers.Refunds');
  const shape = page.locator('[data-shape-id="same"]');
  await expect(shape).toHaveClass(/zf-search-selected/);
  await expect(shape.locator('..')).toBeFocused();
  await insideStage(page, '[data-shape-id="same"]');
  await expect(page.locator('.zf-breadcrumbs')).toContainText('Payments');
  await page.goBack(); await board(page, 'root');
  await page.goForward(); await board(page, 'root.layers.Payments.layers.Refunds');
  await page.keyboard.press('Escape'); await board(page, 'root.layers.Payments');
  for (const [label, id] of [['Alternative', 'root.scenarios.Alternative'], ['Later', 'root.steps.Later']]) {
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await query(page).fill(label);
    await query(page).press('Enter');
    await board(page, id);
    await expect(page.locator('.zf-stage')).toBeFocused();
  }
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

test('offline atlas search distinguishes duplicate labels by file path and navigates across files', async ({ page }, info) => {
  const folder = info.outputPath('atlas');
  await mkdir(`${folder}/a`, { recursive: true });
  await mkdir(`${folder}/b`, { recursive: true });
  await writeFile(`${folder}/index.d2`, 'A: {link: ./a/shared.d2}\nB: {link: ./b/shared.d2}');
  for (const name of ['a', 'b']) await writeFile(`${folder}/${name}/shared.d2`, 'home: Home\nlayers: {Details: {same: Refund approval}}');
  await page.goto('/'); await previewReady(page);
  await openFolder(page, folder); await previewReady(page);
  const network = await exportHtml(page, info, 'atlas');
  await find(page, 'approval');
  await expect(matches(page)).toHaveText([
    'Refund approvalShape · a/shared.d2 › Root › Details',
    'Refund approvalShape · b/shared.d2 › Root › Details',
  ]);
  await query(page).press('ArrowDown');
  await expect(matches(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(matches(page).last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'b/shared.d2');
  await board(page, 'root.layers.Details');
  await expect(page.locator('[data-shape-id="same"]')).toHaveClass(/zf-search-selected/);
  await insideStage(page, '[data-shape-id="same"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/@file/b%2Fshared.d2/Details');
  await page.goBack(); await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'index.d2');
  await page.goForward(); await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'b/shared.d2');
  await page.reload(); await board(page, 'root.layers.Details');
  await find(page, 'approval'); await matches(page).first().click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'a/shared.d2');
  await page.keyboard.press('Escape'); await board(page, 'root');
  await page.keyboard.press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'b/shared.d2');
  await board(page, 'root.layers.Details');
  // Searching an earlier file trims the visit stack, so repeated jumps cannot form cycles.
  await find(page, 'approval'); await matches(page).first().click();
  await find(page, 'approval'); await matches(page).last().click();
  await page.keyboard.press('Escape'); await board(page, 'root');
  await page.keyboard.press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-file', 'index.d2');
  expect(network).toEqual([]);
});

test('offline search handles literal labels, missing queries and modal keyboard focus', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('x: "Café </script> <img src=x onerror=alert(1)>"\nlayers: {Child: {y: Other}}');
  await previewReady(page);
  await exportHtml(page, info);
  await find(page, '');
  await expect(dialog(page).getByRole('status')).toHaveText('Type to find a board or shape.');
  await query(page).fill('nothing here');
  await expect(dialog(page).getByRole('status')).toHaveText('No matches.');
  await query(page).press('Enter'); await expect(dialog(page)).toBeVisible();
  await query(page).fill('CAFÉ </script> <');
  await expect(matches(page)).toHaveCount(1);
  await expect(matches(page)).toContainText('Café </script> <img src=x onerror=alert(1)>');
  await expect(dialog(page).locator('img')).toHaveCount(0);
  await query(page).press('ArrowDown'); await expect(matches(page).first()).toBeFocused();
  await page.keyboard.press('Backspace'); await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('ArrowUp'); await expect(query(page)).toBeFocused();
  await query(page).press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Find in diagram', exact: true })).toBeFocused();
  await board(page, 'root');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await expect(query(page)).toBeFocused();
  await query(page).fill('Child'); await query(page).press('Enter');
  await board(page, 'root.layers.Child');
  await find(page, 'Other');
  await query(page).press('Escape');
  await board(page, 'root.layers.Child');
});

test('offline search fits a narrow dark screen and reveals a match on a zoomed board', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  await exportHtml(page, info);
  await page.setViewportSize({ width: 390, height: 450 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await find(page, 'Receipt');
  await expect(dialog(page)).toBeInViewport({ ratio: 1 });
  await expect(matches(page).first()).toBeInViewport();
  await matches(page).first().click();
  await insideStage(page, '[data-shape-id="Receipt"]');
  await expect(page.locator('[data-shape-id="Receipt"]')).toHaveClass(/zf-search-selected/);
  await expect(page.locator('[data-shape-id="Receipt"]')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 320, height: 450 });
  const zoom = (await page.locator('.zf-zoom-controls').boundingBox())!;
  const findButton = (await page.locator('.zf-search-trigger').boundingBox())!;
  expect(findButton.x).toBeGreaterThanOrEqual(zoom.x + zoom.width + 7);
  expect(findButton.x + findButton.width).toBeLessThanOrEqual(320);
  await find(page, 'Receipt');
  await expect(dialog(page)).toBeInViewport({ ratio: 1 });
});
