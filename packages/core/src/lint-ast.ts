import { boardKey, classifyHref, type Board } from './index';
import { definedClasses } from './classes';
import type { LintInput } from './lint-types';

// Only the compiler AST fields needed to recover links D2 removes from shapes.
export interface AstString { range?: string; value?: string | { string?: string }[]; pattern?: string[] }

export interface AstValue {
  unquoted_string?: AstString;
  double_quoted_string?: AstString;
  single_quoted_string?: AstString;
  block_string?: { range?: string; value?: string };
  boolean?: { value?: boolean };
  number?: { raw?: string };
  import?: AstImport;
  map?: AstMap;
}

export interface AstImport { spread?: boolean; pre?: string; path?: AstValue[] }

export interface AstKey {
  range?: string;
  key?: { path?: AstValue[] };
  edges?: { src?: { path?: AstValue[] }; src_arrow?: string; dst?: { path?: AstValue[] }; dst_arrow?: string }[];
  edge_index?: { int?: number; glob?: boolean };
  edge_key?: { path?: AstValue[] };
  primary?: AstValue;
  value?: AstValue;
  ampersand?: boolean;
  not_ampersand?: boolean;
}

export interface AstMap { range?: string; nodes?: { map_key?: AstKey; import?: AstImport }[] }

export interface LintGraph {
  name?: string;
  ast?: AstMap;
  layers?: LintGraph[];
  scenarios?: LintGraph[];
  steps?: LintGraph[];
}

export function stringValue(value?: AstValue): string | undefined {
  const scalar = value?.unquoted_string ?? value?.double_quoted_string ?? value?.single_quoted_string;
  return typeof scalar?.value === 'string' ? scalar.value
    : scalar?.value?.map((part) => part.string ?? '').join('');
}

/** The text of an unquoted key segment: a quoted one, such as `"layers"`, is an ordinary shape, never a keyword. */
export const keyword = (value?: AstValue) => value?.unquoted_string ? stringValue(value) : undefined;

export function scalarRange(value?: AstValue): string | undefined {
  return (value?.unquoted_string ?? value?.double_quoted_string ?? value?.single_quoted_string)?.range;
}

/** Quote a key segment as D2 does in compiled shape IDs, so `"a b"` is `a b` but `"a.b"` stays quoted. Unlike link
 * targets, shape IDs leave `$` bare and spell `null` in any case as `'null'`. */
export function keySegment(value: AstValue): string {
  const name = stringValue(value) ?? '';
  if (name.toLowerCase() === 'null') return "'null'";
  const plain = name.replaceAll('$', '_');
  return boardKey(plain) === plain ? name : boardKey(name);
}

/** D2 rewrites a connection's link to a board named `null` in any case, such as `NULL`, as `'null'`. */
export const nulled = (id: string) => id.replace(/(^|\.)(?:'null'|null)(?=\.|$)/gi, "$1'null'");

/** The scalar of an edge's last `link` assignment, from `(a -> b)[0].link: x` or `a -> b: {link: x}`. */
export function edgeLink(entry: AstKey): AstValue | undefined {
  const value = (key: AstKey) => stringValue(key.value) !== undefined ? key.value : key.primary;
  if (entry.edge_key) {
    const path = entry.edge_key.path ?? [];
    return path.length === 1 && stringValue(path[0]) === 'link' ? value(entry) : undefined;
  }
  const link = (entry.value?.map?.nodes ?? []).map((node) => node.map_key)
    .filter((key) => key?.key?.path?.length === 1 && stringValue(key.key.path[0]) === 'link').at(-1);
  return link && value(link);
}

/** Re-quote an authored board path the way D2 quotes compiled links (`layers."a b"` is `layers.a b`). */
export function canonicalLink(href: string): string {
  const segments: string[] = [];
  const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^."']*[^."'\s]|))\s*(\.|$)/y;
  for (let match = pattern.exec(href); match; match = pattern.exec(href)) {
    segments.push(match[1]?.replace(/\\(.)/g, '$1') ?? match[2] ?? match[3]);
    if (match[4]) continue;
    // URLs and other non-board text keep their authored form.
    if (pattern.lastIndex !== href.length || !['_', 'root', 'layers', 'scenarios', 'steps'].includes(segments[0])) break;
    return segments.map(boardKey).join('.');
  }
  return href;
}

export function boardTarget(href: string, board: Board, boards: Map<string, Board>): string | undefined {
  const classified = classifyHref(href);
  if ('target' in classified) return classified.target;
  if (classified.kind === 'external') return;
  let base = board;
  let path = href;
  while (path === '_' || path.startsWith('_.')) {
    if (!base.parent) return;
    base = boards.get(base.parent)!;
    path = path === '_' ? '' : path.slice(2);
  }
  return path === '' ? base.id : /^(layers|scenarios|steps)\./.test(path) ? `${base.id}.${path}` : undefined;
}

/** Name a board, or a missing board below an existing one, by its breadcrumb trail. */
export function boardLabel(id: string, boards: Map<string, Board>): string {
  let board = boards.get(id), rest = '';
  if (!board) {
    const ancestor = [...boards.keys()].filter((key) => id.startsWith(`${key}.`)).sort((a, b) => b.length - a.length)[0];
    if (!ancestor) return id;
    board = boards.get(ancestor);
    rest = id.slice(ancestor.length + 1);
  }
  // Missing segments keep D2's quoting (`layers."x.y"`); name them as authored.
  const names: string[] = [];
  let named = true;
  for (const [, quoted, single, plain] of rest.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^."']+)/g)) {
    if (named && plain && ['layers', 'scenarios', 'steps'].includes(plain)) { named = false; continue; }
    const name = quoted?.replace(/\\(.)/g, '$1') ?? single ?? plain;
    if (named && names.length) names[names.length - 1] += `.${name}`;
    else names.push(name);
    named = true;
  }
  for (let item = board; item; item = item.parent ? boards.get(item.parent) : undefined) names.unshift(item.name);
  return names.join(' > ');
}

/** Classes each board can use. Child boards carry compiler-expanded ASTs with every inherited and
 * imported class; the root AST keeps its imports, so its files are read instead, when given. */
export function boardClasses(compiled: LintInput): Map<string, Set<string> | undefined> {
  const classes = new Map<string, Set<string> | undefined>();
  classes.set('root', compiled.fs && compiled.inputPath ? definedClasses(compiled.fs, compiled.inputPath) : undefined);
  function visit(graph: LintGraph, id: string) {
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of graph[group] ?? []) {
        const childId = `${id}.${group}.${boardKey(child.name ?? '')}`;
        const names = new Set<string>();
        for (const node of child.ast?.nodes ?? []) {
          const parts = node.map_key?.key?.path ?? [];
          const path = parts.map((part) => stringValue(part) ?? '');
          if (keyword(parts[0]) !== 'classes') continue;
          if (path.length > 1) names.add(path[1]);
          else for (const entry of node.map_key?.value?.map?.nodes ?? []) {
            const name = stringValue(entry.map_key?.key?.path?.[0]);
            if (name) names.add(name);
          }
        }
        classes.set(childId, names);
        visit(child, childId);
      }
    }
  }
  visit(compiled.graph as LintGraph, 'root');
  return classes;
}
