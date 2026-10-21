import { D2 } from '@d2lang/d2';
import { boardLabel, exportBoardsHtml, exportGlyphSource, indexBoards, lint, renderExportBoards, type Diagram } from '@zoomflow/core';
import { offlineViewerScript, offlineViewerStyle } from '@zoomflow/viewer';
import { strToU8, zipSync } from 'fflate';
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
function htmlLinks(svg: string, diagram: Diagram): string {
  const links = new Map(diagram.shapes.map((shape) => [
    Buffer.from(shape.id).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), shape.link,
  ]));
  return svg.replace(/(<a\b[^>]*>)(\s*<g\b[^>]*\bclass="([^"]*)")/g, (match, anchor: string, group: string, classes: string) => {
    const link = classes.split(/\s+/).map((name) => links.get(name)).find(Boolean);
    if (!link) return match;
    const escaped = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return anchor.replace(/((?:xlink:)?href=")[^"]*"/g, (_attribute, prefix: string) => `${prefix}${escaped}"`) + group;
  });
}
const usage = `Usage:
  zoomflow export file.d2 [--all] [--format svg|png|html] [-o output] [--root directory]
  zoomflow lint file.d2 [--boundary-ports] [--missing-backlink] [--json] [--root directory]
  zoomflow --help | --version`;
const help = `${usage}

SVG/PNG export the root board by default; --all creates a ZIP of every board.
HTML always includes every board in one navigable, self-contained file.
Default output: file.svg, file.png, file.html, or file-svg.zip / file-png.zip;
 -o must use the same extension.
--root bounds local imports (default: cwd if it contains the input, otherwise
 the input directory). Local zoomflow.d2 files override the bundled stdlib.
Export requires D2 v0.9.0 on PATH. Lint uses the bundled D2 compiler.
Boundary ports are optional; --boundary-ports checks explicit zf-in/zf-out contracts.
Exit codes: 0 success (warnings allowed), 1 lint errors, 2 usage/compile/export failure.
`;

class UsageError extends Error {}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Snapshot D2 sources once for both compilers; do not modify the user's files. */
async function sources(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = Object.create(null);
  const library = await readFile(new URL('../../../stdlib/zoomflow.d2', import.meta.url), 'utf8');
  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    const prefix = relative(root, directory).split(sep).join('/');
    const key = (name: string) => prefix ? `${prefix}/${name}` : name;
    // D2 resolves imports relative to their importing file, including nested imports.
    files[key('zoomflow.d2')] = library;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'coverage'].includes(entry.name)) {
        await visit(join(directory, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.d2')) {
        files[key(entry.name)] = await readFile(join(directory, entry.name), 'utf8');
      }
    }
  }
  await visit(root);
  return files;
}

/** D2 resolves local icons against the entry file, so preserve that layout. */
async function stageIcons(diagram: Diagram, input: string, root: string, temp: string) {
  const copied = new Set<string>();
  for (const board of indexBoards(diagram).values()) {
    for (const shape of [board.diagram.root, ...board.diagram.shapes]) {
      // The compiler serializes Go's url.URL as an object, despite its loose TS type.
      const icon = shape.icon as string | { Scheme?: string; Host?: string; Path?: string } | undefined;
      if (!icon || (typeof icon === 'object' && (icon.Scheme || icon.Host))) continue;
      const path = typeof icon === 'string' ? decodeURIComponent(icon) : icon.Path;
      if (!path || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path)) continue;
      const asset = resolve(dirname(input), path);
      if (copied.has(asset)) continue;
      if (!within(root, asset)) throw new Error(`Local image is outside --root: ${asset}`);
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
    if ((error as { code?: string }).code === 'ENOENT') throw new Error(`cannot read ${shown}: no such file`);
    throw error;
  }
}

/** D2 ranges are zero-based `file,line:col:byte-line:col:byte`; editors want `file:line:col`. */
function location(range: string | undefined, shown: (path: string) => string): string | undefined {
  const match = range && /^(.+),(\d+):(\d+):\d+-\d+:\d+:\d+$/.exec(range);
  return match ? `${shown(match[1])}:${Number(match[2]) + 1}:${Number(match[3]) + 1}` : undefined;
}

/** D2 reports parse/compile failures as a JSON array of located messages. */
function compileErrors(message: string, shown: (path: string) => string): string | undefined {
  try {
    const entries: unknown = JSON.parse(message);
    if (!Array.isArray(entries) || !entries.length || !entries.every((entry) => typeof entry?.errmsg === 'string')) return;
    return entries.map(({ errmsg }: { errmsg: string }) => errmsg.replace(/^(.*?)(?=:\d+:\d+:)/, (path) => shown(path))).join('\n');
  } catch { return; }
}

// Stage beside the destination so a failed render never replaces a good export.
async function save(output: string, data: string | Uint8Array) {
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.zoomflow-'));
  try {
    const file = join(staging, 'output');
    await writeFile(file, data);
    await rename(file, output);
  } finally { await rm(staging, { recursive: true, force: true }); }
}


export async function main(args = process.argv.slice(2)): Promise<number> {
  // Show paths as the user would type them: relative to cwd for root-relative D2 paths.
  let shown = (path: string) => path;
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
    if (values.help) { console.log(help); return 0; }
    if (values.version) {
      const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      console.log(`zoomflow ${version}`);
      return 0;
    }
    const [command, filename] = positionals;
    if (!['lint', 'export'].includes(command)) throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command.');
    if (positionals.length !== 2) throw new UsageError(`${command} takes exactly one .d2 file.`);
    if (command === 'lint' && (values.all || values.format || values.output)) throw new Error('Export options cannot be used with lint.');
    if (command === 'export' && (values.json || values['missing-backlink'] || values['boundary-ports'])) throw new Error('Lint options cannot be used with export.');
    const format = values.format ?? 'svg';
    if (!['svg', 'png', 'html'].includes(format)) throw new Error(`Unsupported format: ${format}`);
    const input = resolve(filename);
    if (extname(input) !== '.d2') throw new Error('Input must be a .d2 file.');
    if (!(await regularFile(input, filename))) throw new Error('Input must be a regular file; symlinks are not followed.');
    const root = resolve(values.root ?? (within(process.cwd(), input) ? process.cwd() : dirname(input)));
    if (!within(root, input)) throw new Error('Input must be inside --root.');
    shown = (path) => {
      const rel = relative(process.cwd(), join(root, path));
      return within(process.cwd(), join(root, path)) && rel ? rel : join(root, path);
    };
    const fs = await sources(root);
    const inputPath = relative(root, input).split(sep).join('/');
    if (!Object.hasOwn(fs, inputPath)) throw new Error(`Input not found (symlinks are not followed): ${input}`);
    const all = values.all || format === 'html';
    const extension = all && format !== 'html' ? '.zip' : `.${format}`;
    const output = resolve(values.output ?? input.slice(0, -3) + (extension === '.zip' ? `-${format}.zip` : extension));
    if (command === 'export' && (output === input || extname(output) === '.d2')) throw new Error('Output must not overwrite D2 source files.');
    if (command === 'export' && extname(output).toLowerCase() !== extension) {
      throw new Error(`Output must end in ${extension} for ${extension === '.zip' ? `--all --format ${format}` : `--format ${format}`}: ${values.output}`);
    }
    const d2 = new D2();
    try {
      const compiled = await d2.compile({ fs, inputPath, options: { layout: 'elk' } });
      const boards = indexBoards(compiled.diagram);
      if (command === 'lint') {
        const result = lint(compiled, { missingBacklink: values['missing-backlink'], boundaryPorts: values['boundary-ports'] });
        if (values.json) console.log(JSON.stringify(result, null, 2));
        else {
          for (const diagnostic of result.diagnostics) {
            console.log(`${location(diagnostic.range, shown) ?? shown(inputPath)}: ${diagnostic.severity} ${diagnostic.rule} [${boardLabel(diagnostic.board, boards)}${diagnostic.shape ? ` / ${diagnostic.shape}` : ''}] ${diagnostic.message}`);
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
            return format === 'png' ? '' : format === 'html' ? htmlLinks(data.toString('utf8'), byTarget.get(target)!) : data.toString('utf8');
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
            const archive: Record<string, Uint8Array> = Object.create(null);
            exported.forEach((board) => {
              const target = boards.get(board.id)!.target;
              archive[board.path.replace(/\.svg$/, `.${format}`)] = format === 'png' ? binaries.get(target)! : strToU8(board.svg);
            });
            await save(output, zipSync(archive));
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
    const located = compileErrors(message, shown);
    if (located) console.error(located);
    else if (error instanceof UsageError) console.error(`zoomflow: ${message}\n${usage}\nRun zoomflow --help for details.`);
    else console.error(`zoomflow: ${message}`);
    return 2;
  }
}
