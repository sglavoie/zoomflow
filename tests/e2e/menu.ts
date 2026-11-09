import { expect, type Page } from '@playwright/test';
import { openView } from './helpers';

export async function openDownloads(page: Page) {
  // aria-expanded is the menu's own state; then wait for the content rather than sampling it once.
  const toggle = page.locator('#header-more-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.locator('#header-more-content')).toBeVisible();
}

export async function selectMenuOption(page: Page, selector: string, value: string) {
  if (selector === '#theme') {
    await page.locator(`#theme button[value="${value}"]`).click();
    return;
  }
  const view = selector === '#layout';
  if (view) await openView(page); else await openDownloads(page);
  if (selector === '#export-format') await page.locator(`${selector} input[value="${value}"]`).check();
  else await page.selectOption(selector, value);
  if (view) await page.locator('#workspace-view > summary').click();
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
