import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium } from '@playwright/test';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = resolve(repo, 'packages/cli/bin/zoomflow.mjs');
let temp: string;
beforeAll(async () => {
  await exec(process.execPath, ['packages/cli/build.mjs'], { cwd: repo });
  temp = await mkdtemp(join(tmpdir(), 'zoomflow-cli-test-'));
});
afterAll(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

async function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    const result = await exec(process.execPath, [cli, ...args], { cwd: repo, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, ...options });
    return { ...result, code: 0 };
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string; killed?: boolean };
    if (failure.killed || typeof failure.code !== 'number') throw error;
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
function success(result: Awaited<ReturnType<typeof run>>) { expect(result.code, result.stderr).toBe(0); }

it.each(['labelled', 'dotted', 'imported'])('lints the real %s fixture with stdlib and local imports', async (name) => {
  const result = await run(['lint', `fixtures/lint/${name}.d2`, '--boundary-ports', '--json']);
  success(result);
  expect(JSON.parse(result.stdout)).toMatchObject({ diagnostics: [], boundaryPairsEvaluated: 2 });
});

it('returns a non-zero process exit for boundary and dangling-link errors', async () => {
  for (const [name, rule] of [['mismatched', 'boundary-in'], ['navigation', 'dangling-link']]) {
    const result = await run(['lint', `fixtures/lint/${name}.d2`, '--boundary-ports']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`error ${rule}`);
  }
});

it('keeps warnings successful and makes backlink checking opt-in', async () => {
  const input = join(temp, 'warnings.d2');
  await writeFile(input, 'layers: { unused: {x} }');
  const ordinary = await run(['lint', input, '--json']);
  success(ordinary);
  expect(JSON.parse(ordinary.stdout).diagnostics.map((d: { rule: string }) => d.rule)).toEqual(['orphan-board']);
  const backlinks = await run(['lint', input, '--missing-backlink', '--json']);
  success(backlinks);
  expect(JSON.parse(backlinks.stdout).diagnostics.map((d: { rule: string }) => d.rule)).toEqual(['orphan-board', 'missing-backlink']);
});

it.each(['svg', 'png'])('exports all fixture boards as genuine %s in a ZIP', async (format) => {
  const output = join(temp, `order-${format}.zip`);
  success(await run(['export', 'fixtures/order.d2', '--all', '--format', format, '-o', output]));
  const files = unzipSync(await readFile(output));
  expect(Object.keys(files)).toEqual([`root.${format}`, `checkout.${format}`, `checkout/charge.${format}`]);
  for (const bytes of Object.values(files)) {
    if (format === 'svg') expect(strFromU8(bytes)).toContain('<svg');
    else {
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const png = Buffer.from(bytes);
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
    }
  }
}, 180_000);

it('exports only root by default and resolves imported sources for native export', async () => {
  const output = join(temp, 'root.svg');
  success(await run(['export', 'fixtures/lint/imported.d2', '-o', output]));
  const svg = await readFile(output, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('root.layers.checkout');
  expect(svg).not.toContain('Entry');
});

it('exports cyclic boards into HTML that navigates offline from file://', async () => {
  const output = join(temp, 'cycle.html');
  success(await run(['export', 'fixtures/cycle.d2', '--all', '--format', 'html', '-o', output]));
  const html = await readFile(output, 'utf8');
  const boards = JSON.parse(html.match(/<script id="zoomflow-data" type="application\/json">(.*?)<\/script>/s)![1]);
  expect(boards.map((b: { id: string }) => b.id)).toEqual(['root', 'root.layers.A', 'root.layers.B']);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(output).href);
    for (const target of ['A', 'B', 'A']) {
      await page.locator(`.zf-stage a[href="root.layers.${target}"]`).click();
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe(`root.layers.${target}`);
    }
    await page.reload();
    expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.layers.A');
    await page.keyboard.press('Escape');
    expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root');
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});

it('exports missing board links with a dashed outline and a click message offline', async () => {
  const output = join(temp, 'missing-links.html');
  success(await run(['export', 'fixtures/missing-links.d2', '--format', 'html', '-o', output]));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ offline: true });
    await page.goto(pathToFileURL(output).href);
    for (const [target, board] of [['root.layers.missing', 'root'], ['root.layers.child.layers.absent', 'root.layers.child']]) {
      if (board !== 'root') await page.locator(`.zf-stage a[href="${board}"]`).click();
      const link = page.locator(`.zf-stage a[href="${target}"]`);
      expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('dashed');
      await link.click();
      expect(await page.locator('.zf-message').textContent()).toBe(`Missing board: ${target}`);
      expect(await page.locator('.zf-message').isVisible()).toBe(true);
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe(board);
    }
  } finally { await browser.close(); }
});

it('supports parent-relative imports inside --root and paths with spaces', async () => {
  const root = join(temp, 'project with spaces');
  await mkdir(join(root, 'nested'), { recursive: true });
  await writeFile(join(root, 'nodes.d2'), 'a -> b');
  await writeFile(join(root, 'nested', 'input.d2'), '...@../nodes\na.icon: ./icon.svg');
  await writeFile(join(root, 'nested', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  const input = join(root, 'nested', 'input.d2');
  success(await run(['lint', input, '--root', root], { cwd: tmpdir() }));
  success(await run(['export', input, '--root', root], { cwd: tmpdir() }));
  expect(await readFile(join(root, 'nested', 'input.svg'), 'utf8')).toContain('data:image/svg+xml;base64,');
});

it('reports usage, missing files, compilation and native failures without replacing outputs', async () => {
  expect((await run(['export', 'fixtures/order.d2', '--boundary-ports'])).code).toBe(2);
  expect((await run(['export', 'fixtures/order.d2', '--format', 'pdf'])).code).toBe(2);
  expect((await run(['lint', join(temp, 'missing.d2')])).code).toBe(2);
  expect((await run(['lint', join(temp, 'zoomflow.d2')])).code).toBe(2);
  const input = join(temp, 'invalid.d2');
  await writeFile(input, 'x: {');
  expect((await run(['lint', input])).code).toBe(2);
  const output = join(temp, 'preserved.svg');
  await writeFile(output, 'previous export');
  const missing = await run(['export', 'fixtures/order.d2', '-o', output], { env: { ...process.env, PATH: temp } });
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain('D2 executable not found');
  expect(await readFile(output, 'utf8')).toBe('previous export');
  expect((await run(['export', 'fixtures/order.d2', '-o', 'fixtures/order.d2'])).code).toBe(2);
});

it('includes empty boards, scenarios, steps and a layer named root in HTML', async () => {
  const output = join(temp, 'boards.html');
  success(await run(['export', 'fixtures/cli/boards.d2', '--format', 'html', '-o', output]));
  const html = await readFile(output, 'utf8');
  const boards = JSON.parse(html.match(/<script id="zoomflow-data" type="application\/json">(.*?)<\/script>/s)![1]);
  expect(boards.map((b: { path: string }) => b.path)).toEqual([
    'root.svg', '@root.svg', 'root/empty.svg', '@scenarios/alternate.svg', '@steps/first.svg',
  ]);
  expect(boards.find((b: { id: string }) => b.id === 'root.layers.root.layers.empty').empty).toBe(true);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ offline: true });
    await page.goto(pathToFileURL(output).href);
    await page.locator('.zf-stage a[href="root.layers.root"]').click();
    await page.locator('.zf-stage a[href="root.layers.root.layers.empty"]').click();
    expect(await page.locator('.zf-stage').textContent()).toBe('This board is empty.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.zf-stage a[href="root.scenarios.alternate"]').click();
    expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.scenarios.alternate');
  } finally { await browser.close(); }
});


it('allows port-free diagrams by default and retains actionable dangling-link errors', async () => {
  const source = await readFile(resolve(repo, 'fixtures/lint/nested-navigation.d2'), 'utf8');
  const input = join(temp, 'nested.d2');
  await writeFile(input, source);
  const missing = await run(['lint', input, '--json']);
  expect(missing.code).toBe(1);
  const diagnostics = JSON.parse(missing.stdout).diagnostics;
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('Use link: _');
  await writeFile(input, source.replace('Capture: {link: layers.charge}', 'Capture: {link: _}'));
  const ordinary = await run(['lint', input, '--json']);
  success(ordinary);
  expect(JSON.parse(ordinary.stdout)).toMatchObject({ diagnostics: [], boundaries: [] });
  const strict = await run(['lint', input, '--boundary-ports']);
  expect(strict.code).toBe(1);
  expect(strict.stdout).toContain('error boundary-in');
  success(await run(['lint', 'fixtures/lint/mismatched.d2']));
});
