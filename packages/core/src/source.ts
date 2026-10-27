import { boardKey, classifyHref, indexBoards, resolveFilePath, type Diagram } from './index';

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

interface SourceReference { key?: { range?: string; path?: AstKeySegment[] }; key_path_index?: number }
// D2's public types omit these serialized graph fields (including parents).
interface SourceGraph {
  name?: string;
  objects?: {
    box?: { TopLeft?: { x: number; y: number }; Width: number; Height: number };
    references?: SourceReference[];
  }[];
  layers?: SourceGraph[];
  scenarios?: SourceGraph[];
  steps?: SourceGraph[];
}

/** Join serialized objects to shapes by their unique compiled box, not local
 * names (which collide in containers). These boxes are never animation geometry.
 * Yields every raw D2 reference range, which may name an imported file.
 */
function visitShapeReferences(diagram: Diagram, graph: unknown,
  visitor: (board: string, shape: string, range: string, reference: SourceReference) => void) {
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
      if (shapes.length !== 1) continue;
      for (const reference of object.references ?? []) {
        const part = reference.key?.path?.[reference.key_path_index ?? 0];
        const raw = part ? Object.values(part).find((value) => value.range)?.range : reference.key?.range;
        if (raw) visitor(id, shapes[0].id, raw, reference);
      }
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) visit(child, `${id}.${group}.${boardKey(child.name ?? '')}`);
    }
  }
  visit(graph as SourceGraph, 'root');
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

/** The file each kept shape and connection link was written in, keyed by board ID and shape or connection ID.
 * D2 rewrites the image paths of imported files but keeps their links verbatim, so a file link resolves from
 * the file that wrote it: that of a `shape.link` reference, else the one file that mentions the shape (both
 * ends, for a connection), else the one such file whose text holds the link. Links left out cannot be told
 * apart; callers resolve them from the entry file.
 */
export function linkSources(compiled: { diagram: Diagram; graph: unknown; fs?: Record<string, string> }): Map<string, string> {
  const files = new Map<string, Set<string>>();
  const explicit = new Map<string, string>();
  visitShapeReferences(compiled.diagram, compiled.graph, (board, shape, raw, reference) => {
    // Compiler-expanded ASTs carry placeholder ranges without a file.
    const file = /^(.+),\d+:\d+:\d+-\d+:\d+:\d+$/.exec(raw)?.[1];
    if (file === undefined) return;
    const key = JSON.stringify([board, shape]);
    if (!files.has(key)) files.set(key, new Set());
    files.get(key)!.add(file);
    const path = reference.key?.path ?? [];
    const index = reference.key_path_index ?? 0;
    if (path.length === index + 2 && keyText(path[index + 1]) === 'link') explicit.set(key, file);
  });
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
      const file = shape.link ? explicit.get(key) ?? pick(mentions(shape.id), shape.link) : undefined;
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
