import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseExample, comparesVisuals, visualSkipReason, editorText, previewReady, source } from './helpers';
import { flowSource, flowTemplate, readFlow } from '../../apps/web/src/flow-model';

const shape = (page: import('@playwright/test').Page, id: string) => page.locator(`#viewer [data-shape-id="${id}"]`);
test.use({ viewport: { width: 1440, height: 1000 } });

test('detail sheets reveal depth on hover and carry their accent into the destination breadcrumb', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await expect(page.locator('#document-title')).toHaveText('Order flow');
  await expect(page.locator('#filename')).toHaveText('order.d2');
  const link = page.getByRole('link', { name: 'Open Checkout board', exact: true });
  await expect(link.locator('.zf-depth-sheet')).toHaveCount(2);
  const before = await link.locator('.zf-depth-2').evaluate(node => getComputedStyle(node).transform);
  await link.hover();
  await expect.poll(() => link.locator('.zf-depth-2').evaluate(node => getComputedStyle(node).transform)).not.toBe(before);
  await expect(page.locator('.link-preview')).toBeVisible();
  await link.locator('.appendix-icon').click();
  await expect(page.locator('.zf-breadcrumbs [aria-current]')).toHaveClass(/zf-detail-crumb/);
});

test('adding next continues a labelled path while adding a branch preserves its existing outcome', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const flow = flowTemplate('linear'); flow.connections[0].label = 'Ready';
  await source(page).fill(flowSource(flow)); await previewReady(page);
  await shape(page, 'step_1').click();
  await page.getByRole('button', { name: 'Add next step after Start', exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Rename New step', exact: true });
  await rename.fill('Prepare'); await rename.press('Enter'); await previewReady(page);
  let result = readFlow(await editorText(page))!;
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_4', label: 'Ready' });
  expect(result.connections).toContainEqual({ from: 'step_4', to: 'step_2', label: '' });
  await shape(page, 'step_1').click();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Escape'); await previewReady(page);
  result = readFlow(await editorText(page))!;
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_4', label: 'Ready' });
  expect(result.connections).toContainEqual({ from: 'step_1', to: 'step_5', label: '' });
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(readFlow(await editorText(page))!.steps.map(step => step.label)).toContain('Prepare');
  await expect(shape(page, 'step_5')).toHaveCount(0);
});

test('filled roles distinguish decisions and outcomes in both themes and elevated changes typography', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const flow = flowTemplate('approval'); flow.look.filled = true;
  await source(page).fill(flowSource(flow)); await previewReady(page);
  const fill = (id: string) => shape(page, id).locator('.shape > *').first().evaluate(node => getComputedStyle(node).fill);
  expect(await fill('step_2')).toBe('rgb(255, 243, 219)');
  expect(await fill('step_3')).toBe('rgb(227, 243, 235)');
  await page.locator('#workspace-view > summary').click(); await page.locator('#theme button[value="dark"]').click();
  await expect.poll(() => fill('step_2')).toBe('url("#zf-lit-decision")');
  await expect.poll(() => fill('step_3')).toBe('url("#zf-lit-terminal")');
  const size = await shape(page, 'step_4').locator('text').evaluate(node => getComputedStyle(node).fontSize);
  await page.locator('.board-appearance > details > summary').click();
  await page.locator('.board-appearance').getByRole('button', { name: 'Elevated', exact: true }).click(); await previewReady(page);
  expect(await shape(page, 'step_4').locator('text').evaluate(node => getComputedStyle(node).fontSize)).not.toBe(size);
});

test('presentation isolates the canvas, supports choices and restores controls and focus on Escape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const area = page.locator('.zf-stage-area[data-presentation]');
  await expect(area).toBeVisible();
  expect(await page.locator('header').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await expect(area.locator('.zf-present-title')).toContainText('Order flow');
  await expect(area.locator('.zf-present-title span')).toHaveText('Follow the idea, one step at a time');
  await area.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await area.getByRole('button', { name: 'Explore Checkout', exact: true }).click();
  await expect(shape(page, 'Cart')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(area).toHaveCount(0);
  expect(await page.locator('header').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  expect(await editorText(page)).toBe(original);
  await expect(page.getByRole('button', { name: 'Edit flow', exact: true })).toBeVisible();
});

test('presentation opens details from nodes, badges and the keyboard, preserving back and nested return paths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  const status = guide.getByRole('status');
  // Re-selecting the current ordinary node should not add duplicate steps.
  await shape(page, 'Browse').click();
  await expect(status).toHaveText('Browse');
  for (const activation of ['node', 'badge', 'Enter', ' ']) {
    const link = page.getByRole('link', { name: 'Open Checkout board', exact: true });
    if (activation === 'node') await shape(page, 'Checkout').click();
    else if (activation === 'badge') await link.locator('.appendix-icon').click();
    else { await link.focus(); await link.press(activation); }
    await expect(status).toHaveText('Cart');
    await expect(page.locator('.zf-stage-area[data-presentation]')).toBeVisible();
    await guide.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(status).toHaveText('Browse');
  }
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await shape(page, 'Checkout').click();
  await expect(status).toHaveText('Cart');
  await shape(page, 'Charge').click();
  await expect(status).toContainText('Authorize');
  await guide.getByRole('button', { name: 'Next: Capture', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Receipt', exact: true }).click();
  await guide.getByRole('button', { name: 'Return to Checkout', exact: true }).click();
  await expect(status).toContainText('Charge');
  await guide.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  expect(await editorText(page)).toBe(original);
});

test('offline HTML keeps presentation metadata, opens the chosen board and respects explicit deep links', async ({ page, context }, testInfo) => {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.export-presentation > summary').click();
  const title = 'Order <review> & next steps';
  await page.locator('#export-title').fill(title);
  await page.locator('#export-subtitle').fill('A customer’s journey');
  await page.locator('#export-opening-board').selectOption('root.layers.checkout');
  await page.locator('#export-start-mode').selectOption('presentation');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const path = testInfo.outputPath('presentation.html'); await (await downloaded).saveAs(path);
  await context.setOffline(true);
  const offline = await context.newPage(); await offline.goto(`file://${path}`);
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(offline.locator('.zf-stage-area[data-presentation]')).toBeVisible();
  await expect(offline.locator('.zf-present-title strong')).toHaveText(title);
  await expect(offline.locator('.zf-present-title span')).toHaveText('A customer’s journey');
  await expectCentred(offline, 'Cart', ['Charge']);
  await expect(offline.getByRole('heading', { name: 'Cart', exact: true })).toBeVisible();
  await offline.getByRole('link', { name: 'Open Charge board', exact: true }).locator('.appendix-icon').click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(offline.locator('.zf-walkthrough [role="status"]')).toHaveText('Authorize');
  await expectCentred(offline, 'step_1', ['step_2']);
  await offline.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await offline.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  await offline.goto(`file://${path}#/checkout/charge`);
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
});

test('framed SVG uses the same title, subtitle and geometry as its thumbnail without changing source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  const original = await editorText(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('#export-format input[value="svg"]').check();
  await page.locator('.export-presentation > summary').click();
  await page.locator('#export-frame').check();
  await page.locator('#export-title').fill('Order <flow>');
  await page.locator('#export-subtitle').fill('Ready for the team');
  const thumbnail = page.locator('#export-preview img');
  await expect.poll(() => thumbnail.evaluate(async (node: HTMLImageElement) => node.src ? (await fetch(node.src)).text() : '')).toContain('Ready for the team');
  const preview = await thumbnail.evaluate(async (node: HTMLImageElement) => (await fetch(node.src)).text());
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const svg = await readFile((await (await downloaded).path())!, 'utf8');
  expect(svg).toBe(preview);
  expect(svg).toContain('Order &lt;flow&gt;');
  expect(await editorText(page)).toBe(original);
  await page.reload(); await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.export-presentation > summary').click();
  await expect(page.locator('#export-title')).toHaveValue('Order <flow>');
  await expect(page.locator('#export-frame')).toBeChecked();
});

test('touch coaching uses tap instructions and presentation stays within a narrow screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage(); await page.goto('/'); await previewReady(page);
  await expect(page.locator('.canvas-coach')).toBeHidden();
  await expect(page.locator('.canvas-coach')).toContainText('Tap a step', { timeout: 7000 });
  await expect(page.locator('.canvas-coach')).not.toContainText('Double-click');
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const panel = (await page.locator('.zf-walkthrough').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(320);
  expect(panel.y + panel.height).toBeLessThanOrEqual(640);
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await context.close();
});

test('leaving presentation restores the editor zoom and keeps it when returning from a detail board', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await page.locator('#viewer .zf-zoom-controls span').textContent();
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Explore Checkout', exact: true }).click();
  await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  await page.locator('.zf-breadcrumbs button').first().click();
  await expect(page.locator('#viewer .zf-zoom-controls span')).toHaveText(zoom!);
});

for (const example of ['Order flow', 'Flows & mind maps']) test(`detail pills clear arrowheads in ${example}, live and offline`, async ({ page, context }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  if (example === 'Flows & mind maps') {
    await chooseExample(page, /^Flows & mind maps/); await previewReady(page);
  }
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const file = info.outputPath('badge-clearance.html'); await (await pending).saveAs(file);
  const offline = await context.newPage(); await context.setOffline(true);
  await offline.goto(`file://${file}`);
  for (const target of [page, offline]) {
    await expect(target.locator('.appendix-icon rect').first()).toBeVisible();
    const collisions = await target.locator('.zf-stage').evaluate(stage => {
      const pills = [...stage.querySelectorAll('.appendix-icon rect')].map(node => node.getBoundingClientRect()).filter(box => box.width);
      const arrowheads = [...stage.querySelectorAll<SVGPathElement>('path.connection[marker-end]')].map(path => {
        const matrix = path.getScreenCTM()!;
        const tip = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
        return { x: tip.x, y: tip.y, pad: 10 * Math.abs(matrix.a) };
      });
      return pills.flatMap(box => arrowheads.filter(tip => tip.x + tip.pad > box.left && tip.x - tip.pad < box.right && tip.y + tip.pad > box.top && tip.y - tip.pad < box.bottom));
    });
    expect(collisions).toEqual([]);
    await expect(target.locator('.zf-depth-stack').first().locator('.zf-depth-sheet')).toHaveCount(2);
    const trigger = target.getByRole('button', { name: 'Walkthrough', exact: true });
    await trigger.click(); await target.keyboard.press('Escape');
    await expect(target.getByRole('region', { name: 'Diagram walkthrough' })).toBeHidden();
  }
});

for (const theme of ['light', 'dark'] as const) test(`detail badge clearance appearance in ${theme}`, { tag: '@visual' }, async ({ page, browserName }) => {
  test.skip(!comparesVisuals(browserName), visualSkipReason);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  await page.locator('#toggle-source').click();
  for (const example of ['order', 'flows']) {
    if (example === 'flows') { await chooseExample(page, /^Flows & mind maps/); await previewReady(page); }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.mouse.move(0, 0);
      await expect(page.locator('#viewer .zf-stage')).toHaveScreenshot(`detail-badges-${example}-${theme}-${width}.png`);
    }
  }
});

async function expectCentred(page: import('@playwright/test').Page, id: string, destinations: string[] = []) {
  await expect(page.locator(`.zf-stage [data-shape-id="${id}"]`)).toBeVisible();
  await expect.poll(() => page.locator('.zf-stage').evaluate((stage, id) => {
    const bounds = stage.getBoundingClientRect();
    const target = stage.querySelector(`[data-shape-id="${id}"]`)!.getBoundingClientRect();
    return Math.max(Math.abs((target.x + target.width / 2 - bounds.x) / bounds.width - .5),
      Math.abs((target.y + target.height / 2 - bounds.y) / bounds.height - .5));
  }, id)).toBeLessThan(1 / 6);
  for (const destination of [id, ...destinations]) {
    await expect.poll(() => page.locator('.zf-stage').evaluate((stage, destination) => {
      const bounds = stage.getBoundingClientRect();
      const target = stage.querySelector(`[data-shape-id="${destination}"]`)!.getBoundingClientRect();
      const card = stage.parentElement!.querySelector('.zf-walkthrough')!.getBoundingClientRect();
      const title = stage.parentElement!.querySelector('.zf-present-title')!.getBoundingClientRect();
      return target.left >= bounds.left && target.right <= bounds.right && target.top >= title.bottom && target.bottom <= card.top;
    }, destination)).toBe(true);
  }
}

for (const width of [1440, 390]) test.describe(`presentation at ${width}px`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });
  test('keeps the current step centred while presenting', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/'); await previewReady(page);
    await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await expectCentred(page, 'Browse', ['Checkout']);
    await page.setViewportSize({ width: width === 390 ? 430 : 1280, height: width === 390 ? 900 : 800 });
    await expectCentred(page, 'Browse', ['Checkout']);
    await page.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
    await expectCentred(page, 'Checkout', ['Receipt']);
    await page.getByRole('button', { name: 'Explore Checkout', exact: true }).click();
    await expectCentred(page, 'Cart', ['Charge']);
    await page.getByRole('button', { name: 'Next: Charge', exact: true }).click();
    await expectCentred(page, 'Charge', ['Confirm']);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expectCentred(page, 'Cart', ['Charge']);
    await page.getByRole('button', { name: 'End walkthrough', exact: true }).click();
    // More than six destinations must all participate, including a returning loop.
    if (width === 390) await page.locator('#mobile-source').click();
    await source(page).fill('start -> decision\n' + Array.from({ length: 7 }, (_, i) => `decision -> outcome_${i}: Choice ${i}`).join('\n') + '\noutcome_0 -> start');
    await previewReady(page);
    if (width === 390) await page.locator('#mobile-preview').click();
    await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await page.getByRole('button', { name: 'Next: decision', exact: true }).click();
    await expectCentred(page, 'decision', Array.from({ length: 7 }, (_, i) => `outcome_${i}`));
    await page.getByRole('button', { name: 'Choice 0 → outcome_0', exact: true }).click();
    await expectCentred(page, 'outcome_0', ['start']);
  });
});

for (const theme of ['light', 'dark'] as const) for (const example of ['order', 'flows']) for (const width of [1440, 390]) {
  test.describe(`${example} walkthrough ${theme} ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, storageState: { cookies: [], origins: [] } });
    test('muted steps stay readable', { tag: '@visual' }, async ({ page, browserName }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/'); await previewReady(page);
      if (example === 'flows') { await chooseExample(page, /^Flows & mind maps/); await previewReady(page); }
      await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
      const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
      const currentName = await page.locator('.zf-walkthrough-current text').first().textContent();
      await expect(guide.getByRole('heading', { level: 2 })).toHaveText(currentName!);
      await expect(guide.getByRole('status')).toHaveText(currentName!);
      const next = guide.getByRole('button', { name: /^Next:/ });
      if (await next.count()) await expect(next).toHaveClass('zf-walkthrough-next');
      const muted = page.locator('.zf-walkthrough-muted');
      expect(await muted.count()).toBeGreaterThan(0);
      for (const node of await muted.all()) {
        const opacity = await node.evaluate(node => Number(getComputedStyle(node).opacity));
        expect(opacity).toBeGreaterThanOrEqual(.7); expect(opacity).toBeLessThan(.9);
      }
      await expect(page.locator('.zf-walkthrough-current')).toHaveCSS('opacity', '1');
      await page.mouse.move(0, 0);
      if (comparesVisuals(browserName)) await expect(page.locator('.zf-stage-area')).toHaveScreenshot(`walkthrough-${example}-${theme}-${width}.png`);
      await guide.getByRole('button', { name: 'Present', exact: true }).click();
      if (comparesVisuals(browserName)) await expect(page.locator('.zf-stage-area')).toHaveScreenshot(`present-${example}-${theme}-${width}.png`);
    });
  });
}

for (const presenting of [false, true]) test(`walkthrough camera eases moves and yields to input ${presenting ? 'in Present' : 'in the editor'}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  if (!presenting) for (let i = 0; i < 4; ++i) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  if (presenting) await page.getByRole('button', { name: 'Present', exact: true }).click();
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 100));
  await page.clock.runFor(50);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const box = () => page.locator('.zf-stage > svg').evaluate(svg => svg.getAttribute('viewBox')!.split(' ').map(Number));
  const before = await box();
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await box()).toEqual(before);
  await page.clock.runFor(100); const during = await box();
  await page.clock.runFor(250); const after = await box();
  expect(during).not.toEqual(before); expect(during).not.toEqual(after);
  const fraction = (during[0] - before[0]) / (after[0] - before[0]);
  expect(fraction).toBeGreaterThan(.5); expect(fraction).toBeLessThan(1);
  await page.getByRole('button', { name: 'Back', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await page.clock.runFor(80);
  await page.locator('.zf-stage').dispatchEvent('wheel', { deltaY: 80 });
  const interrupted = await box(); await page.clock.runFor(400);
  expect(await box()).toEqual(interrupted);
  await page.getByRole('button', { name: 'Next: Checkout', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await page.clock.runFor(80);
  await page.getByRole('button', { name: 'End walkthrough', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await page.clock.runFor(50); const ended = await box(); await page.clock.runFor(400);
  // Closing the card refits the stage; allow only subpixel SVG measurement noise.
  const settled = await box();
  const pixels = await page.locator('.zf-stage > svg').evaluate((svg: SVGSVGElement) => Math.abs(svg.getScreenCTM()!.a));
  expect(Math.max(...settled.map((value, i) => Math.abs(value - ended[i]))) * pixels).toBeLessThan(.1);
});
