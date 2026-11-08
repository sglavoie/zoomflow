import { selectMenuOption } from './menu';
import { expect, test } from '@playwright/test';
import { previewReady } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ available: true }) }));
});

test('opening Ask AI before the app starts still checks availability', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/src\/index\.ts/, async (route) => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await page.locator('#ai-assistant > summary').click();
  release();
  await expect(page.locator('#ai-availability')).toHaveText('Claude Code is ready on this computer.');
  await expect(page.locator('#ai-prompt')).toBeEnabled();
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
  await page.goto('/'); await previewReady(page);
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  // Blank keeps the server's own CLAUDE_CONFIG_DIR, or ~/.claude.
  await expect(page.locator('#ai-claude-config-dir')).toHaveValue('');
  await expect(page.locator('#ai-claude-config-dir')).toHaveAttribute('placeholder', /~\/\.claude/);
  await page.locator('#ai-claude-config-dir').fill('~/work-claude');
  await page.locator('#ai-environment').fill('TEST_VALUE=claude');
  await page.getByRole('textbox', { name: 'Ask AI about this diagram' }).fill('Explain this board');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toHaveText('No change needed.');
});

test('AI settings and unfinished prompts survive reload, including edits before blur and cleared fields', async ({ page }) => {
  const checks: Record<string, unknown>[] = [];
  await page.route('**/api/ai/status', route => {
    if (route.request().method() === 'POST') checks.push(route.request().postDataJSON());
    return route.fulfill({ json: { available: true } });
  });
  const openSettings = async () => {
    for (const selector of ['#ai-assistant', '#ai-form .ai-settings']) {
      if (!await page.locator(selector).evaluate((node: HTMLDetailsElement) => node.open)) {
        await page.locator(`${selector} > summary`).click();
      }
    }
  };
  await page.goto('/'); await previewReady(page);
  await openSettings();
  await page.locator('#ai-environment').fill('TEST_VALUE=one=two\nEMPTY=\n');
  await page.locator('#ai-full-access').check();
  await page.locator('#ai-working-directory').fill('~/projects/my project');
  await page.locator('#ai-prompt').fill('An unfinished\nquestion');
  await page.locator('#ai-claude-config-dir').fill('~/.claude-personal');
  // Reload while the config field still has focus: change/blur has not fired.
  await page.reload(); await previewReady(page);
  await openSettings();
  await expect(page.locator('#ai-claude-config-dir')).toHaveValue('~/.claude-personal');
  await expect(page.locator('#ai-environment')).toHaveValue('TEST_VALUE=one=two\nEMPTY=\n');
  await expect(page.locator('#ai-prompt')).toHaveValue('An unfinished\nquestion');
  await expect(page.locator('#ai-full-access')).not.toBeChecked();
  await page.locator('#ai-full-access').check();
  await expect(page.locator('#ai-working-directory')).toHaveValue('~/projects/my project');
  await expect.poll(() => checks.at(-1)).toMatchObject({ provider: 'claude', claudeConfigDir: '~/.claude-personal',
    environment: 'TEST_VALUE=one=two\nEMPTY=\n' });
  await page.locator('#ai-provider').selectOption('codex');
  await page.locator('#ai-prompt').fill('');
  await page.locator('#ai-environment').fill('');
  await page.reload(); await previewReady(page);
  await openSettings();
  await expect(page.locator('#ai-provider')).toHaveValue('codex');
  await expect(page.locator('#ai-claude-config')).toBeHidden();
  await expect(page.locator('#ai-environment')).toHaveValue('');
  await expect(page.locator('#ai-prompt')).toHaveValue('');
  await page.locator('#ai-provider').selectOption('claude');
  await expect(page.locator('#ai-claude-config-dir')).toHaveValue('~/.claude-personal');
});

test('reload restores shared AI settings from the second pane and keeps each unfinished prompt separate', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-start-empty-b').click(); await previewReady(page, 'b');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('#ai-assistant-b > summary').click();
  await page.locator('#ai-prompt').fill('First pane question');
  await page.locator('#ai-prompt-b').fill('Second pane question');
  await page.locator('#ai-form-b .ai-settings summary').click();
  await page.locator('#ai-environment-b').fill('FROM_SECOND=yes');
  await page.locator('#ai-claude-config-dir-b').fill('~/.claude-second');
  await page.reload(); await previewReady(page); await previewReady(page, 'b');
  for (const suffix of ['', '-b']) {
    await expect(page.locator(`#ai-environment${suffix}`)).toHaveValue('FROM_SECOND=yes');
    await expect(page.locator(`#ai-claude-config-dir${suffix}`)).toHaveValue('~/.claude-second');
  }
  await expect(page.locator('#ai-prompt')).toHaveValue('First pane question');
  await expect(page.locator('#ai-prompt-b')).toHaveValue('Second pane question');
});

test('Full access sends its working directory only once switched on', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/ai', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ reply: 'No change needed.', source: null }) });
  });
  await page.goto('/'); await previewReady(page);
  await page.locator('#ai-assistant > summary').click();
  await page.locator('.ai-settings summary').click();
  await expect(page.locator('#ai-working-directory')).toBeHidden();
  const prompt = page.getByRole('textbox', { name: 'Ask AI about this diagram' });
  await prompt.fill('Explain this board');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#ai-status')).toHaveText('No change needed.');
  await page.getByLabel('Full access (bypass permissions)').check();
  await page.locator('#ai-working-directory').fill('~/projects/example');
  await prompt.fill('Summarize the latest features');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.fullAccess).toBe(false);
  expect(requests[1]).toMatchObject({ fullAccess: true, workingDirectory: '~/projects/example' });
});

test('mirrored AI settings check availability once per change', async ({ page }) => {
  const checks: string[] = [];
  await page.route('**/api/ai/status', async (route) => {
    if (route.request().method() === 'POST') checks.push(route.request().postDataJSON().provider);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) });
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/'); await previewReady(page);
  await selectMenuOption(page, '#layout', 'quad');
  await page.locator('#pane-start-empty-b').click(); await previewReady(page, 'b');
  await page.locator('#ai-assistant > summary').click();
  await page.locator('#ai-assistant-b > summary').click();
  await expect(page.locator('#ai-availability-b')).toContainText('ready');
  await expect(page.locator('#ai-availability')).toContainText('ready');
  checks.length = 0;
  await page.locator('#ai-form .ai-settings summary').click();
  await page.locator('#ai-provider').selectOption('codex');
  await expect(page.locator('#ai-availability')).toContainText('Codex is ready');
  await expect(page.locator('#ai-availability-b')).toContainText('Codex is ready');
  expect(checks).toEqual(['codex']);
});

test('AI availability is checked only once the panel first opens', async ({ page }) => {
  const methods: string[] = [];
  await page.route('**/api/ai/status', (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: { available: true } });
  });
  await page.goto('/'); await previewReady(page);
  // Settings changed while the panel is closed wait for it to open.
  await page.locator('#ai-provider').evaluate((select: HTMLSelectElement) => {
    select.value = 'codex';
    select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  expect(methods).toEqual([]);
  await page.locator('#ai-assistant > summary').click();
  await expect(page.locator('#ai-availability')).toContainText('Codex is ready');
  // The endpoint probe runs once per page; the provider check follows it.
  expect(methods).toEqual(['GET', 'POST']);
});
