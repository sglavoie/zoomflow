import { boardKey, indexBoards, type Diagram } from './index';

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

// D2's public types omit these serialized graph fields (including parents).
interface SourceGraph {
  name?: string;
  objects?: {
    box?: { TopLeft?: { x: number; y: number }; Width: number; Height: number };
    references?: { key?: { range?: string; path?: Record<string, { range?: string }>[] }; key_path_index?: number }[];
  }[];
  layers?: SourceGraph[];
  scenarios?: SourceGraph[];
  steps?: SourceGraph[];
}

/** Join serialized objects to shapes by their unique compiled box, not local
 * names (which collide in containers). These boxes are never animation geometry.
 * Yields every raw D2 reference range, which may name an imported file.
 */
function visitShapeReferences(diagram: Diagram, graph: unknown, visitor: (board: string, shape: string, range: string) => void) {
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
        if (raw) visitor(id, shapes[0].id, raw);
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

// The serialized AST of the main file, with UTF-16 ranges like object references.
interface AstMap { range?: string; nodes?: { map_key?: AstMapKey }[] }
interface AstMapKey { key?: { path?: Record<string, { value?: { string?: string }[] }>[] }; value?: { map?: AstMap } }

/** The text between the braces of each board's block in the main file; the whole file for the root board.
 * Boards declared in more than one place, imported, or under scenarios and steps have no single block, so they are left out. */
export function boardBlocks(graph: unknown, source: string, filename = 'index'): Map<string, SourceRange> {
  const blocks = new Map<string, SourceRange>([['root', { from: 0, to: source.length }]]);
  const declarations = new Map<string, number>();
  const segment = (part: Record<string, { value?: { string?: string }[] }>) => {
    const values = Object.values(part)[0]?.value;
    return values?.every((value) => typeof value.string === 'string') ? values.map((value) => value.string).join('') : undefined;
  };
  function declare(path: (string | undefined)[], value: AstMapKey['value'], board: string) {
    if (path[0] !== 'layers' || path.length < 2) {
      if (path.length === 1 && path[0] === 'layers' && value?.map) {
        for (const node of value.map.nodes ?? []) {
          const child = node.map_key?.key?.path?.map(segment);
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
      const path = node.map_key?.key?.path?.map(segment);
      if (path) declare(path, node.map_key!.value, board);
    }
  }
  const ast = (graph as { ast?: AstMap }).ast;
  if (ast) visit(ast, 'root');
  for (const [id, count] of declarations) if (count > 1) blocks.delete(id);
  return blocks;
}
