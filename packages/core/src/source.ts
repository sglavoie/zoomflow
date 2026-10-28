import { boardKey, classifyHref, indexBoards, resolveFilePath, type Board, type Diagram } from './index';

export interface SourceRange { from: number; to: number }
export interface ShapeSource extends SourceRange { board: string; shape: string }

/** The pinned d2.js compiler emits UTF-16 offsets, like CodeMirror. */
export function parseSourceRange(range: string, source: string, filename = 'index'): SourceRange | undefined {
  const match = /^(.*),\d+:\d+:(\d+)-\d+:\d+:(\d+)$/.exec(range);
  if (!match || match[1] !== filename) return;
  const from = Number(match[2]), to = Number(match[3]);
  if (from > to || to > source.length) return;
  return { from, to };
}

// Single-quoted keys carry their text as a plain string; other strings as a list of pieces.
type AstKeySegment = Record<string, { range?: string; value?: string | { string?: string }[] }>;
const keyText = (part: AstKeySegment) => {
  const values = Object.values(part)[0]?.value;
  if (typeof values === 'string') return values;
  return Array.isArray(values) && values.every((value) => typeof value.string === 'string') ? values.map((value) => value.string).join('') : undefined;
};

interface SourceReference { key?: { range?: string; path?: AstKeySegment[] }; key_path_index?: number; map_key_edge_index?: number }
// D2's public types omit these serialized graph fields (including parents).
interface SourceGraph {
  name?: string;
  objects?: {
    box?: { TopLeft?: { x: number; y: number }; Width: number; Height: number };
    references?: SourceReference[];
    attributes?: Record<string, unknown>;
  }[];
  layers?: SourceGraph[];
  scenarios?: SourceGraph[];
  steps?: SourceGraph[];
}

/** Join serialized objects to shapes by their unique compiled box, not local
 * names (which collide in containers). These boxes are never animation geometry.
 */
function visitShapeObjects(diagram: Diagram, graph: unknown,
  visitor: (board: string, shape: string, object: NonNullable<SourceGraph['objects']>[number]) => void) {
  const boards = indexBoards(diagram);
  function visit(node: SourceGraph, id: string) {
    const board = boards.get(id);
    if (!board) return;
    for (const object of node.objects ?? []) {
      const box = object.box;
      if (!box?.TopLeft) continue;
      // Graph layout keeps fractional coordinates; Diagram truncates to integers.
      const shapes = board.diagram.shapes.filter((shape) => shape.pos.x === Math.trunc(box.TopLeft!.x) &&
        shape.pos.y === Math.trunc(box.TopLeft!.y) && shape.width === Math.trunc(box.Width) && shape.height === Math.trunc(box.Height));
      if (shapes.length === 1) visitor(id, shapes[0].id, object);
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) visit(child, `${id}.${group}.${boardKey(child.name ?? '')}`);
    }
  }
  visit(graph as SourceGraph, 'root');
}

/** Yields every raw D2 reference range of each shape, which may name an imported file. */
function visitShapeReferences(diagram: Diagram, graph: unknown,
  visitor: (board: string, shape: string, range: string, reference: SourceReference) => void) {
  visitShapeObjects(diagram, graph, (board, shape, object) => {
    for (const reference of object.references ?? []) {
      const part = reference.key?.path?.[reference.key_path_index ?? 0];
      const raw = part ? Object.values(part).find((value) => value.range)?.range : reference.key?.range;
      if (raw) visitor(board, shape, raw, reference);
    }
  });
}

/** Each shape's compiled attributes, such as `{shape: {value: 'circle'}}`, keyed by board ID and shape ID; glob
 * filters such as `&shape: circle` compare against these, not the rendered diagram's fields. */
export function shapeAttributes(diagram: Diagram, graph: unknown): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  visitShapeObjects(diagram, graph, (board, shape, object) => {
    if (object.attributes) result.set(JSON.stringify([board, shape]), object.attributes);
  });
  return result;
}

/** Ambiguous or imported references are omitted rather than selecting wrong text. */
export function indexShapeSources(diagram: Diagram, graph: unknown, source: string, filename = 'index'): ShapeSource[] {
  const result: ShapeSource[] = [];
  visitShapeReferences(diagram, graph, (board, shape, raw) => {
    const range = parseSourceRange(raw, source, filename);
    if (range && range.from < range.to) result.push({ board, shape, ...range });
  });
  return result;
}

/** First raw D2 range per shape, keyed by board ID and shape ID. */
export function shapeRanges(diagram: Diagram, graph: unknown): Map<string, string> {
  const result = new Map<string, string>();
  visitShapeReferences(diagram, graph, (board, shape, raw) => {
    const key = JSON.stringify([board, shape]);
    if (!result.has(key)) result.set(key, raw);
  });
  return result;
}

const rangeFile = (range: string | undefined) => /^(.+),\d+:\d+:\d+-\d+:\d+:\d+$/.exec(range ?? '')?.[1];

/** The files that mention each shape, keyed by board ID and shape ID; `visitor` sees each mention. */
export function shapeFiles(compiled: { diagram: Diagram; graph: unknown },
  visitor?: (key: string, file: string, reference: SourceReference) => void): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  visitShapeReferences(compiled.diagram, compiled.graph, (board, shape, raw, reference) => {
    // Compiler-expanded ASTs carry placeholder ranges without a file.
    const file = rangeFile(raw);
    if (file === undefined) return;
    const key = JSON.stringify([board, shape]);
    if (!files.has(key)) files.set(key, new Set());
    files.get(key)!.add(file);
    visitor?.(key, file, reference);
  });
  return files;
}

/** The unquoted segments of a compiled shape ID, such as `c."a.b"`. */
export function idSegments(id: string): string[] {
  return [...id.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^.]+)/g)].map(([, double, single, plain]) => double?.replace(/\\(.)/g, '$1') ?? single ?? plain);
}
/** Whether a glob key path, where `*` matches within a segment and `**` any number of them, names a shape ID. */
export function globMatches(pattern: GlobSegment[], id: string[]): boolean {
  const match = (p: number, s: number): boolean => {
    if (p === pattern.length) return s === id.length;
    const part = pattern[p];
    if (part.glob && part.text === '**') {
      for (let next = s + 1; next <= id.length; next++) if (match(p + 1, next)) return true;
      return false;
    }
    if (s === id.length) return false;
    const same = part.glob ? new RegExp(`^${part.text.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(id[s])
      : part.text.toLowerCase() === id[s].toLowerCase();
    return same && match(p + 1, s + 1);
  };
  return match(0, 0);
}
/** Whether a shape passes a glob filter, as D2 reads them: by the shape's compiled attributes, such as `shape` or
 * `style.fill`, with `level` from 0, and `leaf` and `connected` from the board. An attribute the shape lacks never
 * matches, nor, in this D2, does `id`. */
export function filterMatches(filter: GlobFilter, board: Board, shape: Diagram['shapes'][number], attributes: Record<string, unknown>): boolean {
  const segments = idSegments(shape.id);
  const inside = (other: string) => {
    const path = idSegments(other);
    return path.length > segments.length && segments.every((segment, index) => segment === path[index]);
  };
  let actual: string | undefined;
  if (filter.key === 'connected') actual = String(board.diagram.connections.some((item) => item.src === shape.id || item.dst === shape.id));
  else if (filter.key === 'leaf') actual = String(!board.diagram.shapes.some((item) => inside(item.id)));
  else if (filter.key === 'level') actual = String(segments.length - 1);
  else if (filter.key !== 'id') {
    let value: unknown = attributes;
    for (const key of filter.key.split('.')) value = (value as Record<string, unknown> | undefined)?.[key];
    const scalar = (value as { value?: unknown } | undefined)?.value;
    if (typeof scalar === 'string') actual = scalar;
    // D2 keeps an icon as a parsed URL.
    const url = filter.key === 'icon' ? value as { Scheme?: string; Opaque?: string; Host?: string; Path?: string; RawQuery?: string; Fragment?: string } | undefined : undefined;
    if (url?.Scheme !== undefined) actual = `${url.Scheme ? `${url.Scheme}:` : ''}${url.Opaque || `${url.Host ? `//${url.Host}` : ''}${url.Path ?? ''}`}` +
      `${url.RawQuery ? `?${url.RawQuery}` : ''}${url.Fragment ? `#${url.Fragment}` : ''}`;
  }
  const pattern = filter.glob ? new RegExp(`^${filter.value.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's') : undefined;
  const hit = actual !== undefined && (pattern ? pattern.test(actual) : actual === filter.value);
  return filter.negate ? !hit : hit;
}
/** The file each kept shape and connection link was written in, keyed by board ID and shape or connection ID.
 * D2 rewrites the image paths of imported files but keeps their links verbatim, so a file link resolves from
 * the file that wrote it: that of a `shape.link` or `shape: {link: x}` reference, else that of the last glob that
 * sets it, else that of the class that set it, else the one file that mentions the shape (both ends, for a
 * connection), else the one such file whose text holds the link. Links left out cannot be told apart; callers
 * resolve them from the entry file.
 */
export function linkSources(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string> }): Map<string, string> {
  const explicit = new Map<string, string>();
  const files = shapeFiles(compiled, (key, file, reference) => {
    const path = reference.key?.path ?? [];
    const index = reference.key_path_index ?? 0;
    if (path.length === index + 2 && keyText(path[index + 1]) === 'link') explicit.set(key, file);
    else if (path.length === index + 1 && (reference.map_key_edge_index ?? -1) < 0) {
      // `a: {link: x}` names the link in the map after the key.
      const end = /,\d+:\d+:\d+-\d+:\d+:(\d+)$/.exec(reference.key?.range ?? '')?.[1];
      const text = compiled.fs?.[file];
      if (end !== undefined && text !== undefined && mapLink(text, Number(end))?.link) explicit.set(key, file);
    }
  });
  const entry = rangeFile((compiled.graph as { ast?: { range?: string } }).ast?.range);
  const rules = compiled.fs && entry !== undefined ? fileLinkRules(compiled.fs, entry) : undefined;
  let attributes: Map<string, Record<string, unknown>> | undefined;
  /** The file of the last glob that applies to the shape, when it set the shape's link. Globs at the top of the entry
   * file and its imports apply to the root board and the scenarios and steps that inherit it, and an imported file's
   * globs only to the shapes that file writes. */
  const globFile = (board: Board, shape: Diagram['shapes'][number], key: string) => {
    if (!rules?.globs.length || /\.layers\./.test(`${board.id}.`)) return;
    const glob = [...rules.globs].reverse().find((item) => globMatches(item.path, idSegments(shape.id))
      && (item.file === entry || files.get(key)?.has(item.file))
      && (!item.filters.length || item.filters.every((filter) => {
        const found = (attributes ??= shapeAttributes(compiled.diagram, compiled.graph)).get(key);
        return found && filterMatches(filter, board, shape, found);
      })));
    return glob?.link.href === shape.link ? glob.file : undefined;
  };
  // A class's link resolves from the file that defines the class, which need not mention the shape.
  const classes = rules?.classes ?? new Map<string, AuthoredLink>();
  const classFile = (shape: Diagram['shapes'][number]) => {
    const link = (shape.classes ?? []).map((name) => classes.get(name)).filter(Boolean).at(-1);
    return link?.href === shape.link ? rangeFile(link.range) : undefined;
  };
  const pick = (candidates: string[], link: string) => {
    if (candidates.length < 2) return candidates[0];
    const holding = candidates.filter((file) => compiled.fs?.[file]?.includes(link));
    return holding.length === 1 ? holding[0] : undefined;
  };
  const result = new Map<string, string>();
  for (const board of indexBoards(compiled.diagram).values()) {
    const mentions = (id: string) => [...files.get(JSON.stringify([board.id, id])) ?? []];
    for (const shape of board.diagram.shapes) {
      const key = JSON.stringify([board.id, shape.id]);
      const file = shape.link ? explicit.get(key) ?? globFile(board, shape, key) ?? classFile(shape) ?? pick(mentions(shape.id), shape.link) : undefined;
      if (file !== undefined) result.set(key, file);
    }
    for (const connection of board.diagram.connections) {
      const dst = mentions(connection.dst);
      const file = connection.link ? pick(mentions(connection.src).filter((item) => dst.includes(item)), connection.link) : undefined;
      if (file !== undefined) result.set(JSON.stringify([board.id, connection.id]), file);
    }
  }
  return result;
}

/** A link as written: its text and where. */
export interface AuthoredLink { href: string; range: string }
type Scalar = { value: string; from: number; to: number };

const spaces = /[ \t]*/y;
const doubleQuoted = /"((?:[^"\\\n]|\\.)*)"/y;
const singleQuoted = /'((?:[^'\n]|'')*)'/y;
const unquoted = /(?:\$\{[^}\n]*\}|[^;{}\n#\\]|\\.)*/y;
const pipes = /\|+`*/y;
const sticky = (pattern: RegExp, text: string, index: number) => { pattern.lastIndex = index; return pattern.exec(text); };

/** A string starting at `from`, after spaces, or undefined for anything else, such as an array or an import.
 * Unquoted text ends at a `;`, a brace, a line break or a `#`, which starts a comment even mid-word, as D2 reads
 * `./x.d2#/A` as `./x.d2`. Substitutions such as `${x}` are kept as written. */
function scalarAt(text: string, from: number): Scalar | undefined {
  const start = from + sticky(spaces, text, from)![0].length;
  const quoted = text[start] === '"' ? sticky(doubleQuoted, text, start) : text[start] === "'" ? sticky(singleQuoted, text, start) : null;
  if (quoted) return { value: text[start] === '"' ? quoted[1].replace(/\\(.)/g, '$1') : quoted[1].replaceAll("''", "'"), from: start, to: start + quoted[0].length };
  if (text[start] === '|') {
    // Block strings close with the reverse of the pipes and backticks that opened them, as `|`md` with `` `| ``.
    const open = sticky(pipes, text, start)![0];
    const close = text.indexOf([...open].reverse().join(''), start + open.length);
    if (close < 0) return;
    const value = text.slice(start + open.length, close).replace(/^\w*[ \t\n]/, '').trim();
    return { value, from: start, to: close + open.length };
  }
  const plain = sticky(unquoted, text, start)![0].trimEnd();
  if (!plain || /^[`[@'"]/.test(plain)) return;
  return { value: plain.replace(/\\(.)/g, '$1'), from: start, to: start + plain.length };
}

/** The offset of each statement of the map body starting at `from`, up to its closing brace, or of a whole file
 * (`file`), skipping strings, block strings, comments and nested maps; undefined when the text does not balance. */
function statements(text: string, from: number, file = false): number[] | undefined {
  const starts = [from];
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === '\n' || char === ';') { if (depth === 0) starts.push(i + 1); }
    else if (char === '\\') i++;
    else if (char === '#') {
      i = text.indexOf('\n', i) - 1;
      if (i < 0) break;
    } else if (char === '{') depth++;
    else if (char === '}' && depth-- === 0) return file ? undefined : starts;
    else if (text.startsWith('"""', i)) {
      // A block comment, which may hold anything.
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 2;
    }
    // Only a token opens a string: the quote in `Don't` or the pipe in `x: in | out` is label text.
    else if ((char === '"' || char === "'") && /[\s:;{[]/.test(text[i - 1] ?? '\n') || char === '|' && /:[ \t]*$/.test(text.slice(Math.max(from, i - 40), i))) {
      const string = scalarAt(text, i);
      if (string) i = string.to - 1;
    }
  }
  return file && depth === 0 ? starts : undefined;
}

/** A glob filter, as `&shape: circle` or `!&label: A*`; `glob` marks an unquoted value, where `*` matches any text. */
export type GlobFilter = { key: string; value: string; glob: boolean; negate: boolean };
const linkKey = /\s*(?:link|"link"|'link')[ \t]*:/y;
const filterKey = /\s*(!?)&([^:;{}\n#]+?)[ \t]*:/y;
/** The last `link` value among the statements of the map opening after the colon at or after `from`, as in
 * `: label {link: x}`, and the glob filters the map holds. */
function mapLink(text: string, from: number): { link?: Scalar; filters: GlobFilter[] } | undefined {
  const colon = /[ \t]*:/y;
  if (!sticky(colon, text, from)) return;
  let i = colon.lastIndex;
  if (!/^[ \t]*\{/.test(text.slice(i, i + 80))) {
    const label = scalarAt(text, i);
    if (!label) return;
    i = label.to;
  }
  const brace = sticky(/[ \t]*\{/y, text, i);
  if (!brace) return;
  let link: Scalar | undefined;
  const filters: GlobFilter[] = [];
  for (const start of statements(text, i + brace[0].length) ?? []) {
    const filter = sticky(filterKey, text, start);
    const value = filter && scalarAt(text, filterKey.lastIndex);
    if (filter) {
      if (!value) return { filters: [] };
      filters.push({ key: filter[2].trim(), value: value.value, glob: !/["']/.test(text[value.from]), negate: filter[1] === '!' });
    } else if (sticky(linkKey, text, start)) link = scalarAt(text, linkKey.lastIndex) ?? link;
  }
  return { link, filters };
}

/** A D2 range for `from` to `to` in `file`, as `file,line:column:offset-line:column:offset`. */
function textRange(file: string, text: string, from: number, to: number): string {
  const position = (offset: number) => {
    const line = text.lastIndexOf('\n', offset - 1) + 1;
    let lines = 0;
    for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) lines++;
    return `${lines}:${offset - line}:${offset}`;
  };
  return `${file},${position(from)}-${position(to)}`;
}
/** An unquoted `null`, in any case, removes the link, so it reads as none. */
const authored = (file: string, text: string, scalar: Scalar): AuthoredLink =>
  ({ href: /^null$/i.test(scalar.value) && !/["'|]/.test(text[scalar.from]) ? '' : scalar.value, range: textRange(file, text, scalar.from, scalar.to) });

/** The link written after the key ending at `range`'s end, in `a.link: x` form, read from the file's text; the
 * compiler's own value can be substituted or resolved, as in child boards. */
export function linkAfterKey(range: string | undefined, fs: Record<string, string> | undefined): AuthoredLink | undefined {
  const match = /^(.+),\d+:\d+:\d+-\d+:\d+:(\d+)$/.exec(range ?? '');
  const text = match ? fs?.[match[1]] : undefined;
  if (text === undefined) return;
  const colon = sticky(/[ \t]*:/y, text, Number(match![2]));
  const scalar = colon && scalarAt(text, Number(match![2]) + colon[0].length);
  return scalar ? authored(match![1], text, scalar) : undefined;
}

/** The links of shapes written in imported files, keyed by board ID and shape ID, read from each file's text at
 * the shape's references; the last assignment wins. Lint needs them because the root AST keeps imports as
 * references and child ASTs hold D2's resolved values, so `other.d2` reads as a board path there. */
export function importedLinks(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string> }): Map<string, AuthoredLink> {
  const result = new Map<string, AuthoredLink>();
  const entry = /^(.*),/.exec((compiled.graph as { ast?: { range?: string } }).ast?.range ?? '')?.[1];
  visitShapeReferences(compiled.diagram, compiled.graph, (board, shape, _raw, reference) => {
    const range = /^(.+),\d+:\d+:\d+-\d+:\d+:(\d+)$/.exec(reference.key?.range ?? '');
    const text = range && range[1] !== entry ? compiled.fs?.[range[1]] : undefined;
    const path = reference.key?.path ?? [];
    const index = reference.key_path_index ?? 0;
    if (text === undefined || (reference.map_key_edge_index ?? -1) >= 0) return;
    // `a.link: x` names the link in its key; `a: {link: x}` in the map after it.
    const inMap = path.length === index + 1 ? mapLink(text, Number(range![2]))?.link : undefined;
    const link = path.length === index + 2 && keyText(path[index + 1]) === 'link' ? linkAfterKey(reference.key?.range, compiled.fs)
      : inMap && authored(range![1], text, inMap);
    if (link) result.set(JSON.stringify([board, shape]), link);
  });
  return result;
}

/** A glob key path segment: its text, and whether it is an unquoted pattern such as `*` or `a*`. */
export type GlobSegment = { text: string; glob: boolean };
const keyPart = /\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\n]|'')*)'|([^.:;{}\n#"'&]*[^.:;{}\n#"'\s&]))\s*(\.|(?=:))/y;
const importTarget = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[^\s;#}]+`;
// Trailing whitespace takes the `\r` of CRLF line endings.
const importLine = new RegExp(String.raw`\s*(?:\.\.\.@(${importTarget})|((?:[^:;{}\n#]+?))\s*:\s*@(${importTarget}))[ \t\r]*(?=[;\n#}]|$)`, 'y');
/** An import's path as written, quoted or not, without its quotes. */
const importText = (path: string) => path[0] === '"' ? path.slice(1, -1).replace(/\\(.)/g, '$1')
  : path[0] === "'" ? path.slice(1, -1).replaceAll("''", "'") : path;

/** A glob that sets links: its key path, the link, and the filters that limit it. */
export type GlobLink = { path: GlobSegment[]; link: AuthoredLink; filters: GlobFilter[]; /** The file that wrote it. */ file: string };
/** The links a file sets for more than one shape: each glob statement at its top, as in `*.link: x` or
 * `a.*: {&shape: circle; link: x}`, with the glob's key path and file, and each class it defines, as in `classes: {x: {link: y}}`;
 * a later class definition replaces an earlier one. Its imports are followed: globs under their keys, and classes
 * only from whole files spread at the top, as D2 adds them. */
export function fileLinkRules(fs: Record<string, string>, file: string, seen = new Set<string>()):
  { globs: GlobLink[]; classes: Map<string, AuthoredLink> } {
  const globs: GlobLink[] = [];
  const classes = new Map<string, AuthoredLink>();
  const text = fs[file];
  if (text === undefined || seen.has(file)) return { globs, classes };
  seen.add(file);
  /** The key path at `start`, and the offset of the colon after it, or undefined without one. */
  const keyAt = (start: number) => {
    const path: GlobSegment[] = [];
    let at = start;
    for (let part = sticky(keyPart, text, at); part; part = sticky(keyPart, text, at)) {
      path.push({ text: part[1]?.replace(/\\(.)/g, '$1') ?? part[2]?.replaceAll("''", "'") ?? part[3], glob: part[3]?.includes('*') ?? false });
      at = keyPart.lastIndex;
      if (part[4] !== '.') break;
    }
    return path.length && text[at] === ':' ? { path, at } : undefined;
  };
  /** The link a key path ending in `link`, or a map after it, sets. */
  const linkOf = (path: GlobSegment[], start: number, at: number) => {
    const last = path.at(-1)!;
    if (!last.glob && last.text === 'link') return { link: linkAfterKey(textRange(file, text, start, at), fs), named: true, filters: [] };
    const map = mapLink(text, at);
    return { link: map?.link && authored(file, text, map.link), named: false, filters: map?.filters ?? [] };
  };
  const defineClass = (path: GlobSegment[], start: number, at: number) => {
    if (path.length > 2 || path.length === 2 && path[1].text !== 'link') return;
    const { link } = linkOf(path, start, at);
    if (link) classes.set(path[0].text, link);
  };
  for (const start of statements(text, 0, true) ?? []) {
    const imported = sticky(importLine, text, start);
    if (imported) {
      const target = importPath(fs, file, importText(imported[1] ?? imported[3]));
      const scope = imported[2] ? keyPath(imported[2]) : [];
      if (!target || !scope) continue;
      const rules = fileLinkRules(fs, target, seen);
      for (const glob of rules.globs) globs.push({ ...glob, path: [...scope, ...glob.path] });
      if (!imported[2]) for (const [name, link] of rules.classes) classes.set(name, link);
      continue;
    }
    const key = keyAt(start);
    if (!key) continue;
    const { path, at } = key;
    if (path[0].text === 'classes' && !path[0].glob) {
      if (path.length > 1) defineClass(path.slice(1), start, at);
      else {
        // `classes: {x: {link: y}; z.link: w}` defines each class in its map.
        const brace = sticky(/[ \t]*:[ \t]*\{/y, text, at);
        for (const inner of brace ? statements(text, brace.index + brace[0].length) ?? [] : []) {
          const entry = keyAt(inner);
          if (entry) defineClass(entry.path, inner, entry.at);
        }
      }
      continue;
    }
    if (!path.some((segment) => segment.glob)) continue;
    const { link, named, filters } = linkOf(path, start, at);
    if (link) globs.push({ path: named ? path.slice(0, -1) : path, link, filters, file });
  }
  // `seen` guards only the import chain, so a file imported at two places adds its rules at both.
  seen.delete(file);
  return { globs, classes };
}
/** Split an unquoted or quoted key path, such as `a."b.c"`; undefined for one this does not read. */
function keyPath(key: string): GlobSegment[] | undefined {
  const path: GlobSegment[] = [];
  const text = `${key}:`;
  let at = 0;
  for (let part = sticky(keyPart, text, at); part; part = sticky(keyPart, text, at)) {
    path.push({ text: part[1]?.replace(/\\(.)/g, '$1') ?? part[2]?.replaceAll("''", "'") ?? part[3], glob: part[3]?.includes('*') ?? false });
    at = keyPart.lastIndex;
    if (part[4] !== '.') return at === key.length ? path : undefined;
  }
}
/** The `fs` key of the file `@path` imports from `file`, relative to its folder. */
export function importPath(fs: Record<string, string>, file: string, path: string): string | undefined {
  const parts: string[] = [];
  for (const part of [...file.split('/').slice(0, -1), ...path.split('/')]) {
    if (part === '..') parts.pop(); else if (part !== '.' && part) parts.push(part);
  }
  const joined = parts.join('/');
  return [`${joined}.d2`, joined].find((key) => key in fs);
}

/** The compiled diagram with each file link written in an imported file rewritten to open the same file from
 * `inputPath`, the entry file's project path, since viewers resolve links from the file they show. The diagram is
 * copied when a link changes, so lint can still trace each link to the file that wrote it. */
export function rebaseFileLinks(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string>; inputPath?: string },
  inputPath: string, scanned = true): Diagram {
  const sources = linkSources(compiled);
  const entry = compiled.inputPath ?? inputPath;
  const rebased = (href: string, from: string | undefined) => {
    const link = classifyHref(href);
    if (link.kind !== 'file' || from === undefined || from === entry || from === inputPath) return href;
    const target = resolveFilePath(from, link.path, scanned);
    if (target === undefined) return href;
    const base = inputPath.split('/').slice(0, -1);
    const parts = target.split('/');
    let common = 0;
    while (common < base.length && common < parts.length - 1 && base[common] === parts[common]) common++;
    const path = [...base.slice(common).map(() => '..'), ...parts.slice(common)].join('/');
    return `${path.startsWith('../') ? '' : './'}${path}${link.hash}`;
  };
  const changes: [string, string, string][] = [];
  for (const board of indexBoards(compiled.diagram).values()) {
    for (const item of [...board.diagram.shapes, ...board.diagram.connections]) {
      const href = item.link ? rebased(item.link, sources.get(JSON.stringify([board.id, item.id]))) : undefined;
      if (href !== undefined && href !== item.link) changes.push([board.id, item.id, href]);
    }
  }
  if (!changes.length) return compiled.diagram;
  const diagram: Diagram = JSON.parse(JSON.stringify(compiled.diagram));
  const boards = indexBoards(diagram);
  for (const [board, id, href] of changes) {
    const { shapes, connections } = boards.get(board)!.diagram;
    [...shapes, ...connections].find((item) => item.id === id)!.link = href;
  }
  return diagram;
}

// The serialized AST of the main file, with UTF-16 ranges like object references.
interface AstMap { range?: string; nodes?: { map_key?: AstMapKey }[] }
interface AstMapKey { key?: { path?: AstKeySegment[] }; value?: { map?: AstMap } }

/** The text between the braces of each board's block in the main file; the whole file for the root board.
 * Boards declared in more than one place, imported, or under scenarios and steps have no single block, so they are left out. */
export function boardBlocks(graph: unknown, source: string, filename = 'index'): Map<string, SourceRange> {
  const blocks = new Map<string, SourceRange>([['root', { from: 0, to: source.length }]]);
  const declarations = new Map<string, number>();
  function declare(path: (string | undefined)[], value: AstMapKey['value'], board: string) {
    if (path[0] !== 'layers' || path.length < 2) {
      if (path.length === 1 && path[0] === 'layers' && value?.map) {
        for (const node of value.map.nodes ?? []) {
          const child = node.map_key?.key?.path?.map(keyText);
          if (child) declare(['layers', ...child], node.map_key!.value, board);
        }
      }
      return;
    }
    if (path[1] === undefined) return;
    const id = `${board}.layers.${boardKey(path[1])}`;
    declarations.set(id, (declarations.get(id) ?? 0) + 1);
    if (path.length > 2) { declare(path.slice(2), value, id); return; }
    const range = value?.map?.range && parseSourceRange(value.map.range, source, filename);
    if (range && source[range.from] === '{' && source[range.to - 1] === '}') blocks.set(id, { from: range.from + 1, to: range.to - 1 });
    if (value?.map) visit(value.map, id);
  }
  function visit(map: AstMap, board: string) {
    for (const node of map.nodes ?? []) {
      const path = node.map_key?.key?.path?.map(keyText);
      if (path) declare(path, node.map_key!.value, board);
    }
  }
  const ast = (graph as { ast?: AstMap }).ast;
  if (ast) visit(ast, 'root');
  for (const [id, count] of declarations) if (count > 1) blocks.delete(id);
  return blocks;
}
