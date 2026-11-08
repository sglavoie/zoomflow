import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { temp, browser, run, success, embedded } from './cli-helpers';

export function registerCliExportCases() {

  it('exports PNG ZIPs without file/folder collisions for boards named like images', async () => {
    const input = join(temp, 'png-names.d2');
    const output = join(temp, 'png-names.zip');
    await writeFile(input, 'layers: {\n A: {a}\n "A.png": {b; layers: {child: {c}}}\n "root.png": {d; layers: {child: {e}}}\n}');
    success(await run(['export', input, '--all', '--format', 'png', '-o', output]));
    const files = unzipSync(await readFile(output));
    const paths = Object.keys(files);
    expect(paths.some(path => paths.some(other => other.startsWith(`${path}/`)))).toBe(false);
    expect(paths).toHaveLength(6);
    for (const bytes of Object.values(files)) expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
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

  it('exports linked files into ZIPs under folders named after them, file links pointing at their requested boards', async () => {
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
    expect(hrefs('@files/work/index.d2/root.svg')).toEqual(['../../projects/zoomflow.d2/Viewer.svg']);
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
      await page.getByRole('button', { name: 'Find in atlas', exact: true }).click();
      await page.getByRole('searchbox').fill('Stage');
      const result = page.getByRole('list', { name: 'Search results' }).getByRole('button');
      expect(await result.textContent()).toBe('StageShape · projects/zoomflow.d2 › Root › Viewer');
      await result.click();
      expect(await at()).toEqual(['projects/zoomflow.d2', 'root.layers.Viewer']);
      expect(await stage.locator('[data-shape-id="Stage"]').getAttribute('class')).toContain('zf-search-selected');
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  it('refuses an export that would overwrite a local image the diagram uses', async () => {
    const root = join(temp, 'own-icon');
    await mkdir(root);
    const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    await Promise.all([writeFile(join(root, 'logo.d2'), 'a: {icon: ./logo.svg}'), writeFile(join(root, 'logo.svg'), icon)]);
    // Probe before exporting: on case-sensitive disks a successful export creates LOGO.svg.
    const ignoresCase = existsSync(join(root, 'LOGO.svg'));
    const [implied, named] = await Promise.all([run(['export', join(root, 'logo.d2')]), run(['export', join(root, 'logo.d2'), '-o', join(root, 'LOGO.svg')])]);
    expect(implied.code).toBe(2);
    expect(implied.stderr).toContain('Output must not overwrite a file the diagram uses:');
    // Where the disk ignores letter case, another spelling names the same file.
    if (ignoresCase) {
      expect(named.code).toBe(2);
      expect(named.stderr).toContain('Output must not overwrite a file the diagram uses:');
    } else {
      success(named);
      expect(await readFile(join(root, 'LOGO.svg'), 'utf8')).toContain('<svg');
    }
    expect(await readFile(join(root, 'logo.svg'), 'utf8')).toBe(icon);
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
}
