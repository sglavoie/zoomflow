import { boardKey, classifyHref, idSegments, indexBoards, type Board, type Diagram } from '@zoomflow/core';
import { flowSource, quote, readFlow } from './flow-model';

type Scalar = { value?: string };
type Attributes = { label?: Scalar; style?: Record<string, Scalar>; shape?: Scalar; tooltip?: Scalar; link?: Scalar };
type GraphEdge = { srcTableColumnIndex?: number; dstTableColumnIndex?: number;
  src_arrow?: boolean; dst_arrow?: boolean; attributes?: Attributes; srcArrowhead?: Attributes; dstArrowhead?: Attributes };
type Graph = { name?: string; edges?: GraphEdge[]; layers?: Graph[]; scenarios?: Graph[]; steps?: Graph[] };
type Connection = Diagram['connections'][number];
type Relation = { edge: Connection; raw?: GraphEdge; parent: string; child: string; reverse: boolean; src: string; dst: string; arrow: string; index: number };
const shapeKey = (id: string) => idSegments(id).map(quote).join('.');

/** Connection direction, rather than shape containment, defines a non-mind-map branch. Undirected and
 * bidirectional connections follow their authored left-to-right order; left arrows reverse that order. */
function relations(board: Board, graph?: Graph): Relation[] {
  const counts = new Map<string, number>();
  return (board.diagram.connections ?? []).map((edge, index) => {
    const raw = graph?.edges?.[index];
    const reverse = raw ? Boolean(raw.src_arrow && !raw.dst_arrow) : edge.srcArrow !== 'none' && edge.dstArrow === 'none';
    const endpoint = (id: string, column?: number) => {
      const shape = board.diagram.shapes.find(item => item.id === id);
      const name = column !== undefined && shape && 'columns' in shape ? shape.columns?.[column]?.name.label : undefined;
      return shapeKey(id) + (name !== undefined ? `.${quote(name)}` : '');
    };
    const srcArrow = raw?.src_arrow ?? edge.srcArrow !== 'none';
    const dstArrow = raw?.dst_arrow ?? edge.dstArrow !== 'none';
    const src = endpoint(edge.src, raw?.srcTableColumnIndex);
    const dst = endpoint(edge.dst, raw?.dstTableColumnIndex);
    const arrow = srcArrow ? dstArrow ? '<->' : '<-' : dstArrow ? '->' : '--';
    // D2 selectors count arrows for the specified columns; rendered IDs count all arrows between the tables.
    const pair = JSON.stringify([src, arrow, dst]);
    const ordinal = counts.get(pair) ?? 0;
    counts.set(pair, ordinal + 1);
    return { edge, raw, reverse, parent: reverse ? edge.dst : edge.src, child: reverse ? edge.src : edge.dst,
      src, dst, arrow, index: ordinal };
  });
}

const kebab = (name: string) => name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
function attributes(attrs?: Attributes, prefix = ''): string[] {
  const lines: string[] = [];
  for (const name of ['shape', 'tooltip', 'link'] as const) {
    const value = attrs?.[name]?.value;
    if (value) lines.push(`${prefix}${name}: ${quote(value)}`);
  }
  for (const [name, scalar] of Object.entries(attrs?.style ?? {})) {
    if (scalar?.value !== undefined) lines.push(`${prefix}style.${kebab(name)}: ${quote(scalar.value)}`);
  }
  return lines;
}

/** The compiler resolves board hrefs to root IDs, which cannot be pasted back as authored D2 links. */
function boardHref(from: string, to: string, boards: Map<string, Board>): string | undefined {
  const origin = idSegments(from), target = idSegments(to);
  let shared = 0;
  while (shared < Math.min(origin.length, target.length) && origin[shared] === target[shared]) shared++;
  const common = 1 + Math.floor((shared - 1) / 2) * 2;
  const parts = Array.from({ length: (origin.length - common) / 2 }, () => '_');
  for (let i = common; i < target.length; i += 2) parts.push(target[i], boardKey(target[i + 1]));
  if (parts.length) return parts.join('.');
  if (origin.length > 1) return `_.${origin.at(-2)}.${boardKey(origin.at(-1)!)}`;
  const child = [...boards.values()].find(board => board.parent === 'root');
  return child ? `${child.target}._` : undefined;
}

function connectionSource(relation: Relation, parent: string, board: string, boards: Map<string, Board>): string {
  const { edge, raw, reverse } = relation;
  const src = reverse ? relation.src : shapeKey(parent);
  const dst = reverse ? shapeKey(parent) : relation.dst;
  const arrow = relation.arrow;
  // Compiled attributes contain authored styles (including classes and indexed overrides), without freezing
  // the theme's defaults. Snapshot those values while leaving all original source, imports and comments intact.
  const body = attributes(raw?.attributes);
  if (edge.classes?.length) body.unshift(`class: [${edge.classes.map(quote).join('; ')}]`);
  // The host has already rebased imported file links for this entry file. Their new declaration belongs here.
  const href = classifyHref(edge.link ?? '');
  if (href.kind === 'file') body.push(`link: ${quote(edge.link)}`);
  else if (href.kind === 'board' && boards.has(href.target)) {
    const link = boardHref(board, href.target, boards);
    if (link) body.push(`link: ${quote(link)}`);
  }
  const label = raw?.attributes?.label?.value ?? edge.label;
  if (edge.language && edge.language !== 'text') {
    const fence = '|'.repeat(Math.max(1, ...[...label.matchAll(/\|+/g)].map(match => match[0].length + 1)));
    body.unshift(`label: ${fence}${edge.language}\n${label}\n${fence}`);
  } else body.unshift(`label: ${quote(label)}`);
  for (const [name, attrs] of [['source', raw?.srcArrowhead], ['target', raw?.dstArrowhead]] as const) {
    if (attrs?.label?.value) body.push(`${name}-arrowhead.label: ${quote(attrs.label.value)}`);
    body.push(...attributes(attrs, `${name}-arrowhead.`));
  }
  if (typeof edge.icon === 'string' && edge.icon) body.push(`icon: ${quote(edge.icon)}`);
  return `${src} ${arrow} ${dst}: {\n${body.map(line => line.split('\n').map(part => `  ${part}`).join('\n')).join('\n')}\n}`;
}

/** One immutable compiled snapshot supplies candidates and native D2 connection overrides. */
export function graphBranches(source: string, diagram: Diagram, graph: unknown) {
  const boards = indexBoards(diagram);
  const graphs = new Map<string, Graph>();
  function visit(node: Graph, id: string) {
    graphs.set(id, node);
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) visit(child, `${id}.${group}.${boardKey(child.name ?? '')}`);
    }
  }
  visit(graph as Graph, 'root');
  const records = new Map([...boards].map(([id, board]) => [id, relations(board, graphs.get(id))]));
  const shapes = new Map([...boards].map(([id, board]) => [id, new Set(board.diagram.shapes.map(item => item.id))]));
  const choices = new Map<string, ReturnType<typeof find>>();
  const upstream = new Map<string, Relation[]>();
  function find(boardId: string, shape: string) {
    const board = boards.get(boardId);
    const node = board?.diagram.shapes.find(item => item.id === shape);
    if (!board || !node) return;
    const edges = records.get(boardId)!;
    const descendants = new Set([shape]);
    const queue = [shape];
    while (queue.length) {
      const current = queue.pop()!;
      // A container's descendants stay inside it when its upstream connection changes.
      for (const child of board.diagram.shapes) if (child.id.startsWith(`${current}.`) && !descendants.has(child.id)) {
        descendants.add(child.id); queue.push(child.id);
      }
      for (const edge of edges) if (edge.parent === current && !descendants.has(edge.child)) {
        descendants.add(edge.child); queue.push(edge.child);
      }
    }
    // A feedback arrow from inside the downstream branch belongs to that branch, rather than its old parent.
    const parents = edges.filter(item => item.child === shape && !descendants.has(item.parent));
    upstream.set(JSON.stringify([boardId, shape]), parents);
    const destinations = board.diagram.shapes.filter(item => !descendants.has(item.id) &&
      !(parents.length && parents.every(parent => parent.parent === item.id))).map(item => ({
      id: item.id, shape: item.id, trail: [] as string[],
      label: ('label' in item && item.label || item.id) + (item.id.includes('.') || board.diagram.shapes.some(other => other !== item && 'label' in other && 'label' in item && other.label === item.label) ? ` (${item.id})` : ''),
    }));
    return { from: shape, label: 'label' in node && node.label || shape, destinations };
  }
  function branch(board: string, shape: string) {
    const key = JSON.stringify([board, shape]);
    if (!choices.has(key)) choices.set(key, find(board, shape));
    return choices.get(key);
  }
  return {
    branch,
    has: (board: string, shape: string) => shapes.get(board)?.has(shape) === true,
    move(board: string, shape: string, parent: string, own?: string): { source: string; own?: string; additions?: string } | undefined {
      if (!branch(board, shape)?.destinations.some(item => item.id === parent)) return;
      const incoming = upstream.get(JSON.stringify([board, shape]))!;
      const flow = own === undefined ? undefined : readFlow(own);
      if (flow) {
        const parents = new Set(incoming.map(item => item.parent));
        const edges = flow.connections.filter(item => item.to === shape && parents.has(item.from));
        for (const edge of edges) edge.from = parent;
        if (!edges.length) flow.connections.push({ from: parent, to: shape, label: '' });
        return { source, own: flowSource(flow) };
      }
      const changed = incoming.filter(item => item.parent !== parent);
      const lines = ['# Upstream parent changed on the diagram.'];
      // Delete parallel arrows from the highest index down so every selector still names the original edge.
      for (const item of [...changed].sort((a, b) => b.index - a.index)) lines.push(`(${item.src} ${item.arrow} ${item.dst})[${item.index}]: null`);
      for (const item of changed) lines.push(connectionSource(item, parent, board, boards));
      if (!incoming.length) lines.push(`${shapeKey(parent)} -> ${shapeKey(shape)}`);
      const additions = lines.join('\n');
      let text = additions;
      if (board !== 'root') text = `${board.slice(5)}: {\n${text.split('\n').map(line => `  ${line}`).join('\n')}\n}`;
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      return { source: source + (source.endsWith('\n') ? newline : newline + newline) + text.replaceAll('\n', newline) + newline, additions };
    },
  };
}
export type GraphBranches = ReturnType<typeof graphBranches>;
