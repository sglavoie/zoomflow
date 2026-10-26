import { expect, test } from '@playwright/test';
import { previewReady } from './helpers';

test('diagram and D2 source divider drags, uses the keyboard, and remembers its width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  const divider = page.getByRole('separator', { name: 'Resize diagram and D2 source' });
  const preview = page.locator('#preview-pane');
  const source = page.locator('#source-pane');
  const initialPreview = (await preview.boundingBox())!;
  const initialSource = (await source.boundingBox())!;
  expect(initialPreview.x + initialPreview.width).toBeLessThan(initialSource.x);

  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 90, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await preview.boundingBox())!.width).toBeLessThan(initialPreview.width - 70);
  expect((await source.boundingBox())!.width).toBeGreaterThan(initialSource.width + 70);

  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '75');
  await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '75');
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await page.getByRole('button', { name: 'D2 reference', exact: true }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  expect((await preview.boundingBox())!.width).toBeGreaterThan(initialPreview.width);
});

test('source split respects pane minimum widths and restores the chosen share after a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const divider = page.locator('#source-divider');
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '75');
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(66);
  expect((await page.locator('#preview-pane').boundingBox())!.width).toBeGreaterThanOrEqual(360);
  expect((await page.locator('#source-pane').boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(divider).toBeHidden();
  await expect(page.locator('#mobile-view-switch')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '75');
});

test('double-clicking the source divider resets and saves its default size', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Resize diagram and D2 source' });
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '75');
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
});

test('adaptive split gives the editor room and preserves a deliberate resize until reset', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/'); await previewReady(page);
  const divider = page.locator('#source-divider');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect((await page.locator('#source-pane').boundingBox())!.width).toBeGreaterThan(500);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
});

test('a click on the source divider without dragging keeps the split adaptive', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/'); await previewReady(page);
  const divider = page.locator('#source-divider');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
});
