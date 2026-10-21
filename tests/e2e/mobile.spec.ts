import { expect, test } from '@playwright/test';
import { openDownloads } from './menu';
import { source, previewReady, chooseProjectFile } from './helpers';

/** Phone layouts: the Preview/Source switch, compact tools and the on-screen keyboard. */

test('mobile source view gives the editor room with secondary controls collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  await page.locator('#mobile-source').click();
  await expect(page.locator('#preview-pane')).toBeHidden();
  const editor = page.locator('#editor');
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  expect((await editor.boundingBox())!.y).toBeLessThan(700);
  await expect(page.locator('#header-more-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#ai-assistant')).not.toHaveAttribute('open');
  await expect(page.locator('#lint-details')).not.toHaveAttribute('open');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  await source(page).fill('mobile: Editable');
  await expect(page.locator('.zf-stage')).toContainText('Editable');
});

test('selecting a shape on a phone reveals its source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zf-stage [data-shape-id="Browse"]')).toBeVisible();
  await page.locator('.zf-stage [data-shape-id="Browse"]').click();
  await expect(page.locator('#mobile-source')).toHaveAttribute('aria-pressed', 'true');
  await expect(source(page)).toBeFocused();
  await page.locator('#mobile-preview').click();
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
});

test('mobile first fit fills the canvas and diagnostics lead to the source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zf-stage > svg')).toBeVisible();
  const coverage = await page.locator('.zf-stage').evaluate((stage) => {
    const shapes = [...stage.querySelectorAll('[data-shape-id]')].map((shape) => shape.getBoundingClientRect());
    return (Math.max(...shapes.map((box) => box.right)) - Math.min(...shapes.map((box) => box.left))) /
      stage.getBoundingClientRect().width;
  });
  expect(coverage).toBeGreaterThan(0.8);
  await page.locator('#mobile-source').click();
  await source(page).fill('broken: {');
  await expect(page.locator('#preview-status')).toHaveText('Preview out of date');
  await page.locator('#mobile-preview').click();
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-preview-state', 'stale');
  await page.locator('#mobile-source').click();
  await page.locator('#show-diagnostics').click();
  await expect(page.locator('.cm-panel-lint')).toBeVisible();
  await expect(page.locator('.cm-panel-lint .cm-diagnostic').first()).toBeVisible();
});

test('mobile project switches retain Source and each file selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#folder').setInputFiles('fixtures/browser-project'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await source(page).press('ControlOrMeta+End');
  await chooseProjectFile(page, 'lib/nodes.d2');
  await expect(source(page)).toBeVisible();
  await source(page).fill('Imported: Updated'); await previewReady(page);
  await chooseProjectFile(page, 'main.d2');
  await expect(source(page)).toBeVisible();
  await expect(page.locator('#mobile-source')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.zf-stage')).toContainText('Updated');
});

test('expanded tools remain scrollable with a short viewport and larger text', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings > summary').click();
  await page.locator('#lint-details > summary').click();
  for (const size of [{ width: 390, height: 844 }, { width: 390, height: 450 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(size.height);
    const editor = (await page.locator('#editor').boundingBox())!;
    expect(editor.height).toBeGreaterThan(70);
    expect(editor.y + editor.height).toBeLessThanOrEqual(size.height + 1);
    expect(await page.locator('.source-tools').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.locator('#ai-prompt').fill('Keep this prompt');
    await source(page).fill('a: Still editable'); await previewReady(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'button, summary, select, .pane-title, .status-copy, #draft-status, #ai-form input, #ai-form textarea { font-size: 18px !important; }' });
  await source(page).fill('a: Larger text'); await previewReady(page);
  expect((await page.locator('#editor').boundingBox())!.height).toBeGreaterThan(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('visual viewport keyboard resize keeps the editor above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await source(page).focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 430 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const bounds = (await page.locator('#editor').boundingBox())!;
  expect(bounds.height).toBeGreaterThan(80);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(431);
  await source(page).fill('a: Keyboard edit'); await previewReady(page);
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  expect((await page.locator('#editor').boundingBox())!.height).toBeGreaterThan(bounds.height);
});

test('mobile canvas controls do not cover the diagram', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await previewReady(page);
  const canvas = (await page.locator('.zf-stage').boundingBox())!;
  expect(canvas.height).toBeGreaterThan(260);
  expect((await page.locator('header').boundingBox())!.height).toBeLessThan(120);
  for (const selector of ['.zf-zoom-controls', '.zf-fullscreen-toggle']) {
    expect((await page.locator(selector).boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  }
  await openDownloads(page);
  const menu = (await page.locator('#header-more-content').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
});

test.describe('phone workspace', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('touch guidance and empty boards lead back to source without inserting text', async ({ page }) => {
    await page.goto('/'); await previewReady(page);
    await expect(page.locator('.zf-pan-hint')).toHaveText('Tap Checkout to explore · Pinch to zoom');
    await page.getByRole('link', { name: 'Open checkout board', exact: true }).tap();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
    await page.locator('#mobile-source').tap();
    expect((await page.locator('#editor').boundingBox())!.y).toBeLessThan(260);
    await source(page).fill(''); await previewReady(page);
    await page.locator('#mobile-preview').tap();
    await expect(page.locator('.empty-board-help code')).toHaveText('a -> b');
    await expect(page.locator('.zf-pan-hint')).toBeHidden();
    await page.getByRole('button', { name: 'Edit source', exact: true }).tap();
    await expect(source(page)).toBeFocused();
    await expect(source(page)).toHaveText('');
  });

  test('AI review survives time and failed requests, jumps to changes, and preserves Undo after dismissal', async ({ page }) => {
    await page.clock.install();
    const original = Array.from({ length: 70 }, (_, i) => `n${i}: Node ${i}`).join('\n');
    const changed = original.replace('n60: Node 60', 'n60: Updated by AI');
    await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
    await page.route('**/api/ai', (route) => route.fulfill({ json: { reply: 'Updated one label.', source: changed } }));
    await page.goto('/'); await previewReady(page);
    await page.locator('#mobile-source').click();
    await source(page).fill(original); await previewReady(page);
    await page.locator('#ai-assistant > summary').click();
    await page.locator('#ai-prompt').fill('Update node 60');
    await page.locator('#ai-send').click();
    await expect(page.locator('#ai-change-summary')).toContainText('1 source line');
    await previewReady(page);
    await page.clock.fastForward(20_000);
    await page.route('**/api/ai', (route) => route.fulfill({ status: 500, json: { error: 'Try again.' } }));
    await page.locator('#ai-prompt').fill('Try another change');
    await page.locator('#ai-send').click();
    await expect(page.locator('#ai-status')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('#ai-change-summary')).toBeEnabled();
    await page.locator('#ai-change-summary').click();
    await expect(source(page)).toBeFocused();
    await expect(page.locator('.zf-ai-changed')).toContainText('Updated by AI');
    await expect(page.locator('.zf-ai-changed')).toBeInViewport();
    await page.locator('#ai-dismiss-highlights').click();
    await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
    await expect(page.locator('#ai-change-summary')).toBeDisabled();
    await expect(page.locator('#ai-undo')).toBeVisible();
    await page.locator('#ai-undo').click();
    await previewReady(page);
    expect(await source(page).innerText()).toContain('Node 60');
    await expect(page.locator('#ai-undo')).toBeHidden();
  });
});
