import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseExample, comparesVisuals, visualSkipReason, editorText, previewReady, source } from './helpers';
import { selectMenuOption } from './menu';
import { devURL } from './servers';
import { readFlow } from '../../apps/web/src/flow-model';

test.use({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
const shape = (page: Page, id: string) => page.locator(`#viewer [data-shape-id="${id}"]`);
async function open(page: Page) { await page.goto('/'); await previewReady(page); }
async function quick(page: Page) {
  await page.locator('#create-open > summary').click();
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  return page.getByRole('dialog', { name: 'Create a flow' });
}

test('describes Create menu items without renaming them', async ({ page }) => {
  await open(page);
  const summary = page.locator('#create-open > summary');
  const items = [
    ['#new-flow', 'New flow', 'Type steps, get a connected flow'],
    ['#new-mind-map', 'New mind map', 'Turn an outline into connected ideas'],
    ['#file', 'Open .d2', 'Continue from a D2 file on your device'],
    ['#open-folder', 'Open folder', 'Explore connected files in a project'],
  ];
  for (const [width, height] of [[1440, 900], [390, 844], [320, 844], [320, 320], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await summary.focus(); await page.keyboard.press('Enter');
    for (const [selector, name, description] of items) {
      const control = page.locator(selector);
      await expect(control).toHaveAccessibleName(name);
      await expect(control).toHaveAccessibleDescription(description);
      await expect(page.locator(`#${await control.getAttribute('aria-describedby')}`)).toBeVisible();
    }
    const menu = page.locator('.create-open-menu');
    await expect(menu.locator('svg[aria-hidden="true"][focusable="false"]')).toHaveCount(4);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect.poll(async () => {
      const bounds = (await menu.boundingBox())!;
      return bounds.y + bounds.height;
    }).toBeLessThanOrEqual(height);
    // Native file input remains in the keyboard path, with the description
    // attached to the control rather than its enclosing decorative label.
    await page.locator('#new-flow').focus();
    for (const selector of ['#new-mind-map', '#file', '#open-folder']) {
      await page.keyboard.press('Tab'); await expect(page.locator(selector)).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect(summary).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await summary.click();
  await page.getByRole('button', { name: 'New flow', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a flow' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#file').setInputFiles({ name: 'menu.d2', mimeType: 'text/plain', buffer: Buffer.from('a: Opened from Create menu') });
  await expect(page.locator('.zf-stage')).toContainText('Opened from Create menu');
});

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`Create menu in ${theme} at ${width}`, { tag: '@visual' }, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await open(page);
    await page.locator('#create-open > summary').click();
    await page.mouse.move(0, 0);
    await expect(page.locator('.create-open-menu')).toHaveScreenshot(`create-menu-${theme}-${width}.png`);
  });
}

test('fresh workspace teaches direct editing, keeps attached boards, and remembers the chosen layout', async ({ page }) => {
  await open(page);
  await expect(page.locator('#source-pane')).toBeHidden();
  // The first invitation waits for four seconds without input.
  await expect(page.locator('.canvas-coach')).toBeVisible({ timeout: 7000 });
  await shape(page, 'Browse').dblclick();
  await page.getByRole('textbox', { name: 'Rename Browse', exact: true }).fill('Discover');
  await page.keyboard.press('Enter'); await previewReady(page);
  await expect(shape(page, 'Browse')).toContainText('Discover');
  await expect(page.locator('.canvas-coach')).toContainText('Keep the idea moving');
  await page.getByRole('button', { name: 'Add next step', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).fill('Choose items');
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Enter'); await previewReady(page);
  await expect(page.locator('.canvas-coach')).toContainText('There’s more inside');
  await page.getByRole('link', { name: 'Open Checkout board', exact: true }).locator('.appendix-icon').click();
  await page.getByRole('link', { name: 'Open Charge board', exact: true }).locator('.appendix-icon').click();
  await expect(shape(page, 'step_2')).toContainText('Capture');
  await page.locator('#toggle-source').click();
  await page.reload(); await previewReady(page);
  await expect(page.locator('#source-pane')).toBeVisible();
  await expect(page.locator('.canvas-coach')).toBeHidden();
  expect(await editorText(page)).toContain('Discover');
});

test('existing workspaces retain the former source layout when migrating', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zoomflow.selection.v2', 'order.d2'));
  await open(page);
  await expect(page.locator('#source-pane')).toBeVisible();
});

test('quick start connects a list, preserves it in the full builder, and creates an editable draft', async ({ page }) => {
  await open(page);
  const dialog = await quick(page);
  await dialog.getByLabel('Flow name', { exact: true }).fill('Shipping');
  await dialog.getByLabel('Steps, one per line', { exact: true }).fill('Pack\n\nShip\nDeliver');
  await expect(dialog.locator('.zf-stage')).toContainText('Deliver');
  await dialog.getByRole('button', { name: 'Full builder', exact: true }).click();
  await expect(dialog.getByLabel('Step 2 name', { exact: true })).toHaveValue('Ship');
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  const flow = readFlow(await editorText(page))!;
  expect(flow.steps.map(step => step.label)).toEqual(['Pack', 'Ship', 'Deliver']);
  expect(flow.connections).toEqual([{ from: 'step_1', to: 'step_2', label: '' }, { from: 'step_2', to: 'step_3', label: '' }]);
  await shape(page, 'step_2').dblclick();
  await expect(page.getByRole('textbox', { name: 'Rename Ship', exact: true })).toBeFocused();
});

test('insert splits only the chosen labelled connection, preserves its decision, and undoes cleanly', async ({ page }) => {
  await open(page);
  const dialog = await quick(page);
  await dialog.getByRole('button', { name: 'Full builder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approval with Yes / No', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  const original = await editorText(page);
  await page.locator('#viewer [data-flow-connection="1"]').focus();
  await page.getByRole('button', { name: 'Insert step', exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Rename New step', exact: true });
  await expect(rename).toBeFocused(); await rename.fill('Prepare'); await rename.press('Enter'); await previewReady(page);
  const flow = readFlow(await editorText(page))!;
  expect(flow.connections).toContainEqual({ from: 'step_2', to: 'step_5', label: 'Yes' });
  expect(flow.connections).toContainEqual({ from: 'step_5', to: 'step_3', label: '' });
  expect(flow.connections).toContainEqual({ from: 'step_2', to: 'step_4', label: 'No' });
  await page.locator('#viewer .zf-stage').focus();
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  await page.keyboard.press('ControlOrMeta+z'); await previewReady(page);
  expect(await editorText(page)).toBe(original);
});

test('connection hover exposes an insertion handle at the arrow, including horizontal arrows', async ({ page }) => {
  await open(page);
  const point = await page.locator('#viewer [data-flow-connection="0"] path.connection').evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(point.x, point.y);
  const insert = page.getByRole('button', { name: 'Insert step between Browse and Checkout', exact: true });
  await expect(insert).toBeVisible(); await insert.click();
  await expect(page.getByRole('textbox', { name: 'Rename New step', exact: true })).toBeFocused();
});

test('an empty board can start a flow or mind map without opening source syntax', async ({ page }) => {
  await open(page); await page.locator('#toggle-source').click();
  await source(page).fill(''); await previewReady(page);
  await page.getByRole('button', { name: 'Add first step', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Rename First step', exact: true });
  await expect(name).toBeFocused(); await name.fill('Begin'); await name.press('Enter'); await previewReady(page);
  await expect(shape(page, 'step_1')).toContainText('Begin');
  await source(page).fill(''); await previewReady(page);
  await page.getByRole('button', { name: 'Start mind map', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a mind map board' }).getByRole('button', { name: 'Add board', exact: true }).click();
  await previewReady(page); await expect(page.getByRole('button', { name: 'Edit mind map', exact: true })).toBeVisible();
});

// Inspect real keyframes and geometry synchronously, then let the animation run normally.
async function watchEditMotion(page: Page) {
  await page.evaluate(() => {
    (window as any).__editMotion = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (Array.isArray(frames) && (String(frames[0]?.transform).includes('scale(.9)') || this.classList.contains('zf-edit-ghost'))) {
        const duration = Number(typeof options === 'number' ? options : options?.duration);
        animation.pause(); animation.currentTime = 0;
        const start = this.getBoundingClientRect().toJSON();
        animation.currentTime = duration;
        const end = this.getBoundingClientRect().toJSON();
        (window as any).__editMotion.push({ id: this.getAttribute('data-shape-id'), ghost: this.classList.contains('zf-edit-ghost'),
          frames, duration, start, end, fill: getComputedStyle(this).backgroundColor,
          hidden: this.getAttribute('aria-hidden'), pointer: getComputedStyle(this).pointerEvents });
        animation.currentTime = 0; animation.play();
      }
      return animation;
    };
  });
}
const editMotion = (page: Page) => page.evaluate(() => (window as any).__editMotion as {
  id: string | null; ghost: boolean; frames: Keyframe[]; duration: number; start: DOMRect; end: DOMRect;
  fill: string; hidden: string | null; pointer: string;
}[]);

test('scales in a new step', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await open(page);
  await shape(page, 'Browse').click(); await watchEditMotion(page);
  const pixels = await page.locator('#viewer .zf-stage > svg').evaluate(node => (node as SVGSVGElement).getScreenCTM()!.a);
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  await expect.poll(async () => (await editMotion(page)).length).toBe(1);
  const added = (await editMotion(page))[0];
  expect(added.id).toBe('step_1'); expect(added.duration).toBe(220);
  expect(added.frames[0].opacity).toBe(0); expect(added.frames[1].opacity).toBe(1);
  expect(added.start.width / added.end.width).toBeCloseTo(0.9, 3);
  expect(added.start.height / added.end.height).toBeCloseTo(0.9, 3);
  expect(added.start.x + added.start.width / 2).toBeCloseTo(added.end.x + added.end.width / 2, 1);
  expect(added.start.y + added.start.height / 2).toBeCloseTo(added.end.y + added.end.height / 2, 1);
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-edit-motion');
  await expect(page.locator('.zf-edit-enter')).toHaveCount(0);
  expect(await page.locator('#viewer .zf-stage > svg').evaluate(node => (node as SVGSVGElement).getScreenCTM()!.a)).toBeCloseTo(pixels, 5);
  await expect(page.getByRole('textbox', { name: 'Rename New step', exact: true })).toBeFocused();
});

test('collapses a deleted step without leaving a ghost', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await open(page);
  await page.locator('#toggle-source').click();
  await source(page).fill('a -> b -> c\nb.style.fill: "#aabbcc"'); await previewReady(page);
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-edit-motion');
  await page.locator('#viewer .zf-stage').evaluate(stage => {
    stage.addEventListener('zf-beforerender', () => {
      (window as any).__deletedBounds = stage.querySelector('[data-shape-id="b"]')!.getBoundingClientRect().toJSON();
    }, { once: true, capture: true });
  });
  await watchEditMotion(page);
  await source(page).fill('a -> c'); await previewReady(page);
  await expect.poll(async () => (await editMotion(page)).filter(item => item.ghost).length).toBe(1);
  const ghost = (await editMotion(page)).find(item => item.ghost)!;
  const before = await page.evaluate(() => (window as any).__deletedBounds as DOMRect);
  expect(ghost.duration).toBe(200); expect(ghost.hidden).toBe('true'); expect(ghost.pointer).toBe('none');
  expect(ghost.fill).toBe('rgb(170, 187, 204)');
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(ghost.start[key]).toBeCloseTo(before[key], 1);
  expect(ghost.end.width / ghost.start.width).toBeCloseTo(0.1, 3);
  expect(ghost.start.x + ghost.start.width / 2).toBeCloseTo(ghost.end.x + ghost.end.width / 2, 1);
  expect(ghost.start.y + ghost.start.height / 2).toBeCloseTo(ghost.end.y + ghost.end.height / 2, 1);
  expect(ghost.frames[1].opacity).toBe(0);
  await expect(shape(page, 'b')).toHaveCount(0);
  await expect(page.locator('.zf-edit-ghost')).toHaveCount(0);
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-edit-motion');
});

test('skips edit motion under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await open(page);
  await page.locator('#toggle-source').click(); await watchEditMotion(page);
  await source(page).fill('a -> b -> c'); await previewReady(page);
  await source(page).fill('a -> c'); await previewReady(page);
  expect(await editMotion(page)).toEqual([]);
  await expect(page.locator('.zf-edit-ghost, .zf-edit-enter')).toHaveCount(0);
  expect(await page.locator('#viewer .zf-stage').evaluate(stage => stage.getAnimations({ subtree: true }).length)).toBe(0);
});

test('edit ghosts respect render boundaries, shape limits and interruption', async ({ page }) => {
  await page.goto(devURL); await previewReady(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const result = await page.evaluate(async url => {
    const { setupEditMotion } = await import(url);
    const stage = document.createElement('div'); stage.id = 'edit-fixture';
    stage.style.cssText = 'position:relative;width:600px;height:400px;border:1px solid black';
    document.body.append(stage); stage.dataset.board = 'root'; setupEditMotion(stage);
    const svg = (count: number) => `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="zf-lit-fixture"><stop stop-color="#aabbcc"/><stop offset="1" stop-color="#778899"/></linearGradient></defs>
      ${Array.from({ length: count }, (_, i) => `<g data-shape-id="s${i}" data-shape-board="root" transform="translate(${i * 2} 20)"><g class="shape"><rect width="80" height="50" rx="6" fill="url(#zf-lit-fixture)" stroke="#123456" stroke-width="2"/></g></g>`).join('')}</svg>`;
    const initial = (count: number) => { stage.dispatchEvent(new Event('zf-sourcechange')); stage.dataset.board = 'root'; stage.innerHTML = svg(count); };
    const render = async (count: number, board = 'root', animate = true) => {
      stage.dispatchEvent(new CustomEvent('zf-beforerender', { detail: { animate } }));
      stage.dataset.board = board; stage.innerHTML = svg(count); stage.dispatchEvent(new Event('zf-boardchange'));
      await new Promise(requestAnimationFrame);
      for (const animation of stage.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 80; }
      return stage.getAnimations({ subtree: true }).length;
    };
    initial(151); const oldLarge = await render(1);
    initial(1); const newLarge = await render(151);
    initial(2); const boardChange = await render(1, 'other');
    initial(2); const staticRender = await render(1, 'root', false);
    initial(150); const boundary = await render(149);
    const ghost = stage.querySelector<HTMLElement>('.zf-edit-ghost')!;
    const paint = { fill: ghost.style.backgroundImage, stroke: ghost.style.borderColor, radius: ghost.style.borderRadius };
    const canceled = [];
    for (const type of ['pointerdown', 'wheel', 'keydown', 'zf-sourcechange', 'zf-suspend', 'zf-destroy']) {
      initial(2); await render(1); stage.dispatchEvent(new Event(type));
      canceled.push({ type, ghosts: stage.querySelectorAll('.zf-edit-ghost').length, animations: stage.getAnimations({ subtree: true }).length,
        marked: stage.hasAttribute('data-edit-motion') });
    }
    // Use a new controller after destruction for a live media-preference change.
    setupEditMotion(stage); initial(2); await render(1);
    return { oldLarge, newLarge, boardChange, staticRender, boundary, paint, canceled };
  }, `/@fs${process.cwd()}/packages/viewer/src/edit-motion.ts`);
  expect(result.oldLarge).toBe(0); expect(result.newLarge).toBe(0);
  expect(result.boardChange).toBe(0); expect(result.staticRender).toBe(0); expect(result.boundary).toBe(1);
  expect(result.paint.fill).toBe('linear-gradient(rgb(170, 187, 204), rgb(119, 136, 153))');
  expect(result.paint.stroke).toBe('rgb(18, 52, 86)'); expect(result.paint.radius).toBe('6px');
  for (const cancellation of result.canceled) expect(cancellation).toEqual({ type: cancellation.type, ghosts: 0, animations: 0, marked: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#edit-fixture .zf-edit-ghost')).toHaveCount(0);
  expect(await page.locator('#edit-fixture').evaluate(stage => stage.getAnimations({ subtree: true }).length)).toBe(0);
  await page.locator('#edit-fixture').evaluate(stage => { stage.dispatchEvent(new Event('zf-destroy')); stage.remove(); });
});

test('edits animate surviving shapes and reduced motion skips that animation', async ({ page }) => {
  await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const watch = () => page.evaluate(() => new Promise<number>(resolve => {
    document.querySelector('#viewer .zf-stage')!.addEventListener('zf-boardchange', () => requestAnimationFrame(() => {
      resolve(document.querySelector('#viewer .zf-stage')!.getAnimations({ subtree: true }).filter(animation =>
        (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'transform' in frame)).length);
    }), { once: true });
  }));
  await shape(page, 'Browse').click();
  const motion = watch();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  expect(await motion).toBeGreaterThan(0);
  await page.getByRole('textbox', { name: 'Rename New step', exact: true }).press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await shape(page, 'Browse').click(); const reduced = watch();
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  expect(await reduced).toBe(0);
});

test('walkthrough follows choices, visits nested boards, returns, and works offline', async ({ page, context }, testInfo) => {
  await open(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await guide.getByRole('button', { name: 'Explore Checkout', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Charge', exact: true }).click();
  await guide.getByRole('button', { name: 'Explore Charge', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Capture', exact: true }).click();
  await guide.getByRole('button', { name: 'Next: Receipt', exact: true }).click();
  await guide.getByRole('button', { name: 'Return to Checkout', exact: true }).click();
  await expect(guide).toContainText('Charge');
  await guide.getByRole('button', { name: 'End walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const download = await downloaded; const path = testInfo.outputPath('walkthrough.html'); await download.saveAs(path);
  expect(await readFile(path, 'utf8')).toContain('walkthrough');
  await context.setOffline(true);
  const offline = await context.newPage(); await offline.goto(`file://${path}`);
  await offline.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await offline.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await offline.getByRole('button', { name: 'Explore Checkout', exact: true }).click();
  await expect(offline.locator('.zf-walkthrough')).toContainText('Cart');
  await expect(offline.locator('.zf-walkthrough-muted').first()).toBeAttached();
});

test('style controls preserve attachments and filled shapes follow dark mode', async ({ page }) => {
  await open(page);
  await page.locator('.board-appearance > details > summary').click();
  // Anchor the phone popover to the toolbar, not an offset past its trigger.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const menu = (await page.locator('.board-appearance .builder-look').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
  }
  await page.locator('.board-appearance').getByRole('button', { name: 'Elevated', exact: true }).click(); await previewReady(page);
  await expect(page.getByRole('link', { name: 'Open Checkout board', exact: true })).toBeVisible();
  await page.locator('#workspace-view > summary').click();
  await page.locator('#theme button[value="dark"]').click();
  await expect.poll(() => shape(page, 'Browse').locator('.shape rect').evaluate(node => getComputedStyle(node).fill)).toBe('url("#zf-lit-step")');
  await expect.poll(() => shape(page, 'Browse').locator('text').evaluate(node => getComputedStyle(node).fill)).toBe('rgb(228, 234, 242)');
});

test('phone keeps the canvas prominent and creation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  expect((await page.locator('#viewer .zf-stage').boundingBox())!.y).toBeLessThan(245);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const dialog = await quick(page);
  await dialog.getByLabel('Steps, one per line', { exact: true }).fill('First\nNext');
  await dialog.getByRole('button', { name: 'Create flow', exact: true }).click(); await previewReady(page);
  await expect(shape(page, 'step_2')).toContainText('Next');
});


test('walkthrough waits for branch choices, supports loops and backtracking, and keeps unused arrows dim', async ({ page }) => {
  await open(page); await page.locator('#toggle-source').click();
  await source(page).fill('start -> decision\ndecision -> done: Yes\ndecision -> start: Retry'); await previewReady(page);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  await guide.getByRole('button', { name: 'Next: decision', exact: true }).click();
  await expect(guide.getByRole('button', { name: 'Yes → done', exact: true })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Retry → start', exact: true })).toBeVisible();
  await expect(page.locator('#viewer [data-connection-id]:not(.zf-walkthrough-muted)')).toHaveCount(1);
  await guide.getByRole('button', { name: 'Retry → start', exact: true }).click();
  await expect(guide.getByRole('status')).toHaveText('start');
  await guide.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(guide.getByRole('status')).toHaveText('decision');
  await expect(page.locator('#viewer [data-connection-id]:not(.zf-walkthrough-muted)')).toHaveCount(1);
  await guide.getByRole('button', { name: 'Yes → done', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(guide.getByRole('status')).toHaveText('done');
  await guide.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('button', { name: 'Walkthrough', exact: true })).toBeFocused();
});

test('walkthrough and zoom controls remain separate in fullscreen and on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await open(page);
  const zoom = page.getByRole('group', { name: 'Diagram zoom' });
  const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
  const controls = (await zoom.boundingBox())!;
  expect(controls.x + controls.width).toBeLessThanOrEqual((await fullscreen.boundingBox())!.x);
  await page.getByRole('button', { name: 'Walkthrough', exact: true }).click();
  await fullscreen.click();
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  const box = (await zoom.boundingBox())!;
  expect((await guide.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
  await guide.getByRole('button', { name: 'Next: Checkout', exact: true }).click();
  await expect(guide.getByRole('status')).toHaveText('Checkout');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(guide).toBeVisible();
});

test('coach hides for shape menus and toolbar overlays and returns when they close', async ({ page }) => {
  await open(page);
  const coach = page.locator('.canvas-coach');
  await expect(coach).toBeVisible({ timeout: 7000 });
  await shape(page, 'Browse').click();
  await page.getByRole('button', { name: 'More shape actions', exact: true }).click();
  await expect(coach).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(coach).toBeVisible();
  await shape(page, 'Browse').click({ button: 'right' });
  await expect(coach).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(coach).toBeVisible();
  for (const selector of ['.board-outline > summary', '.board-appearance > details > summary', '.diagram-search-trigger']) {
    await page.locator('#viewer').locator(selector).click();
    await expect(coach).toBeHidden();
    if (selector.includes('board-appearance')) await page.locator('#viewer').getByText('Customize style', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(coach).toBeVisible();
  }
});

test('Escape ends a mouse-started walkthrough from the trigger and viewer toolbar, after dismissing overlays', async ({ page }) => {
  await open(page);
  const trigger = page.getByRole('button', { name: 'Walkthrough', exact: true });
  const guide = page.getByRole('region', { name: 'Diagram walkthrough' });
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await trigger.click();
  for (const selector of ['.board-outline > summary', '.board-appearance > details > summary', '.diagram-search-trigger']) {
    await page.locator('#viewer').locator(selector).click();
    await page.keyboard.press('Escape');
    await expect(guide).toBeVisible();
  }
  await page.getByRole('button', { name: 'Zoom in', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
  await expect(trigger).toBeFocused();
});

// Observe actual Web Animations without changing their timing or completion.
async function watchArrival(page: Page) {
  await page.addInitScript(() => {
    (window as any).__arrival = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (Array.isArray(frames) && (String(frames[0]?.transform).includes('scale(.96)') || 'strokeDashoffset' in (frames[0] ?? {}))) {
        (window as any).__arrival.push({ id: this.getAttribute('data-shape-id') ?? this.querySelector('[data-shape-id]')?.getAttribute('data-shape-id'),
          edge: this.closest('[data-connection-id]')?.getAttribute('data-connection-id'), frames, options });
      }
      return animate.call(this, frames, options);
    };
  });
}
const arrival = (page: Page) => page.evaluate(() => (window as any).__arrival as { id?: string; edge?: string; frames: Keyframe[]; options: KeyframeAnimationOptions }[]);

test('arrives once on first load and not after an edit', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await watchArrival(page); await open(page);
  const first = await arrival(page);
  const shapes = first.filter(item => item.id);
  expect(shapes.map(item => item.id)).toEqual(['Browse', 'Checkout', 'Receipt']);
  expect(shapes.map(item => item.options.delay)).toEqual([0, 40, 80]);
  const edges = first.filter(item => item.edge);
  expect(edges).toHaveLength(2);
  expect(edges.every(item => Number(item.frames[0].strokeDashoffset) > 0 && item.frames[1].strokeDashoffset === 0)).toBe(true);
  expect(edges.map(item => item.options.delay)).toEqual([220, 260]);
  expect(first.every(item => Number(item.options.delay) + Number(item.options.duration) <= 600)).toBe(true);
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-arrival-motion');
  await page.locator('#toggle-source').click();
  const original = await editorText(page);
  await source(page).fill(''); await previewReady(page);
  await source(page).fill(original); await previewReady(page);
  expect(await arrival(page)).toHaveLength(first.length);
  await source(page).fill(`${original}\n# edited`); await previewReady(page);
  expect(await arrival(page)).toHaveLength(first.length);
  await page.getByRole('link', { name: 'Open Checkout board', exact: true }).locator('.appendix-icon').click();
  await expect(page.locator('#viewer .zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  expect(await arrival(page)).toHaveLength(first.length);
  await page.locator('#workspace-view > summary').click();
  await page.locator('#theme button[value="dark"]').click();
  expect(await arrival(page)).toHaveLength(first.length);
  await page.reload(); await previewReady(page);
  expect(await arrival(page)).toHaveLength(0);
  await chooseExample(page, /Flows & mind maps/);
  expect((await arrival(page)).some(item => item.id)).toBe(true);
  const count = (await arrival(page)).length;
  await chooseExample(page, /Order flow/);
  // The picker reopens this example's edited browser draft without arrival.
  await previewReady(page); expect(await arrival(page)).toHaveLength(count);
  expect(await editorText(page)).toContain('# edited');
});

test('pulses the drill arrow until the first drill', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await open(page);
  const ring = page.locator('#viewer .zf-drill-hint');
  await expect(ring).toHaveCount(1);
  expect(await ring.evaluate(node => node.closest('a')?.getAttribute('aria-label'))).toBe('Open Checkout board');
  expect(await ring.evaluate(node => getComputedStyle(node).animationName)).toBe('drill-hint');
  await selectMenuOption(page, '#layout', 'tabs');
  await page.locator('#pane-choose-b').click();
  await page.locator('.example-menu').getByRole('button', { name: /Flows & mind maps/ }).and(page.locator('.example-option')).click();
  await previewReady(page, 'b');
  await expect(page.locator('#viewer-b .zf-drill-hint')).toHaveCount(1);
  await page.getByRole('link', { name: 'Open Checkout board', exact: true }).locator('.appendix-icon').click();
  await expect(page.locator('.zf-drill-hint')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('zoomflow.drill-hint-dismissed'))).toBe('true');
  await page.locator('#viewer .zf-breadcrumbs button').first().click();
  await expect(ring).toHaveCount(0);
  await page.reload(); await previewReady(page); await expect(ring).toHaveCount(0);
});

test('waits to coach until a drill or idle', async ({ page }) => {
  await open(page);
  const coach = page.locator('.canvas-coach');
  await expect(coach).toBeHidden();
  // The idle clock starts after arrival and resets on source, keyboard and pointer input.
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-arrival-motion');
  await page.clock.install();
  await page.mouse.click(12, 12);
  await page.clock.runFor(3500); await expect(coach).toBeHidden();
  await page.keyboard.press('Shift');
  await page.clock.runFor(3500); await expect(coach).toBeHidden();
  await page.clock.runFor(600); await expect(coach).toBeVisible();
  const clear = await coach.boundingBox(); const target = await shape(page, 'Browse').boundingBox();
  expect(clear && target && (clear.x + clear.width <= target.x || clear.x >= target.x + target.width ||
    clear.y + clear.height <= target.y || clear.y >= target.y + target.height)).toBe(true);
  await page.getByRole('button', { name: 'Dismiss editing hint', exact: true }).click();
  await expect(coach).toBeHidden(); await expect(page.locator('.zf-drill-hint')).toHaveCount(0);
  await page.reload(); await previewReady(page); await expect(coach).toBeHidden();
  await page.clock.runFor(5000); await expect(coach).toBeHidden();
  // Start fresh to exercise drill-before-idle, independently of dismissal.
  await page.evaluate(() => localStorage.clear()); await page.reload(); await previewReady(page);
  await expect(coach).toBeHidden();
  await page.getByRole('link', { name: 'Open Checkout board', exact: true }).locator('.appendix-icon').click();
  await expect(coach).toBeVisible();
});

test('skips arrival motion under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await watchArrival(page); await open(page);
  expect(await arrival(page)).toHaveLength(0);
  await expect(page.locator('#viewer .zf-stage')).not.toHaveAttribute('data-arrival-motion');
  const ring = page.locator('.zf-drill-hint'); await expect(ring).toHaveCount(1);
  expect(await ring.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await chooseExample(page, /Flows & mind maps/); expect(await arrival(page)).toHaveLength(0);
});

test('offline HTML arrives only on opening', async ({ page, context }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await open(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const path = info.outputPath('arrival.html'); await (await downloaded).saveAs(path);
  await context.setOffline(true);
  const offline = await context.newPage(); await offline.emulateMedia({ reducedMotion: 'no-preference' }); await watchArrival(offline);
  const errors: string[] = []; offline.on('pageerror', error => errors.push(error.message));
  await offline.goto(`file://${path}`);
  await expect.poll(async () => (await arrival(offline)).filter(item => item.id).length).toBe(3);
  const first = await arrival(offline); expect(first.filter(item => item.edge)).toHaveLength(2);
  await offline.getByRole('link', { name: 'Open Checkout board', exact: true }).locator('.appendix-icon').click();
  await expect(offline.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  expect(await arrival(offline)).toHaveLength(first.length);
  await offline.emulateMedia({ reducedMotion: 'reduce' }); await offline.reload();
  await expect(offline.locator('.zf-stage > svg')).toBeVisible(); expect(await arrival(offline)).toHaveLength(0);
  expect(errors).toEqual([]);
});


test('arrival caps large boards and restores paint immediately when interrupted', async ({ page }) => {
  // This fixture exercises the shared runtime directly, including in bundle-based runs.
  await page.goto(devURL); await previewReady(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const result = await page.evaluate(async url => {
    const { setupArrivalMotion } = await import(url);
    const stage = document.createElement('div'); stage.id = 'arrival-fixture';
    stage.innerHTML = `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">${Array.from({ length: 60 }, (_, i) =>
      `<g data-shape-id="s${i}" transform="translate(${(i % 10) * 50} ${Math.floor(i / 10) * 50})"><rect width="40" height="40"/></g>`).join('')}
      <g data-connection-id="edge" data-connection-from="s0" data-connection-to="s59"><path class="connection" d="M0 0L500 300" fill="none" stroke="black" stroke-dasharray="4 2"/></g></svg>`;
    document.body.append(stage);
    const motion = setupArrivalMotion(stage);
    const first = stage.querySelector<SVGGraphicsElement>('[data-shape-id]')!;
    const paint = stage.querySelector<SVGPathElement>('path')!;
    const before = { box: first.getBoundingClientRect().toJSON(), dash: getComputedStyle(paint).strokeDasharray };
    motion.arrive();
    const running = stage.getAnimations({ subtree: true });
    const end = Math.max(...running.map(animation => Number(animation.effect!.getComputedTiming().endTime)));
    for (const animation of running) { animation.pause(); animation.currentTime = 120; }
    stage.dispatchEvent(new PointerEvent('pointerdown'));
    const canceled = stage.getAnimations({ subtree: true }).length;
    const after = { box: first.getBoundingClientRect().toJSON(), dash: getComputedStyle(paint).strokeDasharray };
    const extra = first.cloneNode(true) as SVGGraphicsElement; extra.dataset.shapeId = 's60'; first.after(extra);
    motion.arrive(); const large = stage.getAnimations({ subtree: true }).length;
    extra.remove(); motion.arrive();
    return { count: running.length, end, before, after, canceled, large };
  }, `/@fs${process.cwd()}/packages/viewer/src/arrival-motion.ts`);
  expect(result.count).toBe(62); expect(result.end).toBeLessThanOrEqual(600);
  expect(result.after).toEqual(result.before); expect(result.canceled).toBe(0); expect(result.large).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#arrival-fixture')).not.toHaveAttribute('data-arrival-motion');
  expect(await page.locator('#arrival-fixture').evaluate(stage => stage.getAnimations({ subtree: true }).length)).toBe(0);
  await page.locator('#arrival-fixture').evaluate(stage => { stage.dispatchEvent(new Event('zf-destroy')); stage.remove(); });
});
