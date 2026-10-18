import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

async function board(page: Page, id: string) {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function drill(page: Page, id: string) {
  await page.locator(`.zf-stage a[href="${id}"]`).click();
  await board(page, id);
}

for (const offline of [false, true]) {
  test(`port-free layers infer parent context ${offline ? 'in offline HTML' : 'in the viewer'}`, async ({ page, context }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await board(page, 'root');
    const source = readFileSync('fixtures/lint/nested-navigation.d2', 'utf8');
    await page.locator('#file').setInputFiles({ name: 'nested.d2', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(page.locator('#lint-summary')).toHaveText('1 lint error(s), 0 warning(s)');
    await page.getByRole('button', { name: 'Show diagnostics' }).click();
    await expect(page.locator('.cm-panel-lint')).toContainText('Use link: _');
    await expect(page.locator('.cm-panel-lint')).not.toContainText('boundary-in');
    const repaired = source.replace('Capture: {link: layers.charge}', 'Capture: {link: _}');
    await page.locator('#file').setInputFiles({ name: 'repaired.d2', mimeType: 'text/plain', buffer: Buffer.from(repaired) });
    await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
    await board(page, 'root');
    if (offline) {
      await page.selectOption('#export-format', 'html');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await pending;
      const path = info.outputPath('parent-context.html');
      await download.saveAs(path);
      await context.setOffline(true);
      await page.goto(pathToFileURL(path).href);
    }
    const parentContext = page.getByRole('group', { name: 'Parent connections' });
    await expect(parentContext).toBeHidden();
    for (const [id, expected] of [
      ['root.layers.checkout', 'Checkout · From Browse · To Receipt'],
      ['root.layers.checkout.layers.charge', 'Charge · From Cart · To Confirm'],
      ['root.layers.checkout.layers.charge.layers.capture', 'Capture · From Authorize · To Receipt'],
    ]) {
      await page.locator(`.zf-stage a[href="${id}"]`).click();
      await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
      await expect(parentContext).toHaveText(expected);
    }
    // Resolve context from the document, even without a visited navigation trail.
    if (offline) {
      await page.evaluate(() => history.replaceState(null, ''));
      await page.reload();
    } else {
      // Reloading the app resets an uploaded document; simulate a direct route on load.
      await page.evaluate(() => history.replaceState(null, '', '#/checkout/charge/capture'));
      await page.locator('#file').setInputFiles({ name: 'reopened.d2', mimeType: 'text/plain', buffer: Buffer.from(repaired) });
      await expect(page.locator('#filename')).toHaveText('reopened.d2');
      await board(page, 'root.layers.checkout.layers.charge.layers.capture');
    }
    await expect(parentContext).toHaveText('Capture · From Authorize · To Receipt');
    await page.keyboard.press('Escape');
    await expect(parentContext).toHaveText('Charge · From Cart · To Confirm');
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Root', exact: true }).click();
    await expect(parentContext).toBeHidden();
  });
}

for (const offline of [false, true]) {
  test(`Back links collapse breadcrumb cycles ${offline ? 'in offline HTML' : 'in the viewer'}`, async ({ page, context }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await board(page, 'root');
    if (offline) {
      await page.selectOption('#export-format', 'html');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await pending;
      const path = info.outputPath('breadcrumbs.html');
      await download.saveAs(path);
      await context.setOffline(true);
      await page.goto(pathToFileURL(path).href);
    }
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    async function visit(id: string, names: string[]) {
      await page.locator(`.zf-stage a[href="${id}"]`).click();
      await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
      await expect(crumbs.getByRole('button')).toHaveText(names);
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText(names.at(-1)!);
    }
    await visit('root.layers.checkout', ['Root', 'checkout']);
    for (let i = 0; i < 3; i++) {
      await visit('root.layers.checkout.layers.charge', ['Root', 'checkout', 'charge']);
      await visit('root.layers.checkout', ['Root', 'checkout']);
    }
    await page.goBack();
    await expect(crumbs.getByRole('button')).toHaveText(['Root', 'checkout', 'charge']);
    await page.goForward();
    await expect(crumbs.getByRole('button')).toHaveText(['Root', 'checkout']);

    // Older history entries may already contain repeated cycles.
    await page.evaluate(() => history.replaceState({ zoomflowTrail: [
      'root', 'root.layers.checkout', 'root.layers.checkout.layers.charge',
      'root.layers.checkout', 'root.layers.checkout.layers.charge', 'root.layers.checkout',
    ] }, ''));
    await page.reload();
    await expect(crumbs.getByRole('button')).toHaveText(['Root', 'checkout']);
    expect(await page.evaluate(() => history.state.zoomflowTrail)).toEqual(['root', 'root.layers.checkout']);
    await visit('root', ['Root']);
  });
}

test('collapses sibling-board cycles while preserving browser history', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles('fixtures/cycle.d2');
  await expect(page.locator('#filename')).toHaveText('cycle.d2');
  const crumbs = page.getByRole('navigation').getByRole('button');
  await drill(page, 'root.layers.A');
  await drill(page, 'root.layers.B');
  await expect(crumbs).toHaveText(['Root', 'A', 'B']);
  await drill(page, 'root.layers.A');
  await expect(crumbs).toHaveText(['Root', 'A']);
  await page.goBack();
  await board(page, 'root.layers.B');
  await expect(crumbs).toHaveText(['Root', 'A', 'B']);
  await page.goForward();
  await board(page, 'root.layers.A');
  await expect(crumbs).toHaveText(['Root', 'A']);
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await expect(crumbs).toHaveText(['Root']);
});

test('missing board link has a dashed outline and names its target in the viewer and offline HTML', async ({ page, context }, info) => {
  await page.goto('/');
  await board(page, 'root');
  await page.locator('#file').setInputFiles('fixtures/missing-links.d2');
  await expect(page.locator('#filename')).toHaveText('missing-links.d2');
  await board(page, 'root');

  async function missing(target: string, current: string) {
    const link = page.locator(`.zf-stage a[href="${target}"]`);
    await expect(link).toHaveAttribute('data-missing', '');
    await expect(link).toHaveCSS('outline-style', 'dashed');
    await expect(link).toHaveCSS('outline-width', '2px');
    await link.click();
    await expect(page.locator('.zf-message')).toBeVisible();
    await expect(page.locator('.zf-message')).toHaveText(`Missing board: ${target}`);
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', current);
    await expect(link).toHaveCSS('outline-style', 'dashed');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.zf-message')).toHaveText(`Missing board: ${target}`);
  }
  async function checkLinks() {
    await missing('root.layers.missing', 'root');
    await page.locator('.zf-stage a[href="root.layers.child"]').click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.child');
    await missing('root.layers.child.layers.absent', 'root.layers.child');
    await page.locator('.zf-stage a[href="root"]').click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  }
  await checkLinks();
  await board(page, 'root');
  await page.selectOption('#export-format', 'html');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending;
  const path = info.outputPath('missing-links.html');
  await download.saveAs(path);

  // A successful edit must clear stale missing-link annotations and restore navigation.
  await page.locator('#file').setInputFiles({ name: 'repaired.d2', mimeType: 'text/plain',
    buffer: Buffer.from('shop.📦: {link: layers.missing}\nlayers.missing: {Found}') });
  await expect(page.locator('#filename')).toHaveText('repaired.d2');
  await board(page, 'root');
  await expect(page.locator('.zf-stage [data-missing]')).toHaveCount(0);
  await drill(page, 'root.layers.missing');

  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  await checkLinks();
});

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
