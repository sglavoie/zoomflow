import { D2 } from '@d2lang/d2';
import { boardLabel, classifyHref, exportAtlasHtml, exportAtlasZip, exportBoardsHtml, exportBoardsZip, exportGlyphSource, indexBoards, lint,
  renderExportBoards, resolveFilePath, shapeClass, type AtlasDocument, type Diagram, type ExportBoard, type LintOptions, type LintResult } from '@zoomflow/core';
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
    // Escape whitespace too: XML attribute normalization would turn it into spaces.
    const escaped = link.replace(/[&"<\t\n\r]/g, (char) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;' })[char] ?? `&#${char.charCodeAt(0)};`);
    return anchor.replace(/((?:xlink:)?href=")[^"]*"/g, (_attribute, prefix: string) => `${prefix}${escaped}"`) + group;
  });
}
const entities: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'" };
const unescapeXml = (text: string) => text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|lt|gt|apos));/gi,
  (_entity, dec?: string, hex?: string, name?: string) => name ? entities[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)));
/** Keep web and mail links, and board and file links where the export can follow them, as browser exports do.
 * Other anchors stay but lose their href, so `javascript:` and `data:` links never reach the output.
 * `files` says whether the export holds the file a link's relative path opens.
 */
function safeLinks(svg: string, boards: boolean, files?: (path: string) => boolean): string {
  return svg.replace(/<a\b(?:[^>"]|"[^"]*")*>/g, (anchor) => anchor.replace(/\s(?:xlink:)?href="([^"]*)"/g, (attribute, href: string) => {
    const link = classifyHref(unescapeXml(href));
    return link.kind === 'external' || (boards && link.kind === 'board') || (link.kind === 'file' && files?.(link.path)) ? attribute : '';
  }));
}
/** The project paths of the files a diagram's file links open, in board order, each once. */
function linkedFiles(diagram: Diagram, path: string): string[] {
  const paths = new Set<string>();
  for (const board of indexBoards(diagram).values()) {
    for (const item of [...board.diagram.shapes, ...board.diagram.connections]) {
      const link = classifyHref(item.link ?? '');
      const target = link.kind === 'file' ? resolveFilePath(path, link.path) : undefined;
      if (target !== undefined) paths.add(target);
    }
  }
  return [...paths];
}
/** Point board links at the relative paths of their files in the ZIP, keeping other links. */
function zipLinks(svg: string, from: string, paths: Map<string, string>): string {
  return svg.replace(/((?:xlink:)?href=")([^"]*)"/g, (match, prefix: string, href: string) => {
    const path = paths.get(unescapeXml(href));
    if (path === undefined) return match;
    const link = encodeURI(posix.relative(posix.dirname(from), path)).replace(/[#?]/g, encodeURIComponent);
    return `${prefix}${link.replace(/&/g, '&amp;')}"`;
  });
}
const usage = `Usage:
  zoomflow export file.d2 [--all] [--format svg|png|html] [-o, --output file] [--root directory]
  zoomflow lint file.d2 [--follow] [--boundary-ports] [--missing-backlink] [--json] [--root directory]
  zoomflow -h | --help | -v | --version`;
const help = `${usage}

SVG/PNG export the root board by default; --all creates a ZIP of every board.
HTML always includes every board in one navigable, self-contained file.
HTML and --all also include every file reachable through file links (link: ./other.d2):
 HTML as one atlas, ZIPs with each file's boards under @files/<path>/.
Default output: file.svg, file.png, file.html, or file-svg.zip / file-png.zip;
 -o, --output must use the same extension, which sets the format when --format is absent.
--root bounds local imports and images (default: the input file's directory);
 pass it to import from parent folders. Only the input and the files it imports
 are read. Local zoomflow.d2 files override the bundled stdlib.
Export requires D2 v0.9.0 on PATH. Lint uses the bundled D2 compiler.
Boundary ports are optional; --boundary-ports checks explicit zf-in/zf-out contracts.
--missing-backlink warns about layers without a link back to their parent.
Lint checks that file links open .d2 files inside --root; --follow also lints every
 file reachable through file links, once each, naming each diagnostic's file.
--json prints the lint result to stdout, or {"error", "diagnostics": []} on failure.
Exit codes: 0 success (warnings allowed), 1 lint errors, 2 usage/compile/export failure.`;

class UsageError extends Error {}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Whether a project path names a regular file inside --root, by the real-path rules imports follow. */
async function projectFile(root: string, realRoot: string, key: string): Promise<boolean> {
  const path = resolve(root, key);
  if (!within(root, path)) return false;
  try { return (await lstat(path)).isFile() && within(realRoot, await realpath(path)); } catch { return false; }
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
      // Only a missing file falls back; a local zoomflow.d2 that cannot be used is reported, not silently replaced.
      if (basename(key) === 'zoomflow.d2' && code === 'ENOENT') files[key] = library;
      else if (code === 'ELOOP') problems.set(key, 'symlinks are not followed');
      else if (code === 'EISDIR') problems.set(key, 'not a regular file');
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
      const icon = shape.icon as string | { Scheme?: string; Host?: string; Path?: string; Opaque?: string } | undefined;
      // A one-letter scheme is a Windows drive (`C:\\img.png`), so the path is local.
      const drive = !!icon && typeof icon === 'object' && /^[a-z]$/i.test(icon.Scheme ?? '') && !icon.Host;
      if (!icon || (typeof icon === 'object' && (icon.Scheme || icon.Host) && !drive)) continue;
      let path = typeof icon === 'string' ? undefined : drive ? `${icon.Scheme}:${icon.Opaque || icon.Path}` : icon.Path;
      if (typeof icon === 'string') {
        try { path = decodeURIComponent(icon); } catch { throw new Error(`Local image path is not valid URL encoding: ${icon}`); }
      }
      if (!path || (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path) && !/^[a-z]:/i.test(path))) continue;
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
      // D2 0.9 opens the URL-escaped path beside the entry file, as `my%20icon.svg`, so stage that name too.
      const escaped = join(temp, dirname(relative(root, input)), relative(dirname(input), asset).split(sep).map(escapePath).join(sep));
      if (escaped !== staged) {
        await mkdir(dirname(escaped), { recursive: true });
        await copyFile(asset, escaped);
      }
      copied.add(asset);
    }
  }
}

/** Escape a path segment as Go's url.URL does. */
function escapePath(segment: string) {
  return [...new TextEncoder().encode(segment)].map((byte) => {
    const char = String.fromCharCode(byte);
    return /[\w.~$&+,:;=@-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

async function regularFile(path: string, shown: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new Error(`Cannot read ${shown}: no such file`);
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
  // Skip option values: in `--root . lint`, the command is lint, not the root.
  const valued = new Set(['--root', '--format', '--output', '-o']);
  let json = args.find((arg, i) => !arg.startsWith('-') && !valued.has(args[i - 1])) === 'lint' && args.includes('--json');
  try {
    const { values, positionals } = (() => {
      try {
        return parseArgs({ args, allowPositionals: true, options: {
          all: { type: 'boolean' }, format: { type: 'string' }, output: { type: 'string', short: 'o' },
          root: { type: 'string' }, json: { type: 'boolean' }, follow: { type: 'boolean' },
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
    if (command === 'lint' && (values.all || values.format !== undefined || values.output !== undefined)) throw new UsageError('Export options cannot be used with lint.');
    if (command === 'export' && (values.json || values.follow || values['missing-backlink'] || values['boundary-ports'])) throw new UsageError('Lint options cannot be used with export.');
    // Without --format, an -o extension other than .zip chooses it.
    const implied = /^\.(svg|png|html)$/i.exec(extname(values.output ?? ''))?.[1];
    const format = (values.format ?? implied ?? 'svg').toLowerCase();
    if (!['svg', 'png', 'html'].includes(format)) throw new UsageError(`Unsupported format: ${values.format || '""'}`);
    if (values.output === '') throw new UsageError('Output path is empty.');
    let input = resolve(filename);
    if (extname(input).toLowerCase() !== '.d2') throw new UsageError('Input must be a .d2 file.');
    if (!(await regularFile(input, filename))) {
      throw new Error((await lstat(input)).isSymbolicLink() ? 'Input must be a regular file; symlinks are not followed.' : 'Input must be a regular file.');
    }
    const root = resolve(values.root ?? dirname(input));
    const realRoot = await realpath(root).catch((error: { code?: string }) => {
      if (error.code === 'EACCES' || error.code === 'EPERM') throw new Error(`Cannot read root directory ${root}: permission denied`);
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error(`Root directory not found: ${root}`);
      throw error;
    });
    if (!(await stat(realRoot)).isDirectory()) throw new Error(`Root is not a directory: ${root}`);
    // The real path decides; an input named through the other side of a symlinked root is moved onto the root's side.
    const realInput = await realpath(input);
    if (!within(realRoot, realInput)) throw new Error('Input must be inside --root.');
    if (!within(root, input)) input = join(root, relative(realRoot, realInput));
    shown = (path) => {
      const rel = relative(process.cwd(), join(root, path));
      return within(process.cwd(), join(root, path)) && rel ? rel : join(root, path);
    };
    const inputPath = relative(root, input).split(sep).join('/');
    const all = values.all || format === 'html';
    const extension = all && format !== 'html' ? '.zip' : `.${format}`;
    const output = resolve(values.output ?? input.slice(0, -3) + (extension === '.zip' ? `-${format}.zip` : extension));
    if (command === 'export' && (output === input || extname(output).toLowerCase() === '.d2')) throw new Error('Output must not overwrite D2 source files.');
    if (command === 'export' && !all && extname(output).toLowerCase() === '.zip') throw new Error(`A .zip output needs --all: ${values.output}`);
    if (command === 'export' && extname(output).toLowerCase() !== extension) {
      // Name --format only when it was given; otherwise the format came from -o or the default.
      if (values.format !== undefined) {
        throw new Error(`Output must end in ${extension} for ${extension === '.zip' ? `--all --format ${format}` : `--format ${format}`}: ${values.output}`);
      }
      if (extension === '.zip') {
        throw new Error(`Output must end in .zip, since --all writes every board: ${values.output}${format === 'png' ? '. For PNG images, use -o out.zip --format png.' : ''}`);
      }
      throw new Error(`Output must end in .svg, .png or .html, or pass --format: ${values.output}`);
    }
    if (command === 'export' && (await stat(output).catch(() => undefined))?.isDirectory()) throw new Error(`Output is a directory: ${output}`);
    const d2 = new D2();
    try {
      type Compiled = Awaited<ReturnType<typeof compileSources>>;
      type FileLinks = NonNullable<LintOptions['files']>;
      // Each file compiles once, however many links reach it.
      const compiledFiles = new Map<string, Promise<Compiled>>();
      const compileFile = (path: string) => {
        if (!compiledFiles.has(path)) compiledFiles.set(path, compileSources(d2, root, realRoot, path));
        return compiledFiles.get(path)!;
      };
      /** Check file links against the .d2 files inside --root; compiling each linked file names its boards. */
      const fileLinks = async (path: string, diagram: Diagram): Promise<FileLinks> => {
        const found = new Map<string, ReadonlySet<string> | undefined>();
        for (const target of linkedFiles(diagram, path)) {
          if (!(await projectFile(root, realRoot, target))) continue;
          const linked = await compileFile(target).catch(() => undefined);
          found.set(target, linked && new Set([...indexBoards(linked.compiled.diagram).values()].map((board) => board.hash)));
        }
        return { inputPath: path, exists: (target) => found.has(target), boards: (target) => found.get(target) };
      };
      /** The input, then with `follow` every file its file links reach, breadth first and each once, so cycles end.
       * With `skip`, a linked file that does not compile is left out with a warning instead of failing. */
      const reach = async (follow: boolean, skip: boolean) => {
        const queue = [inputPath];
        const reached: (Compiled & { path: string; links: FileLinks })[] = [];
        for (const path of queue) {
          let file: Compiled;
          try { file = await compileFile(path); } catch (error) {
            if (!skip || path === inputPath) throw error;
            const { message, problems } = error as Error & { problems?: Map<string, string> };
            console.error(`zoomflow: left out ${shown(path)}, which links open: ${compileErrors(message, shown, problems) ?? message}`);
            continue;
          }
          const links = await fileLinks(path, file.compiled.diagram);
          reached.push({ ...file, path, links });
          if (follow) queue.push(...linkedFiles(file.compiled.diagram, path).filter((target) => links.exists(target) && !queue.includes(target)));
        }
        return reached;
      };
      if (command === 'lint') {
        const linted = (await reach(Boolean(values.follow), false)).map((file) => ({ ...file, boards: indexBoards(file.compiled.diagram),
          result: lint(file.compiled, { missingBacklink: values['missing-backlink'], boundaryPorts: values['boundary-ports'], files: file.links }) }));
        // Followed results name the file of each diagnostic and boundary.
        const result: LintResult & { files?: string[] } = values.follow ? {
          files: linted.map((file) => file.path),
          diagnostics: linted.flatMap((file) => file.result.diagnostics.map((item) => ({ file: file.path, ...item }))),
          boundaryPairsEvaluated: linted.reduce((sum, file) => sum + file.result.boundaryPairsEvaluated, 0),
          boundaries: linted.flatMap((file) => file.result.boundaries.map((item) => ({ file: file.path, ...item }))),
        } : linted[0].result;
        if (values.json) console.log(JSON.stringify(result, null, 2));
        else {
          for (const { path, boards, result: { diagnostics } } of linted) {
            for (const diagnostic of diagnostics) {
              const item = diagnostic.shape ?? diagnostic.connection;
              console.log(`${location(diagnostic.range, shown) ?? shown(path)}: ${diagnostic.severity} ${diagnostic.rule} [${boardLabel(diagnostic.board, boards)}${item ? ` / ${item}` : ''}] ${diagnostic.message}`);
            }
          }
          const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
          const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
          const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length;
          const pairs = values['boundary-ports'] ? `; ${count(result.boundaryPairsEvaluated, 'boundary pair')} evaluated` : '';
          console.log(`${count(errors, 'error')}, ${count(warnings, 'warning')}${pairs}${values.follow ? ` in ${count(linted.length, 'file')}` : ''}.`);
        }
        return result.diagnostics.some((item) => item.severity === 'error') ? 1 : 0;
      }
      // A lone board cannot follow links, so only multi-board exports bundle linked files.
      const documents = (await reach(all, true)).map((file) => ({ ...file, diagnostics: lint(file.compiled, { files: file.links }).diagnostics }));
      const temp = await mkdtemp(join(tmpdir(), 'zoomflow-'));
      try {
        for (const file of documents) {
          for (const [path, source] of Object.entries(file.files)) {
            await mkdir(dirname(join(temp, path)), { recursive: true });
            await writeFile(join(temp, path), source);
          }
          await stageIcons(file.compiled.diagram, join(root, file.path), root, temp);
        }
        // D2 logs progress for every board; keep warnings and errors once, naming the user's files.
        const staged = new RegExp(String.raw`[^\s"'()]*${basename(temp)}[\\/]([^\s"'():]*)`, 'g');
        const reported = new Set<string>();
        const messages = (stderr: string) => stderr.split(/\r?\n/)
          .filter((line) => line.trim() && !/^(?:\x1b\[[\d;]*m)*(?:info|success|debug):/.test(line))
          .map((line) => line.replace(staged, (_match, path: string) => shown(path)));
        const render = async (path: string, target: string, type: string): Promise<Buffer> => {
          try {
            const result = await exec('d2', ['--layout=elk', '--bundle=true', '--watch=false', ...fontArgs, `--target=${target}`,
              `--stdout-format=${type}`, join(temp, path), '-'],
            { cwd: dirname(join(root, path)), encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 180_000 });
            for (const line of messages(result.stderr.toString())) {
              if (!reported.has(line)) { reported.add(line); process.stderr.write(`${line}\n`); }
            }
            return result.stdout;
          } catch (error) {
            const failure = error as Error & { code?: string; killed?: boolean; signal?: string | null; stderr?: Buffer };
            if (failure.code === 'ENOENT') throw new Error('D2 executable not found. Install D2 v0.9.0 and add d2 to PATH.');
            if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('D2 export failed: the rendered output was too large.');
            if (failure.killed) throw new Error('D2 export timed out after 3 minutes.');
            if (failure.signal) throw new Error(`D2 export stopped by ${failure.signal}.`);
            throw new Error(`D2 export failed: ${messages(failure.stderr?.toString() ?? '').join('\n') || failure.message}`);
          }
        };
        // A lone board's links to other boards lead nowhere.
        if (!all) await save(output, format === 'svg' ? safeLinks((await render(inputPath, '', format)).toString('utf8'), false) : await render(inputPath, '', format));
        else {
          // File links are kept only when the export holds their file, which may be the entry file itself.
          const bundled = new Set(documents.map((file) => file.path));
          const atlas = documents.some((file) => linkedFiles(file.compiled.diagram, file.path).some((target) => bundled.has(target)));
          const binaries = new Map<string, Buffer>();
          const rendered: AtlasDocument[] = [];
          for (const file of documents) {
            const boards = [...indexBoards(file.compiled.diagram).values()];
            const byTarget = new Map(boards.map((board) => [board.target, board]));
            const follows = atlas ? (path: string) => bundled.has(resolveFilePath(file.path, path) ?? '') : undefined;
            const exported = await renderExportBoards(file.compiled.diagram, async (target) => {
              const data = await render(file.path, target, format === 'html' ? 'svg' : format);
              if (format === 'png') binaries.set(JSON.stringify([file.path, byTarget.get(target)!.id]), data);
              return format === 'png' ? '' : safeLinks(compilerLinks(data.toString('utf8'), byTarget.get(target)!.diagram), true, follows);
            }, format === 'html' ? file.diagnostics : [], { concurrency: availableParallelism(), skipEmpty: format === 'html' });
            rendered.push({ path: file.path, name: file.path.replace(/\.d2$/i, ''), boards: exported });
          }
          if (format === 'html') {
            // One extra render gives every board the same font subsets; without it each board keeps its own.
            const glyphSource = exportGlyphSource(rendered.flatMap((document) => document.boards));
            const glyphFile = join(temp, `.zoomflow-glyphs-${process.pid}.d2`);
            const glyphs = glyphSource ? await writeFile(glyphFile, glyphSource)
              .then(() => exec('d2', ['--layout=elk', '--bundle=true', '--watch=false', ...fontArgs, '--stdout-format=svg', glyphFile, '-'],
                { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 180_000 }))
              .then((result) => result.stdout, () => undefined) : undefined;
            const options = { title: basename(input).slice(0, -3), script: offlineViewerScript(), style: offlineViewerStyle, glyphs };
            await save(output, atlas ? exportAtlasHtml(rendered, options) : exportBoardsHtml(rendered[0].boards, options));
          } else {
            const placed = rendered.map((document) => {
              const paths = new Map(document.boards.map((board) => [board.id, board.path]));
              return { ...document, boards: document.boards.map((board) => ({ ...board, path: board.path.replace(/\.svg$/, `.${format}`),
                svg: format === 'svg' ? zipLinks(board.svg, board.path, paths) : board.svg })) };
            });
            const contents = (board: ExportBoard) => format === 'png' ? binaries.get(JSON.stringify([board.file ?? inputPath, board.id]))! : board.svg;
            await save(output, atlas ? exportAtlasZip(placed, contents) : exportBoardsZip(placed[0].boards, contents));
          }
        }
        const dangling = documents.flatMap((file) => file.diagnostics).filter((item) => item.rule === 'dangling-link' || item.rule === 'dangling-file-link').length;
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
