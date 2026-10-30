import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openFolder, previewReady } from './helpers';
import { devURL } from './servers';

// Hold or reject real worker requests at their boundary, independently of machine speed.
test.use({ baseURL: devURL });
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/src/compiler.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const compile = d2.compile.bind(d2);
      window.projectSearchProbe = { inputs: [], completed: [], hold: false, fail: false };
      d2.compile = async (input, options) => {
        const probe = window.projectSearchProbe;
        probe.inputs.push(input.inputPath);
        if (input.inputPath === 'health.d2' && probe.hold) {
          probe.hold = false;
          await new Promise(resolve => { probe.release = resolve; });
        }
        if (input.inputPath === 'health.d2' && probe.fail) {
          probe.fail = false;
          throw new Error('D2 instance has been disposed');
        }
        const result = await compile(input, options);
        probe.completed.push(input.inputPath);
        return result;
      };
    `) });
  });
  await page.goto('/');
  await openFolder(page, fileURLToPath(new URL('../../fixtures/atlas', import.meta.url)));
  await previewReady(page);
  await page.evaluate(() => { const probe = (window as any).projectSearchProbe; probe.inputs = []; probe.completed = []; });
});

test('shows progress, stops queued work on close and preserves result focus as indexing resumes', async ({ page }) => {
  await page.evaluate(() => { (window as any).projectSearchProbe.hold = true; });
  await page.getByRole('button', { name: 'Find in project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Find in project', exact: true });
  await expect(dialog).toContainText('Indexing 1 of 5 files: health.d2…');
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectSearchProbe.release)).toBe('function');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).projectSearchProbe.release());
  await expect.poll(() => page.evaluate(() => (window as any).projectSearchProbe.completed)).toEqual(['broken/links.d2', 'health.d2']);
  expect(await page.evaluate(() => (window as any).projectSearchProbe.inputs)).toEqual(['broken/links.d2', 'health.d2']);

  await page.evaluate(() => { const probe = (window as any).projectSearchProbe; probe.hold = true; probe.release = undefined; });
  await page.getByRole('button', { name: 'Find in project', exact: true }).click();
  await dialog.getByRole('searchbox').fill('Home');
  const match = dialog.getByRole('button', { name: 'Home Shape · broken/links.d2 · Root', exact: true });
  await dialog.getByRole('searchbox').press('ArrowDown');
  await expect(match).toBeFocused();
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectSearchProbe.release)).toBe('function');
  await page.evaluate(() => (window as any).projectSearchProbe.release());
  await expect(dialog).toContainText('Searched 5 files.');
  await expect(match).toBeFocused();
  // The successfully cached first file is not compiled again on reopening.
  expect(await page.evaluate(() => (window as any).projectSearchProbe.inputs.filter((path: string) => path === 'broken/links.d2').length)).toBe(1);
});

test('an engine interruption offers retry without blaming a source file', async ({ page }) => {
  await page.evaluate(() => { (window as any).projectSearchProbe.fail = true; });
  await page.getByRole('button', { name: 'Find in project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Find in project', exact: true });
  await expect(dialog).toContainText('Search stopped because the diagram engine was unavailable.');
  await expect(dialog).not.toContainText('Could not search health.d2');
  await dialog.getByRole('button', { name: 'Retry search' }).click();
  await expect(dialog).toContainText('Searched 5 files.');
  await expect(dialog.getByRole('button', { name: 'Retry search' })).toBeHidden();
  await dialog.getByRole('searchbox').fill('Night');
  await dialog.getByRole('searchbox').press('Enter');
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/health.d2');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.Sleep');
  await expect(page.locator('[data-shape-id="Night"]')).toHaveClass(/zf-source-selected/);
});
