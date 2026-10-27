import type { Diagram } from '@d2lang/d2';
export { parentContext, type ParentContext } from './context';
export { renderExportBoards, exportBoardsZip, exportSourcesZip, exportBoardsHtml, exportGlyphSource, type ExportBoard } from './export';
export type { Diagram, CompileResponse, RenderOptions } from '@d2lang/d2';
export { boardBlocks, indexShapeSources, parseSourceRange, shapeRanges, type SourceRange, type ShapeSource } from './source';
export { lint, boardLabel, type LintRule, type LintDiagnostic, type LintOptions, type LintResult, type BoundaryEvaluation } from './lint';

export interface Board {
  id: string;
  name: string;
  target: string;
  hash: string;
  parent?: string;
  kind: 'root' | 'layers' | 'scenarios' | 'steps';
  diagram: Diagram;
}

/** Quote a board name as the pinned D2 compiler does in the link IDs it emits:
 * key specials, `--`, a trailing `-` or edge whitespace force double quotes.
 * Names containing a quote or backslash never survive as compiled links, so escaping them is moot.
 */
export function boardKey(name: string): string {
  return name === '' || /["'.:;|*&()<>@#$\\{}[\]]|--|-$|^\s|\s$/.test(name)
    ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
}

/** D2's shape class: padded URL-safe base64 of the HTML-escaped ID's UTF-8 bytes.
 * Self-contained because the offline viewer embeds its source. */
export function shapeClass(id: string): string {
  const escaped = id.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&#34;' })[char]!);
  return btoa(Array.from(new TextEncoder().encode(escaped), (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_');
}

/** Enumerate the board tree, never the potentially cyclic graph of links. */
export function indexBoards(diagram: Diagram): Map<string, Board> {
  const boards = new Map<string, Board>();
  function visit(node: Diagram, id: string, target: string, hash: string,
    kind: Board['kind'], parent?: string) {
    boards.set(id, { id, name: node.name || 'Root', target, hash, kind, parent, diagram: node });
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) {
        if (!child) continue;
        const segment = `${group}.${boardKey(child.name)}`;
        const route = group === 'layers' ? '' : `@${group}/`;
        visit(child, `${id}.${segment}`, target ? `${target}.${segment}` : segment,
          `${hash === '#/' ? '#' : hash}/${route}${encodeURIComponent(child.name)}`, group, id);
      }
    }
  }
  visit(diagram, 'root', '', '#/', 'root');
  return boards;
}

export type ClassifiedHref =
  | { kind: 'board'; target: string }
  | { kind: 'external'; url: string }
  /** A link to another diagram file: `path` stays relative as authored; `hash` is `''` or a `#/…` board route. */
  | { kind: 'file'; path: string; hash: string }
  | { kind: 'invalid'; href: string };

/** D2 emits absolute board IDs; ancestor links include `_` after compilation.
 * A `./` or `../` path ending in `.d2`, optionally followed by a `#/…` board route, links to another file.
 * Self-contained because the offline viewer embeds its source. */
export function classifyHref(href: string): ClassifiedHref {
  if (href === 'root' || /^root\.(layers|scenarios|steps)\..+/.test(href)) return { kind: 'board', target: href };
  const file = /^(\.\.?\/[^#]*\.d2)(#\/.*)?$/s.exec(href);
  if (file) return { kind: 'file', path: file[1], hash: file[2] ?? '' };
  try {
    const url = new URL(href);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return { kind: 'external', url: href };
  } catch { /* Relative and executable URLs are not navigation targets. */ }
  return { kind: 'invalid', href };
}

/** Resolve a file link against the project path of the file that contains it, as D2 resolves imports.
 * Undefined when the result climbs above the project root or is not a valid project `.d2` path.
 * Self-contained because the offline viewer embeds its source. */
export function resolveFilePath(fromPath: string, relativePath: string): string | undefined {
  const parts = fromPath.split('/').slice(0, -1);
  for (const part of relativePath.split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (!parts.length) return;
      parts.pop();
    } else parts.push(part);
  }
  const path = parts.join('/');
  // The rules of `validProjectPath`: no empty, dot or hidden folder segments, and no build folders.
  const valid = parts.length > 0 && parts.every((part, index) => part && part !== '.' && part !== '..' &&
    (index === parts.length - 1 || !part.startsWith('.')) && !['node_modules', 'dist', 'coverage'].includes(part)) &&
    path.endsWith('.d2') && !path.includes('\\') && !path.includes('\0') && !/^[A-Za-z]:/.test(path);
  return valid ? path : undefined;
}

/** The route of a board in another file of an atlas: `#/@file/<path>` then the board's own segments.
 * `@` is reserved for `@scenarios`/`@steps` and board names are percent-encoded, so it cannot collide.
 * Self-contained because the offline viewer embeds its source. */
export function atlasHash(path: string, boardHash: string): string {
  const rest = boardHash.replace(/^#?\/?/, '');
  return `#/@file/${encodeURIComponent(path)}${rest ? `/${rest}` : ''}`;
}

/** Split an atlas route into its file path, if any, and that file's board hash.
 * A route without `@file` belongs to the entry file. Self-contained because the offline viewer embeds its source. */
export function parseAtlasHash(hash: string): { path?: string; hash: string } {
  const match = /^#\/@file\/([^/]+)(?:\/(.*))?$/s.exec(hash);
  if (!match) return { hash: hash || '#/' };
  let path = match[1];
  try { path = decodeURIComponent(path); } catch { /* Keep the raw segment; it names no file. */ }
  return { path, hash: `#/${match[2] ?? ''}` };
}
