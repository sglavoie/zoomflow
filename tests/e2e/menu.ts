import type { Page } from '@playwright/test';

export async function openDownloads(page: Page) {
  if (await page.locator('#header-more-content').isHidden()) await page.locator('#header-more-toggle').click();
}

export async function selectMenuOption(page: Page, selector: string, value: string) {
  if (selector !== '#theme') await openDownloads(page);
  if (selector === '#export-format') await page.locator(`${selector} input[value="${value}"]`).check();
  else await page.selectOption(selector, value);
}

export async function downloadExport(page: Page) {
  await openDownloads(page);
  await page.locator('#export').click();
  await page.locator('#header-more-toggle').click();
}

export async function downloadSource(page: Page) {
  await openDownloads(page);
  await page.getByRole('button', { name: 'Download source (.d2)' }).click();
  await page.locator('#header-more-toggle').click();
}
