import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { Diagram } from '@zoomflow/core';
import { stageIcons } from '../src/index';
import { repo, temp, run, success } from './cli-helpers';

export function registerCliFilesCases() {

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

  it('refuses icon URLs that D2 would open as paths outside --root, keeping web and data URLs', async () => {
    const project = join(temp, 'icon-urls');
    await mkdir(join(project, 'root'), { recursive: true });
    await writeFile(join(project, 'secret.txt'), 'TOKEN=icon-secret');
    // Go cleans `..` lexically after the scheme, host, query or fragment, so each climbs from the staging folder.
    const up = `${'../'.repeat(40)}${project.replace(/^\//, '')}/secret.txt`;
    const icons = [`zz:/${up}`, `#/${up}`, `/${project}/secret.txt`, `./a.svg?/${up}`, `mailto:${up}`];
    const results = await Promise.all(icons.map(async (icon, i) => {
      await writeFile(join(project, 'root', `url-${i}.d2`), `a: { icon: "${icon}" }`);
      return run(['export', join(project, 'root', `url-${i}.d2`), '-o', join(project, `url-${i}.html`)]);
    }));
    results.forEach((result) => {
      expect(result.code, result.stdout).toBe(2);
      expect(result.stderr).toContain('Local image must be a file path, not a URL:');
    });
    const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const diagram = (icon: unknown) => ({ name: '', shapes: [{ link: '', icon }], connections: [], root: { link: '' } }) as unknown as Diagram;
    for (const icon of [svg, 'HTTPS://example.com/a.svg', { Scheme: 'https', Host: 'example.com', Path: '/a.svg' }, { Scheme: 'data', Opaque: 'image/png;base64,AA==' }]) {
      await expect(stageIcons(diagram(icon), join(project, 'root', 'a.d2'), join(project, 'root'), join(project, 'stage'))).resolves.toEqual(new Set());
    }
    await expect(stageIcons(diagram({ Scheme: '', Host: 'private', Path: '/etc/hosts' }), join(project, 'root', 'a.d2'), join(project, 'root'),
      join(project, 'stage'))).rejects.toThrow('Local image must be a file path, not a URL: //private/etc/hosts');
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
    const manifest = JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8'));
    for (const flag of ['--version', '-v']) {
      const version = await run([flag]);
      success(version);
      expect(version.stdout).toBe(`zoomflow ${manifest.version}\n`);
    }
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

  it('reads an input spelled in another letter case than on disk as the disk spells it', async () => {
    const root = join(temp, 'case-input');
    await mkdir(join(root, 'sub'), { recursive: true });
    await Promise.all([writeFile(join(root, 'sub', 'a.d2'), '...@b\nx'), writeFile(join(root, 'sub', 'b.d2'), 'y')]);
    // A case-sensitive disk has no other spelling to read.
    if (!existsSync(join(root, 'Sub'))) return;
    const result = await run(['lint', join(root, 'Sub', 'a.d2'), '--root', root]);
    success(result);
    expect(result.stdout).toBe('0 errors, 0 warnings.\n');
  });

  it('names why an unreadable input cannot be read', async () => {
    if (process.getuid?.() === 0) return;
    const input = join(temp, 'unreadable.d2');
    await writeFile(input, 'a');
    await chmod(input, 0o000);
    try {
      const result = await run(['lint', input]);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe('zoomflow: unreadable.d2: cannot read: permission denied\n');
    } finally { await chmod(input, 0o644); }
  });

  it('refuses an empty --root', async () => {
    const result = await run(['lint', 'fixtures/lint/labelled.d2', '--root=']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('zoomflow: Root path is empty.');
  });
}
