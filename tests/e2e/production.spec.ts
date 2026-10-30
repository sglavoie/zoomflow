import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { downloadExport, selectMenuOption } from './menu';
import { previewReady, source } from './helpers';

/** Production smoke test: the built app from `pnpm build`, served by `vite preview`.
 * It covers what only the bundle can break: the lazy D2 worker, WASM, fonts and export runtime.
 */
test('the production build compiles, navigates, edits and exports offline HTML', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await previewReady(page);
  await page.locator('.zf-stage a[data-board="root.layers.checkout"]').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');

  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nBuilt: Production check');
  await previewReady(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Root' }).click();
  await expect(page.locator('.zf-stage')).toContainText('Production check');

  await selectMenuOption(page, '#export-format', 'html');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
  const path = info.outputPath('production.html');
  await (await pending).saveAs(path);
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('.zf-stage')).toContainText('Production check');
  await offline.locator('.zf-stage a[data-board="root.layers.checkout"]').click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await offline.getByRole('button', { name: 'Find in diagram', exact: true }).click();
  await offline.getByRole('searchbox').fill('Production check');
  await offline.getByRole('searchbox').press('Enter');
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await expect(offline.locator('[data-shape-id="Built"]')).toHaveClass(/zf-search-selected/);
  expect(errors).toEqual([]);
});
