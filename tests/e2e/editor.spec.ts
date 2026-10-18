import { expect, test, type Page } from '@playwright/test';

const sourceInput = (page: Page) => page.getByRole('textbox', { name: 'D2 source', exact: true });
async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function replace(page: Page, source: string) {
  await sourceInput(page).focus();
  await sourceInput(page).press('ControlOrMeta+a');
  await page.keyboard.insertText(source);
}
async function findSource(page: Page, text: string) {
  await sourceInput(page).click();
  await sourceInput(page).press('ControlOrMeta+f');
  const search = page.locator('.cm-search input[name="search"]');
  await page.getByLabel('match case', { exact: true }).check();
  await search.fill('');
  // CodeMirror commits search queries on keyup/change, not input alone.
  await search.pressSequentially(text);
  await search.press('Enter');
  await search.press('Escape');
}

test('live edits retain the last good render on syntax errors and recover with diagnostics cleared', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  const before = await page.locator('.zf-stage').innerHTML();
  // Focus without moving the cursor onto an arbitrary (possibly nested) shape.
  // A click in the editor intentionally navigates to that identifier's board.
  await sourceInput(page).focus();
  await sourceInput(page).press('ControlOrMeta+End');
  // Appending by keyboard exercises CodeMirror input and the debounce path.
  await page.keyboard.insertText('\nbroken: {');
  await expect(page.locator('#compile-error')).toContainText('maps must be terminated');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible();
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
  expect(await page.locator('.zf-stage').innerHTML()).toBe(before);
  await ready(page, 'root.layers.checkout');
  // Editing keys must stay inside CodeMirror, even while a nested board is open.
  await sourceInput(page).press('Backspace');
  await sourceInput(page).press('Escape');
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', 'root.layers.checkout');
  await replace(page, 'fresh: Recovered');
  await expect(page.locator('.zf-stage')).toContainText('Recovered');
  await ready(page);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
});

test('clicking shapes selects exact source and selecting source highlights the matching shape', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await replace(page, '😀: Emoji\nbox: {a: Nested}\na: Root\na -> box.a\nbeta: Beta');
  const nested = page.locator('.zf-stage [data-shape-id="box.a"]');
  await expect(nested).toBeVisible();
  await nested.click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('a');
  await expect(nested).toHaveClass(/zf-source-selected/);
  // The selected nested identifier is distinguished from the root's same name.
  await page.keyboard.insertText('renamed');
  await expect(page.locator('.zf-stage [data-shape-id="box.renamed"]')).toBeVisible();
  await findSource(page, 'beta');
  await expect(page.locator('.zf-stage [data-shape-id="beta"]')).toHaveClass(/zf-source-selected/);
  await expect(page.locator('.zf-stage [data-shape-id="a"]')).not.toHaveClass(/zf-source-selected/);
  await page.locator('.zf-stage [data-shape-id="😀"]').click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('😀');
});

test('source selection opens its board, linked shapes still drill, and file loading replaces editor text', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await findSource(page, 'Capture');
  await ready(page, 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-stage [data-shape-id="Capture"]')).toHaveClass(/zf-source-selected/);
  await page.keyboard.insertText('Captured');
  await expect(page.locator('.zf-stage [data-shape-id="Captured"]')).toBeVisible();
  await ready(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('button', { name: 'Root', exact: true }).click();
  await ready(page);
  const checkout = page.locator('.zf-stage a[href="root.layers.checkout"]');
  await checkout.click({ modifiers: ['Alt'] });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Checkout');
  await ready(page);
  await checkout.click();
  await ready(page, 'root.layers.checkout');
  await page.locator('#file').setInputFiles({ name: 'new.d2', mimeType: 'text/plain', buffer: Buffer.from('new: New document') });
  await expect(sourceInput(page)).toHaveText('new: New document');
  await expect(page.locator('.zf-stage')).toContainText('New document');
  await ready(page);
});

test('edits during compiler startup publish only the newest source', async ({ page }) => {
  await page.goto('/');
  await replace(page, 'stale: {');
  await replace(page, 'latest: Latest preview');
  await expect(page.locator('.zf-stage')).toContainText('Latest preview');
  await ready(page);
  await expect(page.locator('#compile-error')).toBeHidden();
  await expect(page.locator('.zf-stage [data-shape-id="latest"]')).toBeVisible();
});

const misaligned = `direction: right
Browse -> Checkout -> Receipt
Checkout: {link: layers.checkout}
Docs: {link: https://example.com/docs}
layers: {
  checkout: {
    direction: right
    Cart -> Charge -> Confirm
    Charge: {link: layers.charge}
    Back: {link: _}
    layers: {
      charge: {
      Capture: {link: layers.capture}
        Authorize -> Capture -> Receipt
        Back: {link: _}

        layers: {
      capture: {
        Capture -> New -> New again
        Back: {link: _}
        Capture: {link: layers.charge}
      }
    }
      }
    }
  }
}`;

// Read CodeMirror's document, including lines outside its rendered viewport.
async function editorSource(page: Page) {
  return page.locator('#editor').evaluate(async (element) => {
    const modulePath = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ modulePath);
    return EditorView.findFromDOM(element.querySelector('.cm-editor')!)!.state.doc.toString();
  });
}

test('formats nested boards with D2 rules, refreshes navigation, and supports undo and shortcut', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await replace(page, misaligned);
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  const formatted = await editorSource(page);
  expect(formatted).toContain('        Capture: {link: layers.capture}');
  expect(formatted).toContain('          capture: {\n            Capture -> New -> New again');
  expect(formatted).toContain('Docs: {link: https://example.com/docs}');
  expect(formatted).toMatch(/\n {10}}\n {8}}\n {6}}\n {4}}\n {2}}\n}\n$/);
  // Formatting triggers the normal debounced compile; aria-busy is still false
  // during that debounce, so wait for the new diagnostics before navigating.
  await expect(page.locator('#lint-summary')).not.toHaveText('Lint pending…');
  await ready(page);
  await page.locator('.zf-stage a[href="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  await page.locator('.zf-stage a[href="root.layers.checkout.layers.charge"]').click();
  await ready(page, 'root.layers.checkout.layers.charge');
  await page.locator('.zf-stage a[href="root.layers.checkout.layers.charge.layers.capture"]').click();
  await ready(page, 'root.layers.checkout.layers.charge.layers.capture');
  await expect(page.locator('.zf-stage')).toContainText('New again');
  await sourceInput(page).focus();
  await sourceInput(page).press('ControlOrMeta+z');
  expect(await editorSource(page)).toBe(misaligned);
  await sourceInput(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  expect(await editorSource(page)).toBe(formatted);
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.locator('#format-status')).toHaveText('Source is already formatted.');
});

test('format errors leave source and last good preview intact', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const before = await page.locator('.zf-stage').innerHTML();
  await replace(page, 'broken: {');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.locator('#format-status')).toContainText('Formatting failed:');
  expect(await editorSource(page)).toBe('broken: {');
  expect(await page.locator('.zf-stage').innerHTML()).toBe(before);
  await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeEnabled();
});

test('formatting during compiler startup cannot overwrite later edits', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/@d2lang_d2\.js/, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await replace(page, 'box: {\nchild\n}');
    await page.getByRole('button', { name: 'Format', exact: true }).click();
    await expect(page.locator('#format-status')).toHaveText('Formatting…');
    await replace(page, 'latest: Keep this edit');
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeEnabled();
  await expect(page.locator('.zf-stage')).toContainText('Keep this edit');
  expect(await editorSource(page)).toBe('latest: Keep this edit');
  await expect(page.locator('#format-status')).toBeHidden();
});
