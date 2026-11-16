import { deflateRawSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { board, comparesVisuals, drill, editorText, openFolder, previewReady, projectFolder, source, visualSkipReason } from './helpers';

const encode = (text: string) => deflateRawSync(text).toString('base64url');
async function clipboard(page: Page, fail = false) {
  await page.evaluate(fail => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        if (fail) throw new Error('Permission denied');
        document.documentElement.dataset.copiedLink = text;
      },
    } });
  }, fail);
}
async function copyLink(page: Page) {
  await clipboard(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Copy share link', exact: true }).click();
  await expect(page.locator('#export-status')).toHaveText('Share link copied to clipboard.');
  return (await page.locator('html').getAttribute('data-copied-link'))!;
}
const draftRecords = (page: Page) => page.evaluate(() => Object.fromEntries(
  Object.entries(localStorage).filter(([key]) => key.startsWith('zoomflow.draft.v2:'))));

test('copies a board link into a fresh context as an unsaved Shared diagram', async ({ page, browser }) => {
  await page.goto('/?pad=40');
  await previewReady(page);
  await drill(page, 'root.layers.checkout');
  const original = await editorText(page);
  const link = await copyLink(page);
  expect(new URL(link).hash).toBe('#/checkout');
  expect(new URL(link).searchParams.get('pad')).toBe('40');
  await expect(page.locator('#share-link-privacy')).toHaveText('The diagram is inside the link, so anyone with the link can read it.');
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto(link);
    await previewReady(fresh);
    await board(fresh, 'root.layers.checkout');
    expect(await editorText(fresh)).toBe(original);
    await expect(fresh.locator('#document-title')).toHaveText('Shared diagram');
    await expect(fresh.locator('#document-unsaved')).toBeVisible();
    expect(new URL(fresh.url()).searchParams.has('d')).toBe(false);
    expect(new URL(fresh.url()).searchParams.get('pad')).toBe('40');
  } finally { await context.close(); }
});

test('opening and reopening a link leaves every existing draft record untouched', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await page.locator('#file').setInputFiles({ name: 'Shared diagram.d2', mimeType: 'text/plain', buffer: Buffer.from('old: Existing draft') });
  await previewReady(page);
  await source(page).fill('old: Unsaved existing draft');
  await previewReady(page);
  await expect.poll(async () => JSON.stringify(await draftRecords(page))).toContain('Unsaved existing draft');
  for (let visit = 0; visit < 2; visit++) {
    const before = await draftRecords(page);
    await page.goto(`/?d=${encode('new: 日本語 café 🚀')}`);
    await previewReady(page);
    expect(await editorText(page)).toBe('new: 日本語 café 🚀');
    await expect(page.locator('.zf-stage')).toContainText('日本語 café 🚀');
    const after = await draftRecords(page);
    for (const [key, value] of Object.entries(before)) expect(after[key]).toBe(value);
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);
  }
});

test('folder projects and oversized source explain the export alternatives', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  // Incompressible comments keep compilation small while making the encoded URL too long.
  const noise = Array.from({ length: 1400 }, (_, i) => `# ${i} ${Math.imul(i + 123, 2654435761) >>> 0}`).join('\n');
  await source(page).fill(`a -> b\n${noise}`);
  await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('#share-link-hint')).toHaveText('This link exceeds 8,000 characters. Choose Interactive diagram (HTML) above.');
  await expect(page.locator('#copy-share-link')).toBeDisabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await openFolder(page, projectFolder);
  await previewReady(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('#share-link-hint')).toHaveText('A folder project cannot be shared as a link. Choose Interactive atlas (HTML) above.');
  await expect(page.locator('#copy-share-link')).toBeDisabled();
});

test('malformed and truncated links show an error and the normal starting diagram', async ({ page }) => {
  for (const data of ['invalid!', encode('a -> b').slice(0, -2), '']) {
    await page.goto(`/?pad=40&d=${data}`);
    await previewReady(page);
    await expect(page.locator('#file-status')).toHaveText('Could not open share link: the diagram data is invalid or incomplete.');
    await expect(page.locator('#document-title')).toHaveText('Order flow');
    await board(page, 'root');
    expect(new URL(page.url()).search).toBe('?pad=40');
  }
});

test('decoded source uses normal compiler errors and remains editable', async ({ page }) => {
  const broken = 'broken: {';
  await page.goto(`/?d=${encode(broken)}`);
  await expect(page.locator('#document-title')).toHaveText('Shared diagram');
  await expect(page.locator('#compile-error')).toBeVisible();
  expect(await editorText(page)).toBe(broken);
  await expect(page.locator('#file-status')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('d')).toBe(false);
  await source(page).fill('fixed: Repaired shared source');
  await previewReady(page);
  await expect(page.locator('.zf-stage')).toContainText('Repaired shared source');
});

test('clipboard failure is visible and a subsequent copy can succeed', async ({ page }) => {
  await page.goto('/');
  await previewReady(page);
  await clipboard(page, true);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('#copy-share-link').click();
  await expect(page.locator('#export-status')).toHaveText('Could not copy share link. Check clipboard permission and try again.');
  await clipboard(page);
  await page.locator('#copy-share-link').click();
  await expect(page.locator('#export-status')).toHaveText('Share link copied to clipboard.');
});

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`share panel ${theme} ${width}`, { tag: '@visual' }, async ({ page, browserName }) => {
    test.skip(!comparesVisuals(browserName), visualSkipReason);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    await previewReady(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.locator('#copy-share-link')).toBeEnabled();
    await page.locator('#copy-share-link').scrollIntoViewIfNeeded();
    await expect(page.locator('#header-more-content')).toHaveScreenshot(`share-panel-${theme}-${width}.png`);
  });
}
