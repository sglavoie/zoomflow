import { expect, test, type Page } from '@playwright/test';
import { source } from './helpers';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');

test('creates, revisits, edits and recovers a flow without typing diagram syntax', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await source(page).fill('original: Keep my work');
  await ready(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a flow' });
  await dialog.getByLabel('Flow name').fill('Holiday request');
  await dialog.getByRole('button', { name: 'Approval with Yes / No' }).click();
  await dialog.getByLabel('Step 1 name').fill('Submit holiday request');
  await dialog.getByLabel('Layout').selectOption('right');
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click();
  await ready(page);
  await expect(page.locator('#filename')).toHaveText('Holiday request.d2');
  await expect(page.locator('#document-unsaved')).toBeVisible();
  await expect(page.locator('.zf-stage')).toContainText('Submit holiday request');
  await expect(page.locator('.zf-stage')).toContainText('Yes');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await page.getByLabel('Step 1 name').fill('Request time off');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Request time off');
  await source(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Submit holiday request');
  await page.locator('#example-picker summary').click();
  await page.locator('#example-options .example-option').first().click();
  await ready(page);
  await expect(source(page)).toContainText('original: Keep my work');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeHidden();
});

test('adds steps and branches, validates names, removes dangling connections and cancels safely', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.getByRole('button', { name: 'Create flow', exact: true }).click();
  await expect(page.getByLabel('Step 4 name')).toBeFocused();
  await page.getByLabel('Step 4 name').fill('Notify the team');
  await page.getByLabel('Step 2 name').fill('Ready to publish?');
  await page.getByLabel('Step 2 type').selectOption('diamond');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('Connection 4 from', { exact: true }).selectOption('step_2');
  await page.getByLabel('Connection 4 to', { exact: true }).selectOption('step_1');
  await page.getByLabel('Connection 4 label').fill('No');
  await page.getByRole('button', { name: 'Remove step 3', exact: true }).click();
  await expect(page.locator('#flow-connections .flow-connection')).toHaveCount(2);
  await expect(page.getByLabel('Connection 2 from', { exact: true })).toHaveValue('step_2');
  await page.getByRole('button', { name: 'Create flow', exact: true }).click();
  await ready(page);
  await expect(page.locator('.zf-stage')).toContainText('Notify the team');
  await expect(page.locator('.zf-stage')).toContainText('No');
  const before = await page.locator('.cm-content').innerText();
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await page.getByLabel('Step 1 name').fill('Not applied');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Discard flow changes?' }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeFocused();
  await expect(page.locator('.cm-content')).toHaveText(before, { useInnerText: true });
  await source(page).fill(before + '\nstep_1.style.fill: red');
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeHidden();
});

test('works on a phone and keeps modal controls inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  await page.getByLabel('Flow name').fill('Mobile flow');
  await page.getByLabel('Step 2 name').fill('A name with "quotes": and -> arrows');
  expect(await page.locator('#flow-builder').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create flow', exact: true }).click();
  await expect(page.locator('#mobile-preview')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.zf-stage')).toContainText('A name with "quotes": and -> arrows');
  await page.getByRole('button', { name: 'Edit flow', exact: true }).click();
  await expect(page.getByLabel('Step 2 name')).toHaveValue('A name with "quotes": and -> arrows');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('removing a connection keeps focus on the neighbouring connection', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a flow' });
  await dialog.getByRole('button', { name: 'Approval with Yes / No' }).click();
  const remove = dialog.getByRole('button', { name: /^Remove connection/ });
  const count = await remove.count();
  expect(count).toBeGreaterThan(2);
  await dialog.getByRole('button', { name: 'Remove connection 2', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove connection 2', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: `Remove connection ${count - 1}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: `Remove connection ${count - 2}`, exact: true })).toBeFocused();
  while (await remove.count()) await remove.first().click();
  await expect(dialog.getByRole('button', { name: 'Add connection', exact: true })).toBeFocused();
});

test('closing the builder confirms before discarding changes, and closes at once without them', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const builder = page.getByRole('dialog', { name: 'Create a flow' });
  const confirm = page.getByRole('dialog', { name: 'Discard this flow?' });
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  await builder.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(builder).toBeHidden();
  await expect(confirm).toBeHidden();
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  await builder.getByLabel('Step 2 name').fill('Keep me');
  await builder.getByRole('button', { name: 'Close flow builder' }).click();
  await expect(confirm).toContainText('No draft is created.');
  // Escape answers the confirmation, not the builder beneath it.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel('Step 2 name')).toHaveValue('Keep me');
  // The builder accepts Escape again once the confirmation has returned focus to it.
  await expect.poll(() => builder.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(builder.getByLabel('Step 2 name')).toHaveValue('Keep me');
  await builder.getByRole('button', { name: 'Cancel', exact: true }).click();
  await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(builder).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await expect(page.getByRole('button', { name: 'New flow', exact: true })).toBeFocused();
});
