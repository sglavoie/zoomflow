import { classifyHref, indexBoards, type Board, type Diagram } from './index';
import { type GlobSegment, type GlobFilter, fileLinkRules, linkOrder, mapLink, compareOrder, type GlobLink, type AuthoredLink, linkAfterKey, authored } from './source-link-parser';
import { idSegments, rangeFile, shapeFiles, keyText, shapeAttributes, visitShapeReferences } from './source-graph';

/** Whether a glob key path, where `*` matches within a segment and `**` or `***` any number of them, names a shape ID. */
export function globMatches(pattern: GlobSegment[], id: string[]): boolean {
  const match = (p: number, s: number): boolean => {
    if (p === pattern.length) return s === id.length;
    const part = pattern[p];
    if (part.glob && (part.text === '**' || part.text === '***')) {
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
 * `style.fill`, with `level` from 0, and `leaf` and `connected` from the board. An unquoted value with `*`, such as `a*`, ignores
 * case; any other does not. An attribute the shape lacks never matches, nor, in this D2, does `id`. */
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
    const url = filter.key === 'icon' ? value as { Scheme?: string; Opaque?: string; Host?: string; Path?: string; RawPath?: string; RawQuery?: string; Fragment?: string } | undefined : undefined;
    // As Go writes it: the path as escaped in the source, else re-escaped.
    const path = url?.RawPath || encodeURIComponent(url?.Path ?? '').replace(/%(24|26|2B|2C|2F|3A|3B|3D|40)/g, (code) => decodeURIComponent(code))
      .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    if (url?.Scheme !== undefined) actual = `${url.Scheme ? `${url.Scheme}:` : ''}${url.Opaque || `${url.Host ? `//${url.Host}` : ''}${path}`}` +
      `${url.RawQuery ? `?${url.RawQuery}` : ''}${url.Fragment ? `#${url.Fragment}` : ''}`;
  }
  const pattern = filter.glob ? new RegExp(`^${filter.value.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'si') : undefined;
  const hit = actual !== undefined && (pattern ? pattern.test(actual) : actual === filter.value);
  return filter.negate ? !hit : hit;
}

/** The file each kept shape and connection link was written in, keyed by board ID and shape or connection ID.
 * D2 rewrites the image paths of imported files but keeps their links verbatim, so a file link resolves from
 * the file that wrote it: that of the last `shape.link` or `shape: {link: x}` reference or glob that sets it, as D2
 * applies them, else that of the class that set it, else the one file that mentions the shape (both ends, for a
 * connection), else the one such file whose text holds the link. Links left out cannot be told apart; callers
 * resolve them from the entry file.
 */
export function linkSources(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string> }): Map<string, string> {
  const entry = rangeFile((compiled.graph as { ast?: { range?: string } }).ast?.range);
  const rules = compiled.fs && entry !== undefined ? fileLinkRules(compiled.fs, entry) : undefined;
  const order = linkOrder(rules?.regions ?? []);
  // The last reference that sets each shape's link, with its place when it has one.
  const explicit = new Map<string, { file: string; order?: number[] }>();
  const files = shapeFiles(compiled, (key, file, reference) => {
    const path = reference.key?.path ?? [];
    const index = reference.key_path_index ?? 0;
    let sets = path.length === index + 2 && keyText(path[index + 1]) === 'link';
    if (!sets && path.length === index + 1 && (reference.map_key_edge_index ?? -1) < 0) {
      // `a: {link: x}` names the link in the map after the key.
      const end = /,\d+:\d+:\d+-\d+:\d+:(\d+)$/.exec(reference.key?.range ?? '')?.[1];
      const text = compiled.fs?.[file];
      sets = end !== undefined && text !== undefined && Boolean(mapLink(text, Number(end))?.link);
    }
    if (!sets) return;
    const [board, shape] = JSON.parse(key) as [string, string];
    const place = order(reference.key?.range, board, shape);
    const previous = explicit.get(key);
    if (!previous?.order || !place || compareOrder(place, previous.order) >= 0) explicit.set(key, { file, order: place });
  });
  let attributes: Map<string, Record<string, unknown>> | undefined;
  /** The last glob that applies to the shape. A glob applies to its board and the scenarios and steps that inherit
   * it, `***` to layers as well, and an imported file's globs only to the shapes that file writes. */
  const lastGlob = (board: Board, shape: Diagram['shapes'][number], key: string) => {
    let last: { glob: GlobLink; order?: number[] } | undefined;
    for (const glob of rules?.globs ?? []) {
      const full = `root${glob.board}`;
      // `***` reaches into layers too.
      const global = glob.path[0]?.glob && glob.path[0].text === '***';
      if (board.id !== full && !(board.id.startsWith(`${full}.`) && (global || !/\.layers\./.test(`${board.id.slice(full.length)}.`)))) continue;
      if (!globMatches(glob.path, idSegments(shape.id)) || glob.file !== entry && !files.get(key)?.has(glob.file)) continue;
      if (glob.filters.length && !glob.filters.every((filter) => {
        const found = (attributes ??= shapeAttributes(compiled.diagram, compiled.graph)).get(key);
        return found && filterMatches(filter, board, shape, found);
      })) continue;
      const place = order(glob.link.range, board.id, shape.id);
      if (!last?.order || !place || compareOrder(place, last.order) >= 0) last = { glob, order: place };
    }
    return last;
  };
  /** The file of the reference or glob D2 applies last, when it set the shape's link; a reference wins when either
   * place is unknown. */
  const writtenFile = (board: Board, shape: Diagram['shapes'][number], key: string) => {
    const own = explicit.get(key);
    const glob = lastGlob(board, shape, key);
    if (own && !(glob?.order && own.order && compareOrder(glob.order, own.order) > 0)) return own.file;
    return glob?.glob.link.href === shape.link ? glob?.glob.file : undefined;
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
      const file = shape.link ? writtenFile(board, shape, key) ?? classFile(shape) ?? pick(mentions(shape.id), shape.link) : undefined;
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

/** Rebase an imported file's link without changing its destination. Keep leading `..` segments and excluded
 * folders: a link outside the project must still be outside it when resolved from a deeper entry file. */
export function rebaseFileHref(href: string, from: string | undefined, inputPath: string): string {
  const link = classifyHref(href);
  if (link.kind !== 'file' || from === undefined || from === inputPath) return href;
  const parts = from.split('/').slice(0, -1);
  for (const part of link.path.split('/')) {
    if (part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  const base = inputPath.split('/').slice(0, -1);
  let common = 0;
  while (common < base.length && common < parts.length - 1 && base[common] === parts[common]) common++;
  const path = [...base.slice(common).map(() => '..'), ...parts.slice(common)].join('/');
  return `${path.startsWith('../') ? '' : './'}${path}${link.hash}`;
}

/** The compiled diagram with each file link written in an imported file rewritten to open the same file from
 * `inputPath`, the entry file's project path, since viewers resolve links from the file they show. The diagram is
 * copied when a link changes, so lint can still trace each link to the file that wrote it. */
export function rebaseFileLinks(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string>; inputPath?: string },
  inputPath: string): Diagram {
  const sources = linkSources(compiled);
  const entry = compiled.inputPath ?? inputPath;
  const rebased = (href: string, from: string | undefined) => {
    return from === entry ? href : rebaseFileHref(href, from, inputPath);
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
