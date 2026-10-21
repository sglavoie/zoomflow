import { expect, test } from '@playwright/test';
import { comparesVisuals, source, visualSkipReason } from './helpers';

// Keep visual coverage small and intentional. Behavioral tests still run in all browsers.
test.use({ reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
for (const mobile of [false, true]) for (const theme of ['light', 'dark'] as const) {
  test(`${mobile ? 'phone' : 'desktop'} ${theme} workspace`, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    // Availability depends on local CLIs, so keep that external response deterministic.
    await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
    const screenshot = (name: string) => expect(page).toHaveScreenshot(`${mobile ? 'phone' : 'desktop'}-${theme}-${name}.png`);
    await page.goto('/');
    await expect(page.locator('#preview-status')).toHaveText('Preview ready');
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => document.fonts.ready);
    await screenshot('healthy');
    if (mobile) await page.locator('#mobile-source').click();
    await source(page).fill('a: Good\nbroken: {');
    await expect(page.locator('#compile-error')).toBeVisible();
    await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
    await source(page).blur();
    await screenshot('error-source');
    if (mobile) {
      await page.locator('#mobile-preview').click();
      await expect(page.locator('#mobile-error')).toBeVisible();
      await screenshot('error-preview');
      await page.locator('#mobile-source').click();
    }
    await source(page).fill('a: Good');
    await expect(page.locator('#preview-status')).toHaveText('Preview ready');
    await expect(page.locator('#draft-status')).toHaveAttribute('data-recovery', 'saved');
    await page.locator('#ai-assistant summary').first().click();
    await page.locator('#lint-details summary').click();
    await expect(page.locator('#ai-availability')).toContainText('ready on this computer');
    await screenshot('expanded-tools');
    if (mobile) {
      await page.locator('.ai-settings > summary').click();
      await page.setViewportSize({ width: 390, height: 450 });
      await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(450);
      await screenshot('short-tools');
      await page.setViewportSize({ width: 844, height: 390 });
      await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(390);
      await screenshot('landscape-tools');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(844);
      const enlarged = await page.addStyleTag({ content: 'button, summary, select, .pane-title, .status-copy, #draft-status, #ai-form input, #ai-form textarea { font-size: 18px !important; }' });
      await screenshot('large-text-tools');
      await enlarged.evaluate((element) => element.parentNode?.removeChild(element));
      await page.locator('.ai-settings > summary').click();
    }
    await page.locator('#ai-assistant summary').first().click();
    await page.locator('#lint-details summary').click();
    await page.locator('#toggle-reference').click();
    await expect(page.locator('#d2-reference')).toBeVisible();
    await screenshot('reference');
    await page.locator('#close-reference').click();
    if (mobile) await page.locator('#mobile-source').click();
    await page.route('**/api/ai', route => route.fulfill({ json: { source: 'a: Updated\nb: Added', reply: 'Updated the diagram.' } }));
    await page.locator('#ai-assistant > summary').click();
    await page.locator('#ai-prompt').fill('Add another step');
    await page.locator('#ai-send').click();
    await expect(page.locator('.zf-ai-changed')).toHaveCount(2);
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    await screenshot('ai-changes');
  });
}
