import { expect, test } from '@playwright/test';

test('a busy compiler skips superseded previews and compiles the latest edit next', async ({ page }) => {
  // Hold a real compilation at its boundary, without relying on machine speed.
  await page.route((url) => url.pathname === '/src/compiler.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const d2 = new D2();');
    await route.fulfill({ response, body: body.replace('const d2 = new D2();', `
      const d2 = new D2();
      const compile = d2.compile.bind(d2);
      window.previewProbe = { inputs: [], hold: false };
      d2.compile = async (input, options) => {
        window.previewProbe.inputs.push(input.fs[input.inputPath]);
        if (window.previewProbe.hold) {
          window.previewProbe.hold = false;
          await new Promise(resolve => { window.previewProbe.release = resolve; });
        }
        return compile(input, options);
      };
    `) });
  });
  await page.goto('/');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await page.evaluate(() => {
    const probe = (window as any).previewProbe;
    probe.inputs = []; probe.hold = true;
  });
  const source = page.getByRole('textbox', { name: 'D2 source', exact: true });
  await source.fill('first: Running');
  await expect.poll(() => page.evaluate(() => typeof (window as any).previewProbe.release)).toBe('function');
  await source.fill('second: Superseded');
  await page.waitForTimeout(450); // Pass the production 350 ms debounce while first is held.
  await source.fill('latest: Keep this');
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => (window as any).previewProbe.inputs)).toEqual(['first: Running']);
  await page.evaluate(() => (window as any).previewProbe.release());
  await expect(page.locator('.zf-stage')).toContainText('Keep this');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => (window as any).previewProbe.inputs)).toEqual(['first: Running', 'latest: Keep this']);
  await expect(page.locator('#compile-error')).toBeHidden();
});
