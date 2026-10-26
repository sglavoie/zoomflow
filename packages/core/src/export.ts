import { strToU8, zipSync } from 'fflate';
import { indexBoards, type Diagram } from './index';
import type { LintDiagnostic } from './lint';
import { parentContext, type ParentContext } from './context';

export interface ExportBoard {
  id: string;
  name: string;
  hash: string;
  parent?: string;
  path: string;
  empty: boolean;
  svg: string;
  missingLinks?: LintDiagnostic[];
  parentContext?: ParentContext[];
}

/** Keep Unicode names; replace only what archives or Windows/macOS/Linux file systems reject. */
function segment(name: string): string {
  const safe = name.replace(/[\\/\0-\x1f\x7f<>:"|?*]/g, '_').replace(/[. ]+$/, (tail) => '_'.repeat(tail.length)) || '_';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\.|$)/i.test(safe) ? `_${safe}` : safe;
}

export interface RenderExportOptions {
  /** Maximum simultaneous render calls; results keep tree order. */
  concurrency?: number;
  /** Skip rendering boards without shapes, whose SVG the HTML viewer never shows. */
  skipEmpty?: boolean;
}

/** Render every tree node exactly once, including unlinked and empty boards. */
export async function renderExportBoards(diagram: Diagram, render: (target: string) => Promise<string>,
  diagnostics: readonly LintDiagnostic[] = [], options: RenderExportOptions = {}): Promise<ExportBoard[]> {
  const boards = indexBoards(diagram);
  // Names compare case-insensitively (Windows, macOS); a file and folder may not share one.
  const used = new Set<string>();
  const claim = (folder: string, name: string, suffix = '') => {
    const key = (value: string) => `${folder}${value}${suffix}`.normalize('NFC').toLowerCase();
    while (used.has(key(name))) name = `@${name}`;
    used.add(key(name));
    return name;
  };
  const places = new Map<string, { folder: string; name: string }>();
  const folders = new Map<string, string>();
  const folder = (id: string, kind: string): string => {
    const cached = folders.get(`${id}\0${kind}`);
    if (cached !== undefined) return cached;
    const place = places.get(id)!;
    const base = id === 'root' ? '' : folders.get(`${id}\0layers`) ?? `${place.folder}${claim(place.folder, place.name)}/`;
    folders.set(`${id}\0layers`, base);
    const result = kind === 'layers' ? base : `${base}${claim(base, `@${kind}`)}/`;
    folders.set(`${id}\0${kind}`, result);
    return result;
  };
  const result: ExportBoard[] = [];
  for (const board of boards.values()) {
    const parent = board.parent ? folder(board.parent, board.kind) : '';
    const name = board.parent ? segment(board.name) : 'root';
    places.set(board.id, { folder: parent, name });
    result.push({ id: board.id, name: board.name, hash: board.hash, parent: board.parent,
      path: `${parent}${claim(parent, name, '.svg')}.svg`, empty: board.diagram.shapes.length === 0, svg: '',
      parentContext: parentContext(board, boards),
      missingLinks: diagnostics.filter((item) => item.rule === 'dangling-link' && item.board === board.id && item.shape && item.target) });
  }
  const targets = [...boards.values()].map((board) => board.target);
  const pending = result.map((_, index) => index).filter((index) => !(options.skipEmpty && result[index].empty));
  const failures: unknown[] = [];
  // After a failure, let in-flight renders settle but start no more.
  await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 1), pending.length) }, async () => {
    for (let index = pending.shift(); index !== undefined; index = pending.shift()) {
      try { result[index].svg = await render(targets[index]); }
      catch (error) { failures.push(error); pending.length = 0; }
    }
  }));
  if (failures.length) throw failures[0];
  return result;
}

/** Zip one file per board; `contents` substitutes other renders, such as PNGs, for the SVG. */
export function exportBoardsZip(boards: readonly ExportBoard[],
  contents: (board: ExportBoard) => string | Uint8Array = (board) => board.svg): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const board of boards) {
    if (board.path in files) throw new Error(`Duplicate export path: ${board.path}`);
    const data = contents(board);
    files[board.path] = typeof data === 'string' ? strToU8(data) : data;
  }
  return new Uint8Array(zipSync(files));
}

/** Keep the relative D2 tree intact when a browser project has no writable folder handle. */
export function exportSourcesZip(sources: Record<string, string>): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [path, source] of Object.entries(sources)) {
    const parts = path.split('/');
    if (!path.endsWith('.d2') || parts.some((part) => !part || part === '.' || part === '..') ||
      path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path))
      throw new Error(`Invalid project source path: ${path}`);
    files[path] = strToU8(source);
  }
  if (!Object.keys(files).length) throw new Error('Project has no D2 source files.');
  return new Uint8Array(zipSync(files));
}

const styleBlock = /<style\b[^>]*>(<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/style>/g;
const fontFace = /@font-face\s*\{\s*font-family:\s*"?(d2-\d+)-(font-[\w-]+)"?;\s*src:\s*url\("([^"]+)"\);?\s*\}/g;
const xmlEntity = /&(?:#(\d+)|#x([\da-f]+)|(lt|gt|amp|quot|apos));/gi;
const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (text: string) => text.replace(xmlEntity, (_match, dec?: string, hex?: string, name?: string) =>
  name ? named[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)));
/** D2 scopes each board's CSS by a per-render class on its inner <svg>. */
const scopeOf = (svg: string) => /<svg\b[^>]*\bclass="(d2-\d+) d2-svg"/.exec(svg)?.[1];

/** D2 subsets each board's fonts to that board's text. Rendering this source once yields
 * faces covering every shown board: bold shape labels, regular shapes, italic edge labels.
 */
export function exportGlyphSource(boards: readonly ExportBoard[]): string | undefined {
  const chars = new Set<string>();
  for (const board of boards) {
    if (board.empty) continue;
    const text = unescapeXml(board.svg.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' '));
    for (const char of text) if (!/\s/.test(char)) chars.add(char);
  }
  if (!chars.size) return undefined;
  // Single-quoted D2 strings are literal; only the quote itself needs a double-quoted label.
  const plain = [...chars].filter((char) => char !== "'");
  const labels = plain.length ? Array.from({ length: Math.ceil(plain.length / 100) }, (_, i) => `'${plain.slice(i * 100, i * 100 + 100).join('')}'`) : [];
  if (chars.has("'")) labels.push('"\'"');
  return labels.map((label, i) => `b${i}: ${label}\nr${i}: ${label} {style.bold: false}\nb${i} -> r${i}: ${label}\n`).join('');
}

/** Share font faces with the glyph render, then hoist style blocks the boards repeat.
 * Each distinct block is emitted once under its own class, so per-board rules keep their
 * scope and specificity. A block moves only when every board has the same unscoped rules
 * at that position, and only as part of its board's leading run, so no cascade changes.
 */
function shareStyles(svgs: string[], glyphs?: string): { svgs: string[]; style: string } {
  const scopes = svgs.map(scopeOf);
  if (svgs.length < 2 || scopes.some((scope) => !scope)) return { svgs, style: '' };
  const faces = new Map([...(glyphs ?? '').matchAll(fontFace)].map((match) => [match[2], match[3]]));
  const used = new Set<string>();
  svgs = svgs.map((svg, i) => {
    const scope = scopes[i]!;
    for (const [rule, owner, face] of [...svg.matchAll(fontFace)]) {
      if (owner !== scope || !faces.has(face) || /["<>&]/.test(faces.get(face)!)) continue;
      svg = svg.replace(rule, '').replace(new RegExp(String.raw`${scope}-${face}(?![\w-])`, 'g'), `zf-${face}`);
      used.add(face);
    }
    return svg;
  });
  const blocks = svgs.map((svg, i) => [...svg.matchAll(styleBlock)].map((match) => {
    const css = (match[1] ? match[2] : unescapeXml(match[2])).replace(new RegExp(String.raw`\.${scopes[i]}(?![\w-])`, 'g'), '.zf-scope');
    const hoistable = !css.includes(scopes[i]!) && !/<\/style/i.test(css);
    // Per-board font faces have unique names, so they cannot affect other boards.
    return { raw: match[0], css, hoistable, unscoped: css.replace(/[^{}]*\.zf-scope[^{}]*\{[^{}]*\}|@font-face\s*\{[^{}]*\}/g, '') };
  }));
  let common = 0;
  while (blocks.every((list) => list[common] && list[common].unscoped === blocks[0][common].unscoped)) common++;
  const variants = new Map<string, number>();
  const result = svgs.map((svg, i) => {
    let length = 0;
    while (length < common && blocks[i][length].hoistable) length++;
    const classes = blocks[i].slice(0, length).map((block) => {
      if (!variants.has(block.css)) variants.set(block.css, variants.size);
      svg = svg.replace(block.raw, '');
      return `zf-s${variants.get(block.css)}`;
    });
    return classes.length ? svg.replace(`class="${scopes[i]} d2-svg"`, `class="${scopes[i]} d2-svg ${classes.join(' ')}"`) : svg;
  });
  const fonts = [...used].map((face) => `@font-face{font-family:zf-${face};src:url("${faces.get(face)}")}`);
  const style = [...fonts, ...[...variants].map(([css, index]) => css.replace(/\.zf-scope(?![\w-])/g, `.zf-s${index}`))].join('\n');
  return { svgs: result, style };
}

/** The caller supplies its DOM runtime; core stays usable in Node without a DOM. */
export function exportBoardsHtml(boards: readonly ExportBoard[],
  options: { title: string; script: string; style: string; /** Rendered {@link exportGlyphSource}. */ glyphs?: string }): string {
  const title = options.title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  // The viewer never shows an empty board's SVG.
  const shown = boards.filter((board) => !board.empty);
  const shared = shareStyles(shown.map((board) => board.svg), options.glyphs);
  const embedded = boards.map((board) => ({ ...board, svg: board.empty ? '' : shared.svgs[shown.indexOf(board)] }));
  // SVG labels can contain HTML closing tags. Never embed unescaped JSON in a script.
  const data = JSON.stringify(embedded).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const style = shared.style;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${options.style}</style>${style ? `<style id="zoomflow-svg-style">${style}</style>` : ''}</head><body>
<header><h1>${title}</h1></header><main id="viewer"><nav class="zf-breadcrumbs" aria-label="Breadcrumb"></nav><div class="zf-context" role="group" aria-label="Parent connections" hidden></div><div class="zf-message"><span role="status"></span><span role="alert"></span></div><div class="zf-visually-hidden" aria-live="polite"></div><div class="zf-stage" role="region" aria-label="Diagram" tabindex="-1"></div></main>
<footer>Select a linked shape to explore · Esc or Backspace goes up</footer>
<script id="zoomflow-data" type="application/json">${data}</script><script>${options.script}</script></body></html>`;
}
