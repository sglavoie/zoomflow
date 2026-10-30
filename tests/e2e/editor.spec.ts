import { expect, test, type Page } from '@playwright/test';
import { selectMenuOption } from './menu';
import { d2Module, source, previewReady, stubAiStatus, editorText, withEditorView } from './helpers';

async function ready(page: Page, id = 'root') {
  await expect(page.locator('.zf-stage')).toHaveAttribute('data-board', id);
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
}
async function replace(page: Page, text: string) {
  await source(page).focus();
  await source(page).press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
async function findSource(page: Page, text: string) {
  await source(page).focus();
  await source(page).press('ControlOrMeta+f');
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
  await page.locator('.zf-stage a[data-board="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  const before = await page.locator('.zf-stage').innerHTML();
  await source(page).focus();
  await source(page).press('ControlOrMeta+End');
  // Appending by keyboard exercises CodeMirror input and the debounce path.
  await page.keyboard.insertText('\nbroken: {');
  await expect(page.locator('#compile-error')).toContainText('maps must be terminated');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible();
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
  expect(await page.locator('.zf-stage').innerHTML()).toBe(before);
  await ready(page, 'root.layers.checkout');
  // Editing keys must stay inside CodeMirror, even while a nested board is open.
  await source(page).press('Backspace');
  await source(page).press('Escape');
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

test('explicit reveal opens the selected source board, linked shapes still drill, and file loading replaces editor text', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await findSource(page, 'Capture');
  await ready(page);
  await source(page).press('ControlOrMeta+Shift+Enter');
  await ready(page, 'root.layers.checkout.layers.charge');
  await expect(page.locator('.zf-stage [data-shape-id="Capture"]')).toHaveClass(/zf-source-selected/);
  await source(page).focus();
  await page.keyboard.insertText('Captured');
  await expect(page.locator('.zf-stage [data-shape-id="Captured"]')).toBeVisible();
  await ready(page, 'root.layers.checkout.layers.charge');
  await page.getByRole('button', { name: 'Root', exact: true }).click();
  await ready(page);
  const checkout = page.locator('.zf-stage a[data-board="root.layers.checkout"]');
  await checkout.click({ modifiers: ['Alt'] });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Checkout');
  await ready(page);
  await checkout.click();
  await ready(page, 'root.layers.checkout');
  await page.locator('#file').setInputFiles({ name: 'new.d2', mimeType: 'text/plain', buffer: Buffer.from('new: New document') });
  await expect(source(page)).toHaveText('new: New document');
  await expect(page.locator('.zf-stage')).toContainText('New document');
  await ready(page);
});

test('source clicks open boards from root and from undimmed nested source', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await replace(page, `home: Root shape
layers.outer: {
  node: Outer shape
  layers.inner: {
    # Inner board comment

    leaf: Inner shape
  }
}`);
  await previewReady(page);
  const lines = source(page).locator('.cm-line');
  const home = lines.filter({ hasText: 'home: Root shape' }).getByText('home', { exact: true });
  await expect(source(page).locator('.zf-outside-board')).toHaveCount(0);
  await lines.filter({ hasText: 'layers.outer: {' }).click();
  await ready(page, 'root.layers.outer');
  const inner = lines.filter({ hasText: 'layers.inner: {' });
  await expect(inner).not.toHaveClass(/zf-outside-board/);
  await inner.click();
  await ready(page, 'root.layers.outer.layers.inner');
  for (const target of [
    lines.filter({ hasText: '# Inner board comment' }),
    lines.filter({ hasText: /^$/ }),
    lines.filter({ hasText: 'leaf: Inner shape' }).getByText('leaf', { exact: true }),
  ]) {
    await home.click();
    await ready(page);
    await expect(page.locator('.zf-stage [data-shape-id="home"]')).toHaveClass(/zf-source-selected/);
    await expect(source(page).locator('.zf-outside-board')).toHaveCount(0);
    await target.click();
    await ready(page, 'root.layers.outer.layers.inner');
    await expect(source(page)).toBeFocused();
  }
  await expect(page.locator('.zf-stage [data-shape-id="leaf"]')).toHaveClass(/zf-source-selected/);
});

test('clicking dimmed source focuses its board and keeps the editor cursor and viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/'); await previewReady(page);
  const text = `${'# Root documentation\n'.repeat(40)}home: Root shape {link: layers.first}
layers.first: {
  first: First board
  layers.deep: {
    # Deep board comment
    leaf: Nested leaf
  }
}
layers.second: {
  # Second board comment

  second: Second board
}
# Root footer`;
  await replace(page, text); await previewReady(page);
  await page.locator('.zf-stage a[data-board="root.layers.first"]').click();
  await ready(page, 'root.layers.first');
  const lines = source(page).locator('.cm-line');
  const header = lines.filter({ hasText: 'layers.second: {' });
  await expect(header).toHaveClass(/zf-outside-board/);
  // A click must work even when it leaves the cursor at its existing position.
  await withEditorView(page, (view, _, text) => {
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) } });
    view.focus();
  }, 'layers.second: {');
  await header.click({ position: { x: 2, y: 5 } });
  await ready(page, 'root.layers.second');
  await expect(header).not.toHaveClass(/zf-outside-board/);
  await expect(source(page)).toBeFocused();
  const cursor = await withEditorView(page, view => view.state.selection.main.head);
  expect(cursor).toBeGreaterThanOrEqual(text.indexOf('layers.second: {'));
  expect(cursor).toBeLessThanOrEqual(text.indexOf('layers.second: {') + 'layers.second: {'.length);
  const scroll = await page.locator('#editor .cm-scroller').evaluate(el => el.scrollTop);

  // Comments and whitespace have no shape source mapping; nested blocks win over their parents.
  await lines.filter({ hasText: '# Deep board comment' }).click();
  await ready(page, 'root.layers.first.layers.deep');
  await expect(page.locator('.zf-stage')).toContainText('Nested leaf');
  await lines.filter({ hasText: 'first: First board' }).getByText('first', { exact: true }).click();
  await ready(page, 'root.layers.first');
  await expect(page.locator('.zf-stage [data-shape-id="first"]')).toHaveClass(/zf-source-selected/);
  await lines.filter({ hasText: /^$/ }).click();
  await ready(page, 'root.layers.second');
  await lines.filter({ hasText: /^ {2}}$/ }).click();
  await ready(page, 'root.layers.first.layers.deep');
  await lines.filter({ hasText: '# Root footer' }).click();
  await ready(page);
  await expect(source(page)).toBeFocused();
  await expect(source(page).locator('.zf-outside-board')).toHaveCount(0);
  expect(await page.locator('#editor .cm-scroller').evaluate(el => el.scrollTop)).toBe(scroll);
  expect(await editorText(page)).toBe(text);
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
  return editorText(page);
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
  await page.locator('.zf-stage a[data-board="root.layers.checkout"]').click();
  await ready(page, 'root.layers.checkout');
  await page.locator('.zf-stage a[data-board="root.layers.checkout.layers.charge"]').click();
  await ready(page, 'root.layers.checkout.layers.charge');
  await page.locator('.zf-stage a[data-board="root.layers.checkout.layers.charge.layers.capture"]').click();
  await ready(page, 'root.layers.checkout.layers.charge.layers.capture');
  await expect(page.locator('.zf-stage')).toContainText('New again');
  await source(page).focus();
  await source(page).press('ControlOrMeta+z');
  expect(await editorSource(page)).toBe(misaligned);
  await source(page).press('Shift+Alt+f');
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
  await page.route(d2Module, async (route) => {
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

test('D2 syntax tokens remain visible in light and dark themes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor .zf-token-comment').first()).toBeVisible();
  await expect(page.locator('#editor .zf-token-keyword').first()).toBeVisible();
  await expect(page.locator('#editor .zf-token-property').first()).toBeVisible();
  await expect(page.locator('#editor .zf-token-url').first()).toBeVisible();
  await expect(page.locator('#editor .zf-token-operator').first()).toBeVisible();
  const light = await page.locator('#editor .zf-token-comment').first().evaluate((node) => getComputedStyle(node).color);
  await selectMenuOption(page, '#theme', 'dark');
  const dark = await page.locator('#editor .zf-token-comment').first().evaluate((node) => getComputedStyle(node).color);
  expect(dark).not.toBe(light);
});

test('typing indents nested D2, closing braces dedent, and layers can be folded', async ({ page }) => {
  await page.goto('/'); await previewReady(page);
  await source(page).fill('layers: {');
  await source(page).press('End'); await source(page).press('Enter');
  await source(page).pressSequentially('detail: {');
  await source(page).press('Enter');
  await source(page).pressSequentially('a: Nested');
  // CodeMirror already inserted the inner closing brace. Continue after it.
  await source(page).press('ArrowDown'); await source(page).press('End');
  await source(page).press('Enter'); await source(page).pressSequentially('}');
  await expect(source(page)).toHaveText('layers: {\n  detail: {\n    a: Nested\n  }\n}', { useInnerText: true });
  await previewReady(page);
  await source(page).press('ControlOrMeta+Home');
  // BracketLeft makes Playwright report the shifted key ({), as a real keyboard does.
  await source(page).press(process.platform === 'darwin' ? 'Meta+Alt+[' : 'Control+Shift+BracketLeft');
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
  await page.locator('.cm-foldPlaceholder').click();
  await expect(source(page)).toContainText('a: Nested');
});

test('format preserves selection, cursor and scroll inside a large edited document', async ({ page }) => {
  await stubAiStatus(page);
  await page.goto('/'); await previewReady(page);
  const text = Array.from({ length: 80 }, (_, i) => `node${i}:{label:Same}`).join('\n');
  await source(page).fill(text); await previewReady(page);
  const before = await withEditorView(page, (view, EditorView) => {
    const start = view.state.doc.toString().indexOf('node50');
    view.dispatch({ selection: { anchor: start + 6, head: start }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
    view.focus();
    return view.state.doc.sliceString(start, start + 6);
  });
  // Centering first overshoots on estimated line heights, then settles after CodeMirror
  // measures them. Record the scroll position only once two readings agree.
  let scroll = -1;
  await expect.poll(async () => {
    const previous = scroll;
    scroll = await page.locator('.cm-scroller').evaluate(el => el.scrollTop);
    return scroll > 500 && scroll === previous;
  }).toBe(true);
  await source(page).press('Shift+Alt+f');
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(before);
  expect(Math.abs(await page.locator('.cm-scroller').evaluate(el => el.scrollTop) - scroll)).toBeLessThan(4);
  await source(page).press('ControlOrMeta+z');
  await expect.poll(() => editorText(page)).toBe(text);
});

test('format success returns to file state, while failures persist and later edits clear them', async ({ page }) => {
  await page.clock.install();
  await page.goto('/'); await previewReady(page);
  await source(page).fill('a:{label: Hello}'); await previewReady(page);
  await page.locator('#format-source').click();
  await expect(page.locator('#format-status')).toHaveText('Source formatted.');
  await previewReady(page);
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
  await source(page).fill('a: Repaired'); await previewReady(page);
  await expect(page.locator('#format-status')).toBeHidden();
  await expect(page.locator('#draft-status')).toBeVisible();
});

test('wrapped source retains its nesting columns after resize and edits', async ({ page }) => {
  await stubAiStatus(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await source(page).fill(`group: {\n    child: This is a long label that should wrap across several visual lines while keeping its nesting visible\n}`);
  const line = page.locator('.cm-line').filter({ hasText: 'child: This' });
  await expect(line).toHaveClass(/zf-indented-line/);
  for (const width of [390, 540]) {
    await page.setViewportSize({ width, height: 640 });
    // Compare the first non-whitespace glyph with the first glyph on each
    // wrapped row; checking CSS alone wouldn't catch a wrong text-indent.
    const rows = await line.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rows: { x: number; y: number }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.textContent!.length; i++) {
          if (/\s/.test(node.textContent![i])) continue;
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (!rows.some(row => Math.abs(row.y - r.y) < 1)) rows.push({ x: r.x, y: r.y });
        }
      }
      return rows;
    });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) expect(Math.abs(row.x - rows[0].x)).toBeLessThan(1);
  }
  await source(page).fill('plain: No indentation');
  await expect(page.locator('.zf-indented-line')).toHaveCount(0);
});
