import { selectMenuOption, downloadExport } from './menu';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { board } from './helpers';

async function openViewer(page: Page, context: BrowserContext, info: TestInfo, offline: boolean, hash = '') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await board(page, 'root');
  if (offline) {
    await selectMenuOption(page, '#export-format', 'html');
    const pending = page.waitForEvent('download');
    await downloadExport(page);
    const path = info.outputPath('history.html');
    await (await pending).saveAs(path);
    await context.setOffline(true);
    await page.goto(pathToFileURL(path).href + hash);
  } else if (hash) await page.goto(`/${hash}`);
}

for (const offline of [false, true]) {
  test(`same-board navigation keeps history and each Back renders once ${offline ? 'in offline HTML' : 'in the viewer'}`, async ({ page, context }, info) => {
    await openViewer(page, context, info, offline);
    const stage = page.locator('.zf-stage').first();
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await page.locator('.zf-stage a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    const length = await page.evaluate(() => history.length);
    await crumbs.getByRole('button', { name: 'checkout', exact: true }).click();
    await crumbs.getByRole('button', { name: 'checkout', exact: true }).click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    expect(await page.evaluate(() => history.length)).toBe(length);
    await crumbs.getByRole('button').first().click();
    await expect(stage).toHaveAttribute('data-board', 'root');
    expect(await page.evaluate(() => history.length)).toBe(length + 1);

    await stage.evaluate((element) => {
      (window as unknown as { renders: number }).renders = 0;
      element.addEventListener('zf-boardchange', () => { (window as unknown as { renders: number }).renders++; });
    });
    const renders = () => page.evaluate(() => (window as unknown as { renders: number }).renders);
    // Wait for the expected render, then let a few frames pass to catch a duplicate.
    const rendersOnce = async (count: number) => {
      await expect.poll(renders).toBe(count);
      await page.evaluate(() => new Promise((resolve) => {
        let frames = 3;
        const next = () => (--frames ? requestAnimationFrame(next) : setTimeout(resolve, 50));
        requestAnimationFrame(next);
      }));
      expect(await renders()).toBe(count);
    };
    await page.goBack();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await rendersOnce(1);
    await page.goBack();
    await expect(stage).toHaveAttribute('data-board', 'root');
    await rendersOnce(2);
    await page.goForward();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await rendersOnce(3);
  });

  test(`unknown deep links name the missing board ${offline ? 'in offline HTML' : 'in the viewer'}`, async ({ page, context }, info) => {
    await openViewer(page, context, info, offline, '#/nope/deeper');
    const stage = page.locator('.zf-stage').first();
    const message = page.locator('.zf-message').first();
    await expect(stage).toHaveAttribute('data-board', 'root');
    await expect(message).toHaveText('Board "nope/deeper" not found; showing Root');
    await expect(message.locator('[role="status"]')).toHaveText('Board "nope/deeper" not found; showing Root');
    await expect(message.locator('[role="alert"]')).toBeEmpty();
    expect(await page.evaluate(() => location.hash)).toBe('#/');
    await page.locator('.zf-stage a[data-board="root.layers.checkout"]').locator('.appendix-icon').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await expect(message).toBeEmpty();
  });
}

