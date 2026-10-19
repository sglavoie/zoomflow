import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { downloadExport, selectMenuOption } from './menu';

test.use({ reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
for (const theme of ['light', 'dark'] as const) {
  test(`${theme} offline viewer fits phones, landscape and enlarged text`, async ({ page, context, browserName }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.locator('#preview-status')).toHaveText('Preview ready');
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download'); await downloadExport(page);
    const path = info.outputPath('order.html'); await (await pending).saveAs(path);
    await page.goto('about:blank');
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href);
    await page.getByRole('link', { name: 'Open checkout board', exact: true }).click();
    await page.getByRole('link', { name: 'Open charge board', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    for (const size of [
      { name: 'phone', width: 390, height: 844 },
      { name: 'short', width: 390, height: 450 },
      { name: 'landscape', width: 844, height: 390 },
      { name: 'large-text', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      if (size.name === 'large-text') await page.addStyleTag({ content: 'body, button, .zf-context, .zf-pan-hint, .zf-zoom-controls span { font-size: 20px !important; line-height: 1.4 !important; }' });
      await page.evaluate(() => document.fonts.ready);
      const stage = (await page.locator('.zf-stage').boundingBox())!;
      const controls = (await page.locator('.zf-zoom-controls').boundingBox())!;
      expect(stage.height).toBeGreaterThan(100);
      expect(controls.y).toBeGreaterThanOrEqual(stage.y + stage.height);
      expect(controls.y + controls.height).toBeLessThanOrEqual(size.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
      if (browserName === 'chromium') await expect(page).toHaveScreenshot(`offline-${theme}-${size.name}.png`, { maxDiffPixelRatio: 0.005 });
    }
    await page.getByRole('link', { name: 'Return to checkout', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  });
}
