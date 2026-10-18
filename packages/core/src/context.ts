import { classifyHref, type Board, type Diagram } from './index';

/** Directed neighbours of a shape, independent of labels and parallel edges. */
export function boundaryNeighbours(diagram: Diagram, shape: string) {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  let incident = false;
  for (const edge of diagram.connections) {
    if (edge.src !== shape && edge.dst !== shape) continue;
    incident = true;
    if (edge.dstArrow !== 'none') {
      if (edge.dst === shape) incoming.add(edge.src);
      if (edge.src === shape) outgoing.add(edge.dst);
    }
    if (edge.srcArrow !== 'none') {
      if (edge.src === shape) incoming.add(edge.dst);
      if (edge.dst === shape) outgoing.add(edge.src);
    }
  }
  return { in: incoming, out: outgoing, incident };
}

export interface ParentContext {
  shape: string;
  label: string;
  incoming: string[];
  outgoing: string[];
}

/** Describe each immediate parent's drillable node without guessing internal wiring. */
export function parentContext(board: Board, boards: ReadonlyMap<string, Board>): ParentContext[] {
  const parent = board.parent && boards.get(board.parent);
  if (!parent || board.kind !== 'layers') return [];
  const labels = new Map(parent.diagram.shapes.map((shape) => [shape.id, ('label' in shape && shape.label) || shape.id]));
  return parent.diagram.shapes.flatMap((shape) => {
    const link = classifyHref(shape.link, parent.id);
    if (!('target' in link) || link.target !== board.id) return [];
    const neighbours = boundaryNeighbours(parent.diagram, shape.id);
    if (!neighbours.in.size && !neighbours.out.size) return [];
    return [{ shape: shape.id, label: labels.get(shape.id)!,
      incoming: [...neighbours.in].map((id) => labels.get(id) ?? id),
      outgoing: [...neighbours.out].map((id) => labels.get(id) ?? id) }];
  });
}
