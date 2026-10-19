import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixture = (name: string) => readFileSync(`fixtures/lint/${name}.d2`, 'utf8');

test('bundled stdlib and live lint diagnostics recover, with optional backlink warnings', async ({ page }) => {
  await page.goto('/');
  const open = async (source: string) => {
    await page.locator('#file').setInputFiles({ name: 'lint.d2', mimeType: 'text/plain', buffer: Buffer.from(source) });
  };
  await open(fixture('mismatched'));
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  await page.getByLabel('Check boundary ports').check();
  await expect(page.locator('#lint-summary')).toContainText('5 lint error(s)');
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.zf-stage [data-shape-id="checkout"]')).toBeVisible();
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await page.getByRole('button', { name: 'Show diagnostics' }).click();
  await expect(page.locator('.cm-panel-lint')).toContainText('Zero boundary pairs evaluated');
  await expect(page.locator('.cm-panel-lint')).toContainText('boundary-out');
  await page.getByLabel('Check boundary ports').uncheck();
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  await page.getByLabel('Check boundary ports').check();
  await open(readFileSync('fixtures/order.d2', 'utf8'));
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');

  // Exercise the debounce/edit path rather than only file loading.
  const source = page.getByRole('textbox', { name: 'D2 source', exact: true });
  await source.click();
  await source.press('ControlOrMeta+a');
  await page.keyboard.insertText(fixture('labelled'));
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(page.locator('#compile-error')).toBeHidden();

  await open(fixture('labelled').replace('    back.link: _\n', ''));
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  await page.getByLabel('Check parent backlinks').check();
  await expect(page.locator('#lint-summary')).toHaveText('0 lint error(s), 1 warning(s)');
  await expect(page.locator('.cm-panel-lint')).toContainText('missing-backlink');
  await page.getByLabel('Check parent backlinks').uncheck();
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');

  await open(fixture('navigation'));
  await expect(page.locator('#lint-summary')).toHaveText('2 lint error(s), 1 warning(s)');
  await expect(page.locator('.cm-panel-lint')).toContainText('dangling-link');
  await expect(page.locator('.cm-panel-lint')).toContainText('orphan-board');
  await open('broken: {');
  await expect(page.locator('#compile-error')).toBeVisible();
  await expect(page.locator('#lint-summary')).toContainText('Lint unavailable');
  await expect(page.locator('.cm-panel-lint')).not.toContainText('dangling-link');
  await open(fixture('labelled'));
  await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
  await expect(page.locator('#compile-error')).toBeHidden();
});
