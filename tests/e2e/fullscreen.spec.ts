import { selectMenuOption } from './menu';
import { previewReady, source } from './helpers';
import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`fullscreen fills the page and restores the layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const stage = page.locator('.zf-stage');
    await expect(stage).toHaveAttribute('data-board', 'root');
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'D2 reference', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search D2 reference' }).fill('style');
    const divider = page.locator('#reference-divider');
    await divider.focus();
    await page.keyboard.press('ArrowUp');
    const split = await divider.getAttribute('aria-valuenow');
    const source = await page.locator('.cm-content').textContent();
    const toggle = page.getByRole('button', { name: 'Fullscreen', exact: true });
    if (viewport.width <= 600) await page.locator('#workspace').evaluate((node) => { node.scrollTop = 120; });
    await toggle.scrollIntoViewIfNeeded();
    const before = await stage.boundingBox();
    const workspaceScroll = await page.locator('#workspace').evaluate((node) => node.scrollTop);
    await toggle.click();

    const exit = page.getByRole('button', { name: 'Exit fullscreen', exact: true });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    {
      const canvas = (await stage.boundingBox())!;
      expect(canvas.width).toBe(viewport.width - 16);
      // Contextual guidance occupies a bounded row above the bottom toolbar.
      expect(canvas.height).toBeGreaterThan(viewport.height - 120);
      expect((await exit.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    }
    const buttonBox = (await exit.boundingBox())!;
    expect(viewport.width - buttonBox.x - buttonBox.width).toBe(8);
    expect(viewport.height - buttonBox.y - buttonBox.height).toBeLessThanOrEqual(16);
    for (const selector of ['header', 'footer', '#source-pane', '#d2-reference', '#reference-divider', '.zf-breadcrumbs', '.zf-message']) {
      await expect(page.locator(selector)).toBeHidden();
    }
    await page.keyboard.press('Control+Shift+/');
    await expect(exit).toBeFocused();
    await exit.click();

    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await stage.boundingBox()).toEqual(before);
    expect(await page.locator('#workspace').evaluate((node) => node.scrollTop)).toBe(workspaceScroll);
    if (viewport.width > 600) await expect(page.locator('#source-pane')).toBeVisible();
    else {
      await expect(page.locator('#mobile-preview')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#mobile-source').click();
      await expect(page.locator('#source-pane')).toBeVisible();
      await page.locator('#mobile-preview').click();
    }
    await expect(page.locator('#d2-reference')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search D2 reference' })).toHaveValue('style');
    await expect(divider).toHaveAttribute('aria-valuenow', split!);
    expect(await page.locator('.cm-content').textContent()).toBe(source);
  });
}

test('fullscreen survives board navigation and Escape exits without navigating up', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await stage.locator('a[data-board="root.layers.checkout"]').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeFocused();
  await expect(page.locator('#d2-reference')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-board', 'root');
});

test('nested board content stays centered with its own background', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const stage = page.locator('.zf-stage');
  await expect(stage).toHaveAttribute('data-board', 'root');
  await selectMenuOption(page, '#theme', 'dark');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();

  const assertBoard = async () => {
    await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
    const geometry = await stage.evaluate((element) => {
      const background = element.querySelector<SVGRectElement>('svg svg > rect')!;
      const stageRect = element.getBoundingClientRect();
      const shapes = [...element.querySelectorAll('[data-shape-id]')].map((shape) => shape.getBoundingClientRect());
      return {
        dx: (Math.min(...shapes.map((shape) => shape.left)) + Math.max(...shapes.map((shape) => shape.right))) / 2 -
          (stageRect.x + stageRect.width / 2),
        dy: (Math.min(...shapes.map((shape) => shape.top)) + Math.max(...shapes.map((shape) => shape.bottom))) / 2 -
          (stageRect.y + stageRect.height / 2),
        stageFill: getComputedStyle(element).backgroundColor,
        boardFill: getComputedStyle(background).fill,
      };
    });
    expect(Math.abs(geometry.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.dy)).toBeLessThanOrEqual(2);
    expect(geometry.stageFill).toBe(geometry.boardFill);
  };

  await stage.locator('a[data-board="root.layers.checkout"]').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout');
  await assertBoard();
  await stage.locator('a[data-board="root.layers.checkout.layers.charge"]').click();
  await expect(stage).toHaveAttribute('data-board', 'root.layers.checkout.layers.charge');
  await assertBoard();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await selectMenuOption(page, '#theme', 'light');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await assertBoard();
});

test('Escape cancels an open confirmation before it exits fullscreen', async ({ page }) => {
  await page.addInitScript(() => {
    const disk = { text: 'disk: Original', modified: 1 };
    (window as any).disk = disk;
    (window as any).showOpenFilePicker = async () => [{ kind: 'file', name: 'shared.d2',
      getFile: async () => new File([disk.text], 'shared.d2', { type: 'text/plain', lastModified: disk.modified }),
      createWritable: async () => ({ write: async (text: string) => { disk.text = text; disk.modified++; }, close: async () => {}, abort: async () => {} }) }];
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#file').click();
  await expect(page.locator('#filename')).toHaveText('shared.d2'); await previewReady(page);
  await source(page).fill('disk: Mine');
  await page.evaluate(() => { (window as any).disk.modified = 99; });
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.locator('#pane-a')).toHaveAttribute('data-fullscreen', '');
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: 'File changed on disk — overwrite?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#pane-a')).toHaveAttribute('data-fullscreen', '');
  expect(await page.evaluate(() => (window as any).disk.text)).toBe('disk: Original');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pane-a')).not.toHaveAttribute('data-fullscreen');
});
