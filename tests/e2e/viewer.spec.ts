import { expect, test, type Page } from '@playwright/test';

async function board(page: Page, id: string) {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function drill(page: Page, id: string) {
  await page.locator(`.zf-stage a[href="${id}"]`).click();
  await board(page, id);
}

test('opens order.d2, drills three levels and returns by breadcrumb, Esc and browser history', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles('fixtures/order.d2');
  await expect(page.locator('#filename')).toHaveText('order.d2');
  await board(page, 'root');
  await drill(page, 'root.layers.checkout');
  await drill(page, 'root.layers.checkout.layers.charge');
  await expect(page).toHaveURL(/#\/checkout\/charge$/);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'checkout', exact: true }).click();
  await board(page, 'root.layers.checkout');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await drill(page, 'root.layers.checkout');
  await drill(page, 'root.layers.checkout.layers.charge');
  await page.goBack();
  await board(page, 'root.layers.checkout');
  await page.goForward();
  await board(page, 'root.layers.checkout.layers.charge');
  await page.keyboard.press('Backspace');
  await board(page, 'root.layers.checkout');
  await drill(page, 'root'); // The D2 `_` backlink.
});

test('opens a deep link directly and restores it on reload', async ({ page }) => {
  await page.goto('/#/checkout/charge');
  await board(page, 'root.layers.checkout.layers.charge');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Root', 'checkout', 'charge']);
  await expect(page.locator('.zf-stage')).toContainText('Capture');
  await page.reload();
  await board(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('button', { name: 'Root', exact: true }).click();
  await board(page, 'root');
});

test('handles external links, theme changes, invalid files and missing deep links', async ({ page }) => {
  await page.goto('/#/checkout/missing');
  await board(page, 'root.layers.checkout');
  await expect(page).toHaveURL(/#\/checkout$/);
  await page.keyboard.press('Escape');
  await board(page, 'root');
  const external = page.locator('.zf-stage a[href="https://example.com/docs"]');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  const background = () => page.locator('.zf-stage svg').first().evaluate((svg) => {
    const rect = svg.querySelector('rect');
    return rect ? getComputedStyle(rect).fill : '';
  });
  await page.selectOption('#theme', 'light');
  const light = await background();
  await page.selectOption('#theme', 'dark');
  await expect.poll(background).not.toBe(light);
  await page.selectOption('#theme', 'light');
  await expect.poll(background).toBe(light);
  await page.locator('#file').setInputFiles({ name: 'bad.d2', mimeType: 'text/plain', buffer: Buffer.from('broken: {') });
  await expect(page.getByRole('alert')).toContainText('Error');
  await board(page, 'root');
  await drill(page, 'root.layers.checkout');
});

test('follows scenario and step links and displays empty layers', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles({ name: 'boards.d2', mimeType: 'text/plain', buffer: Buffer.from(`Scenario: {link: scenarios.alternate}
Step: {link: steps.first}
Empty: {link: layers.empty}
scenarios: {alternate: {Alternative}}
steps: {first: {Started}}
layers: {empty: {}}`) });
  await expect(page.locator('#filename')).toHaveText('boards.d2');
  await drill(page, 'root.scenarios.alternate');
  await expect(page.locator('.zf-stage')).toContainText('Alternative');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await drill(page, 'root.steps.first');
  await expect(page.locator('.zf-stage')).toContainText('Started');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await drill(page, 'root.layers.empty');
  await expect(page.locator('.zf-stage')).toHaveText('This board is empty.');
});
