import type { Diagram } from '@d2lang/d2';
export { parentContext, type ParentContext } from './context';
export { renderExportBoards, exportBoardsZip, exportSourcesZip, exportBoardsHtml, exportGlyphSource, type ExportBoard } from './export';
export type { Diagram, CompileResponse, RenderOptions } from '@d2lang/d2';
export { indexShapeSources, parseSourceRange, shapeRanges, type SourceRange, type ShapeSource } from './source';
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
  | { kind: 'invalid'; href: string };

/** D2 emits absolute board IDs; ancestor links include `_` after compilation. */
export function classifyHref(href: string): ClassifiedHref {
  if (href === 'root' || /^root\.(layers|scenarios|steps)\..+/.test(href)) return { kind: 'board', target: href };
  try {
    const url = new URL(href);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return { kind: 'external', url: href };
  } catch { /* Relative and executable URLs are not navigation targets. */ }
  return { kind: 'invalid', href };
}
