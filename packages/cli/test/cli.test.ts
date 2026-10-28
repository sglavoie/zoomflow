import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
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
    if (format === 'svg') {
      expect(strFromU8(files['checkout/charge.svg'])).toContain('Capture');
      // Board links point at the boards' files, relative to the linking board.
      const hrefs = (path: string) => new Set([...strFromU8(files[path]).matchAll(/ href="([^"]*)"/g)].map((match) => match[1]));
      expect(hrefs('root.svg')).toEqual(new Set(['checkout.svg', 'https://d2lang.com/tour/intro/']));
      expect(hrefs('checkout.svg')).toEqual(new Set(['checkout/charge.svg', 'root.svg']));
      expect(hrefs('checkout/charge.svg')).toEqual(new Set(['../checkout.svg']));
    }
  }, 180_000);

  it('links ZIP SVGs across scenarios and escaped board names', async () => {
    const input = join(temp, 'zip-links.d2');
    const output = join(temp, 'zip-links.zip');
    await writeFile(input, 'a.link: layers."x y&z"\nlayers."x y&z": {up.link: _; b -> c: {link: _.scenarios.s}}\nscenarios.s: {d}');
    success(await run(['export', input, '--all', '-o', output]));
    const files = unzipSync(await readFile(output));
    const hrefs = (path: string) => new Set([...strFromU8(files[path]).matchAll(/ href="([^"]*)"/g)].map((match) => match[1]));
    expect(Object.keys(files)).toEqual(['root.svg', 'x y&z.svg', '@scenarios/s.svg']);
    expect(hrefs('root.svg')).toEqual(new Set(['x%20y&amp;z.svg']));
    expect(hrefs('x y&z.svg')).toEqual(new Set(['root.svg', '@scenarios/s.svg']));
    expect(hrefs('@scenarios/s.svg')).toEqual(new Set(['../x%20y&amp;z.svg']));
  }, 180_000);

  it('drops ZIP SVG links to boards the ZIP lacks', async () => {
    const input = join(temp, 'zip-missing.d2');
    const output = join(temp, 'zip-missing.zip');
    await writeFile(input, 'a -> b: {link: layers.missing}\nc.link: layers.k\nlayers.k: {d}');
    success(await run(['export', input, '--all', '-o', output]));
    const files = unzipSync(await readFile(output));
    expect(new Set([...strFromU8(files['root.svg']).matchAll(/ href="([^"]*)"/g)].map((match) => match[1]))).toEqual(new Set(['k.svg']));
  }, 180_000);

  it('exports only root by default and resolves imported sources for native export', async () => {
    const output = join(temp, 'root.svg');
    success(await run(['export', 'fixtures/lint/imported.d2', '-o', output]));
    const svg = await readFile(output, 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('Checkout');
    // The board link would be dead in a standalone file.
    expect(svg).not.toContain('root.layers.checkout');
    expect(svg).not.toContain('Entry');
  });

  it('keeps only web, mail and followable board links in SVG exports', async () => {
    const input = join(temp, 'unsafe-links.d2');
    await writeFile(input, 'a: x {link: "javascript:alert(1)"}\nb.link: "data:text/html,<b>x</b>"\nc.link: layers.k\n' +
      'd.link: "https://e.com/?a=1&b=2"\ne.link: "mailto:x@y.z"\nf.link: \'vbscript:msgbox("x")\'\nlayers.k: {g.link: "javascript:alert(2)"; h.link: _}');
    const [single, zip] = [join(temp, 'unsafe-links.svg'), join(temp, 'unsafe-links.zip')];
    success(await run(['export', input, '-o', single]));
    success(await run(['export', input, '--all', '-o', zip]));
    const anchors = (svg: string) => [...svg.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors(await readFile(single, 'utf8'))).toEqual(['<a>', '<a>', '<a>',
      '<a href="https://e.com/?a=1&amp;b=2" xlink:href="https://e.com/?a=1&amp;b=2">', '<a href="mailto:x@y.z" xlink:href="mailto:x@y.z">', '<a>']);
    const files = unzipSync(await readFile(zip));
    expect(anchors(strFromU8(files['root.svg']))).toEqual(['<a>', '<a>', '<a href="k.svg" xlink:href="k.svg">',
      '<a href="https://e.com/?a=1&amp;b=2" xlink:href="https://e.com/?a=1&amp;b=2">', '<a href="mailto:x@y.z" xlink:href="mailto:x@y.z">', '<a>']);
    expect(anchors(strFromU8(files['k.svg']))).toEqual(['<a>', '<a href="root.svg" xlink:href="root.svg">']);
  }, 180_000);

  it('escapes whitespace in board links so XML attribute normalization keeps them navigable', async () => {
    const input = join(temp, 'tab-board.d2');
    const output = join(temp, 'tab-board.html');
    await writeFile(input, 'a.link: layers."x\\ty"\nlayers."x\\ty": {b.link: _}');
    success(await run(['export', input, '--format', 'html', '-o', output]));
    expect(embedded(await readFile(output, 'utf8'))[0].svg).toContain('href="root.layers.x&#9;y"');
    const page = await browser.newPage({ offline: true });
    try {
      await page.goto(pathToFileURL(output).href);
      await page.locator('.zf-stage a').first().click();
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.layers.x\ty');
    } finally { await page.close(); }
  });

  it('accepts upper-case inputs and formats, and takes the format from the output extension', async () => {
    const input = join(temp, 'UPPER.D2');
    await writeFile(input, 'a -> b\nlayers.c: {d}');
    const [png, html] = [join(temp, 'upper.png'), join(temp, 'upper.html')];
    const results = await Promise.all([run(['export', input, '-o', png]), run(['export', input, '--format', 'HTML', '-o', html]),
      run(['lint', input]), run(['export', input, '-o', join(temp, 'upper.D2')])]);
    results.slice(0, 3).forEach(success);
    expect([...(await readFile(png)).subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(await readFile(html, 'utf8')).toContain('<title>UPPER</title>');
    expect(results[3].stderr).toBe('zoomflow: Output must not overwrite D2 source files.\n');
  });

  it('accepts an input named by its real path inside a symlinked --root, and the reverse', async () => {
    const real = join(temp, 'real-root');
    const linked = join(temp, 'linked-root');
    await mkdir(join(real, 'sub'), { recursive: true });
    await symlink(real, linked);
    await writeFile(join(real, 'sub', 'a.d2'), '...@../b\nx -> y');
    await writeFile(join(real, 'b.d2'), 'z');
    const [byReal, byLink] = await Promise.all([run(['lint', join(real, 'sub', 'a.d2'), '--root', linked, '--json']),
      run(['lint', join(linked, 'sub', 'a.d2'), '--root', real, '--json'])]);
    success(byReal);
    success(byLink);
    expect(JSON.parse(byReal.stdout).diagnostics).toEqual([]);
    // The real path still decides: a symlinked folder cannot bring an outside input in.
    // Tests run concurrently, so use a folder this test owns.
    await mkdir(join(temp, 'other-root'), { recursive: true });
    const outside = await run(['lint', join(linked, 'sub', 'a.d2'), '--root', join(temp, 'other-root')]);
    expect(outside.stderr).toBe('zoomflow: Input must be inside --root.\n');
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
        await page.locator(`.zf-stage a[data-board="root.layers.${target}"]`).click();
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
        if (board !== 'root') await page.locator(`.zf-stage a[data-board="${board}"]`).click();
        const link = page.locator(`.zf-stage a[data-board="${target}"]`);
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

  it('loads imports whose names hold characters Go escapes in JSON', async () => {
    const root = join(temp, 'escaped-imports');
    await mkdir(root, { recursive: true });
    await Promise.all([writeFile(join(root, 'index.d2'), 'x: @"a&b"\ny: @"c<d>"'), writeFile(join(root, 'a&b.d2'), 'p'), writeFile(join(root, 'c<d>.d2'), 'q')]);
    success(await run(['lint', join(root, 'index.d2')]));
  });

  it('defaults --root to the input directory and never reads unrelated unreadable folders', async () => {
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
      // Only imported files are read, so the locked folder is never visited.
      expect(result.stderr).toBe('');
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

  it('names a missing local icon when the root is reached through a symlink', async () => {
    const real = join(temp, 'real-project');
    const linked = join(temp, 'linked-project');
    await mkdir(real, { recursive: true });
    await symlink(real, linked);
    const diagram = { name: '', shapes: [{ link: '', icon: './missing.png' }], connections: [], root: { link: '' } } as unknown as Diagram;
    await expect(stageIcons(diagram, join(linked, 'a.d2'), linked, join(temp, 'linked-stage')))
      .rejects.toThrow(/^Cannot read .*missing\.png: no such file$/);
  });

  it('keeps local images inside --root, through symlinked folders too, and requires regular files', async () => {
    const project = join(temp, 'icons');
    const root = join(project, 'q');
    await mkdir(join(project, 'out'), { recursive: true });
    await mkdir(join(root, 'folder'), { recursive: true });
    await writeFile(join(project, 'out', 's.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    await symlink('../out', join(root, 'link'));
    const cases = [['./link/s.svg', 'Local image is outside --root'], ['../out/s.svg', 'Local image is outside --root'],
      ['./folder', 'Local image must be a regular file']] as const;
    const results = await Promise.all(cases.map(async ([icon], i) => {
      await writeFile(join(root, `icon-${i}.d2`), `a.icon: ${icon}`);
      return run(['export', join(root, `icon-${i}.d2`), '--root', root, '-o', join(project, `icon-${i}.svg`)]);
    }));
    results.forEach((result, i) => {
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(cases[i][1]);
    });
  });

  it('bundles local images whose paths have spaces, beside an entry file in a spaced folder', async () => {
    const project = join(temp, 'spaced icons');
    await mkdir(join(project, 'my dir'), { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
    await Promise.all([writeFile(join(project, 'my dir', 'my icon.svg'), svg), writeFile(join(project, 'other icon.svg'), svg),
      writeFile(join(project, 'my dir', 'a.d2'), 'a: { icon: ./my icon.svg }\nb: { icon: "../other icon.svg" }')]);
    const output = join(project, 'a.svg');
    const result = await run(['export', join(project, 'my dir', 'a.d2'), '--root', project, '-o', output]);
    success(result);
    expect((await readFile(output, 'utf8')).match(/data:image\/svg\+xml/g)).toHaveLength(2);
  });

  it('treats Windows drive paths as local images, not URLs', async () => {
    const diagram = { name: '', shapes: [{ link: '', icon: { Scheme: 'c', Opaque: '\\img.png', Host: '', Path: '' } }],
      connections: [], root: { link: '' } } as unknown as Diagram;
    await expect(stageIcons(diagram, join(temp, 'drive.d2'), temp, join(temp, 'drive-stage'))).rejects.toThrow(/img\.png/);
  });

  it('reads only the input and its imports, explaining imports it could not load', async () => {
    const root = join(temp, 'reachable');
    await mkdir(join(root, 'dist', 'nested'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'dist', 'input.d2'), '...@zoomflow\n...@nested/part\na -> b'),
      writeFile(join(root, 'dist', 'nested', 'part.d2'), '...@../../deep\nc'),
      writeFile(join(root, 'deep.d2'), 'd'),
      writeFile(join(root, 'locked.d2'), 'e'),
      writeFile(join(root, 'uses-locked.d2'), '...@locked'),
      writeFile(join(temp, 'outside.d2'), 'f'),
      writeFile(join(root, 'uses-outside.d2'), '...@../outside'),
    ]);
    await chmod(join(root, 'locked.d2'), 0o000);
    try {
      // An unreadable file elsewhere in the root, and the excluded-looking dist folder, no longer matter.
      const reachable = await run(['lint', join(root, 'dist', 'input.d2'), '--root', root, '--json']);
      success(reachable);
      expect(JSON.parse(reachable.stdout).diagnostics).toEqual([]);
      const [locked, outside] = await Promise.all([run(['lint', join(root, 'uses-locked.d2'), '--root', root]),
        run(['lint', join(root, 'uses-outside.d2'), '--root', root])]);
      expect(locked.code).toBe(2);
      expect(locked.stderr).toContain('failed to import "locked.d2": file does not exist (cannot read: permission denied)');
      expect(outside.code).toBe(2);
      expect(outside.stderr).toContain(`failed to import "../outside.d2": file does not exist (outside --root ${root}; pass --root to include it)`);
    } finally { await chmod(join(root, 'locked.d2'), 0o644); }
  });

  it('prints a JSON error object for lint --json failures', async () => {
    const input = join(temp, 'invalid-json.d2');
    await writeFile(input, 'x: {');
    const result = await run(['lint', input, '--json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({ error: `${input}:1:4: maps must be terminated with }`, diagnostics: [] });
    const usage = await Promise.all([['lint', 'a.d2', '--json', '--all'], ['lint', '--json'], ['lint', 'a.d2', 'b.d2', '--json'],
      ['lint', 'a.d2', '--json', '--bogus'], ['lint', 'a.d2', '--json', '--root'], ['--root', '.', 'lint', 'a.d2', '--json', '--bogus'],
      ['-o', 'x', '--format', 'svg', 'lint', 'a.d2', '--json']].map((args) => run(args)));
    expect(usage.map((item) => [item.code, JSON.parse(item.stdout)])).toEqual([
      [2, { error: 'Export options cannot be used with lint.', diagnostics: [] }],
      [2, { error: 'lint takes exactly one .d2 file.', diagnostics: [] }],
      [2, { error: 'lint takes exactly one .d2 file.', diagnostics: [] }],
      [2, { error: expect.stringContaining("Unknown option '--bogus'"), diagnostics: [] }],
      [2, { error: expect.stringContaining("Option '--root <value>' argument missing"), diagnostics: [] }],
      [2, { error: expect.stringContaining("Unknown option '--bogus'"), diagnostics: [] }],
      [2, { error: 'Export options cannot be used with lint.', diagnostics: [] }],
    ]);
    // Parse failures outside lint --json keep stdout empty.
    expect((await run(['lint', 'a.d2', '--bogus'])).stdout).toBe('');
  });

  it('names directories and symlinks given as input, and unwritable output folders', async () => {
    const folder = join(temp, 'folder.d2');
    const linked = join(temp, 'linked.d2');
    const locked = join(temp, 'read-only');
    await Promise.all([mkdir(folder, { recursive: true }), mkdir(locked, { recursive: true }), symlink(resolve(repo, 'fixtures/order.d2'), linked)]);
    await chmod(locked, 0o555);
    try {
      const [directory, link, unwritable] = await Promise.all([run(['lint', folder]), run(['lint', linked]),
        run(['export', 'fixtures/order.d2', '-o', join(locked, 'order.svg')])]);
      expect(directory.stderr).toBe('zoomflow: Input must be a regular file.\n');
      expect(link.stderr).toBe('zoomflow: Input must be a regular file; symlinks are not followed.\n');
      expect(unwritable.code).toBe(2);
      expect(unwritable.stderr).toBe(`zoomflow: Cannot write ${join(locked, 'order.svg')}: permission denied\n`);
    } finally { await chmod(locked, 0o755); }
  }, 180_000);

  it('names unreadable inputs and a --root that is not a directory', async () => {
    const locked = join(temp, 'unreadable');
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, 'a.d2'), 'a');
    await chmod(locked, 0o000);
    try {
      const [unreadable, file] = await Promise.all([run(['lint', join(locked, 'a.d2')]),
        run(['lint', 'fixtures/order.d2', '--root', 'fixtures/order.d2'])]);
      expect(unreadable.code).toBe(2);
      expect(unreadable.stderr).toBe(`zoomflow: Cannot read ${join(locked, 'a.d2')}: permission denied\n`);
      expect(file.code).toBe(2);
      expect(file.stderr).toBe(`zoomflow: Root is not a directory: ${resolve(repo, 'fixtures/order.d2')}\n`);
    } finally { await chmod(locked, 0o755); }
  });

  it('rejects an output directory before rendering', async () => {
    const output = join(temp, 'output.svg');
    await mkdir(output, { recursive: true });
    const result = await run(['export', 'fixtures/order.d2', '-o', output]);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(`zoomflow: Output is a directory: ${output}\n`);
  });

  it('documents every option in the help text', async () => {
    const result = await run(['--help']);
    success(result);
    for (const option of ['-o, --output', '--json', '--missing-backlink', '--boundary-ports', '--root', '--follow']) expect(result.stdout).toContain(option);
    expect(result.stdout).toMatch(/failure\.\n$/);
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
      [[], 'Missing command.'], [['build', 'a.d2'], 'Unknown command: build'], [['--bogus'], "Unknown option '--bogus'"],
      [['lint', 'a.d2', '--all'], 'Export options cannot be used with lint.'], [['export', 'a.d2', '--json'], 'Lint options cannot be used with export.'],
      [['export', 'a.d2', '--format', 'pdf'], 'Unsupported format: pdf'], [['export', 'a.d2', '--format='], 'Unsupported format: ""'],
      [['lint', 'a.d2', '-o', ''], 'Export options cannot be used with lint.'], [['export', 'a.d2', '-o', ''], 'Output path is empty.'],
      [['lint', 'a.txt'], 'Input must be a .d2 file.']] as const;
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
      run(['export', 'fixtures/order.d2', '--all', '--format', 'svg', '-o', output]),
      run(['export', 'fixtures/order.d2', '--all', '-o', join(temp, 'order.png')]), run(['export', 'fixtures/order.d2', '-o', join(temp, 'order')]),
    ]);
    for (const result of results) expect(result.code).toBe(2);
    const [, , absent, , invalid, missing, , zip, htm, formatted, png, bare] = results;
    expect(absent.stderr).toBe('zoomflow: Cannot read fixtures/missing.d2: no such file\n');
    expect(invalid.stderr).toBe(`${input}:2:1: connection missing destination\n${input}:1:4: maps must be terminated with }\n`);
    expect(missing.stderr).toContain('D2 executable not found');
    // --format is named only when it was passed.
    expect(zip.stderr).toBe(`zoomflow: Output must end in .zip, since --all writes every board: ${output}\n`);
    expect(formatted.stderr).toBe(`zoomflow: Output must end in .zip for --all --format svg: ${output}\n`);
    expect(png.stderr).toBe(`zoomflow: Output must end in .zip, since --all writes every board: ${join(temp, 'order.png')}. For PNG images, use -o out.zip --format png.\n`);
    expect(bare.stderr).toBe(`zoomflow: Output must end in .svg, .png or .html, or pass --format: ${join(temp, 'order')}\n`);
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
      'root.svg', '@root.svg', '@root/empty.svg', '@scenarios/alternate.svg', '@steps/first.svg',
    ]);
    expect(boards.find((b: { id: string }) => b.id === 'root.layers.root.layers.empty')).toMatchObject({ empty: true, svg: '' });
    const page = await browser.newPage({ offline: true });
    try {
      await page.goto(pathToFileURL(output).href);
      await page.locator('.zf-stage a[data-board="root.layers.root"]').click();
      await page.locator('.zf-stage a[data-board="root.layers.root.layers.empty"]').click();
      expect(await page.locator('.zf-stage').textContent()).toBe('This board is empty.');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.zf-stage a[data-board="root.scenarios.alternate"]').click();
      expect(await page.locator('.zf-stage').getAttribute('data-board')).toBe('root.scenarios.alternate');
    } finally { await page.close(); }
  });

  it('reports unusable imports, a local zoomflow.d2 included, and readable summaries and paths', async () => {
    const root = join(temp, 'unusable-imports');
    await mkdir(join(root, 'shared.d2'), { recursive: true });
    await Promise.all([writeFile(join(root, 'styled.d2'), '...@zoomflow\na'), writeFile(join(root, 'folder.d2'), '...@shared\na'),
      writeFile(join(root, 'warn.d2'), 'layers: { unused: {x} }'),
      symlink(resolve(repo, 'stdlib/zoomflow.d2'), join(root, 'zoomflow.d2'))]);
    const [styled, folder, summary, zip, notDir] = await Promise.all([run(['lint', join(root, 'styled.d2')]),
      run(['lint', join(root, 'folder.d2')]), run(['lint', join(root, 'warn.d2')]),
      run(['export', 'fixtures/order.d2', '-o', join(temp, 'single.zip')]), run(['lint', 'fixtures/order.d2/inner.d2'])]);
    // A symlinked zoomflow.d2 is not silently swapped for the bundled one.
    expect(styled.code).toBe(2);
    expect(styled.stderr).toContain('failed to import "zoomflow.d2": file does not exist (symlinks are not followed)');
    expect(folder.stderr).toContain('failed to import "shared.d2": file does not exist (not a regular file)');
    success(summary);
    expect(summary.stdout).toMatch(/\n0 errors, 1 warning\.\n$/);
    expect(zip.stderr).toBe(`zoomflow: A .zip output needs --all: ${join(temp, 'single.zip')}\n`);
    expect(notDir.stderr).toBe('zoomflow: Cannot read fixtures/order.d2/inner.d2: no such file\n');
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

  it('lints file links in the input and, with --follow, every file they reach within --root', async () => {
    const [own, rooted, followed, json] = await Promise.all([run(['lint', 'fixtures/atlas/broken/links.d2']),
      run(['lint', 'fixtures/atlas/broken/links.d2', '--root', 'fixtures/atlas']),
      run(['lint', 'fixtures/atlas/broken/links.d2', '--root', 'fixtures/atlas', '--follow']),
      run(['lint', 'fixtures/atlas/index.d2', '--follow', '--json'])]);
    // Without --root, the parent folder is outside the project.
    expect(own.code).toBe(1);
    expect(own.stdout).toBe([
      'fixtures/atlas/broken/links.d2:2:1: error dangling-file-link [Root / Nowhere] Link targets missing file "missing.d2".',
      'fixtures/atlas/broken/links.d2:3:1: error dangling-file-link [Root / Home] Link "../index.d2#/Gone" points outside the project folder or at a file that cannot be a diagram.',
      '2 errors, 0 warnings.', ''].join('\n'));
    expect(rooted.code).toBe(1);
    expect(rooted.stdout).toBe([
      'fixtures/atlas/broken/links.d2:2:1: error dangling-file-link [Root / Nowhere] Link targets missing file "broken/missing.d2".',
      'fixtures/atlas/broken/links.d2:3:1: warning missing-file-board [Root / Home] Link targets missing board "Gone" in "index.d2", so the viewer opens its nearest existing board.',
      '1 error, 1 warning.', ''].join('\n'));
    expect(followed.code).toBe(1);
    expect(followed.stdout).toContain('1 error, 1 warning in 5 files.');
    success(json);
    expect(JSON.parse(json.stdout)).toMatchObject({ files: ['index.d2', 'health.d2', 'work/index.d2', 'projects/zoomflow.d2'], diagnostics: [] });
  });

  it('follows file links once each through cycles and never outside --root or through symlinks', async () => {
    const root = join(temp, 'atlas-cycle');
    await mkdir(join(root, 'inner'), { recursive: true });
    await writeFile(join(root, 'outside.d2'), 'o');
    await writeFile(join(root, 'inner', 'a.d2'), 'B: {link: ./b.d2}\nUp: {link: ../outside.d2}\nLinked: {link: ./linked.d2}');
    await writeFile(join(root, 'inner', 'b.d2'), 'A: {link: ./a.d2}\nx: {link: "./a.d2#/Gone"}');
    await symlink(join(root, 'outside.d2'), join(root, 'inner', 'linked.d2'));
    const a = join(root, 'inner', 'a.d2');
    const [inner, wide] = await Promise.all([run(['lint', a, '--follow', '--json']), run(['lint', a, '--follow', '--root', root, '--json'])]);
    expect(inner.code).toBe(1);
    const result = JSON.parse(inner.stdout);
    expect(result.files).toEqual(['a.d2', 'b.d2']);
    expect(result.diagnostics.map((item: { file: string; rule: string; shape: string }) => [item.file, item.rule, item.shape])).toEqual([
      ['a.d2', 'dangling-file-link', 'Up'], ['a.d2', 'dangling-file-link', 'Linked'], ['b.d2', 'missing-file-board', 'x']]);
    // A wider --root reaches the parent file, but a symlinked file is still not followed.
    expect(wide.code).toBe(1);
    expect(JSON.parse(wide.stdout).files).toEqual(['inner/a.d2', 'inner/b.d2', 'outside.d2']);
    expect(JSON.parse(wide.stdout).diagnostics.map((item: { shape: string }) => item.shape)).toEqual(['Linked', 'x']);
    const [html, zip] = [join(temp, 'atlas-cycle.html'), join(temp, 'atlas-cycle.zip')];
    const exports = await Promise.all([run(['export', a, '--format', 'html', '-o', html]), run(['export', a, '--all', '-o', zip])]);
    for (const item of exports) {
      success(item);
      expect(item.stderr).toBe('zoomflow: 2 dangling links (run zoomflow lint)\n');
    }
    expect(embedded(await readFile(html, 'utf8')).map((board: { file: string; hash: string }) => [board.file, board.hash]))
      .toEqual([['a.d2', '#/'], ['b.d2', '#/@file/b.d2']]);
    const files = unzipSync(await readFile(zip));
    const hrefs = (path: string) => [...strFromU8(files[path]).matchAll(/ href="([^"]*)"/g)].map((match) => match[1]);
    expect(Object.keys(files)).toEqual(['root.svg', '@files/b.d2/root.svg']);
    // Links outside the export lose their href; links within it open the target's root SVG.
    expect(hrefs('root.svg')).toEqual(['@files/b.d2/root.svg']);
    expect(hrefs('@files/b.d2/root.svg')).toEqual(['../../root.svg', '../../root.svg']);
  }, 180_000);

  it('resolves file links in imports from the file that wrote them, into any folder inside --root', async () => {
    const root = join(temp, 'atlas-imported');
    await Promise.all(['sub', 'dist', '.hidden'].map((folder) => mkdir(join(root, folder), { recursive: true })));
    await Promise.all([
      writeFile(join(root, 'index.d2'), '...@sub/part\nd.link: ./dist/x.d2\nh.link: ./.hidden/y.d2'),
      writeFile(join(root, 'sub', 'part.d2'), 'a.link: ./other.d2\nb.link: ../x.d2\nc -> e: {link: ./other.d2}'),
      writeFile(join(root, 'sub', 'other.d2'), 'o'), writeFile(join(root, 'x.d2'), 'x'),
      writeFile(join(root, 'dist', 'x.d2'), 'dx'), writeFile(join(root, '.hidden', 'y.d2'), 'y'),
    ]);
    const zip = join(temp, 'atlas-imported.zip');
    const [linted, followed, exported] = await Promise.all([run(['lint', join(root, 'index.d2')]),
      run(['lint', join(root, 'index.d2'), '--follow', '--json']), run(['export', join(root, 'index.d2'), '--all', '-o', zip])]);
    success(linted);
    expect(linted.stdout).toBe('0 errors, 0 warnings.\n');
    success(followed);
    expect(JSON.parse(followed.stdout).files).toEqual(['index.d2', 'sub/other.d2', 'dist/x.d2', 'x.d2', '.hidden/y.d2']);
    success(exported);
    const files = unzipSync(await readFile(zip));
    // Links written in the import are rewritten to resolve from the input, as the export resolves them.
    expect([...strFromU8(files['root.svg']).matchAll(/ href="([^"]*)"/g)].map((match) => match[1])).toEqual([
      '@files/sub/other.d2/root.svg', '@files/dist/x.d2/root.svg', '@files/x.d2/root.svg', '@files/.hidden/y.d2/root.svg',
      // A connection's link sits inside its wrapper, so it is rewritten too.
      '@files/sub/other.d2/root.svg']);
  }, 180_000);

  it('reads no linked file for a lone SVG or PNG, but does for HTML', async () => {
    const root = join(temp, 'lone-board');
    await mkdir(root, { recursive: true });
    const preload = join(root, 'log-reads.cjs');
    await Promise.all([writeFile(join(root, 'index.d2'), 'a.link: ./linked.d2\nb.link: ./absent.d2'), writeFile(join(root, 'linked.d2'), 'l'),
      // Log every file the CLI reads, through the ESM bindings it imports.
      writeFile(preload, `const fs = require('node:fs/promises');
const readFile = fs.readFile;
fs.readFile = (path, ...rest) => { process.stderr.write(\`read \${path}\\n\`); return readFile(path, ...rest); };
require('node:module').syncBuiltinESMExports();`)]);
    const env = { ...process.env, NODE_OPTIONS: `--require ${preload}` };
    const [svg, html] = await Promise.all([run(['export', join(root, 'index.d2'), '-o', join(root, 'lone.svg')], { env }),
      run(['export', join(root, 'index.d2'), '-o', join(root, 'lone.html')], { env })]);
    success(svg);
    expect(svg.stderr).toContain(`read ${join(root, 'index.d2')}`);
    expect(svg.stderr).not.toContain('linked.d2');
    // A missing file still counts as a dangling link, found without reading.
    expect(svg.stderr).toContain('zoomflow: 1 dangling link (run zoomflow lint)');
    success(html);
    expect(html.stderr).toContain(`read ${join(root, 'linked.d2')}`);
  }, 180_000);

  it('exports linked files into ZIPs under folders named after them, file links pointing at their root SVG', async () => {
    const [svg, png] = [join(temp, 'atlas-svg.zip'), join(temp, 'atlas-png.zip')];
    const results = await Promise.all([run(['export', 'fixtures/atlas/index.d2', '--all', '-o', svg]),
      run(['export', 'fixtures/atlas/index.d2', '--all', '--format', 'png', '-o', png])]);
    results.forEach(success);
    const files = unzipSync(await readFile(svg));
    const hrefs = (path: string) => [...strFromU8(files[path]).matchAll(/ href="([^"]*)"/g)].map((match) => match[1]);
    expect(Object.keys(files)).toEqual(['root.svg', '@files/health.d2/root.svg', '@files/health.d2/Sleep.svg',
      '@files/work/index.d2/root.svg', '@files/projects/zoomflow.d2/root.svg', '@files/projects/zoomflow.d2/Viewer.svg']);
    expect(hrefs('root.svg')).toEqual(['@files/health.d2/root.svg', '@files/work/index.d2/root.svg']);
    expect(hrefs('@files/health.d2/root.svg')).toEqual(['Sleep.svg']);
    expect(hrefs('@files/work/index.d2/root.svg')).toEqual(['../../projects/zoomflow.d2/root.svg']);
    const images = unzipSync(await readFile(png));
    expect(Object.keys(images)).toEqual(Object.keys(files).map((path) => path.replace(/\.svg$/, '.png')));
    for (const data of Object.values(images)) expect([...data.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  }, 180_000);

  it('exports every linked file into one HTML atlas that navigates offline from file://', async () => {
    const output = join(temp, 'atlas.html');
    success(await run(['export', 'fixtures/atlas/index.d2', '--format', 'html', '-o', output]));
    const html = await readFile(output, 'utf8');
    expect([...new Set(embedded(html).map((board: { file: string }) => board.file))]).toEqual(['index.d2', 'health.d2', 'work/index.d2', 'projects/zoomflow.d2']);
    const context = await browser.newContext({ offline: true });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      const stage = page.locator('.zf-stage');
      const at = async () => [await stage.getAttribute('data-file'), await stage.getAttribute('data-board')];
      expect(await at()).toEqual(['index.d2', 'root']);
      await page.locator('.zf-stage a[data-file="./health.d2"]').click();
      expect(await at()).toEqual(['health.d2', 'root']);
      await page.locator('.zf-stage a[data-board="root.layers.Sleep"]').click();
      expect(await at()).toEqual(['health.d2', 'root.layers.Sleep']);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      expect(await at()).toEqual(['index.d2', 'root']);
      await page.locator('.zf-stage a[data-file="./work/index.d2"]').click();
      await page.locator('.zf-stage a[data-file="../projects/zoomflow.d2#/Viewer"]').click();
      expect(await at()).toEqual(['projects/zoomflow.d2', 'root.layers.Viewer']);
      expect(await page.locator('.zf-breadcrumbs').textContent()).toContain('work/index');
      await page.goBack();
      expect(await at()).toEqual(['work/index.d2', 'root']);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
});
