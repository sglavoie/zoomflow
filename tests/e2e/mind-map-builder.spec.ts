import { expect, test, type Page } from '@playwright/test';
import { board, source } from './helpers';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');
// The header offers New mind map from 1350px; narrower screens use the filename menu.
test.use({ viewport: { width: 1440, height: 900 } });

test('creates a mind map from an outline, drills into a detail board and edits it again', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New mind map', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a mind map' });
  await expect(dialog.getByRole('status')).toHaveText('13 topics · 1 detail board');
  await dialog.getByLabel('Mind map name').fill('Trip');
  await dialog.getByRole('textbox', { name: 'Topics' }).fill('Trip\n- Places\n  - Lisbon\n    - Alfama\n  - Porto\n- Budget "max" $2k');
  await expect(dialog.getByRole('status')).toHaveText('6 topics · 1 detail board');
  await dialog.getByRole('button', { name: 'Create mind map', exact: true }).click();
  await ready(page);
  await expect(page.locator('#filename')).toHaveText('Trip.d2');
  await expect(page.locator('.zf-stage')).toContainText('Budget "max" $2k');
  await page.getByRole('link', { name: 'Open Lisbon board', exact: true }).click();
  await board(page, 'root.layers.Lisbon');
  await expect(page.locator('.zf-stage')).toContainText('Alfama');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button')).toHaveText(['Root', 'Lisbon']);
  await page.keyboard.press('Escape');
  await board(page, 'root');

  await page.getByRole('button', { name: 'Edit mind map', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit mind map' });
  const outline = edit.getByRole('textbox', { name: 'Topics' });
  await expect(outline).toHaveValue('Trip\n  Places\n    Lisbon\n      Alfama\n    Porto\n  Budget "max" $2k');
  await expect(outline).toBeFocused();
  await edit.getByLabel('Detail boards').selectOption('0');
  await edit.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Alfama');
  await source(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await ready(page);
  await expect(page.getByRole('link', { name: 'Open Lisbon board', exact: true })).toBeVisible();
  await source(page).fill(`${await source(page).innerText()}\nn.style.fill: red`);
  await expect(page.getByRole('button', { name: 'Edit mind map', exact: true })).toBeHidden();
});

test('indents and outdents outline lines from the keyboard and buttons', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New mind map', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a mind map' });
  const outline = dialog.getByRole('textbox', { name: 'Topics' });
  await outline.fill('Centre\nA\nB');
  await expect(dialog.getByRole('status')).toHaveText('3 topics · one board');
  await outline.press('ControlOrMeta+]');
  await expect(outline).toHaveValue('Centre\nA\n  B');
  await outline.pressSequentially('2');
  await expect(outline).toHaveValue('Centre\nA\n  B2');
  await outline.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(7, area.value.length));
  await dialog.getByRole('button', { name: 'Indent', exact: true }).click();
  await expect(outline).toHaveValue('Centre\n  A\n    B2');
  await outline.press('ControlOrMeta+[');
  await expect(outline).toHaveValue('Centre\nA\n  B2');
  // Backspace keeps editing the outline rather than navigating the workspace.
  await outline.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(area.value.length, area.value.length));
  await outline.press('Backspace');
  await expect(outline).toHaveValue('Centre\nA\n  B');
  await outline.fill('');
  await expect(dialog.getByRole('status')).toHaveText('Write a central topic to begin.');
  await dialog.getByRole('button', { name: 'Create mind map', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Discard this mind map?' });
  await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await expect(page.getByRole('button', { name: 'New mind map', exact: true })).toBeFocused();
});

test('works on a phone and keeps the builder inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await ready(page);
  // The header has no room for it on phones; the filename menu offers it instead.
  await expect(page.getByRole('button', { name: 'New mind map', exact: true })).toBeHidden();
  await page.locator('#example-picker summary').click();
  await page.getByRole('button', { name: 'New mind map from an outline', exact: true }).click();
  await expect(page.locator('#example-picker')).not.toHaveAttribute('open');
  expect(await page.locator('#mind-map-builder').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create mind map', exact: true }).click();
  await expect(page.locator('#example-picker summary')).toBeFocused();
  await expect(page.locator('#mobile-preview')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.zf-stage')).toContainText('Product launch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
