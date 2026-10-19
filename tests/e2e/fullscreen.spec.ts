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
    await toggle.scrollIntoViewIfNeeded();
    const before = await stage.boundingBox();
    await toggle.click();

    const exit = page.getByRole('button', { name: 'Exit fullscreen', exact: true });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    expect(await stage.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    const buttonBox = (await exit.boundingBox())!;
    expect(viewport.width - buttonBox.x - buttonBox.width).toBe(12);
    expect(viewport.height - buttonBox.y - buttonBox.height).toBe(12);
    for (const selector of ['header', 'footer', '#source-pane', '#d2-reference', '#reference-divider', '.zf-breadcrumbs', '.zf-message']) {
      await expect(page.locator(selector)).toBeHidden();
    }
    await page.keyboard.press('Control+/');
    await expect(exit).toBeFocused();
    await exit.click();

    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await stage.boundingBox()).toEqual(before);
    await expect(page.locator('#source-pane')).toBeVisible();
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
  await stage.locator('a[href="root.layers.checkout"]').click();
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
