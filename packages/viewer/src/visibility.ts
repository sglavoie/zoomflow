import { boardKey, shapeClass, type Board, type Diagram } from '@zoomflow/core';
import { associateShapeBadges } from './shape-badges';

export type HiddenShapes = ReadonlyMap<string, ReadonlySet<string>>;

/** Follow containment and outgoing connections, including the parent-to-child order of mind-map `--` edges. */
export function hiddenShapeIds(board: Board, choices: ReadonlySet<string>): Set<string> {
  if (!choices.size) return new Set();
  const shapes = new Set(board.diagram.shapes.map(shape => shape.id));
  const children = new Map<string, string[]>();
  const add = (parent: string, child: string) => {
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  };
  for (const id of shapes) {
    for (let dot = id.lastIndexOf('.'); dot > 0; dot = id.lastIndexOf('.', dot - 1)) {
      const parent = id.slice(0, dot);
      if (shapes.has(parent)) { add(parent, id); break; }
    }
  }
  for (const edge of board.diagram.connections) {
    const reverse = Boolean(edge.srcArrow && edge.srcArrow !== 'none');
    const forward = !reverse || Boolean(edge.dstArrow && edge.dstArrow !== 'none');
    if (forward) add(edge.src, edge.dst);
    if (reverse) add(edge.dst, edge.src);
  }
  const hidden = new Set<string>();
  const pending = [...choices];
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (hidden.has(id) || !shapes.has(id)) continue;
    hidden.add(id);
    pending.push(...children.get(id) ?? []);
  }
  return hidden;
}

/** A hidden drill-down node hides its attached layer and nested layers, including merged centres. */
export function diagramHiddenShapes(boards: ReadonlyMap<string, Board>, choices: HiddenShapes): Map<string, Set<string>> {
  const hidden = new Map([...boards].map(([id, board]) => [id, hiddenShapeIds(board, choices.get(id) ?? new Set())]));
  const children = new Map<string, Board[]>();
  for (const board of boards.values()) {
    if (board.parent && board.kind === 'layers') children.set(board.parent, [...children.get(board.parent) ?? [], board]);
  }
  const pending: Board[] = [];
  for (const board of boards.values()) for (const shape of board.diagram.shapes) {
    const target = boards.get(shape.link);
    if (hidden.get(board.id)!.has(shape.id) && target?.kind === 'layers' && target.parent === board.id) pending.push(target);
  }
  const visited = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const board = pending[i];
    if (visited.has(board.id)) continue;
    visited.add(board.id);
    hidden.set(board.id, new Set(board.diagram.shapes.map(shape => shape.id)));
    pending.push(...children.get(board.id) ?? []);
  }
  return hidden;
}

/** Filter the model as well as the SVG, so offline search and parent context omit hidden items. */
export function visibleDiagram(diagram: Diagram, hidden: HiddenShapes, id = 'root'): Diagram {
  const omitted = hidden.get(id) ?? new Set<string>();
  const result = { ...diagram, shapes: diagram.shapes.filter(shape => !omitted.has(shape.id)),
    connections: diagram.connections.filter(edge => !omitted.has(edge.src) && !omitted.has(edge.dst)) };
  for (const kind of ['layers', 'scenarios', 'steps'] as const) {
    result[kind] = diagram[kind]?.map(child => child && visibleDiagram(child, hidden, `${id}.${kind}.${boardKey(child.name)}`));
  }
  return result;
}

/** Mark entire anchors, including their badges, while leaving every shape selectable in the editor. */
export function markHiddenShapes(root: Element, board: Board, hidden: ReadonlySet<string>) {
  associateShapeBadges(root, board);
  for (const node of root.querySelectorAll('[data-export-hidden]')) {
    node.removeAttribute('data-export-hidden');
    node.removeAttribute('aria-description');
  }
  if (!hidden.size) return;
  if (board.diagram.shapes.every(shape => hidden.has(shape.id))) root.querySelector(':scope > .zf-layer-label')?.setAttribute('data-export-hidden', '');
  const groups = new Map<string, Element>();
  for (const group of root.querySelectorAll('g')) for (const name of group.classList) if (!groups.has(name)) groups.set(name, group);
  const badges = new Map<string, Element[]>();
  for (const icon of root.querySelectorAll('[data-badge-shape]')) {
    const id = icon.getAttribute('data-badge-shape')!;
    const list = badges.get(id) ?? [];
    list.push(icon);
    badges.set(id, list);
  }
  const items = [...board.diagram.shapes, ...board.diagram.connections];
  for (const item of items) {
    const omitted = 'src' in item ? hidden.has(item.src) || hidden.has(item.dst) : hidden.has(item.id);
    if (!omitted) continue;
    const group = groups.get(shapeClass(item.id));
    const outer = group?.closest('a') ?? group;
    if (outer) {
      outer.setAttribute('data-export-hidden', '');
      outer.setAttribute('aria-description', 'Hidden from export');
    }
    for (const badge of badges.get(item.id) ?? []) if (!outer?.contains(badge)) badge.setAttribute('data-export-hidden', '');
    if (group && !('src' in item) && item.pos) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'zf-hidden-label');
      label.setAttribute('x', String(item.pos.x + item.width / 2));
      label.setAttribute('y', String(item.pos.y + item.height + 14));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('aria-hidden', 'true');
      label.textContent = 'Hidden from export';
      outer!.after(label);
    }
  }
}

export function removeHiddenShapes(root: Element) {
  for (const node of root.querySelectorAll('[data-export-hidden], .zf-hidden-label')) node.remove();
}

/** Work on a fresh render; resource preparation fits the final bounds after loading its fonts. */
export function filterHiddenSvg(svg: string, board: Board, hidden: ReadonlySet<string>): string {
  if (!hidden.size) return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid SVG from renderer');
  markHiddenShapes(doc.documentElement, board, hidden);
  removeHiddenShapes(doc.documentElement);
  doc.documentElement.setAttribute('data-export-trim', '');
  return new XMLSerializer().serializeToString(doc.documentElement);
}
