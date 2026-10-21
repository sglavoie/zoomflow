import { selectMenuOption, downloadExport } from './menu';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { board, drill } from './helpers';

for (const offline of [false, true]) {
  test(`port-free layers infer parent context ${offline ? 'in offline HTML' : 'in the viewer'}`, async ({ page, context }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await board(page, 'root');
    const source = readFileSync('fixtures/lint/nested-navigation.d2', 'utf8');
    await page.locator('#file').setInputFiles({ name: 'nested.d2', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(page.locator('#lint-summary')).toHaveText('1 lint error, 0 warnings');
    await page.locator('#show-diagnostics').click();
    await expect(page.locator('.cm-panel-lint')).toContainText('Use link: _');
    await expect(page.locator('.cm-panel-lint')).not.toContainText('boundary-in');
    const repaired = source.replace('Capture: {link: layers.charge}', 'Capture: {link: _}');
    await page.locator('#file').setInputFiles({ name: 'repaired.d2', mimeType: 'text/plain', buffer: Buffer.from(repaired) });
    await expect(page.locator('#lint-summary')).toHaveText('No lint issues');
    await board(page, 'root');
    if (offline) {
      await selectMenuOption(page, '#export-format', 'html');
      const pending = page.waitForEvent('download');
      await downloadExport(page);
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
      // Reload the saved document without a navigation trail to exercise a true deep link.
      await page.evaluate(() => history.replaceState(null, '', '#/checkout/charge/capture'));
      await page.reload();
      await expect(page.locator('#filename')).toHaveText('repaired.d2');
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
      await selectMenuOption(page, '#export-format', 'html');
      const pending = page.waitForEvent('download');
      await downloadExport(page);
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

  async function missing(target: string, current: string, label: string) {
    const link = page.locator(`.zf-stage a[href="${target}"]`);
    await expect(link).toHaveAttribute('data-missing', '');
    await expect(link).toHaveCSS('outline-style', 'dashed');
    await expect(link).toHaveCSS('outline-width', '2px');
    await link.click();
    await expect(page.locator('.zf-message')).toBeVisible();
    await expect(page.locator('.zf-message')).toHaveText(`Missing board: ${label}`);
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', current);
    await expect(link).toHaveCSS('outline-style', 'dashed');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.zf-message')).toHaveText(`Missing board: ${label}`);
  }
  async function checkLinks() {
    await missing('root.layers.missing', 'root', 'Root > missing');
    await page.locator('.zf-stage a[href="root.layers.child"]').click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.child');
    await missing('root.layers.child.layers.absent', 'root.layers.child', 'Root > child > absent');
    await page.locator('.zf-stage a[href="root"]').click();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
  }
  await checkLinks();
  await board(page, 'root');
  await selectMenuOption(page, '#export-format', 'html');
  const pending = page.waitForEvent('download');
  await downloadExport(page);
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
  await expect(page.locator('.zf-message')).toHaveText('Board "checkout/missing" not found; showing checkout');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await expect(page.locator('.zf-message')).toBeEmpty();
  const external = page.locator('.zf-stage a[href="https://d2lang.com/tour/intro/"]');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  const background = () => page.locator('.zf-stage svg').first().evaluate((svg) => {
    const rect = svg.querySelector('rect');
    return rect ? getComputedStyle(rect).fill : '';
  });
  await selectMenuOption(page, '#theme', 'light');
  const light = await background();
  await selectMenuOption(page, '#theme', 'dark');
  await expect.poll(background).not.toBe(light);
  await selectMenuOption(page, '#theme', 'light');
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
  await expect(page.locator('.zf-stage')).toContainText('This board is empty.');
});

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
    await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    const length = await page.evaluate(() => history.length);
    await crumbs.getByRole('button', { name: 'checkout', exact: true }).click();
    await crumbs.getByRole('button', { name: 'checkout', exact: true }).click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    expect(await page.evaluate(() => history.length)).toBe(length);
    await crumbs.getByRole('button', { name: 'Root', exact: true }).click();
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
    await expect(message).toHaveAttribute('role', 'status');
    expect(await page.evaluate(() => location.hash)).toBe('#/');
    await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
    await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
    await expect(message).toBeEmpty();
  });
}

test('destroying a viewer releases its viewport listeners and controls', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  const result = await page.evaluate(async (url) => {
    const { Viewer, setupViewport } = await import(url);
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; inset: 0; width: 400px; height: 300px';
    document.body.append(host);
    const viewer = new Viewer(host, { history: false });
    setupViewport(viewer.stage, host);
    viewer.stage.style.cssText = 'width: 400px; height: 300px';
    viewer.stage.innerHTML = '<svg viewBox="0 0 100 100" width="400" height="300"><rect width="100" height="100"/></svg>';
    viewer.stage.dispatchEvent(new Event('zf-boardchange'));
    host.querySelector<HTMLButtonElement>('.zf-zoom-controls button[aria-label="Zoom in"]')!.click();
    viewer.stage.focus();
    const space = () => {
      const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const before = space();
    viewer.destroy();
    const after = space();
    const controls = host.querySelectorAll('.zf-zoom-controls, .zf-pan-hint').length;
    host.remove();
    return { before, after, controls };
  }, `/@fs${process.cwd()}/packages/viewer/src/index.ts`);
  expect(result).toEqual({ before: true, after: false, controls: 0 });
});

test('going up returns keyboard focus to the link that leads back down', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  const checkout = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await checkout.focus();
  await checkout.press('Enter');
  await board(page, 'root.layers.checkout');
  await expect(page.locator('.zf-stage')).toBeFocused();
  // A held key repeats: only the first press goes up.
  const repeated = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(repeated).toBe(false);
  await board(page, 'root.layers.checkout');
  await page.keyboard.press('Escape');
  await board(page, 'root');
  await expect(checkout).toBeFocused();
  // The D2 `_` backlink goes up too.
  await checkout.press('Enter');
  await board(page, 'root.layers.checkout');
  const back = page.locator('.zf-stage a[href="root"]');
  await back.focus();
  await back.press('Enter');
  await board(page, 'root');
  await expect(checkout).toBeFocused();
  // A breadcrumb to an ancestor does the same, even across two levels.
  await checkout.press('Enter');
  await board(page, 'root.layers.checkout');
  const charge = page.locator('.zf-stage a[href="root.layers.checkout.layers.charge"]');
  await charge.focus();
  await charge.press('Enter');
  await board(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Root', exact: true }).press('Enter');
  await board(page, 'root');
  await expect(checkout).toBeFocused();
});

test('sanitizing removes HTML-namespaced and odd-case executable elements before they run', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  const url = `/@fs${process.cwd()}/packages/viewer/src/sanitize.ts`;
  const mount = (flag: string, sanitize: boolean) => page.evaluate(async ({ url, flag, sanitize }) => {
    const { sanitizeSvg } = await import(url);
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml">' +
      `<h:iframe src="javascript:parent.${flag}=1"/><h:object data="javascript:parent.${flag}=1"/><h:embed src="javascript:parent.${flag}=1"/>` +
      `<h:base href="https://attacker.example/"/><h:script>parent.${flag}=1</h:script><h:img src="data:," onerror="parent.${flag}=1"/>` +
      `<SCRIPT>parent.${flag}=1</SCRIPT><rect width="10" height="10"/></svg>`;
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (sanitize) sanitizeSvg(doc.documentElement);
    const svg = document.importNode(doc.documentElement, true);
    document.body.append(svg);
    return [...svg.querySelectorAll('*')].map((node) => `${node.namespaceURI} ${node.localName}`);
  }, { url, flag, sanitize });
  expect(await mount('sanitized', true)).toEqual(['http://www.w3.org/2000/svg rect']);
  // Control: the same markup unsanitized really executes, so the check below is meaningful.
  await mount('control', false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { control?: number }).control)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { sanitized?: number }).sanitized)).toBeUndefined();
});

test('a trackpad pinch at a zoom limit never zooms the page', async ({ page }) => {
  await page.goto('/');
  await board(page, 'root');
  const prevented = await page.locator('.zf-stage > svg').evaluate((svg) => {
    const wheel = (deltaY: number, ctrlKey: boolean) => {
      const bounds = svg.getBoundingClientRect();
      const event = new WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true,
        clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 });
      svg.dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (let step = 0; step < 40; step++) wheel(240, true);
    const atMinimum = { pinch: wheel(240, true), scroll: wheel(240, false) };
    for (let step = 0; step < 40; step++) wheel(-240, true);
    const atMaximum = { pinch: wheel(-240, true), scroll: wheel(-240, false) };
    return { atMinimum, atMaximum };
  });
  // A plain wheel at a limit scrolls the page as usual; a pinch is always claimed.
  expect(prevented).toEqual({ atMinimum: { pinch: true, scroll: false }, atMaximum: { pinch: true, scroll: false } });
  await expect(page.locator('.zf-zoom-controls span')).toHaveText('800%');
});
