import { expect, test } from '@playwright/test';
import { source, previewReady, stubAiStatus } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ available: true }) }));
});

test('AI updates the current diagram and keeps the edit undoable', async ({ page }) => {
  await page.route('**/api/ai', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.provider).toBe('codex');
    expect(request.source).toContain('Checkout');
    expect(request.board).toBe('root');
    expect(request.environment).toBe('TEST_VALUE=codex');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Added a note.', source: 'note: Added by AI' }) });
  });
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  await page.getByLabel('AI', { exact: true }).selectOption('codex');
  await expect(page.locator('#ai-claude-config')).toBeHidden();
  await page.locator('#ai-environment').fill('TEST_VALUE=codex');
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Replace it with a note');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toContainText('Diagram updated. Added a note.');
  await expect(page.locator('.zf-stage')).toContainText('Added by AI');
  const source = page.getByRole('textbox', { name: 'D2 source', exact: true });
  await source.focus();
  await source.press('ControlOrMeta+z');
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
});

test('Claude config directory is visible and sent with shared environment', async ({ page }) => {
  await page.route('**/api/ai', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.provider).toBe('claude');
    expect(request.claudeConfigDir).toBe('~/work-claude');
    expect(request.environment).toBe('TEST_VALUE=claude');
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ reply: 'No change needed.', source: null }) });
  });
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  await expect(page.locator('#ai-claude-config-dir')).toHaveValue('~/.claude');
  await page.locator('#ai-claude-config-dir').fill('~/work-claude');
  await page.locator('#ai-environment').fill('TEST_VALUE=claude');
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Explain this board');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toHaveText('No change needed.');
});

test('AI errors and stale responses leave the source alone', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/ai', async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Changed it.', source: 'stale: Stale' }) });
  });
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#ai-assistant > summary').click();
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Change it');
  await page.getByRole('button', { name: 'Send' }).click();
  const source = page.getByRole('textbox', { name: 'D2 source', exact: true });
  await source.focus();
  await source.press('ControlOrMeta+a');
  await page.keyboard.insertText('fresh: Kept');
  release();
  await expect(page.locator('#ai-status')).toContainText('diagram changed while AI was working');
  await expect(page.locator('.zf-stage')).toContainText('Kept');
  await expect(page.locator('.zf-stage')).not.toContainText('Stale');
});

test('invalid AI D2 is reported without replacing the diagram', async ({ page }) => {
  await page.route('**/api/ai', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ reply: 'Changed it.', source: 'broken: {' }) }));
  await page.goto('/');
  await expect(page.locator('#viewer')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#ai-assistant > summary').click();
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Change it');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toContainText('AI returned invalid D2');
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await expect(page.getByRole('textbox', { name: 'D2 source', exact: true })).toContainText('Checkout');
});

test('CLI failures are shown beside the prompt', async ({ page }) => {
  await page.route('**/api/ai', (route) => route.fulfill({ status: 500, contentType: 'application/json',
    body: JSON.stringify({ error: 'codex is not installed or is not on the server PATH.' }) }));
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  await page.getByLabel('AI', { exact: true }).selectOption('codex');
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Add a node');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#ai-status')).toContainText('codex is not installed');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('AI availability is checked before composing a prompt and can be retried', async ({ page }) => {
  let available = false;
  await page.route('**/api/ai/status', (route) => route.fulfill({
    status: available ? 200 : 404, contentType: 'application/json', body: JSON.stringify({ available }),
  }));
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-availability')).toContainText('pnpm dev');
  await expect(page.locator('#ai-prompt')).toBeDisabled();
  await expect(page.locator('#ai-send')).toBeDisabled();
  available = true;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ai-prompt')).toBeEnabled();
  await expect(page.locator('#ai-availability')).toContainText('ready on this computer');
});

test('provider readiness follows the selected CLI and explains sign-in failures', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => {
    const provider = route.request().postDataJSON().provider;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(provider === 'codex'
        ? { available: false, reason: 'Codex is installed. Sign in with codex login.' }
        : { available: true }) });
  });
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-prompt')).toBeEnabled();
  await page.locator('.ai-settings summary').click();
  await page.getByLabel('AI', { exact: true }).selectOption('codex');
  await expect(page.locator('#ai-availability')).toContainText('Sign in with codex login');
  await expect(page.locator('#ai-send')).toBeDisabled();
  await page.getByLabel('AI', { exact: true }).selectOption('claude');
  await expect(page.locator('#ai-prompt')).toBeEnabled();
});

test('cancel keeps the prompt and ignores a late AI response', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/ai', async (route) => {
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Changed.', source: 'late: Wrong' }) }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('#ai-prompt').fill('Make a change');
  await page.locator('#ai-send').click();
  await expect(page.locator('#ai-elapsed')).toHaveText(/[1-9]\d*s elapsed/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#ai-status')).toContainText('canceled');
  release();
  await expect(page.locator('#ai-send')).toBeEnabled();
  await expect(page.locator('#ai-prompt')).toHaveValue('Make a change');
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await expect(page.getByRole('button', { name: 'Undo AI change' })).toBeHidden();
});

test('explicit AI undo restores source and is retired after subsequent edits', async ({ page }) => {
  await page.route('**/api/ai', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ reply: 'Changed.', source: 'ai: Replacement' }) }));
  await page.goto('/');
  await expect(page.locator('#preview-status')).toHaveText('Preview ready');
  await page.locator('#ai-assistant > summary').click();
  const send = async () => {
    await page.locator('#ai-prompt').fill('Replace the diagram');
    await page.locator('#ai-send').click();
    await expect(page.locator('.zf-stage')).toContainText('Replacement');
  };
  await send();
  await page.getByRole('button', { name: 'Undo AI change' }).click();
  await expect(page.locator('.zf-stage')).toContainText('Checkout');
  await send();
  await page.getByRole('textbox', { name: 'D2 source', exact: true }).fill('mine: Later edit');
  await expect(page.getByRole('button', { name: 'Undo AI change' })).toBeHidden();
  await expect(page.locator('.zf-stage')).toContainText('Later edit');
  await expect(page.locator('.zf-ai-changed')).toHaveCount(0);
});

test('AI server failures explain recovery and hide technical details initially', async ({ page }) => {
  await stubAiStatus(page);
  await page.route('**/api/ai/status', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/');
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-availability')).toContainText('pnpm dev');
  await expect(page.locator('#ai-availability')).not.toContainText('Unexpected token');
  const details = page.locator('#ai-assistant .ai-error-details');
  await expect(details.locator('pre')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('pre')).toContainText('text/html');
  await page.route('**/api/ai/status', route => route.fulfill({ json: { available: true } }));
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('#ai-prompt')).toBeEnabled();
  await expect(details).toBeHidden();
});

test('AI availability timeouts offer a retry without exposing abort exceptions', async ({ page }) => {
  await stubAiStatus(page);
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/status', async route => { await gate; await route.fulfill({ json: { available: true } }); });
  try {
    await page.goto('/');
    await page.locator('#ai-assistant > summary').click();
    await page.clock.fastForward(6000);
    await expect(page.locator('#ai-availability')).toContainText('timed out');
    await expect(page.locator('#ai-availability')).not.toContainText('AbortError');
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  } finally { release(); }
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
  await page.locator('#editor').evaluate(async el => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    const from = view.state.doc.toString().indexOf('Kept');
    view.dispatch({ selection: { anchor: from, head: from + 4 } });
  });
  await page.locator('#ai-assistant > summary').click();
  const send = async () => {
    await page.locator('#ai-prompt').fill('Update the outer nodes'); await page.locator('#ai-send').click();
    await expect(page.locator('#ai-status')).toContainText('Diagram updated.');
    await expect(page.locator('.zf-ai-changed')).toHaveText(['a: Updated', 'c: Changed']);
    await expect(page.locator('#ai-change-summary')).toHaveText('Changes at 2 source lines.');
  };
  await send();
  const selected = await page.locator('#editor').evaluate(async el => {
    const path = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ path);
    const view = EditorView.findFromDOM(el.querySelector('.cm-editor')!)!;
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  });
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
