import { shapeClass, type Board } from '@zoomflow/core';

/** Only layer descendants expand together: scenarios and steps remain separate views. */
export function visibleLayers(boards: ReadonlyMap<string, Board>, root: string, expanded: ReadonlySet<string>): Board[] {
  const children = new Map<string, Board[]>();
  for (const board of boards.values()) {
    if (board.kind !== 'layers' || !board.parent) continue;
    const siblings = children.get(board.parent) ?? [];
    siblings.push(board);
    children.set(board.parent, siblings);
  }
  const visible: Board[] = [];
  const visit = (id: string) => {
    const board = boards.get(id);
    if (!board) return;
    visible.push(board);
    for (const child of children.get(id) ?? []) if (expanded.has(child.id)) visit(child.id);
  };
  visit(root);
  return visible;
}

type Size = { width: number; height: number };
export type LayerNode = Size & { id: string; parent?: string; order: number };
/** Place whole subtrees in separate rows, so expanding a deep branch cannot overlap its siblings. */
export function layoutLayers(nodes: LayerNode[]): Map<string, { x: number; y: number } & Size> {
  const children = (id: string) => nodes.filter(node => node.parent === id).sort((a, b) => a.order - b.order);
  const sizes = new Map<string, Size>();
  const measure = (node: LayerNode): Size => {
    const nested = children(node.id).map(measure);
    const size = { width: node.width + (nested.length ? 96 + Math.max(...nested.map(item => item.width)) : 0),
      height: Math.max(node.height, nested.reduce((sum, item) => sum + item.height, 0) + Math.max(0, nested.length - 1) * 48) };
    sizes.set(node.id, size);
    return size;
  };
  const placed = new Map<string, { x: number; y: number } & Size>();
  const place = (node: LayerNode, x: number, y: number) => {
    const size = sizes.get(node.id)!;
    placed.set(node.id, { x, y: y + (size.height - node.height) / 2, width: node.width, height: node.height });
    const nested = children(node.id);
    const height = nested.reduce((sum, child) => sum + sizes.get(child.id)!.height, 0) + Math.max(0, nested.length - 1) * 48;
    let top = y + (size.height - height) / 2;
    for (const child of nested) { place(child, x + node.width + 96, top); top += sizes.get(child.id)!.height + 48; }
  };
  if (nodes[0]) { measure(nodes[0]); place(nodes[0], 24, 24); }
  return placed;
}

/** Isolate clip paths, filters and other fragment IDs when several rendered boards share one SVG. */
function namespaceIds(svg: SVGElement, prefix: string) {
  const ids = new Map<string, string>();
  for (const node of [svg, ...svg.querySelectorAll('[id]')]) {
    const id = node.getAttribute('id');
    if (id) { ids.set(id, prefix + id); node.setAttribute('id', prefix + id); }
  }
  const urls = (value: string) => value.replace(/url\(\s*(['"]?)#([^'"\s)]+)\1\s*\)/g,
    (match, quote: string, id: string) => ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match);
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/href$/i.test(attribute.name) && ids.has(attribute.value.slice(1)) && attribute.value.startsWith('#')) attribute.value = `#${ids.get(attribute.value.slice(1))}`;
      else if (attribute.value.includes('url(')) attribute.value = urls(attribute.value);
    }
    if (node.localName === 'style') node.textContent = urls(node.textContent ?? '');
  }
}

type LayerItem = { board: Board; svg: SVGElement };
type Shape = Board['diagram']['shapes'][number];
type Merge = { center: Shape; parent: Board; anchor: Shape };
type Point = { x: number; y: number };

function shapeElement(item: LayerItem, id: string) {
  return [...item.svg.querySelectorAll<SVGGElement>('g')].find(element =>
    element.dataset.shapeId === id || element.classList.contains(shapeClass(id)));
}
function edgeElement(item: LayerItem, id: string) {
  return [...item.svg.querySelectorAll<SVGGElement>('g')].find(element => element.classList.contains(shapeClass(id)));
}

/** Merge only a layer's central/entry topic with the one linked parent shape that represents it.
 * Repeated labels elsewhere, multiple possible entry points, and roots with their own icons or tooltips stay intact. */
function mergedRoots(items: LayerItem[]) {
  const merged = new Map<string, Merge>();
  const label = (shape: Shape) => 'label' in shape ? shape.label.replace(/\s+/g, ' ').trim() : undefined;
  for (const item of items.slice(1)) {
    const { board } = item;
    const parent = items.find(item => item.board.id === board.parent)?.board;
    if (!parent) continue;
    const centers = board.diagram.shapes.filter(shape => shape.classes?.includes('zf-topic'));
    const candidates = centers.length ? centers : board.diagram.shapes.filter(shape => !shape.id.includes('.') &&
      !board.diagram.connections.some(edge => edge.dst === shape.id && edge.src !== shape.id));
    const matches = candidates.flatMap(center => parent.diagram.shapes
      .filter(anchor => anchor.link === board.id && label(center) && label(anchor) === label(center))
      .map(anchor => ({ center, anchor, parent })));
    if (matches.length !== 1) continue;
    const merge = matches[0];
    const { center } = merge;
    if (center.icon || center.tooltip || board.diagram.shapes.some(shape => shape.id.startsWith(`${center.id}.`)) || !shapeElement(item, center.id)) continue;
    const edges = board.diagram.connections.filter(edge => edge.src === center.id || edge.dst === center.id);
    if (edges.some(edge => edge.src === edge.dst || edge.srcLabel || edge.dstLabel || !edgeElement(item, edge.id)?.querySelector('path.connection'))) continue;
    merged.set(board.id, merge);
  }
  return merged;
}

/** Extend an edge's existing label mask instead of clipping the part that now reaches into its parent layer. */
function extendMask(svg: SVGElement, path: SVGPathElement, start: Point, end: Point, move?: { x: number; y: number; dx: number; dy: number }) {
  const id = /url\(['"]?#([^)'"\s]+)/.exec(path.getAttribute('mask') ?? '')?.[1];
  const mask = id && [...svg.querySelectorAll('mask')].find(mask => mask.id === id);
  if (!mask) return;
  if (move) for (const rect of mask.querySelectorAll('rect[fill="black"]')) {
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(key => Number(rect.getAttribute(key)));
    if (move.x >= x && move.x <= x + width && move.y >= y && move.y <= y + height) {
      rect.setAttribute('x', String(x + move.dx)); rect.setAttribute('y', String(y + move.dy));
    }
  }
  const x = Math.min(Number(mask.getAttribute('x')), start.x, end.x) - 32;
  const y = Math.min(Number(mask.getAttribute('y')), start.y, end.y) - 32;
  const right = Math.max(Number(mask.getAttribute('x')) + Number(mask.getAttribute('width')), start.x, end.x) + 32;
  const bottom = Math.max(Number(mask.getAttribute('y')) + Number(mask.getAttribute('height')), start.y, end.y) + 32;
  for (const element of [mask, mask.querySelector('rect[fill="white"]')].filter(Boolean) as Element[]) {
    for (const [key, value] of Object.entries({ x, y, width: right - x, height: bottom - y })) element.setAttribute(key, String(value));
  }
}

function redirectRootEdges(item: LayerItem, center: Shape, source: Point) {
  for (const edge of item.board.diagram.connections) {
    if (edge.src !== center.id && edge.dst !== center.id) continue;
    const group = edgeElement(item, edge.id)!;
    for (const path of group.querySelectorAll<SVGPathElement>('path.connection')) {
      // D2 emits absolute connection paths. Keep the unchanged endpoint, including its arrowhead clearance.
      const coordinates = (path.getAttribute('d')?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const start = edge.src === center.id ? source : { x: coordinates[0], y: coordinates[1] };
      const end = edge.dst === center.id ? source : { x: coordinates.at(-2)!, y: coordinates.at(-1)! };
      const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      path.setAttribute('d', `M${start.x} ${start.y} C${middle.x} ${start.y} ${middle.x} ${end.y} ${end.x} ${end.y}`);
      path.dataset.layerEdge = edge.id;
      let move: { x: number; y: number; dx: number; dy: number } | undefined;
      const texts = [...group.querySelectorAll<SVGTextElement>('text')];
      if (edge.label && texts[0]) {
        const x = Number(texts[0].getAttribute('x'));
        const y = Number(texts[0].getAttribute('y'));
        move = { x, y, dx: middle.x - x, dy: middle.y + edge.fontSize * 0.35 - y };
        for (const text of texts) text.setAttribute('transform', `translate(${move.dx} ${move.dy}) ${text.getAttribute('transform') ?? ''}`);
      }
      extendMask(item.svg, path, start, end, move);
    }
  }
  const element = shapeElement(item, center.id)!;
  (element.closest('a') ?? element).remove();
  // Unassociated link badges are siblings of shapes in D2's SVG; remove the hidden root's badge too.
  for (const icon of item.svg.querySelectorAll<SVGGElement>('.appendix-icon')) {
    const position = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/.exec(icon.getAttribute('transform') ?? '');
    if (center.link && position && Math.abs(Number(position[1]) + 16 - center.pos.x - center.width) < 2 &&
      Math.abs(Number(position[2]) + 16 - center.pos.y) < 2) icon.remove();
  }
  item.svg.setAttribute('overflow', 'visible');
  item.svg.querySelector(':scope > svg')?.setAttribute('overflow', 'visible');
}

/** Compose the original board diagrams on one SVG, connected at the shapes that open each child.
 * All shape IDs stay board-scoped so source selection and editing keep their original meaning. */
export function composeLayers(items: LayerItem[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const create = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const boxes = new Map(items.map(({ board, svg }) => {
    const graph = svg.querySelector(':scope > svg') ?? svg;
    const values = graph.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [];
    if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) throw new Error(`Invalid SVG dimensions for ${board.name}`);
    return [board.id, { x: values[0], y: values[1], width: values[2], height: values[3] }];
  }));
  const nodes = items.map(({ board }, index) => {
    const parent = items.find(item => item.board.id === board.parent)?.board;
    const anchor = parent?.diagram.shapes.find(shape => shape.link === board.id);
    const box = boxes.get(board.id)!;
    return { id: board.id, parent: index ? board.parent : undefined, width: box.width, height: box.height + 28, order: anchor?.pos.y ?? index };
  });
  const placed = layoutLayers(nodes);
  const merged = mergedRoots(items);
  const anchorPoint = (board: Board, shape: Shape): Point => {
    // A central topic can itself open another layer; follow shared roots through the whole visible chain.
    while (merged.get(board.id)?.center.id === shape.id) {
      const merge = merged.get(board.id)!;
      board = merge.parent; shape = merge.anchor;
    }
    const box = placed.get(board.id)!;
    const view = boxes.get(board.id)!;
    return { x: box.x + shape.pos.x + shape.width - view.x,
      y: box.y + 28 + shape.pos.y + shape.height / 2 - view.y };
  };
  const width = Math.max(...[...placed.values()].map(box => box.x + box.width)) + 24;
  const height = Math.max(...[...placed.values()].map(box => box.y + box.height)) + 24;
  const svg = create('svg', { viewBox: `0 0 ${width} ${height}`, 'data-layer-canvas': '', preserveAspectRatio: 'xMidYMid meet' });
  const graph = create('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
  const rootGraph = items[0].svg.querySelector(':scope > svg');
  graph.setAttribute('class', rootGraph?.getAttribute('class') ?? '');
  const background = rootGraph?.querySelector(':scope > rect')?.cloneNode() as SVGRectElement | undefined;
  if (background) {
    for (const [key, value] of Object.entries({ x: 0, y: 0, width, height })) background.setAttribute(key, String(value));
    graph.append(background);
  }
  const connectors = create('g', { 'aria-hidden': 'true', class: 'zf-layer-connectors' });
  graph.append(connectors);
  for (const [index, { board, svg: content }] of items.entries()) {
    const box = placed.get(board.id)!;
    const view = boxes.get(board.id)!;
    const merge = merged.get(board.id);
    if (merge) {
      const point = anchorPoint(merge.parent, merge.anchor);
      redirectRootEdges({ board, svg: content }, merge.center, { x: point.x - box.x + view.x, y: point.y - box.y - 28 + view.y });
    }
    namespaceIds(content, `layer-${index}-`);
    // One background spans the connected canvas, rather than covering adjacent branches with board backgrounds.
    content.querySelector(':scope > svg > rect')?.remove();
    const group = create('g', { transform: `translate(${box.x} ${box.y})`, 'data-layer-board': board.id,
      role: 'group', 'aria-label': `${board.name} layer` });
    const label = create('text', { x: 12, y: 20, fill: '#52657d', opacity: 0.65, 'font-size': 14, 'font-family': 'sans-serif', class: 'zf-layer-label fill-N1' });
    label.textContent = board.name;
    content.setAttribute('x', '0'); content.setAttribute('y', '28');
    content.setAttribute('width', String(view.width)); content.setAttribute('height', String(view.height));
    if (!merge) group.append(label);
    group.append(content);
    graph.append(group);
    if (!index) continue;
    if (merge) {
      group.dataset.mergedRoot = merge.center.id;
      group.dataset.layerLink = board.id;
      continue;
    }
    const parent = items.find(item => item.board.id === board.parent)?.board;
    const parentBox = parent && placed.get(parent.id);
    const parentView = parent && boxes.get(parent.id);
    if (!parent || !parentBox || !parentView) continue;
    const anchors = parent.diagram.shapes.filter(shape => shape.link === board.id);
    const center = board.diagram.shapes.find(shape => !shape.id.includes('.')) ?? board.diagram.shapes[0];
    const end = { x: box.x + (center ? center.pos.x - view.x : 0),
      y: box.y + 28 + (center ? center.pos.y + center.height / 2 - view.y : view.height / 2) };
    for (const anchor of anchors.length ? anchors : [undefined]) {
      const start = anchor ? anchorPoint(parent, anchor) : { x: parentBox.x + parentView.width,
        y: parentBox.y + 28 + parentView.height / 2 };
      const bend = parentBox.x + parentBox.width + 48;
      connectors.append(create('path', { d: `M${start.x} ${start.y} C${bend} ${start.y} ${bend} ${end.y} ${end.x} ${end.y}`,
        fill: 'none', stroke: '#8192a4', 'stroke-width': 2, 'data-layer-link': board.id }));
    }
  }
  svg.append(graph);
  return svg;
}
