import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium, type Browser } from '@playwright/test';
import type { Diagram } from '@zoomflow/core';
import { stageIcons } from '../src/index';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = resolve(repo, 'packages/cli/bin/zoomflow.mjs');
let temp: string;
let browser: Browser;
beforeAll(async () => {
  [, temp, browser] = await Promise.all([exec(process.execPath, ['packages/cli/build.mjs'], { cwd: repo }),
    mkdtemp(join(tmpdir(), 'zoomflow-cli-test-')), chromium.launch()]);
});
afterAll(async () => {
  await browser?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});

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
const embedded = (html: string) => JSON.parse(html.match(/<script id="zoomflow-data" type="application\/json">(.*?)<\/script>/s)![1]);

// Every case writes to its own paths, so subprocesses can overlap.
vi.setConfig({ maxConcurrency: 8 });
describe.concurrent('zoomflow CLI', () => {
  it.each(['labelled', 'dotted', 'imported'])('lints the real %s fixture with stdlib and local imports', async (name) => {
    const result = await run(['lint', `fixtures/lint/${name}.d2`, '--boundary-ports', '--json']);
    success(result);
    expect(JSON.parse(result.stdout)).toMatchObject({ diagnostics: [], boundaryPairsEvaluated: 2 });
  });

  it.each([['mismatched', 'boundary-in'], ['navigation', 'dangling-link']])('returns a non-zero exit for %s errors', async (name, rule) => {
    const result = await run(['lint', `fixtures/lint/${name}.d2`, '--boundary-ports']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`error ${rule}`);
  });

  it('prints clickable one-based locations and readable board trails', async () => {
    const boundary = await run(['lint', 'fixtures/lint/mismatched.d2', '--boundary-ports']);
    expect(boundary.stdout.split('\n').slice(0, 2)).toEqual([
      'fixtures/lint/mismatched.d2:4:6: error boundary-in [Root / checkout] "checkout" needs a zf-in port named "a" in "Root > checkout".',
      'fixtures/lint/mismatched.d2:8:5: error boundary-in [Root > checkout / wrong] zf-in port "wrong" has no matching incoming neighbour of "checkout" in "Root".',
    ]);
    const links = await run(['lint', 'fixtures/lint/navigation.d2']);
    expect(links.stdout).toContain('fixtures/lint/navigation.d2:2:15: error dangling-link [Root / missing] Link targets missing board "Root > absent".');
    expect(links.stdout).toContain('fixtures/lint/navigation.d2:7:5: error dangling-link [Root > A / missing] Link targets missing board "Root > A > absent".');
    expect(links.stdout).not.toMatch(/,\d+:\d+:\d+-|root\.layers/);
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

  it.each(['svg', 'png'])('exports all fixture boards as genuine %s in a ZIP without D2 progress chatter', async (format) => {
    const output = join(temp, `order-${format}.zip`);
    const result = await run(['export', 'fixtures/order.d2', '--all', '--format', format, '-o', output]);
    success(result);
    expect(result.stderr).toBe('');
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
    if (format === 'svg') expect(strFromU8(files['checkout/charge.svg'])).toContain('Capture');
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
    expect(html).toContain('<title>cycle</title>');
    expect(embedded(html).map((b: { id: string }) => b.id)).toEqual(['root', 'root.layers.A', 'root.layers.B']);
    // One glyph render replaces every board's own font subset and theme block.
    expect(html.match(/@font-face/g)).toHaveLength(1);
    expect(embedded(html).every((b: { svg: string }) => !b.svg.includes('<style'))).toBe(true);
    const context = await browser.newContext({ offline: true });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      expect(await page.locator('.zf-visually-hidden').evaluate((node) => getComputedStyle(node).position)).toBe('absolute');
      const controls = (await page.locator('.zf-zoom-controls').boundingBox())!;
      const stage = (await page.locator('.zf-stage').boundingBox())!;
      expect(controls.y).toBeGreaterThanOrEqual(stage.y + stage.height);
      expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThanOrEqual(page.viewportSize()!.height);
      for (const target of ['A', 'B', 'A']) {
        await page.locator(`.zf-stage a[href="root.layers.${target}"]`).click();
        expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe(`root.layers.${target}`);
      }
      await page.reload();
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.layers.A');
      await page.keyboard.press('Escape');
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root');
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  it('exports missing board links with a dashed outline, a click message and a stderr summary', async () => {
    const output = join(temp, 'missing-links.html');
    const result = await run(['export', 'fixtures/missing-links.d2', '--format', 'html', '-o', output]);
    success(result);
    expect(result.stderr).toBe('zoomflow: 2 dangling links (run zoomflow lint)\n');
    const page = await browser.newPage({ offline: true });
    try {
      await page.goto(pathToFileURL(output).href);
      for (const [target, board, label] of [['root.layers.missing', 'root', 'Root > missing'], ['root.layers.child.layers.absent', 'root.layers.child', 'Root > child > absent']]) {
        if (board !== 'root') await page.locator(`.zf-stage a[href="${board}"]`).click();
        const link = page.locator(`.zf-stage a[href="${target}"]`);
        expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('dashed');
        await link.click();
        expect(await page.locator('.zf-message').textContent()).toBe(`Missing board: ${label}`);
        expect(await page.locator('.zf-message').isVisible()).toBe(true);
        expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe(board);
      }
    } finally { await page.close(); }
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

  it('defaults --root to the input directory and skips unreadable folders with a warning', async () => {
    // Its own directory: other cases lint inputs directly under the shared temp folder.
    const home = await mkdtemp(join(tmpdir(), 'zoomflow-cli-home-'));
    const project = join(home, 'project');
    await mkdir(join(home, 'locked'), { recursive: true });
    await mkdir(join(project, 'private'), { recursive: true });
    await writeFile(join(project, 'a.d2'), '...@nodes\nx -> y');
    await writeFile(join(project, 'nodes.d2'), 'n');
    await Promise.all([chmod(join(home, 'locked'), 0o000), chmod(join(project, 'private'), 0o000)]);
    try {
      const result = await run(['lint', 'project/a.d2', '--json'], { cwd: home });
      success(result);
      expect(JSON.parse(result.stdout).diagnostics).toEqual([]);
      expect(result.stderr).toBe(`zoomflow: skipping unreadable folder ${join('project', 'private')}\n`);
      const locked = await run(['lint', join(project, 'a.d2'), '--root', join(home, 'locked')]);
      expect(locked.code).toBe(2);
      expect(locked.stderr).toBe('zoomflow: Input must be inside --root.\n');
    } finally {
      await Promise.all([chmod(join(home, 'locked'), 0o755), chmod(join(project, 'private'), 0o755)]);
      await rm(home, { recursive: true, force: true });
    }
  });

  it('names a local icon whose path is not valid URL encoding', async () => {
    const shape = { link: '', icon: './bad%E0%A4%A.svg' };
    const diagram = { name: '', shapes: [shape], connections: [], root: { link: '' } } as unknown as Diagram;
    await expect(stageIcons(diagram, join(temp, 'icons.d2'), temp, join(temp, 'icon-stage')))
      .rejects.toThrow('Local image path is not valid URL encoding: ./bad%E0%A4%A.svg');
  });

  it('reports usage concisely and prints the version', async () => {
    const version = await run(['--version']);
    success(version);
    expect(version.stdout).toBe('zoomflow 0.0.0\n');
    expect((await run(['-v'])).stdout).toBe('zoomflow 0.0.0\n');
    const help = await run(['-h']);
    success(help);
    expect(help.stdout).toContain("--root bounds local imports and images (default: the input file's directory)");
    expect(help.stdout).toContain('  zoomflow -h | --help | -v | --version\n');
    const cases = [[['lint'], 'lint takes exactly one .d2 file.'], [['lint', 'a.d2', 'b.d2'], 'lint takes exactly one .d2 file.'],
      [[], 'Missing command.'], [['build', 'a.d2'], 'Unknown command: build'], [['--bogus'], "Unknown option '--bogus'"]] as const;
    const results = await Promise.all(cases.map(([args]) => run([...args])));
    results.forEach((result, i) => {
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(`zoomflow: ${cases[i][1]}`);
      expect(result.stderr).toMatch(/\nUsage:\n {2}zoomflow export[\s\S]*\nRun zoomflow --help for details\.\n$/);
      expect(result.stderr).not.toContain('Exit codes');
    });
  });

  it('reports missing files, compilation and native failures without replacing outputs', async () => {
    const input = join(temp, 'invalid.d2');
    const output = join(temp, 'preserved.svg');
    await Promise.all([writeFile(input, 'x: {\ny ->'), writeFile(output, 'previous export')]);
    const results = await Promise.all([
      run(['export', 'fixtures/order.d2', '--boundary-ports']), run(['export', 'fixtures/order.d2', '--format', 'pdf']),
      run(['lint', 'fixtures/missing.d2']), run(['lint', join(temp, 'zoomflow.d2')]), run(['lint', input]),
      run(['export', 'fixtures/order.d2', '-o', output], { env: { ...process.env, PATH: temp } }),
      run(['export', 'fixtures/order.d2', '-o', 'fixtures/order.d2']), run(['export', 'fixtures/order.d2', '--all', '-o', output]),
      run(['export', 'fixtures/order.d2', '--format', 'html', '-o', join(temp, 'order.htm')]),
    ]);
    for (const result of results) expect(result.code).toBe(2);
    const [, , absent, , invalid, missing, , zip, htm] = results;
    expect(absent.stderr).toBe('zoomflow: cannot read fixtures/missing.d2: no such file\n');
    expect(invalid.stderr).toBe(`${input}:2:1: connection missing destination\n${input}:1:4: maps must be terminated with }\n`);
    expect(missing.stderr).toContain('D2 executable not found');
    expect(zip.stderr).toBe(`zoomflow: Output must end in .zip for --all --format svg: ${output}\n`);
    expect(htm.stderr).toContain('Output must end in .html');
    expect(await readFile(output, 'utf8')).toBe('previous export');
  });

  it('names the user’s file, not the staging directory, in native D2 failures', async () => {
    const input = join(temp, 'remote.d2');
    await writeFile(input, 'a: {icon: https://127.0.0.1:9/x.png}');
    const result = await run(['export', input, '-o', join(temp, 'remote.svg')]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`partial render written) ${input}: failed to bundle remote images`);
    expect(result.stderr).not.toMatch(/zoomflow-[A-Za-z0-9]{6}|^(info|success):/m);
  });

  it('includes empty boards, scenarios, steps and a layer named root in HTML', async () => {
    const output = join(temp, 'boards.html');
    success(await run(['export', 'fixtures/cli/boards.d2', '--format', 'html', '-o', output]));
    const boards = embedded(await readFile(output, 'utf8'));
    expect(boards.map((b: { path: string }) => b.path)).toEqual([
      'root.svg', '@root.svg', 'root/empty.svg', '@scenarios/alternate.svg', '@steps/first.svg',
    ]);
    expect(boards.find((b: { id: string }) => b.id === 'root.layers.root.layers.empty')).toMatchObject({ empty: true, svg: '' });
    const page = await browser.newPage({ offline: true });
    try {
      await page.goto(pathToFileURL(output).href);
      await page.locator('.zf-stage a[href="root.layers.root"]').click();
      await page.locator('.zf-stage a[href="root.layers.root.layers.empty"]').click();
      expect(await page.locator('.zf-stage').textContent()).toBe('This board is empty.');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.zf-stage a[href="root.scenarios.alternate"]').click();
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.scenarios.alternate');
    } finally { await page.close(); }
  });

  it('allows port-free diagrams by default and retains actionable dangling-link errors', async () => {
    const source = await readFile(resolve(repo, 'fixtures/lint/nested-navigation.d2'), 'utf8');
    const input = join(temp, 'nested.d2');
    const repaired = join(temp, 'nested-repaired.d2');
    await writeFile(input, source);
    await writeFile(repaired, source.replace('Capture: {link: layers.charge}', 'Capture: {link: _}'));
    const missing = await run(['lint', input, '--json']);
    expect(missing.code).toBe(1);
    const diagnostics = JSON.parse(missing.stdout).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('Use link: _');
    const [ordinary, strict, mismatched] = await Promise.all([run(['lint', repaired, '--json']),
      run(['lint', repaired, '--boundary-ports']), run(['lint', 'fixtures/lint/mismatched.d2'])]);
    success(ordinary);
    expect(JSON.parse(ordinary.stdout)).toMatchObject({ diagnostics: [], boundaries: [] });
    success(strict);
    expect(strict.stdout).toContain('0 boundary pairs evaluated');
    success(mismatched);
  });
});
