// @vitest-environment happy-dom
import { indexBoards, renderExportBoards, shapeClass, type Diagram } from '@zoomflow/core';
import { afterEach, expect, it } from 'vitest';
import { Viewer } from '../src/index';
import { diagramHiddenShapes, filterHiddenSvg, hiddenShapeIds, markHiddenShapes, removeHiddenShapes, visibleDiagram } from '../src/visibility';
import { associateShapeBadges } from '../src/shape-badges';

const diagram = { name: '', shapes: ['group', 'group.child', 'group.child.leaf', 'grouping', '"group.child"'].map((id, index) => ({
  id, label: id, link: '', pos: { x: index * 100, y: 20 }, width: 80, height: 40,
})), connections: [{ id: '(grouping -> group.child)[0]', src: 'grouping', dst: 'group.child' }] } as unknown as Diagram;
const board = indexBoards(diagram).get('root')!;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><svg viewBox="0 0 600 100" width="600" height="100">
  ${diagram.shapes.map(shape => `<g class="${shapeClass(shape.id)}"><rect width="80" height="40"/><text>${shape.id}</text></g>`).join('')}
  <g class="${shapeClass(diagram.connections[0].id)}"><path/><text>Incident edge</text></g></svg></svg>`;
const viewers: Viewer[] = [];
afterEach(() => { for (const viewer of viewers.splice(0)) viewer.destroy(); document.body.replaceChildren(); });
function mount(key = () => 'one') {
  const host = document.createElement('div');
  document.body.append(host);
  const viewer = new Viewer(host, { history: false, document: { key, restore: () => false } });
  viewers.push(viewer);
  return viewer;
}

it('hides a container and descendants without matching sibling prefixes or quoted literal dots', () => {
  const hidden = hiddenShapeIds(board, new Set(['group']));
  expect([...hidden]).toEqual(['group', 'group.child', 'group.child.leaf']);
  const filtered = visibleDiagram(diagram, new Map([['root', hidden]]));
  expect(filtered.shapes.map(shape => shape.id)).toEqual(['grouping', '"group.child"']);
  expect(filtered.connections).toEqual([]);
  expect(diagram.shapes).toHaveLength(5);
  const output = filterHiddenSvg(svg, board, hidden);
  const root = new DOMParser().parseFromString(output, 'image/svg+xml').documentElement;
  expect(root.getAttribute('viewBox')).toBe('0 0 600 100');
  expect([...root.querySelectorAll('text')].map(node => node.textContent)).toEqual(['grouping', '"group.child"']);
});

it('removes a hidden linked node and its unassociated badge while preserving other links', () => {
  const linked = `<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><g class="${shapeClass('group')}"><text>Hidden</text></g></a>
    <g class="appendix-icon" transform="translate(64, 4)"><text>Badge</text></g>
    <a href="https://example.org"><g class="${shapeClass('grouping')}"><text>Kept</text></g></a></svg>`;
  const linkedBoard = { ...board, diagram: { ...diagram, shapes: diagram.shapes.map(shape => shape.id === 'group' ? { ...shape, link: 'https://example.com' } : shape) } };
  const root = new DOMParser().parseFromString(filterHiddenSvg(linked, linkedBoard, new Set(['group'])), 'image/svg+xml');
  expect([...root.querySelectorAll('a')].map(node => node.getAttribute('href'))).toEqual(['https://example.org']);
  expect(root.querySelector('.appendix-icon')).toBeNull();
  expect(root.querySelector('text')!.textContent).toBe('Kept');
});

it('removes both link and tooltip badges by ownership after their positions change, preserving visible badges', () => {
  const linkedBoard = { ...board, diagram: { ...diagram, shapes: diagram.shapes.map(shape => ({ ...shape,
    link: shape.id === 'group' || shape.id === 'grouping' ? 'https://example.com' : '',
    tooltip: shape.id === 'group' || shape.id === 'grouping' ? 'Details' : '',
  })) } };
  const markup = `<svg xmlns="http://www.w3.org/2000/svg">
    <a href="https://example.com"><g class="${shapeClass('group')}"><text>Hidden</text></g></a>
    <g class="appendix-icon" transform="translate(64 4)"><title>Details</title><circle/></g>
    <g class="appendix-icon" transform="translate(32 4)"><circle/></g>
    <a href="https://example.com"><g class="${shapeClass('grouping')}"><text>Kept</text></g></a>
    <g class="appendix-icon" transform="translate(364 4)"><title>Details</title><circle/></g>
    <g class="appendix-icon" transform="translate(332 4)"><circle/></g>
  </svg>`;
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  associateShapeBadges(root, linkedBoard);
  const badges = [...root.querySelectorAll('[data-badge-shape="group"]')];
  expect(badges).toHaveLength(2);
  for (const badge of badges) badge.setAttribute('transform', 'translate(999 999) scale(0.2)');
  markHiddenShapes(root, linkedBoard, new Set(['group']));
  expect(badges.every(badge => badge.hasAttribute('data-export-hidden'))).toBe(true);
  markHiddenShapes(root, linkedBoard, new Set());
  expect(badges.some(badge => badge.hasAttribute('data-export-hidden'))).toBe(false);
  markHiddenShapes(root, linkedBoard, new Set(['group']));
  removeHiddenShapes(root);
  expect(root.querySelector('[data-badge-shape="group"]')).toBeNull();
  expect(root.querySelectorAll('[data-badge-shape="grouping"]')).toHaveLength(2);
});

it('follows connected children recursively, keeping incoming parents and unrelated branches visible', () => {
  const graph = { ...diagram, shapes: ['parent', 'branch', 'first', 'second', 'leaf', 'other'].map(id => ({ id })), connections: [
    { src: 'parent', dst: 'branch', srcArrow: 'none', dstArrow: 'triangle' },
    { src: 'branch', dst: 'first', srcArrow: 'none', dstArrow: 'none' },
    { src: 'branch', dst: 'second', srcArrow: 'none', dstArrow: 'none' },
    { src: 'first', dst: 'leaf', srcArrow: 'none', dstArrow: 'triangle' },
    { src: 'leaf', dst: 'first', srcArrow: 'none', dstArrow: 'triangle' },
    { src: 'parent', dst: 'other', srcArrow: 'none', dstArrow: 'none' },
  ] } as unknown as Diagram;
  expect([...hiddenShapeIds({ ...board, diagram: graph }, new Set(['branch']))]).toEqual(['branch', 'first', 'second', 'leaf']);
  const reversed = { ...graph, connections: [{ src: 'leaf', dst: 'branch', srcArrow: 'triangle', dstArrow: 'none' }] } as unknown as Diagram;
  expect([...hiddenShapeIds({ ...board, diagram: reversed }, new Set(['branch']))]).toEqual(['branch', 'leaf']);
});

it('hides linked detail layers and their descendants without following back links or unrelated layers', async () => {
  const tree = { ...diagram, shapes: [{ ...diagram.shapes[0], id: 'entry', link: 'root.layers.Detail' },
    { ...diagram.shapes[1], id: 'keep', link: '' }], connections: [], layers: [
    { ...diagram, name: 'Detail', layers: [{ ...diagram, name: 'Deep' }] },
    { ...diagram, name: 'Other' },
  ] } as unknown as Diagram;
  const boards = indexBoards(tree);
  const hidden = diagramHiddenShapes(boards, new Map([['root', new Set(['entry'])]]));
  expect(hidden.get('root')).toEqual(new Set(['entry']));
  expect(hidden.get('root.layers.Detail')!.size).toBe(5);
  expect(hidden.get('root.layers.Detail.layers.Deep')!.size).toBe(5);
  expect(hidden.get('root.layers.Other')!.size).toBe(0);
  const viewer = mount();
  await viewer.setDocument(tree, async () => svg);
  viewer.toggleShapeHidden('group.child', 'root.layers.Detail');
  viewer.toggleShapeHidden('entry');
  expect(viewer.isShapeHidden('group', 'root.layers.Detail.layers.Deep')).toBe(true);
  viewer.toggleShapeHidden('entry');
  expect(viewer.isShapeHidden('group', 'root.layers.Detail')).toBe(false);
  expect(viewer.isShapeHidden('group.child', 'root.layers.Detail')).toBe(true);
  viewer.toggleShapeHidden('entry');
  viewer.toggleShapeHidden('group.child.leaf', 'root.layers.Detail');
  expect(viewer.hiddenShapeCount()).toBe(0);
});

it('preserves explicit child choices when toggling a container and unhides an inherited choice', async () => {
  const viewer = mount();
  await viewer.setDocument(diagram, async () => svg);
  viewer.toggleShapeHidden('group.child');
  viewer.toggleShapeHidden('group');
  viewer.toggleShapeHidden('group');
  expect(viewer.isShapeHidden('group')).toBe(false);
  expect(viewer.isShapeHidden('group.child')).toBe(true);
  viewer.toggleShapeHidden('group');
  viewer.toggleShapeHidden('group.child.leaf');
  expect(viewer.hiddenShapeCount()).toBe(0);
});

it('remembers choices across recompiles and documents and copies them independently for Save as', async () => {
  let key = 'one';
  const viewer = mount(() => key);
  await viewer.setDocument(diagram, async () => svg);
  viewer.toggleShapeHidden('group');
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.isShapeHidden('group.child')).toBe(true);
  key = 'two';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.hiddenShapeCount()).toBe(0);
  key = 'one';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.hiddenShapeCount()).toBe(3);
  viewer.copyLayerDocument('copy');
  key = 'copy';
  viewer.toggleShapeHidden('group');
  expect(viewer.hiddenShapeCount()).toBe(0);
  key = 'one';
  await viewer.setDocument(diagram, async () => svg);
  expect(viewer.hiddenShapeCount()).toBe(3);
});

it('snapshots board-specific visibility for exports and omits hidden search entries', async () => {
  const viewer = mount();
  const tree = { ...diagram, layers: [{ ...diagram, name: 'Detail' }] };
  await viewer.setDocument(tree, async () => svg);
  viewer.toggleShapeHidden('group');
  const view = viewer.exportView(tree, async () => svg);
  viewer.toggleShapeHidden('group');
  const boards = await renderExportBoards(view.diagram, view.render);
  expect(boards[0].searchShapes!.map(shape => shape.id)).toEqual(['grouping', '"group.child"']);
  expect(boards[0].svg).not.toContain('Incident edge');
  expect(boards[1].searchShapes).toHaveLength(5);
  expect(boards[1].svg).toContain('Incident edge');
  expect(viewer.hiddenShapeCount()).toBe(0);
});

it('omits hidden nodes and their edges in a combined layer export', async () => {
  const viewer = mount();
  await viewer.setDocument({ ...diagram, layers: [{ ...diagram, name: 'Detail' }] }, async () => svg);
  viewer.toggleShapeHidden('group');
  await viewer.setAllLayers(true);
  const output = await viewer.renderVisibleLayers();
  const root = new DOMParser().parseFromString(output!, 'image/svg+xml');
  expect(root.querySelector('[data-layer-board="root"] [data-shape-id="group"]')).toBeNull();
  expect(root.querySelector('[data-layer-board="root.layers.Detail"] [data-shape-id="group"]')).not.toBeNull();
  expect(root.querySelector('.zf-hidden-label')).toBeNull();
  expect(viewer.stage.querySelector('[data-export-hidden]')).not.toBeNull();
});
