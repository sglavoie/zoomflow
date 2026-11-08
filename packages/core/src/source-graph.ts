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

// Single-quoted keys carry their text as a plain string; other strings as a list of pieces.
export type AstKeySegment = Record<string, { range?: string; value?: string | { string?: string }[] }>;

export const keyText = (part: AstKeySegment) => {
  const values = Object.values(part)[0]?.value;
  if (typeof values === 'string') return values;
  return Array.isArray(values) && values.every((value) => typeof value.string === 'string') ? values.map((value) => value.string).join('') : undefined;
};

export interface SourceReference { key?: { range?: string; path?: AstKeySegment[] }; key_path_index?: number; map_key_edge_index?: number }

// D2's public types omit these serialized graph fields (including parents).
export interface SourceGraph {
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
export function visitShapeObjects(diagram: Diagram, graph: unknown,
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
export function visitShapeReferences(diagram: Diagram, graph: unknown,
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

export const rangeFile = (range: string | undefined) => /^(.+),\d+:\d+:\d+-\d+:\d+:\d+$/.exec(range ?? '')?.[1];

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

// The serialized AST of the main file, with UTF-16 ranges like object references.
export interface AstMap { range?: string; nodes?: { map_key?: AstMapKey }[] }

export interface AstMapKey { range?: string; key?: { path?: AstKeySegment[] }; value?: { map?: AstMap } }

/** The text between the braces of each board's block in the main file; the whole file for the root board.
 * Boards declared in more than one place, imported, or under scenarios and steps have no single block, so they are left out. */
export function boardBlocks(graph: unknown, source: string, filename = 'index', statements?: Map<string, SourceRange>): Map<string, SourceRange> {
  const blocks = new Map<string, SourceRange>([['root', { from: 0, to: source.length }]]);
  // Keyed in lower case, as D2 matches board names.
  const declarations = new Map<string, number>();
  // A quoted `"layers"` is an ordinary shape.
  const keyword = (part: AstKeySegment | undefined) => part !== undefined && 'unquoted_string' in part && keyText(part)?.toLowerCase() === 'layers';
  // D2 merges `LAYERS` into an existing `layers` board but, written alone, also makes root shapes of it,
  // so another casing counts as a declaration without giving a board its block.
  function declare(path: AstKeySegment[], value: AstMapKey['value'], board: string, editable: boolean, statement?: string) {
    if (!keyword(path[0]) || path.length < 2) {
      if (path.length === 1 && keyword(path[0]) && value?.map) {
        for (const node of value.map.nodes ?? []) {
          const child = node.map_key?.key?.path;
          if (child) declare([path[0], ...child], node.map_key!.value, board, editable, node.map_key!.range);
        }
      }
      return;
    }
    const name = keyText(path[1]);
    if (name === undefined) return;
    const id = `${board}.layers.${boardKey(name)}`;
    const exact = editable && keyText(path[0]) === 'layers';
    declarations.set(id.toLowerCase(), (declarations.get(id.toLowerCase()) ?? 0) + 1);
    if (path.length > 2) { declare(path.slice(2), value, id, exact, statement); return; }
    const range = value?.map?.range && parseSourceRange(value.map.range, source, filename);
    if (exact && range && source[range.from] === '{' && source[range.to - 1] === '}') {
      blocks.set(id, { from: range.from + 1, to: range.to - 1 });
      const span = statement && parseSourceRange(statement, source, filename);
      if (span) statements?.set(id, span);
    }
    if (value?.map) visit(value.map, id, exact);
  }
  function visit(map: AstMap, board: string, editable: boolean) {
    for (const node of map.nodes ?? []) {
      const path = node.map_key?.key?.path;
      if (path) declare(path, node.map_key!.value, board, editable, node.map_key!.range);
    }
  }
  const ast = (graph as { ast?: AstMap }).ast;
  if (ast) visit(ast, 'root', true);
  for (const id of blocks.keys()) if ((declarations.get(id.toLowerCase()) ?? 0) > 1) { blocks.delete(id); statements?.delete(id); }
  return blocks;
}
