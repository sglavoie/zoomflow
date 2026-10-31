// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { indexBoards, shapeClass, type Diagram } from '@zoomflow/core';
import { Viewer } from '../src/index';
import { composeLayers, layerDepths, layoutLayers, visibleLayers } from '../src/layers';

const node = (name: string, layers: Diagram[] = []): Diagram => ({ name, shapes: [{ id: 'a', pos: { x: 10, y: 20 }, width: 80, height: 40 }],
  connections: [], layers } as unknown as Diagram);
const diagram = node('', [node('A', [node('Deep')]), node('B')]);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><svg viewBox="-10 -10 200 100" width="200" height="100">
  <rect width="200" height="100" fill="white"/><defs><clipPath id="clip"><rect width="80" height="40"/></clipPath></defs>
  <g class="${shapeClass('a')}" clip-path="url(#clip)"><rect x="10" y="20" width="80" height="40"/><text>Topic</text></g>
  </svg></svg>`;
const viewers: Viewer[] = [];
function mount(key = () => 'document') {
  const host = document.createElement('div');
  document.body.append(host);
  const viewer = new Viewer(host, { history: false, document: { key, restore: () => false } });
  viewers.push(viewer);
  return { viewer, host };
}
afterEach(() => { for (const viewer of viewers.splice(0)) viewer.destroy(); document.body.replaceChildren(); });

function sharedRootItems(chain = false) {
  const root = node('', [node('Detail', [node('Deep')])]);
  const child = root.layers![0]!;
  const deep = child.layers![0]!;
  const shape = (id: string, label: string, x: number, link = '', center = false) => ({
    id, label, pos: { x, y: 20 }, width: 80, height: 40, link, classes: center ? ['zf-topic'] : [],
  });
  const edge = { id: '(n -> branch)[0]', src: 'n', dst: 'branch', srcArrow: 'none', dstArrow: 'triangle', label: 'Next', fontSize: 16 };
  root.shapes = [shape('entry', 'Review', 10, 'root.layers.Detail')] as unknown as Diagram['shapes'];
  child.shapes = [shape('n', 'Review', 10, chain ? 'root.layers.Detail.layers.Deep' : '', true),
    shape('branch', 'Review', 150, chain ? '' : 'root.layers.Detail.layers.Deep')] as unknown as Diagram['shapes'];
  child.connections = [edge] as unknown as Diagram['connections'];
  deep.shapes = [shape('n', 'Review', 10, '', true), shape('branch', 'Finish', 150)] as unknown as Diagram['shapes'];
  deep.connections = [edge] as unknown as Diagram['connections'];
  const items = [...indexBoards(root).values()].map(board => {
    const shapes = board.diagram.shapes.map(shape => `<g class="${shapeClass(shape.id)}" data-shape-id="${shape.id}" data-shape-board="${board.id}"><rect x="${shape.pos.x}" y="20" width="80" height="40"/><text>${'label' in shape ? shape.label : ''}</text></g>`).join('');
    const edges = board.diagram.connections.map(edge => `<g class="${shapeClass(edge.id)}"><path class="connection" d="M90 40 L150 40" stroke="#e5484d" marker-end="url(#arrow)" mask="url(#labels)"/><text x="120" y="46">Next</text></g>`).join('');
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 100"><svg viewBox="-10 -10 260 100" width="260" height="100"><rect width="260" height="100" fill="white"/>
      <defs><marker id="arrow"/><mask id="labels" x="-10" y="-10" width="260" height="100"><rect x="-10" y="-10" width="260" height="100" fill="white"/><rect x="105" y="32" width="30" height="24" fill="black"/></mask></defs>${shapes}${edges}</svg></svg>`;
    return { board, svg: new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGElement };
  });
  return { root, items };
}

it('shows each shared root once, reconnects its branches, and keeps other topics with the same label', () => {
  const { root, items } = sharedRootItems();
  const source = JSON.stringify(root);
  const combined = composeLayers(items);
  expect(combined.querySelectorAll('[data-merged-root]')).toHaveLength(2);
  expect(combined.querySelectorAll('[data-shape-id="n"]')).toHaveLength(0);
  expect(combined.querySelectorAll('[data-shape-id="entry"]')).toHaveLength(1);
  expect(combined.querySelector('[data-layer-board="root.layers.Detail"] [data-shape-id="branch"]')).not.toBeNull();
  expect(combined.querySelectorAll('[data-layer-link]')).toHaveLength(2);
  for (const path of combined.querySelectorAll('path.connection')) {
    expect(path.getAttribute('d')).not.toBe('M90 40 L150 40');
    expect(path.getAttribute('d')).not.toContain('NaN');
    expect(path.getAttribute('stroke')).toBe('#e5484d');
    expect(path.getAttribute('marker-end')).toMatch(/url\(#layer-\d-arrow\)/);
    const mask = [...combined.querySelectorAll('mask')].find(mask => `url(#${mask.id})` === path.getAttribute('mask'))!;
    expect(Number(mask.getAttribute('x'))).toBeLessThan(-10);
  }
  expect(JSON.stringify(root)).toBe(source);
});

it('restores the centre when its board is the start of a subset and preserves distinct entry nodes', () => {
  const { items } = sharedRootItems();
  const subset = composeLayers(items.slice(1));
  expect(subset.querySelectorAll('[data-shape-board="root.layers.Detail"][data-shape-id="n"]')).toHaveLength(1);
  expect(subset.querySelectorAll('[data-shape-board="root.layers.Detail.layers.Deep"][data-shape-id="n"]')).toHaveLength(0);
  const distinct = sharedRootItems();
  (distinct.items[1].board.diagram.shapes[0] as unknown as { label: string }).label = 'Different entry';
  const combined = composeLayers(distinct.items);
  expect(combined.querySelector('[data-layer-board="root.layers.Detail"][data-merged-root]')).toBeNull();
  expect(combined.querySelector('[data-shape-board="root.layers.Detail"][data-shape-id="n"]')).not.toBeNull();
});

it('resolves a chain of shared centres to the same surviving ancestor shape', () => {
  const { items } = sharedRootItems(true);
  const combined = composeLayers(items);
  const starts = [...combined.querySelectorAll<SVGGElement>('[data-merged-root]')].map(group => {
    const position = group.getAttribute('transform')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const point = group.querySelector('path.connection')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    return { x: position[0] + point[0] + 10, y: position[1] + 28 + point[1] + 10 };
  });
  expect(starts).toHaveLength(2);
  expect(starts[0]).toEqual(starts[1]);
});

it('collapses whole subtrees and does not overlay scenarios or steps', () => {
  const boards = indexBoards({ ...diagram, scenarios: [node('Alternative', [node('Detail')])] });
  expect(visibleLayers(boards, 'root', new Set(boards.keys())).map(board => board.name)).toEqual(['Root', 'A', 'Deep', 'B']);
  expect(visibleLayers(boards, 'root', new Set(['root.layers.A.layers.Deep', 'root.layers.B'])).map(board => board.name)).toEqual(['Root', 'B']);
});

it('counts depth by layer boundaries relative to the chosen starting board', () => {
  const boards = indexBoards({ ...diagram, scenarios: [node('Alternative', [node('Detail')])] });
  expect([...layerDepths(boards, 'root')]).toEqual([
    ['root', 0], ['root.layers.A', 1], ['root.layers.A.layers.Deep', 2], ['root.layers.B', 1],
  ]);
  expect([...layerDepths(boards, 'root.layers.A')]).toEqual([
    ['root.layers.A', 0], ['root.layers.A.layers.Deep', 1],
  ]);
});

it('shows exactly the requested number of levels and keeps the depth relative when navigating', async () => {
  const { viewer } = mount();
  const tree = node('', [node('A', [node('Deep', [node('Leaf')])]), node('B', [node('Other')])]);
  await viewer.setDocument(tree, async () => svg);
  expect(viewer.layerState.maxDepth).toBe(3);
  await viewer.setLayerDepth(0);
  expect(viewer.layerState.visible).toEqual(new Set(['root']));
  await viewer.setLayerDepth(1);
  expect(viewer.layerState.visible).toEqual(new Set(['root', 'root.layers.A', 'root.layers.B']));
  await viewer.setLayerDepth(2);
  expect(viewer.layerState.visible.size).toBe(5);
  expect(viewer.layerState.visible.has('root.layers.A.layers.Deep.layers.Leaf')).toBe(false);
  expect(viewer.layerState.depth).toBe(2);
  await viewer.navigate('root.layers.A');
  expect(viewer.layerState.root).toBe('root.layers.A');
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A', 'root.layers.A.layers.Deep', 'root.layers.A.layers.Deep.layers.Leaf']));
  await viewer.navigate('root');
  expect(viewer.layerState.visible.size).toBe(5);
});

it('retains a chosen depth through source edits while individual switches create a custom view', async () => {
  const { viewer } = mount();
  const tree = node('', [node('A', [node('Deep', [node('Leaf')])]), node('B', [node('Other')])]);
  await viewer.setDocument(tree, async () => svg);
  await viewer.setLayerDepth(1);
  tree.layers![0]!.layers!.push(node('New', [node('Hidden')]));
  await viewer.setDocument(tree, async () => svg);
  expect(viewer.layerState.depth).toBe(1);
  expect(viewer.layerState.visible.size).toBe(3);
  await viewer.setLayerVisible('root.layers.A.layers.Deep', true);
  expect(viewer.layerState.depth).toBeNull();
  expect(viewer.layerState.visibleDepth).toBe(2);
  await viewer.setLayerDepth(2);
  expect(viewer.layerState.depth).toBe(2);
  expect(viewer.layerState.visible.size).toBe(6);
  expect(viewer.layerState.visible.has('root.layers.A.layers.New.layers.Hidden')).toBe(false);
  tree.layers![1]!.layers!.push(node('Another'));
  await viewer.setDocument(tree, async () => svg);
  expect(viewer.layerState.visible.has('root.layers.B.layers.Another')).toBe(true);
  expect(viewer.layerState.visible.has('root.layers.A.layers.Deep.layers.Leaf')).toBe(false);
});

it('keeps a finite depth per document and ignores invalid depth values', async () => {
  let key = 'first';
  const { viewer } = mount(() => key);
  await viewer.setDocument(diagram, async () => svg);
  await viewer.setLayerDepth(1);
  for (const depth of [-1, 1.5, NaN, Infinity]) await viewer.setLayerDepth(depth);
  expect(viewer.layerState.depth).toBe(1);
  key = 'second';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.layerState.depth).toBe(0);
  key = 'first';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.layerState.depth).toBe(1);
  await viewer.setAllLayers(true);
  expect(viewer.layerState.depth).toBe(2);
  await viewer.setAllLayers(false);
  expect(viewer.layerState.depth).toBe(0);
});

it('keeps a tall expanded subtree clear of its sibling and orders branches by their parent shapes', () => {
  const placed = layoutLayers([
    { id: 'root', width: 200, height: 100, order: 0 },
    { id: 'late', parent: 'root', width: 200, height: 100, order: 80 },
    { id: 'early', parent: 'root', width: 200, height: 100, order: 20 },
    { id: 'deep', parent: 'early', width: 200, height: 800, order: 0 },
  ]);
  const deep = placed.get('deep')!;
  const sibling = placed.get('late')!;
  expect(sibling.y).toBeGreaterThan(deep.y + deep.height);
  expect(deep.x).toBeGreaterThan(placed.get('early')!.x + placed.get('early')!.width);
});

it('isolates repeated SVG fragment IDs while connecting the original diagrams', () => {
  const items = [...indexBoards(diagram).values()].map(board => ({ board,
    svg: new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement }));
  const combined = composeLayers(items);
  const ids = [...combined.querySelectorAll('[id]')].map(node => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const shape of combined.querySelectorAll('[clip-path]')) {
    const id = shape.getAttribute('clip-path')!.slice(5, -1);
    expect(combined.querySelector(`#${id}`)).not.toBeNull();
  }
  expect(combined.querySelectorAll('[data-layer-link]')).toHaveLength(3);
});

it('remembers children when a parent is hidden and keeps editing scoped to the active board', async () => {
  const { viewer } = mount();
  viewer.setSourceShapes([...indexBoards(diagram).keys()].map(board => ({ board, shape: 'a', from: 0, to: 1 })));
  await viewer.setDocument(diagram, async () => svg);
  await viewer.setAllLayers(true);
  expect(viewer.stage.querySelectorAll('[data-layer-board]')).toHaveLength(4);
  const canvas = viewer.stage.firstElementChild;
  const deep = [...viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find(shape => shape.dataset.shapeBoard === 'root.layers.A.layers.Deep')!;
  deep.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(viewer.currentBoard?.id).toBe('root.layers.A.layers.Deep');
  expect(viewer.stage.firstElementChild).toBe(canvas);
  viewer.highlightShapes(['a']);
  expect([...viewer.stage.querySelectorAll<SVGElement>('.zf-source-selected')].map(shape => shape.dataset.shapeBoard)).toEqual(['root.layers.A.layers.Deep']);
  await viewer.setLayerVisible('root.layers.A', false);
  expect(viewer.layerState.expanded.has('root.layers.A.layers.Deep')).toBe(true);
  expect(viewer.currentBoard?.id).toBe('root');
  expect(viewer.stage.querySelectorAll('[data-layer-board]')).toHaveLength(2);
  await viewer.setLayerVisible('root.layers.A', true);
  expect(viewer.stage.querySelectorAll('[data-layer-board]')).toHaveLength(4);
});

it('preserves the previous view when expanding a layer cannot render', async () => {
  const { viewer, host } = mount();
  await viewer.setDocument(diagram, async target => { if (target) throw new Error('Child failed'); return svg; });
  await viewer.setAllLayers(true);
  expect(viewer.layerState.enabled).toBe(false);
  expect(viewer.stage.querySelector('[data-layer-canvas]')).toBeNull();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Child failed');
});

it('expands and toggles relative to a nested board without bringing in ancestors or siblings', async () => {
  const { viewer } = mount();
  await viewer.setDocument(diagram, async () => svg);
  await viewer.navigate('root.layers.A');
  expect(viewer.layerState.available).toEqual(new Set(['root.layers.A', 'root.layers.A.layers.Deep']));
  await viewer.setLayerVisible('root.layers.A.layers.Deep', true);
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A', 'root.layers.A.layers.Deep']));
  await viewer.setLayerVisible('root.layers.B', true);
  await viewer.setLayerVisible('root.layers.A', false);
  expect(viewer.layerState.root).toBe('root.layers.A');
  expect(viewer.layerState.visible.size).toBe(2);
  await viewer.setLayerVisible('root.layers.A.layers.Deep', false);
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A']));
  await viewer.setAllLayers(true);
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A', 'root.layers.A.layers.Deep']));
  expect(await viewer.renderVisibleLayers()).not.toContain('data-layer-board="root"');
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.layerState.root).toBe('root.layers.A');
  expect(viewer.layerState.visible.size).toBe(2);
});

it('focuses explicit navigation on the destination subtree, including navigation back to an ancestor', async () => {
  const { viewer } = mount();
  await viewer.setDocument(diagram, async () => svg);
  await viewer.setAllLayers(true);
  await viewer.navigate('root.layers.A');
  expect(viewer.layerState.root).toBe('root.layers.A');
  expect(viewer.stage.querySelectorAll('[data-layer-board]')).toHaveLength(2);
  await viewer.navigate('root.layers.A.layers.Deep');
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A.layers.Deep']));
  await viewer.navigate('root');
  expect(viewer.layerState.visible.size).toBe(4);
});

it('can expand from a shape selected within a larger canvas without retaining that canvas’s ancestors', async () => {
  const { viewer } = mount();
  await viewer.setDocument(diagram, async () => svg);
  await viewer.setAllLayers(true);
  const shape = [...viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find(shape => shape.dataset.shapeBoard === 'root.layers.A')!;
  shape.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(viewer.currentBoard?.id).toBe('root.layers.A');
  expect(viewer.layerState.root).toBe('root');
  expect(viewer.layerState.all).toBe(false);
  await viewer.setAllLayers(true);
  expect(viewer.layerState.root).toBe('root.layers.A');
  expect(viewer.layerState.visible).toEqual(new Set(['root.layers.A', 'root.layers.A.layers.Deep']));
});

it('ignores a delayed expansion after returning to one board', async () => {
  const { viewer } = mount();
  let release!: (svg: string) => void;
  await viewer.setDocument(diagram, target => target === 'layers.A' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(svg));
  const pending = viewer.setAllLayers(true);
  await viewer.setAllLayers(false);
  release(svg);
  await pending;
  expect(viewer.layerState.enabled).toBe(false);
  expect(viewer.stage.querySelector('[data-layer-canvas]')).toBeNull();
});

it('keeps visibility choices per document and exports a clean full-size composition', async () => {
  let key = 'first';
  const { viewer } = mount(() => key);
  await viewer.setDocument(diagram, async () => svg);
  await viewer.setAllLayers(true);
  await viewer.setLayerVisible('root.layers.B', false);
  viewer.highlightShapes(['a']);
  const exported = await viewer.renderVisibleLayers();
  expect(exported).toContain('data-layer-canvas');
  expect(exported).not.toContain('zf-source-selected');
  expect(exported).not.toContain('data-layer-board="root.layers.B"');
  key = 'second';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.layerState.enabled).toBe(false);
  key = 'first';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.layerState.visible.size).toBe(3);
});
