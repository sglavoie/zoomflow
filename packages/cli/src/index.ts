import { D2 } from '@d2lang/d2';
import { boardLabel, exportBoardsHtml, exportBoardsZip, exportGlyphSource, indexBoards, lint, renderExportBoards, shapeClass, type Diagram } from '@zoomflow/core';
import { offlineViewerScript, offlineViewerStyle } from '@zoomflow/viewer';
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
// Resolve against the installed workspace, never the input file or caller's cwd.
const fontArgs = Object.entries({
  'font-regular': 'Regular', 'font-bold': 'Bold', 'font-italic': 'Italic', 'font-semibold': 'Semibold',
}).map(([flag, face]) => `--${flag}=${fileURLToPath(new URL(`../../../fonts/SourceSansPro-${face}.ttf`, import.meta.url))}`);

/** Native D2 rewrites shape links as file paths when rendering a child alone.
 * Recover the exact compiler links using D2's encoded shape wrapper identity.
 * This matches renderer-generated tags, not authored D2 or arbitrary HTML.
 */
function compilerLinks(svg: string, diagram: Diagram): string {
  const links = new Map(diagram.shapes.map((shape) => [shapeClass(shape.id), shape.link]));
  return svg.replace(/(<a\b[^>]*>)(\s*<g\b[^>]*\bclass="([^"]*)")/g, (match, anchor: string, group: string, classes: string) => {
    const link = classes.split(/\s+/).map((name) => links.get(name)).find(Boolean);
    if (!link) return match;
    const escaped = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return anchor.replace(/((?:xlink:)?href=")[^"]*"/g, (_attribute, prefix: string) => `${prefix}${escaped}"`) + group;
  });
}
/** Point board links at the relative paths of their files in the ZIP, keeping other links. */
function zipLinks(svg: string, from: string, paths: Map<string, string>): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', '#34': '"', lt: '<', gt: '>', apos: "'", '#39': "'" };
  return svg.replace(/((?:xlink:)?href=")([^"]*)"/g, (match, prefix: string, href: string) => {
    const path = paths.get(href.replace(/&(amp|quot|#34|lt|gt|apos|#39);/g, (_entity, name: string) => entities[name]));
    if (path === undefined) return match;
    const link = encodeURI(posix.relative(posix.dirname(from), path)).replace(/[#?]/g, encodeURIComponent);
    return `${prefix}${link.replace(/&/g, '&amp;')}"`;
  });
}
const usage = `Usage:
  zoomflow export file.d2 [--all] [--format svg|png|html] [-o, --output file] [--root directory]
  zoomflow lint file.d2 [--boundary-ports] [--missing-backlink] [--json] [--root directory]
  zoomflow -h | --help | -v | --version`;
const help = `${usage}

SVG/PNG export the root board by default; --all creates a ZIP of every board.
HTML always includes every board in one navigable, self-contained file.
Default output: file.svg, file.png, file.html, or file-svg.zip / file-png.zip;
 -o, --output must use the same extension.
--root bounds local imports and images (default: the input file's directory);
 pass it to import from parent folders. Only the input and the files it imports
 are read. Local zoomflow.d2 files override the bundled stdlib.
Export requires D2 v0.9.0 on PATH. Lint uses the bundled D2 compiler.
Boundary ports are optional; --boundary-ports checks explicit zf-in/zf-out contracts.
--missing-backlink warns about layers without a link back to their parent.
--json prints the lint result to stdout, or {"error", "diagnostics": []} on failure.
Exit codes: 0 success (warnings allowed), 1 lint errors, 2 usage/compile/export failure.`;

class UsageError extends Error {}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

// Matches both D2's raw JSON error text, with escaped quotes, and its decoded messages.
const failedImport = /failed to import \\?"([^"\\]+)\\?": file does not exist/g;

/** Compile from a snapshot of the input and the D2 files it imports; never modify the user's files.
 * D2 names every missing import at once, so each retry loads one more level of nested imports.
 * Returns the snapshot for native export; failures carry why an import could not be loaded.
 */
async function compileSources(d2: D2, root: string, realRoot: string, inputPath: string) {
  const files: Record<string, string> = Object.create(null);
  const problems = new Map<string, string>();
  const library = await readFile(new URL('../../../stdlib/zoomflow.d2', import.meta.url), 'utf8');
  async function load(key: string): Promise<boolean> {
    const path = resolve(root, key);
    if (!within(root, path)) { problems.set(key, `outside --root ${root}; pass --root to include it`); return false; }
    try {
      const entry = await lstat(path);
      if (!entry.isFile()) throw Object.assign(new Error(), { code: entry.isSymbolicLink() ? 'ELOOP' : 'EISDIR' });
      if (!within(realRoot, await realpath(path))) { problems.set(key, `outside --root ${root} through a symlinked directory`); return false; }
      files[key] = await readFile(path, 'utf8');
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // D2 resolves imports relative to their importing file, so the stdlib sits beside every source.
      if (basename(key) === 'zoomflow.d2' && ['ENOENT', 'ELOOP', 'EISDIR'].includes(code)) files[key] = library;
      else if (code === 'ELOOP') problems.set(key, 'symlinks are not followed');
      else if (code === 'EACCES' || code === 'EPERM') problems.set(key, 'cannot read: permission denied');
      else if (code !== 'ENOENT') problems.set(key, `cannot read: ${(error as Error).message || code}`);
    }
    return Object.hasOwn(files, key);
  }
  await load(inputPath);
  const tried = new Set([inputPath]);
  for (;;) {
    try {
      return { compiled: await d2.compile({ fs: files, inputPath, options: { layout: 'elk' } }), files };
    } catch (error) {
      const wanted = [...String((error as Error).message).matchAll(failedImport)].map((match) => match[1]).filter((key) => !tried.has(key));
      wanted.forEach((key) => tried.add(key));
      if (!(await Promise.all(wanted.map(load))).some(Boolean)) throw Object.assign(error as Error, { problems });
    }
  }
}

/** D2 resolves local icons against the entry file, so preserve that layout. Exported for tests. */
export async function stageIcons(diagram: Diagram, input: string, root: string, temp: string) {
  const realRoot = await realpath(root);
  const copied = new Set<string>();
  for (const board of indexBoards(diagram).values()) {
    for (const shape of [board.diagram.root, ...board.diagram.shapes]) {
      // The compiler serializes Go's url.URL as an object, despite its loose TS type.
      const icon = shape.icon as string | { Scheme?: string; Host?: string; Path?: string } | undefined;
      if (!icon || (typeof icon === 'object' && (icon.Scheme || icon.Host))) continue;
      let path = typeof icon === 'string' ? undefined : icon.Path;
      if (typeof icon === 'string') {
        try { path = decodeURIComponent(icon); } catch { throw new Error(`Local image path is not valid URL encoding: ${icon}`); }
      }
      if (!path || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path)) continue;
      const asset = resolve(dirname(input), path);
      if (copied.has(asset)) continue;
      // Compare real paths too, so a symlinked directory cannot reach outside the root.
      // A path that does not resolve has no real path; the regular-file check names why.
      const outside = new Error(`Local image is outside --root: ${asset}`);
      if (!within(root, asset)) throw outside;
      const real = await realpath(asset).catch(() => undefined);
      if (real !== undefined && !within(realRoot, real)) throw outside;
      if (!(await regularFile(asset, relative(process.cwd(), asset)))) throw new Error(`Local image must be a regular file: ${asset}`);
      const staged = join(temp, relative(root, asset));
      await mkdir(dirname(staged), { recursive: true });
      await copyFile(asset, staged);
      copied.add(asset);
    }
  }
}

async function regularFile(path: string, shown: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') throw new Error(`Cannot read ${shown}: no such file`);
    if (code === 'EACCES' || code === 'EPERM') throw new Error(`Cannot read ${shown}: permission denied`);
    throw error;
  }
}

/** D2 ranges are zero-based `file,line:col:byte-line:col:byte`; editors want `file:line:col`. */
function location(range: string | undefined, shown: (path: string) => string): string | undefined {
  const match = range && /^(.+),(\d+):(\d+):\d+-\d+:\d+:\d+$/.exec(range);
  return match ? `${shown(match[1])}:${Number(match[2]) + 1}:${Number(match[3]) + 1}` : undefined;
}

/** D2 reports parse/compile failures as a JSON array of located messages.
 * Explain imports that exist but were not loaded, such as those outside --root.
 */
function compileErrors(message: string, shown: (path: string) => string, problems = new Map<string, string>()): string | undefined {
  try {
    const entries: unknown = JSON.parse(message);
    if (!Array.isArray(entries) || !entries.length || !entries.every((entry) => typeof entry?.errmsg === 'string')) return;
    return entries.map(({ errmsg }: { errmsg: string }) => errmsg.replace(/^(.*?)(?=:\d+:\d+:)/, (path) => shown(path))
      .replace(failedImport, (failure, key: string) => problems.has(key) ? `${failure} (${problems.get(key)})` : failure)).join('\n');
  } catch { return; }
}

// Stage beside the destination so a failed render never replaces a good export.
async function save(output: string, data: string | Uint8Array) {
  try {
    await mkdir(dirname(output), { recursive: true });
    const staging = await mkdtemp(join(dirname(output), '.zoomflow-'));
    try {
      const file = join(staging, 'output');
      await writeFile(file, data);
      await rename(file, output);
    } finally { await rm(staging, { recursive: true, force: true }); }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'EACCES' || code === 'EPERM') throw new Error(`Cannot write ${output}: permission denied`);
    if (code === 'EROFS') throw new Error(`Cannot write ${output}: read-only file system`);
    throw error;
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  // Show paths as the user would type them: relative to cwd for root-relative D2 paths.
  let shown = (path: string) => path;
  // Known before parsing, so a lint --json usage error still prints JSON.
  let json = args.find((arg) => !arg.startsWith('-')) === 'lint' && args.includes('--json');
  try {
    const { values, positionals } = (() => {
      try {
        return parseArgs({ args, allowPositionals: true, options: {
          all: { type: 'boolean' }, format: { type: 'string' }, output: { type: 'string', short: 'o' },
          root: { type: 'string' }, json: { type: 'boolean' },
          'missing-backlink': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
          'boundary-ports': { type: 'boolean' }, version: { type: 'boolean', short: 'v' },
        } });
      } catch (error) { throw new UsageError((error as Error).message); }
    })();
    json = positionals[0] === 'lint' && Boolean(values.json);
    if (values.help) { console.log(help); return 0; }
    if (values.version) {
      const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      console.log(`zoomflow ${version}`);
      return 0;
    }
    const [command, filename] = positionals;
    if (!['lint', 'export'].includes(command)) throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command.');
    if (positionals.length !== 2) throw new UsageError(`${command} takes exactly one .d2 file.`);
    if (command === 'lint' && (values.all || values.format || values.output)) throw new UsageError('Export options cannot be used with lint.');
    if (command === 'export' && (values.json || values['missing-backlink'] || values['boundary-ports'])) throw new UsageError('Lint options cannot be used with export.');
    const format = values.format ?? 'svg';
    if (!['svg', 'png', 'html'].includes(format)) throw new UsageError(`Unsupported format: ${format}`);
    const input = resolve(filename);
    if (extname(input) !== '.d2') throw new UsageError('Input must be a .d2 file.');
    if (!(await regularFile(input, filename))) {
      throw new Error((await lstat(input)).isSymbolicLink() ? 'Input must be a regular file; symlinks are not followed.' : 'Input must be a regular file.');
    }
    const root = resolve(values.root ?? dirname(input));
    const realRoot = await realpath(root).catch(() => { throw new Error(`Root directory not found: ${root}`); });
    if (!(await stat(realRoot)).isDirectory()) throw new Error(`Root is not a directory: ${root}`);
    if (!within(root, input) || !within(realRoot, await realpath(input))) throw new Error('Input must be inside --root.');
    shown = (path) => {
      const rel = relative(process.cwd(), join(root, path));
      return within(process.cwd(), join(root, path)) && rel ? rel : join(root, path);
    };
    const inputPath = relative(root, input).split(sep).join('/');
    const all = values.all || format === 'html';
    const extension = all && format !== 'html' ? '.zip' : `.${format}`;
    const output = resolve(values.output ?? input.slice(0, -3) + (extension === '.zip' ? `-${format}.zip` : extension));
    if (command === 'export' && (output === input || extname(output) === '.d2')) throw new Error('Output must not overwrite D2 source files.');
    if (command === 'export' && extname(output).toLowerCase() !== extension) {
      throw new Error(`Output must end in ${extension} for ${extension === '.zip' ? `--all --format ${format}` : `--format ${format}`}: ${values.output}`);
    }
    if (command === 'export' && (await stat(output).catch(() => undefined))?.isDirectory()) throw new Error(`Output is a directory: ${output}`);
    const d2 = new D2();
    try {
      const { compiled, files: fs } = await compileSources(d2, root, realRoot, inputPath);
      const boards = indexBoards(compiled.diagram);
      if (command === 'lint') {
        const result = lint(compiled, { missingBacklink: values['missing-backlink'], boundaryPorts: values['boundary-ports'] });
        if (values.json) console.log(JSON.stringify(result, null, 2));
        else {
          for (const diagnostic of result.diagnostics) {
            const item = diagnostic.shape ?? diagnostic.connection;
            console.log(`${location(diagnostic.range, shown) ?? shown(inputPath)}: ${diagnostic.severity} ${diagnostic.rule} [${boardLabel(diagnostic.board, boards)}${item ? ` / ${item}` : ''}] ${diagnostic.message}`);
          }
          console.log(`${result.diagnostics.filter((d) => d.severity === 'error').length} errors, ${result.diagnostics.filter((d) => d.severity === 'warning').length} warnings; ${result.boundaryPairsEvaluated} boundary pairs evaluated.`);
        }
        return result.diagnostics.some((item) => item.severity === 'error') ? 1 : 0;
      }
      const temp = await mkdtemp(join(tmpdir(), 'zoomflow-'));
      try {
        for (const [path, source] of Object.entries(fs)) {
          await mkdir(dirname(join(temp, path)), { recursive: true });
          await writeFile(join(temp, path), source);
        }
        await stageIcons(compiled.diagram, input, root, temp);
        // D2 logs progress for every board; keep warnings and errors once, naming the user's files.
        const staged = new RegExp(String.raw`[^\s"'()]*${basename(temp)}/([^\s"'():]*)`, 'g');
        const reported = new Set<string>();
        const messages = (stderr: string) => stderr.split(/\r?\n/)
          .filter((line) => line.trim() && !/^(?:\x1b\[[\d;]*m)*(?:info|success|debug):/.test(line))
          .map((line) => line.replace(staged, (_match, path: string) => shown(path)));
        const render = async (target: string, type: string): Promise<Buffer> => {
          try {
            const result = await exec('d2', ['--layout=elk', '--bundle=true', '--watch=false', ...fontArgs, `--target=${target}`,
              `--stdout-format=${type}`, join(temp, inputPath), '-'],
            { cwd: dirname(input), encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 180_000 });
            for (const line of messages(result.stderr.toString())) {
              if (!reported.has(line)) { reported.add(line); process.stderr.write(`${line}\n`); }
            }
            return result.stdout;
          } catch (error) {
            const failure = error as Error & { code?: string; stderr?: Buffer };
            if (failure.code === 'ENOENT') throw new Error('D2 executable not found. Install D2 v0.9.0 and add d2 to PATH.');
            throw new Error(`D2 export failed: ${messages(failure.stderr?.toString() ?? '').join('\n') || failure.message}`);
          }
        };
        const diagnostics = lint(compiled).diagnostics;
        if (!all) await save(output, await render('', format));
        else {
          const binaries = new Map<string, Buffer>();
          const byTarget = new Map([...boards.values()].map((board) => [board.target, board.diagram]));
          const exported = await renderExportBoards(compiled.diagram, async (target) => {
            const data = await render(target, format === 'html' ? 'svg' : format);
            binaries.set(target, data);
            return format === 'png' ? '' : compilerLinks(data.toString('utf8'), byTarget.get(target)!);
          }, format === 'html' ? diagnostics : [], { concurrency: availableParallelism(), skipEmpty: format === 'html' });
          if (format === 'html') {
            // One extra render gives every board the same font subsets; without it each board keeps its own.
            const glyphSource = exportGlyphSource(exported);
            const glyphFile = join(temp, `.zoomflow-glyphs-${process.pid}.d2`);
            const glyphs = glyphSource ? await writeFile(glyphFile, glyphSource)
              .then(() => exec('d2', ['--layout=elk', '--bundle=true', '--watch=false', ...fontArgs, '--stdout-format=svg', glyphFile, '-'],
                { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 180_000 }))
              .then((result) => result.stdout, () => undefined) : undefined;
            await save(output, exportBoardsHtml(exported, { title: basename(input, '.d2'), script: offlineViewerScript(), style: offlineViewerStyle, glyphs }));
          } else {
            const paths = new Map(exported.map((board) => [board.id, board.path]));
            const files = exported.map((board) => ({ ...board, path: board.path.replace(/\.svg$/, `.${format}`),
              svg: format === 'svg' ? zipLinks(board.svg, board.path, paths) : board.svg }));
            await save(output, exportBoardsZip(files, (board) => format === 'png' ? binaries.get(boards.get(board.id)!.target)! : board.svg));
          }
        }
        const dangling = diagnostics.filter((item) => item.rule === 'dangling-link').length;
        if (dangling) console.error(`zoomflow: ${dangling} dangling link${dangling === 1 ? '' : 's'} (run zoomflow lint)`);
        console.log(output);
        return 0;
      } finally { await rm(temp, { recursive: true, force: true }); }
    } finally { await d2.dispose(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const located = compileErrors(message, shown, (error as { problems?: Map<string, string> }).problems);
    if (located) console.error(located);
    else if (error instanceof UsageError) console.error(`zoomflow: ${message}\n${usage}\nRun zoomflow --help for details.`);
    else console.error(`zoomflow: ${message}`);
    // Keep --json output parseable when there is no lint result to print.
    if (json) console.log(JSON.stringify({ error: located ?? message, diagnostics: [] }, null, 2));
    return 2;
  }
}
