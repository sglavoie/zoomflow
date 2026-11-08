import { expect, test } from '@playwright/test';
import { source, previewReady, stubAiStatus, selectSource, withEditorView } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ available: true }) }));
});

test('phone composer keeps prompt and Send or Cancel together, with settings reachable below', async ({ page }) => {
  await stubAiStatus(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai', async route => {
    await gate;
    await route.fulfill({ json: { source: null, reply: 'Done.' } }).catch(() => {});
  });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-provider')).toBeHidden();
  for (const size of [{ width: 390, height: 640 }, { width: 390, height: 450 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.body.clientHeight)).toBe(size.height);
    await expect.poll(async () => {
      const tools = (await page.locator('.source-tools').boundingBox())!;
      const prompt = (await page.locator('#ai-prompt').boundingBox())!;
      const send = (await page.locator('#ai-send').boundingBox())!;
      return prompt.y >= tools.y && send.y >= tools.y && Math.max(prompt.y + prompt.height, send.y + send.height) <= tools.y + tools.height;
    }).toBe(true);
    const editor = (await page.locator('#editor').boundingBox())!;
    expect(editor.height).toBeGreaterThanOrEqual(79);
    expect(editor.y + editor.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.locator('#ai-prompt').fill('Explain this');
  await page.locator('#ai-send').click();
  await expect(page.locator('#ai-cancel')).toBeVisible();
  await expect(page.locator('#ai-send')).toBeHidden();
  const tools = (await page.locator('.source-tools').boundingBox())!;
  const cancel = (await page.locator('#ai-cancel').boundingBox())!;
  expect(cancel.y + cancel.height).toBeLessThanOrEqual(tools.y + tools.height);
  await page.locator('#ai-cancel').click(); release();
  await expect(page.locator('#ai-prompt')).toHaveValue('Explain this');
  await page.locator('.ai-settings > summary').click();
  await page.locator('#ai-provider').selectOption('codex');
  await expect(page.locator('#ai-availability')).toContainText('Codex is ready');
});

test('AI edits highlight only changed lines, preserve selection and undo, and remain until dismissed or switching', async ({ page }) => {
  await stubAiStatus(page);
  const before = 'a: First\nb: Kept\nc: Last';
  const after = 'a: Updated\nb: Kept\nc: Changed';
  await page.route('**/api/ai', route => route.fulfill({ json: { source: after, reply: 'Updated the outer nodes.' } }));
  await page.clock.install();
  await page.goto('/'); await previewReady(page);
  await source(page).fill(before); await previewReady(page);
  await selectSource(page, 'Kept');
  await page.locator('#ai-assistant > summary').click();
  const send = async () => {
    await page.locator('#ai-prompt').fill('Update the outer nodes'); await page.locator('#ai-send').click();
    await expect(page.locator('#ai-status')).toContainText('Diagram updated.');
    await expect(page.locator('.zf-ai-changed')).toHaveText(['a: Updated', 'c: Changed']);
    await expect(page.locator('#ai-change-summary')).toHaveText('Changes at 2 source lines.');
  };
  await send();
  const selected = await withEditorView(page, view => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to));
  expect(selected).toBe('Kept');
  await page.locator('#ai-undo').click();
  await expect(source(page)).toHaveText(before, { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await send();
  await page.clock.fastForward(16_000);
  await expect(page.locator('.zf-ai-changed')).toHaveText(['a: Updated', 'c: Changed']);
  await page.locator('#ai-dismiss-highlights').click();
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await expect(page.locator('#ai-undo')).toBeVisible();
  await page.locator('#ai-undo').click(); await send();
  await page.locator('#file').setInputFiles({ name: 'other.d2', mimeType: 'text/plain', buffer: Buffer.from('other: Unrelated') });
  await expect(source(page)).toHaveText('other: Unrelated');
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
  await page.locator('#example-picker > summary').click();
  await page.getByRole('button', { name: /^Order flow/ }).click();
  await expect(source(page)).toHaveText(after, { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
});

test('AI deletions reveal their location and Undo on a short phone screen', async ({ page }) => {
  await stubAiStatus(page);
  await page.setViewportSize({ width: 390, height: 450 });
  await page.route('**/api/ai', route => route.fulfill({ json: { source: 'a: Keep\nc: Keep', reply: 'Removed the middle node.' } }));
  await page.goto('/'); await previewReady(page);
  await page.locator('#mobile-source').click();
  await source(page).fill('a: Keep\nb: Remove\nc: Keep'); await previewReady(page);
  await page.locator('#ai-assistant > summary').click();
  await page.locator('#ai-prompt').fill('Remove the middle node');
  await page.locator('#ai-send').click();
  await expect(page.locator('.zf-ai-changed')).toHaveText(['c: Keep']);
  await expect(page.locator('#ai-change-summary')).toContainText('including deletions');
  await expect.poll(async () => {
    const tools = (await page.locator('.source-tools').boundingBox())!;
    const undo = (await page.locator('#ai-undo').boundingBox())!;
    return undo.y >= tools.y && undo.y + undo.height <= tools.y + tools.height;
  }).toBe(true);
  await page.locator('#ai-undo').click();
  await expect(source(page)).toHaveText('a: Keep\nb: Remove\nc: Keep', { useInnerText: true });
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
});

test('the AI prompt sends with Command or Control+Enter', async ({ page }) => {
  const prompts: string[] = [];
  await page.route('**/api/ai', async (route) => {
    prompts.push(route.request().postDataJSON().prompt);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'It shows checkout.', source: null }) });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#ai-assistant > summary').click();
  const prompt = page.getByRole('textbox', { name: 'Ask AI about this diagram' });
  await prompt.fill('What does this show?');
  await prompt.press('Enter');
  expect(prompts).toEqual([]);
  await prompt.press('ControlOrMeta+Enter');
  await expect(page.locator('#ai-status')).toContainText('It shows checkout.');
  expect(prompts).toEqual(['What does this show?']);
  await page.locator('#show-shortcuts').click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Send the prompt');
});

test('keyboard focus follows a request from the prompt to Cancel and back, and returns after Undo', async ({ page }) => {
  await stubAiStatus(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/ai', async (route) => {
    await gate;
    await route.fulfill({ json: { reply: 'Added a note.', source: 'note: Added by AI' } });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#ai-assistant > summary').click();
  const prompt = page.locator('#ai-prompt');
  await prompt.fill('Add a note');
  await prompt.press('ControlOrMeta+Enter');
  await expect(page.locator('#ai-cancel')).toBeFocused();
  release();
  await expect(page.locator('#ai-status')).toContainText('Diagram updated.');
  await expect(prompt).toBeFocused();
  await page.locator('#ai-undo').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-undo')).toBeHidden();
  await expect(prompt).toBeFocused();
});
