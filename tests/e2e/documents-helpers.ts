import type { Page } from '@playwright/test';

export async function draftRows(page: Page, name: string) {
  await page.locator('#example-picker > summary').click();
  const count = await page.locator('#draft-options .example-option').filter({ hasText: name }).count();
  await page.keyboard.press('Escape');
  return count;
}
