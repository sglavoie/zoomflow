import { expect, test } from '@playwright/test';

// Keep visual coverage small and intentional. Behavioral tests still run in all browsers.
test.use({ reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
for (const mobile of [false, true]) for (const theme of ['light', 'dark'] as const) {
  test(`${mobile ? 'phone' : 'desktop'} ${theme} workspace`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The visual baseline uses pinned Chromium; other engines have behavioral coverage.');
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    // Availability depends on local CLIs, so keep that external response deterministic.
    await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
    const screenshot = (name: string) => expect(page).toHaveScreenshot(`${mobile ? 'phone' : 'desktop'}-${theme}-${name}.png`, { maxDiffPixelRatio: 0.005 });
    await page.goto('/');
    await expect(page.locator('#preview-status')).toHaveText('Preview ready');
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => document.fonts.ready);
    await screenshot('healthy');
    if (mobile) await page.locator('#mobile-source').click();
    const source = page.getByRole('textbox', { name: 'D2 source', exact: true });
    await source.fill('a: Good\nbroken: {');
    await expect(page.locator('#compile-error')).toBeVisible();
    await expect(page.locator('#draft-status')).toContainText('Browser draft saved');
    await source.blur();
    await screenshot('error-source');
    if (mobile) {
      await page.locator('#mobile-preview').click();
      await expect(page.locator('#mobile-error')).toBeVisible();
      await screenshot('error-preview');
      await page.locator('#mobile-source').click();
    }
    await source.fill('a: Good');
    await expect(page.locator('#preview-status')).toHaveText('Preview ready');
    await expect(page.locator('#draft-status')).toContainText('Browser draft saved');
    await page.locator('#ai-assistant summary').first().click();
    await page.locator('#lint-details summary').click();
    await expect(page.locator('#ai-availability')).toContainText('ready on this computer');
    await screenshot('expanded-tools');
    await page.locator('#ai-assistant summary').first().click();
    await page.locator('#lint-details summary').click();
    await page.locator('#toggle-reference').click();
    await expect(page.locator('#d2-reference')).toBeVisible();
    await screenshot('reference');
  });
}
