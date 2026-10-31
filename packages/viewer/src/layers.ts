import type { Board } from '@zoomflow/core';

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

/** Compose the original board diagrams on one SVG, connected at the shapes that open each child.
 * All shape IDs stay board-scoped so source selection and editing keep their original meaning. */
export function composeLayers(items: { board: Board; svg: SVGElement }[]): SVGSVGElement {
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
    namespaceIds(content, `layer-${index}-`);
    // One background spans the connected canvas, rather than covering adjacent branches with board backgrounds.
    content.querySelector(':scope > svg > rect')?.remove();
    const group = create('g', { transform: `translate(${box.x} ${box.y})`, 'data-layer-board': board.id,
      role: 'group', 'aria-label': `${board.name} layer` });
    const label = create('text', { x: 12, y: 20, fill: '#52657d', opacity: 0.65, 'font-size': 14, 'font-family': 'sans-serif', class: 'zf-layer-label fill-N1' });
    label.textContent = board.name;
    content.setAttribute('x', '0'); content.setAttribute('y', '28');
    content.setAttribute('width', String(view.width)); content.setAttribute('height', String(view.height));
    group.append(label, content);
    graph.append(group);
    if (!index) continue;
    const parent = items.find(item => item.board.id === board.parent)?.board;
    const parentBox = parent && placed.get(parent.id);
    const parentView = parent && boxes.get(parent.id);
    if (!parent || !parentBox || !parentView) continue;
    const anchors = parent.diagram.shapes.filter(shape => shape.link === board.id);
    const center = board.diagram.shapes.find(shape => !shape.id.includes('.')) ?? board.diagram.shapes[0];
    const end = { x: box.x + (center ? center.pos.x - view.x : 0),
      y: box.y + 28 + (center ? center.pos.y + center.height / 2 - view.y : view.height / 2) };
    for (const anchor of anchors.length ? anchors : [undefined]) {
      const start = { x: parentBox.x + (anchor ? anchor.pos.x + anchor.width - parentView.x : parentView.width),
        y: parentBox.y + 28 + (anchor ? anchor.pos.y + anchor.height / 2 - parentView.y : parentView.height / 2) };
      const bend = parentBox.x + parentBox.width + 48;
      connectors.append(create('path', { d: `M${start.x} ${start.y} C${bend} ${start.y} ${bend} ${end.y} ${end.x} ${end.y}`,
        fill: 'none', stroke: '#8192a4', 'stroke-width': 2, 'data-layer-link': board.id }));
    }
  }
  svg.append(graph);
  return svg;
}
