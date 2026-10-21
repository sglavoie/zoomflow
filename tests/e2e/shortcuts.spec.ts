import { expect, test } from '@playwright/test';
import { source } from './helpers';

test('shortcuts dialog contains keyboard focus and leaves the current board unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  const source = await page.locator('.cm-content').innerText();
  const button = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  const close = page.getByRole('button', { name: 'Close keyboard shortcuts' });

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog).toContainText('Format D2 source');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Backspace');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.keyboard.press('Control+Shift+/');
  await expect(page.locator('#d2-reference')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  expect(await page.locator('.cm-content').innerText()).toBe(source);

  await button.click();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test('shortcuts stay within a narrow viewport in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByText('Smallest / largest diagram share').scrollIntoViewIfNeeded();
  await expect(dialog.getByText('Smallest / largest diagram share')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('comment shortcut toggles D2 comments and remains undoable', async ({ page }) => {
  await page.goto('/');
  await source(page).fill('a -> b\nb -> c');
  await source(page).press('ControlOrMeta+a');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('# a -> b# b -> c');
  await expect(page.locator('#d2-reference')).toBeHidden();
  await source(page).press('ControlOrMeta+z');
  await expect(source(page)).toHaveText('a -> bb -> c');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('# a -> b# b -> c');
  await source(page).press('ControlOrMeta+/');
  await expect(source(page)).toHaveText('a -> bb -> c');
});
