import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { comparesVisuals, visualSkipReason, openFolder } from './helpers';

test.use({ reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
for (const theme of ['light', 'dark'] as const) test(`polished controls in ${theme}`, { tag: '@visual' }, async ({ page, browserName }) => {
  test.skip(!comparesVisuals(browserName), visualSkipReason);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: theme });
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
  await page.goto('/');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#header-more-content')).toHaveScreenshot(`export-${theme}.png`);
  await page.locator('#header-more-toggle').click();
  await openFolder(page, 'fixtures/browser-project');
  await expect(page.locator('.zf-stage')).toContainText('From a local import');
  await page.locator('#example-picker summary').click();
  await page.locator('#diagram-search').fill('nodes');
  await expect(page.locator('.example-menu')).toHaveScreenshot(`picker-${theme}.png`);
  await page.locator('#diagram-search').fill('');
  await page.getByRole('button', { name: 'Remove browser-project project drafts' }).click();
  await expect(page.locator('#document-action')).toHaveScreenshot(`confirmation-${theme}.png`);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Escape');
  const source = readFileSync('fixtures/lint/nested-navigation.d2', 'utf8').replace('Capture: {link: layers.charge}', 'Capture: {link: _}');
  await page.locator('#file').setInputFiles({ name: 'nested.d2', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  let id = 'root';
  for (const name of ['checkout', 'charge', 'capture']) {
    id += `.layers.${name}`;
    await page.locator(`.zf-stage a[data-board="${id}"]`).click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  }
  await page.getByRole('button', { name: 'Earlier boards', exact: true }).click();
  await expect(page).toHaveScreenshot(`breadcrumbs-${theme}.png`);
});
