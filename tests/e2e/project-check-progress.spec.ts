import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openFolder, previewReady, withEditorView } from './helpers';
import { devURL } from './servers';

test.use({ baseURL: devURL });
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/src/compiler.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const compile = d2.compile.bind(d2);
      window.projectCheckProbe = { inputs: [], completed: [], hold: false, fail: false, unlocated: false };
      d2.compile = async (input, options) => {
        const probe = window.projectCheckProbe;
        probe.inputs.push(input.inputPath);
        if (input.inputPath === 'health.d2' && probe.hold) {
          probe.hold = false;
          await new Promise(resolve => { probe.release = resolve; });
        }
        if (input.inputPath === 'health.d2' && probe.fail) {
          probe.fail = false;
          throw new Error('D2 instance has been disposed');
        }
        if (input.inputPath === 'health.d2' && probe.unlocated) {
          probe.unlocated = false;
          throw new Error('Layout could not finish');
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
  await page.evaluate(() => { const probe = (window as any).projectCheckProbe; probe.inputs = []; probe.completed = []; });
});

test('cancellation stops queued work and late publication, then checks all files again', async ({ page }) => {
  await page.evaluate(() => { (window as any).projectCheckProbe.hold = true; });
  await page.getByRole('button', { name: 'Check project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Check project', exact: true });
  await expect(dialog).toContainText('Checking 1 of 5 files: health.d2…');
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectCheckProbe.release)).toBe('function');
  await dialog.getByRole('button', { name: 'Cancel check' }).click();
  await expect(dialog).toContainText('Check cancelled after 1 of 5 files. Results are incomplete.');
  await expect(dialog.getByRole('button', { name: 'Check again' })).toBeFocused();
  await page.evaluate(() => (window as any).projectCheckProbe.release());
  await expect.poll(() => page.evaluate(() => (window as any).projectCheckProbe.completed)).toEqual(['broken/links.d2', 'health.d2']);
  expect(await page.evaluate(() => (window as any).projectCheckProbe.inputs)).toEqual(['broken/links.d2', 'health.d2']);
  await expect(dialog).toContainText('Check cancelled after 1 of 5 files.');
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog).toContainText('Checked 5 files.');
  await expect(dialog.getByRole('button', { name: 'Check again' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).projectCheckProbe.inputs.length)).toBe(7);
});

test('closing abandons queued work, and editing during a check discards stale results', async ({ page }) => {
  await page.evaluate(() => { (window as any).projectCheckProbe.hold = true; });
  const trigger = page.getByRole('button', { name: 'Check project', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Check project', exact: true });
  await expect(dialog).toContainText('Checking 1 of 5 files: health.d2…');
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectCheckProbe.release)).toBe('function');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.evaluate(() => (window as any).projectCheckProbe.release());
  await expect.poll(() => page.evaluate(() => (window as any).projectCheckProbe.completed.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).projectCheckProbe.inputs.length)).toBe(2);
  await page.evaluate(() => { const probe = (window as any).projectCheckProbe; probe.hold = true; probe.release = undefined; });
  await trigger.click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).projectCheckProbe.release)).toBe('function');
  await withEditorView(page, view => view.dispatch({ changes: { from: view.state.doc.length, insert: '\nnew: New unsaved source' } }));
  await expect(dialog).toContainText('Sources or check options changed.');
  await page.evaluate(() => (window as any).projectCheckProbe.release());
  await expect(dialog.getByRole('list')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog).toContainText('Checked 5 files.');
});

test('engine interruptions offer retry without diagnosing a file, and unlocated errors can open their file', async ({ page }) => {
  await page.evaluate(() => { (window as any).projectCheckProbe.fail = true; });
  await page.getByRole('button', { name: 'Check project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Check project', exact: true });
  await expect(dialog).toContainText('Check stopped because the diagram engine was unavailable.');
  await expect(dialog.getByRole('list', { name: 'Issues in health.d2' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).projectCheckProbe.unlocated = true; });
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog).toContainText('Checked 5 files.');
  const issue = dialog.getByRole('list', { name: 'Issues in health.d2' }).getByRole('button');
  await expect(issue).toContainText('Layout could not finish');
  await expect(issue).toContainText('Open file · Source location unavailable');
  await issue.click();
  await expect(page.locator('#filename')).toHaveAttribute('title', 'atlas/health.d2');
  await expect(page.locator('#editor .cm-content')).toBeFocused();
});
