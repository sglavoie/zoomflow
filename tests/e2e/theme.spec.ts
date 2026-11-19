import { expect, test } from '@playwright/test';
import { previewReady, openView } from './helpers';
import { download } from './export-helpers';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

for (const width of [320, 390, 1280]) test(`theme buttons override the system and remember the selection at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await previewReady(page); await openView(page);
  const theme = page.getByRole('group', { name: 'Theme', exact: true, includeHidden: true });
  const light = theme.getByRole('button', { name: 'Light', exact: true, includeHidden: true });
  const dark = theme.getByRole('button', { name: 'Dark', exact: true, includeHidden: true });
  const system = theme.getByRole('button', { name: 'System', exact: true, includeHidden: true });
  const root = page.locator('html');
  for (const button of [light, dark, system]) await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');
  const background = () => page.locator('.zf-stage svg rect').first().evaluate(rect => getComputedStyle(rect).fill);
  const lightBackground = await background();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(background).not.toBe(lightBackground);
  await light.focus();
  await page.keyboard.press('Enter');
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect.poll(background).toBe(lightBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await previewReady(page); await openView(page);
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');

  await page.emulateMedia({ colorScheme: 'light' });
  await openView(page);
  await dark.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(theme.locator('[aria-pressed="true"]')).toHaveText('Dark');
  await expect.poll(background).not.toBe(lightBackground);
  await openView(page);
  await system.focus();
  await page.keyboard.press('Space');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await previewReady(page); await openView(page);
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
});

test('an invalid saved theme falls back to System', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zoomflow.theme', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await previewReady(page); await openView(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme button[aria-pressed="true"]')).toHaveText('System');
});

test('keeps AA contrast for theme tokens in both themes', async ({ page }, info) => {
  await page.goto('/'); await previewReady(page);
  const report = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const ratios = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const color = (token: string) => {
        probe.style.color = `var(--${token})`;
        return getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number);
      };
      const over = (fg: number[], bg: number[]) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
      const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const rows: { ink: string; background: string; ratio: number; minimum: number }[] = [];
      const check = (ink: string, background: string[], minimum = 4.5) => {
        const bg = background.reduce((base, token) => over(color(token), base), [255, 255, 255]);
        const a = luminance(over(color(ink), bg)); const b = luminance(bg);
        rows.push({ ink, background: background.join(' + '), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum });
      };
      for (const bg of ['page', 'surface', 'stage']) {
        for (const ink of ['text', 'muted', 'subtle', 'accent', 'danger', 'danger-text']) check(ink, [bg]);
        for (const ink of ['focus', 'control-border', 'grip']) check(ink, [bg], 3);
      }
      for (const bg of ['hover', 'hover-subtle', 'accent-soft', 'accent-surface', 'code-surface', 'active-line']) {
        for (const ink of ['text', 'muted', 'subtle', 'accent']) check(ink, ['surface', bg]);
      }
      check('on-accent', ['accent']); check('on-accent', ['accent-hover']);
      check('on-drop-overlay', ['surface', 'drop-overlay']);
      check('danger-text', ['danger-surface']); check('danger', ['danger-surface']);
      check('detail-accent', ['zf-badge-surface']); check('detail-accent', ['surface'], 3);
      check('mark-ink', ['mark-surface']); check('zf-badge-ink', ['zf-badge-surface']);
      for (const ink of ['warning', 'token-ai-changed-edge', 'token-source-selected']) check(ink, ['surface'], 3);
      for (const ink of ['token-comment', 'token-string', 'token-keyword', 'token-property', 'token-variable', 'token-url', 'token-number', 'token-operator', 'token-punctuation']) {
        for (const bg of [[], ['active-line'], ['selection'], ['token-ai-changed']]) check(ink, ['surface', ...bg]);
      }
      if (document.documentElement.dataset.theme === 'dark') for (const gradient of document.querySelectorAll('linearGradient[id^="zf-lit-"]')) {
        for (const stop of gradient.querySelectorAll('stop')) {
          const fill = getComputedStyle(stop).stopColor.match(/[\d.]+/g)!.map(Number);
          const a = luminance(color('text')); const b = luminance(fill);
          rows.push({ ink: 'text', background: gradient.id + ' ' + stop.getAttribute('offset'), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum: 4.5 });
        }
      }
      probe.remove(); return rows;
    });
    report.push({ theme, ratios });
  }
  await info.attach('theme-contrast', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const failures = report.flatMap(({ theme, ratios }) => ratios.filter(row => row.ratio < row.minimum).map(row => ({ theme, ...row })));
  expect(failures).toEqual([]);
});


test('matches viewer lighting offline and keeps downloaded images flat', async ({ page, browser }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await previewReady(page);
  const appearance = () => {
    const stage = document.querySelector('.zf-stage')!;
    const probe = document.createElement('span'); document.body.append(probe);
    const token = (name: string) => {
      probe.style.color = `var(--${name}, var(--zf-${name}))`;
      return getComputedStyle(probe).color;
    };
    const colors = {
      page: token('page'), surface: token('surface'), text: token('text'), muted: token('muted'),
      focus: token('focus'), control: token('control-border'), accent: token('accent'), onAccent: token('on-accent'),
      detail: token('detail-accent'), danger: token('danger'), badge: token('zf-badge-surface'),
      stage: getComputedStyle(stage).backgroundColor,
      paint: getComputedStyle(stage.querySelector('.zf-filled > .shape > [fill="#e9f0fa"]')!).fill.replace(/url\("[^"#]+#/, 'url("#'),
      edge: getComputedStyle(stage.querySelector('path.connection')!).stroke,
      stops: [...stage.querySelectorAll('linearGradient[id^="zf-lit-"]')].map(gradient => ({
        id: gradient.id, colors: [...gradient.querySelectorAll('stop')].map(stop => getComputedStyle(stop).stopColor),
      })),
    };
    probe.remove(); return colors;
  };
  const offline = await browser.newContext({ offline: true, reducedMotion: 'reduce', storageState: { cookies: [], origins: [] } });
  try {
    const exported = await offline.newPage();
    const html = await download(page, 'html', info);
    await exported.goto(pathToFileURL(html).href);
    for (const theme of ['light', 'dark'] as const) {
      // Selected app theme must override the opposite system theme.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await openView(page); await page.locator(`#theme button[value="${theme}"]`).click();
      await exported.emulateMedia({ colorScheme: theme });
      const live = await page.evaluate(appearance);
      await expect.poll(() => exported.evaluate(appearance)).toEqual(live);
      expect(live.stage).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(14, 17, 29)');
      expect(live.paint).toBe(theme === 'light' ? 'rgb(237, 242, 248)' : 'url("#zf-lit-step")');
      expect(live.edge).toBe(theme === 'light' ? 'rgb(108, 134, 173)' : 'rgb(161, 187, 222)');
      const image = await download(page, 'svg', info);
      expect(await readFile(image, 'utf8')).not.toContain('zf-library-surfaces');
      const imagePage = await offline.newPage();
      await imagePage.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await imagePage.goto(pathToFileURL(image).href);
      expect(await imagePage.locator('.zf-filled > .shape > [fill="#e9f0fa"]').first().evaluate(node => getComputedStyle(node).fill))
        .toBe(theme === 'light' ? 'rgb(237, 242, 248)' : 'rgb(38, 54, 76)');
      await imagePage.close();
    }
  } finally { await offline.close(); }
});
