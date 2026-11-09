import { expect, test } from '@playwright/test';
import { previewReady } from './helpers';

for (const width of [320, 390, 1280]) test(`theme buttons override the system and remember the selection at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await previewReady(page);
  const theme = page.getByRole('group', { name: 'Theme', exact: true });
  const light = theme.getByRole('button', { name: 'Light', exact: true });
  const dark = theme.getByRole('button', { name: 'Dark', exact: true });
  const system = theme.getByRole('button', { name: 'System', exact: true });
  const root = page.locator('html');
  for (const button of [light, dark, system]) await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');
  const background = () => page.locator('.zf-stage svg rect').first().evaluate(rect => getComputedStyle(rect).fill);
  const lightBackground = await background();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(background).not.toBe(lightBackground);
  await light.focus();
  await page.keyboard.press('Enter');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect.poll(background).toBe(lightBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await previewReady(page);
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');

  await page.emulateMedia({ colorScheme: 'light' });
  await dark.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(theme.locator('[aria-pressed="true"]')).toHaveText('Dark');
  await expect.poll(background).not.toBe(lightBackground);
  await system.focus();
  await page.keyboard.press('Space');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await previewReady(page);
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
});

test('an invalid saved theme falls back to System', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zoomflow.theme', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await previewReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme button[aria-pressed="true"]')).toHaveText('System');
});
