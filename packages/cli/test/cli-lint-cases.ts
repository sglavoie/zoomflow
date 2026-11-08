import { readFile, symlink, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exec, repo, cli, temp, run, success, embedded } from './cli-helpers';

export function registerCliLintCases() {

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

  it('counts file links and imports spelled in another letter case as missing, as case-sensitive systems do', async () => {
    const root = join(temp, 'atlas-case');
    await mkdir(join(root, 'Docs'), { recursive: true });
    await Promise.all([writeFile(join(root, 'Docs', 'health.d2'), 'x'), writeFile(join(root, 'imports.d2'), '...@Docs/Health\nq'),
      writeFile(join(root, 'index.d2'), 'A: {link: ./Docs/Health.d2}\nB: {link: ./docs/health.d2}\nC: {link: ./Docs/health.d2}')]);
    const [linked, imported] = await Promise.all([run(['lint', join(root, 'index.d2'), '--follow', '--json']), run(['lint', join(root, 'imports.d2')])]);
    expect(linked.code).toBe(1);
    const result = JSON.parse(linked.stdout);
    expect(result.files).toEqual(['index.d2', 'Docs/health.d2']);
    expect(result.diagnostics.map((item: { rule: string; shape: string }) => [item.rule, item.shape]))
      .toEqual([['dangling-file-link', 'A'], ['dangling-file-link', 'B']]);
    expect(imported.code).toBe(2);
    expect(imported.stderr).toMatch(/failed to import "Docs\/Health\.d2": file does not exist/);
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

  it('does not redirect invalid imported links to valid files beside a deeper entry', async () => {
    const root = join(temp, 'atlas-invalid-imported');
    await Promise.all(['lib', 'work/deep/dist'].map(folder => mkdir(join(root, folder), { recursive: true })));
    const input = join(root, 'work/deep/index.d2');
    await Promise.all([
      writeFile(input, '...@../../lib/part\nvalid.link: ../../other.d2\nlocal.link: ./dist/other.d2'),
      writeFile(join(root, 'lib/part.d2'), 'outside.link: ../../other.d2\nmissing.link: ./dist/other.d2\noutside -> missing: {link: ../../other.d2}'),
      writeFile(join(root, 'other.d2'), 'other'),
      writeFile(join(root, 'work/deep/dist/other.d2'), 'local'),
    ]);
    const zip = join(root, 'atlas.zip'), html = join(root, 'atlas.html');
    const results = await Promise.all([run(['export', input, '--root', root, '--all', '-o', zip]),
      run(['export', input, '--root', root, '-o', html])]);
    results.forEach(success);
    const hrefs = (svg: string) => [...svg.matchAll(/ href="([^"]*)"/g)].map(match => match[1]);
    expect(hrefs(strFromU8(unzipSync(await readFile(zip))['root.svg']))).toEqual([
      '@files/other.d2/root.svg', '@files/work/deep/dist/other.d2/root.svg',
    ]);
    expect(hrefs(embedded(await readFile(html, 'utf8'))[0].svg)).toEqual(['../../other.d2', './dist/other.d2']);
    for (const result of results) expect(result.stderr).toContain('3 dangling links');
  }, 180_000);

  it('keeps the lint exit code when its reader closes the output early', async () => {
    const input = join(temp, 'many-warnings.d2');
    await writeFile(input, Array.from({ length: 1500 }, (_, i) => `layers.L${i}: {}`).join('\n'));
    const { stdout, stderr } = await exec('bash', ['-c', `"$0" "$1" lint "$2" --json | head -c 1 >/dev/null; echo "\${PIPESTATUS[0]}"`,
      process.execPath, cli, input], { cwd: repo, timeout: 180_000 });
    expect(stderr).toBe('');
    expect(stdout).toBe('0\n');
  });


  it('prints a JSON error object for lint --json failures', async () => {
    const input = join(temp, 'invalid-json.d2');
    await writeFile(input, 'x: {');
    const result = await run(['lint', input, '--json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({ error: `${input}:1:4: maps must be terminated with }`, diagnostics: [] });
    const usage = await Promise.all([['lint', 'a.d2', '--json', '--all'], ['lint', '--json'], ['lint', 'a.d2', 'b.d2', '--json'],
      ['lint', 'a.d2', '--json', '--bogus'], ['lint', 'a.d2', '--json', '--root'], ['--root', '.', 'lint', 'a.d2', '--json', '--bogus'],
      ['-o', 'x', '--format', 'svg', 'lint', 'a.d2', '--json'], ['lint', 'a.d2', '--json=1']].map((args) => run(args)));
    expect(usage.map((item) => [item.code, JSON.parse(item.stdout)])).toEqual([
      [2, { error: 'Export options cannot be used with lint.', diagnostics: [] }],
      [2, { error: 'lint takes exactly one .d2 file.', diagnostics: [] }],
      [2, { error: 'lint takes exactly one .d2 file.', diagnostics: [] }],
      [2, { error: expect.stringContaining("Unknown option '--bogus'"), diagnostics: [] }],
      [2, { error: expect.stringContaining("Option '--root <value>' argument missing"), diagnostics: [] }],
      [2, { error: expect.stringContaining("Unknown option '--bogus'"), diagnostics: [] }],
      [2, { error: 'Export options cannot be used with lint.', diagnostics: [] }],
      [2, { error: expect.stringContaining("Option '--json' does not take an argument"), diagnostics: [] }],
    ]);
    // Parse failures outside lint --json keep stdout empty.
    expect((await run(['lint', 'a.d2', '--bogus'])).stdout).toBe('');
  });
}
