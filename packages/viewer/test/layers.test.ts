// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { indexBoards, shapeClass, type Diagram } from '@zoomflow/core';
import { Viewer } from '../src/index';
import { composeLayers, layoutLayers, visibleLayers } from '../src/layers';

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

it('collapses whole subtrees and does not overlay scenarios or steps', () => {
  const boards = indexBoards({ ...diagram, scenarios: [node('Alternative', [node('Detail')])] });
  expect(visibleLayers(boards, 'root', new Set(boards.keys())).map(board => board.name)).toEqual(['Root', 'A', 'Deep', 'B']);
  expect(visibleLayers(boards, 'root', new Set(['root.layers.A.layers.Deep', 'root.layers.B'])).map(board => board.name)).toEqual(['Root', 'B']);
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
