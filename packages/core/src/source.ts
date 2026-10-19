import { indexBoards, type Diagram } from './index';

export interface SourceRange { from: number; to: number }
export interface ShapeSource extends SourceRange { board: string; shape: string }

/** The pinned d2.js compiler emits UTF-16 offsets, like CodeMirror. */
export function parseSourceRange(range: string, source: string, filename = 'index'): SourceRange | undefined {
  const match = /^(.*),\d+:\d+:(\d+)-\d+:\d+:(\d+)$/.exec(range);
  if (match?.[1] !== filename) return;
  if (!match) return;
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
 * Ambiguous or imported references are omitted rather than selecting wrong text.
 */
export function indexShapeSources(diagram: Diagram, graph: unknown, source: string, filename = 'index'): ShapeSource[] {
  const boards = indexBoards(diagram);
  const result: ShapeSource[] = [];
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
        const range = raw && parseSourceRange(raw, source, filename);
        if (range && range.from < range.to) result.push({ board: id, shape: shapes[0].id, ...range });
      }
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) visit(child, `${id}.${group}.${child.name}`);
    }
  }
  visit(graph as SourceGraph, 'root');
  return result;
}
