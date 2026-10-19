import { expect, test, type Page } from '@playwright/test';
import { referenceTopics } from '../../apps/web/src/reference-data';

const ready = (page: Page) => expect(page.locator('#preview-status')).toHaveText('Preview ready');
const source = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });

test('format success returns to file state, while failures persist and later edits clear them', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await ready(page);
  await source(page).fill('a:{label: Hello}'); await ready(page);
  await page.locator('#format-source').click();
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await ready(page);
  await expect(page.locator('#draft-status')).toBeHidden();
  await page.clock.fastForward(4100);
  await expect(page.locator('#format-status')).toBeHidden();
  await expect(page.locator('#draft-status')).toHaveText('File has unsaved changes');
  await expect(page.locator('#draft-status')).toBeVisible();
  await page.locator('#format-source').click();
  await expect(page.locator('#format-status')).toHaveText('Source is already formatted.');
  await source(page).fill('broken: {');
  await page.locator('#format-source').click();
  await expect(page.locator('#format-status')).toContainText('Formatting failed:');
  await page.clock.fastForward(5000);
  await expect(page.locator('#format-status')).toBeVisible();
  await source(page).fill('a: Repaired'); await ready(page);
  await expect(page.locator('#format-status')).toBeHidden();
  await expect(page.locator('#draft-status')).toBeVisible();
});

test('adaptive split gives the editor room and preserves a deliberate resize until reset', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/'); await ready(page);
  const divider = page.locator('#source-divider');
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect((await page.locator('#source-pane').boundingBox())!.width).toBeGreaterThan(500);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '57');
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '62');
});

test('reference keeps exact code, highlights search matches, and acknowledges each copy locally', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await ready(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async (text: string) => { document.documentElement.dataset.copied = text; } } }));
  await page.locator('#toggle-reference').click();
  await expect(page.locator('.reference-topic .zf-token-property').first()).toBeVisible();
  await page.locator('#reference-search').fill('connections arrows');
  const card = page.locator('.reference-topic:visible');
  await expect(card).toHaveCount(1);
  await expect(card.locator('h3 mark')).toHaveText(['Connections', 'arrows']);
  const expected = referenceTopics.find((topic) => topic.id === 'connections')!.source;
  expect(await card.locator('code').textContent()).toBe(expected);
  const copy = card.getByRole('button', { name: 'Copy Connections and arrows example' });
  await copy.click();
  await expect(copy).toHaveText('Copied');
  expect(await page.locator('html').getAttribute('data-copied')).toBe(expected);
  await page.clock.fastForward(2100);
  await expect(copy).toHaveText('Copy');
  await page.locator('#reference-search').fill('->');
  await expect(page.locator('.reference-topic:visible code mark.zf-token-operator').first()).toBeVisible();
  await page.locator('#reference-search').fill('');
  await expect(page.locator('.reference-topic mark')).toHaveCount(0);
  await expect(page.locator('.reference-topic .zf-token-property').first()).toBeVisible();
});

test('canvas guidance follows navigation, mouse, keyboard and zoom context', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const hint = page.locator('.zf-pan-hint');
  await expect(hint).toHaveText('Click Checkout to explore');
  await expect(page.locator('.zf-stage a[href="https://d2lang.com/tour/intro/"]')).toBeVisible();
  const browse = page.locator('.zf-stage [data-shape-id="Browse"]');
  await browse.hover();
  await expect(hint).toHaveText('Click to select this shape’s source');
  await page.getByRole('link', { name: 'Open checkout board', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(hint).toHaveText('Click Charge to explore');
  await page.locator('.zf-stage').focus();
  await page.keyboard.press('Home');
  await expect(hint).toContainText('Enter');
  await expect(hint).not.toContainText('Click');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(hint).toHaveText('Space + drag to pan · Scroll to zoom');
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(hint).toHaveText('Click Charge to explore');
});

test.describe('phone workspace', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('touch guidance and empty boards lead back to source without inserting text', async ({ page }) => {
    await page.goto('/'); await ready(page);
    await expect(page.locator('.zf-pan-hint')).toHaveText('Tap Checkout to explore · Pinch to zoom');
    await page.getByRole('link', { name: 'Open checkout board', exact: true }).tap();
    await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
    await page.locator('#mobile-source').tap();
    expect((await page.locator('#editor').boundingBox())!.y).toBeLessThan(260);
    await source(page).fill(''); await ready(page);
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
    await page.goto('/'); await ready(page);
    await page.locator('#mobile-source').click();
    await source(page).fill(original); await ready(page);
    await page.locator('#ai-assistant > summary').click();
    await page.locator('#ai-prompt').fill('Update node 60');
    await page.locator('#ai-send').click();
    await expect(page.locator('#ai-change-summary')).toContainText('1 source line');
    await ready(page);
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
    await ready(page);
    expect(await source(page).innerText()).toContain('Node 60');
    await expect(page.locator('#ai-undo')).toBeHidden();
  });
});
