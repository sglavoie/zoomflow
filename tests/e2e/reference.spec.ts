import { expect, test, type Page } from '@playwright/test';
import { referenceTopics } from '../../apps/web/src/reference-data';

const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
const panel = (page: Page) => page.getByRole('complementary', { name: 'D2 reference' });
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search D2 reference' });
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize diagram and reference' });
const toggle = (page: Page) => page.getByRole('button', { name: 'D2 reference', exact: true });

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root');
}

async function editorState(page: Page) {
  return page.locator('#editor').evaluate(async (element) => {
    const modulePath = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ modulePath);
    const state = EditorView.findFromDOM(element.querySelector('.cm-editor')!)!.state;
    return { source: state.doc.toString(), selection: state.selection.toJSON() };
  });
}

test('reference shortcuts work from the editor and panel without changing source or selection', async ({ page }) => {
  await ready(page);
  await expect(panel(page)).toBeHidden();
  await source(page).focus();
  const before = await editorState(page);
  for (const shortcut of ['Meta+/', 'Meta+Shift+?', 'Control+/', 'Control+Shift+?']) {
    await page.keyboard.press(shortcut);
    await expect(panel(page)).toBeVisible();
    await expect(search(page)).toBeFocused();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press(shortcut);
    await expect(panel(page)).toBeHidden();
    await expect(source(page)).toBeFocused();
    expect(await editorState(page)).toEqual(before);
  }
  // A held shortcut opens once instead of repeatedly flashing the panel.
  await page.keyboard.down('Meta');
  await page.keyboard.down('/');
  await page.keyboard.down('/');
  await page.keyboard.up('/');
  await page.keyboard.up('Meta');
  await expect(panel(page)).toBeVisible();
  await search(page).press('Escape');
  await expect(source(page)).toBeFocused();
  await page.keyboard.press('/');
  await page.keyboard.press('?');
  await expect(panel(page)).toBeHidden();
  expect((await editorState(page)).source).toContain('/?');
});

test('diagram is on the left; toggling preserves search, scroll, split size, and editor width', async ({ page }) => {
  await ready(page);
  const fullViewer = (await page.locator('#viewer').boundingBox())!;
  const editorBefore = (await page.locator('#source-pane').boundingBox())!;
  expect(fullViewer.x + fullViewer.width).toBeLessThanOrEqual(editorBefore.x + 1);
  await toggle(page).click();
  const splitViewer = (await page.locator('#viewer').boundingBox())!;
  const reference = (await panel(page).boundingBox())!;
  expect(splitViewer.y + splitViewer.height).toBeLessThan(reference.y);
  expect(splitViewer.height / fullViewer.height).toBeCloseTo(0.6, 1);
  expect((await page.locator('#source-pane').boundingBox())!).toEqual(editorBefore);
  await search(page).fill('style');
  await page.locator('#reference-content').evaluate((element) => { element.scrollTop = 150; });
  const scroll = await page.locator('#reference-content').evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await divider(page).focus();
  await page.keyboard.press('ArrowUp');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '55');
  await page.getByRole('button', { name: 'Close D2 reference' }).click();
  await expect(toggle(page)).toBeFocused();
  expect((await page.locator('#viewer').boundingBox())!.height).toBeCloseTo(fullViewer.height, 0);
  await toggle(page).click();
  await expect(search(page)).toHaveValue('style');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '55');
  expect(await page.locator('#reference-content').evaluate((element) => element.scrollTop)).toBe(scroll);
});

test('divider supports dragging, keyboard bounds, and remembers its size after reload', async ({ page }) => {
  await ready(page);
  await toggle(page).click();
  const before = (await page.locator('#viewer').boundingBox())!.height;
  const handle = (await divider(page).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 60, { steps: 5 });
  await page.mouse.up();
  expect((await page.locator('#viewer').boundingBox())!.height).toBeLessThan(before - 40);
  await divider(page).press('Home');
  await divider(page).press('ArrowUp');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '25');
  await divider(page).press('End');
  await divider(page).press('ArrowDown');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '75');
  await divider(page).press('ArrowUp');
  await page.reload();
  await toggle(page).click();
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '70');
});

test('double-clicking the reference divider resets and saves its default size', async ({ page }) => {
  await ready(page);
  await toggle(page).click();
  await divider(page).press('End');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '75');
  await divider(page).dblclick();
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '60');
  await page.reload();
  await toggle(page).click();
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '60');
});

test('offline reference searches examples, copies exact source, and links to full documentation', async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await toggle(page).click();
  await expect(page.locator('.reference-topic:visible')).toHaveCount(referenceTopics.length);
  await search(page).fill('ARROWS');
  await expect(page.locator('.reference-topic:visible')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Connections and arrows' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connections and arrows docs' })).toHaveAttribute('href', 'https://d2lang.com/tour/connections/');
  await expect(page.getByRole('link', { name: 'Connections and arrows docs' })).toHaveAttribute('target', '_blank');
  // Intercept the platform clipboard boundary consistently across browser engines.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copied = text; },
    } });
  });
  await page.getByRole('button', { name: 'Copy Connections and arrows example' }).click();
  expect(await page.locator('html').getAttribute('data-copied')).toBe(referenceTopics.find((topic) => topic.id === 'connections')!.source);
  await expect(page.locator('#reference-status')).toHaveText('Copied Connections and arrows example.');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Permission denied'); },
    } });
  });
  await page.getByRole('button', { name: 'Copy Connections and arrows example' }).click();
  await expect(page.locator('#reference-status')).toContainText('Example selected');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(referenceTopics.find((topic) => topic.id === 'connections')!.source);
  await search(page).fill('no-such-syntax');
  await expect(page.locator('.reference-topic:visible')).toHaveCount(0);
  await expect(page.locator('#reference-content')).toContainText('No matching syntax');
  await search(page).fill('');
  await expect(page.locator('.reference-topic:visible')).toHaveCount(referenceTopics.length);
});

test('reference controls preserve board navigation and focus follows the current task', async ({ page }) => {
  await ready(page);
  const checkout = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await checkout.focus();
  await page.keyboard.press('Meta+/');
  await page.keyboard.press('Escape');
  await expect(checkout).toBeFocused();
  await checkout.click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await source(page).focus();
  await page.keyboard.press('Meta+/');
  await search(page).fill('layers');
  await search(page).press('Backspace');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.getByRole('link', { name: 'Full docs' }).focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await page.keyboard.press('Escape');
  await expect(source(page)).toBeFocused();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await toggle(page).click();
  await source(page).focus();
  await page.keyboard.press('Meta+/');
  await expect(source(page)).toBeFocused();
  await toggle(page).click();
  await page.locator('.zf-stage a[href="root.layers.checkout.layers.charge"]').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await expect(panel(page)).toBeVisible();
});

test('reference stays usable on narrow screens, in dark mode, and with storage blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage disabled'); };
    Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator('#header-more-toggle').click();
  await expect(page.locator('#theme')).toBeVisible();
  await page.getByLabel('Theme').selectOption('dark');
  await toggle(page).click();
  await expect(search(page)).toBeVisible();
  await search(page).fill('variables');
  await expect(page.locator('.reference-topic:visible')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bounds = (await panel(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await divider(page).press('ArrowUp');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '55');
  await page.getByRole('button', { name: 'Close D2 reference' }).click();
  await expect(panel(page)).toBeHidden();
});
