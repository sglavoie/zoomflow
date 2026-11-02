import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { indexBoards, rebaseFileLinks } from '@zoomflow/core';
import { graphBranches } from '../src/graph-branches';
import { flowSource, flowTemplate, readFlow } from '../src/flow-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2.dispose(); });
const compile = (source: string, fs: Record<string, string> = {}) => d2.compile({ ...projectFileSystem('index.d2', fs, source), options: { layout: 'elk' } });
async function model(source: string, fs?: Record<string, string>) {
  const compiled = await compile(source, fs);
  return { compiled, moves: graphBranches(source, compiled.diagram, compiled.graph) };
}
const pairs = (diagram: Awaited<ReturnType<typeof compile>>['diagram']) => diagram.connections.map(edge => [edge.src, edge.dst, edge.label]);

it('rewires a node while keeping its downstream graph, implicit nodes, custom source and comments', async () => {
  const source = '# Keep me\ndirection: right\na -> child -> leaf: Chain\nb\nchild: {tooltip: Details; style.fill: green}\n';
  const { moves } = await model(source);
  expect(moves.branch('root', 'child')!.destinations.map(item => item.id)).toEqual(['b']);
  const changed = moves.move('root', 'child', 'b')!.source;
  expect(changed.startsWith(source)).toBe(true);
  const result = await compile(changed);
  expect(pairs(result.diagram)).toEqual([['child', 'leaf', 'Chain'], ['b', 'child', 'Chain']]);
  expect(result.diagram.shapes.map(item => item.id)).toContain('a');
  expect(result.diagram.shapes.find(item => item.id === 'child')).toMatchObject({ tooltip: 'Details', fill: 'green' });
  expect(moves.move('root', 'child', 'leaf')).toBeUndefined();
  expect(moves.move('root', 'child', 'child')).toBeUndefined();
  expect(moves.move('root', 'child', 'a')).toBeUndefined();
  expect(moves.move('root', 'missing', 'b')).toBeUndefined();
});

it('replaces multiple incoming parents, preserves parallel labels and self-loops, and supports successive moves', async () => {
  const source = 'a -> child: One\na -> child: Two\nb -> child: Three\nchild -> child: Again\nchild -> leaf\nc\nd';
  const { moves } = await model(source);
  const changed = moves.move('root', 'child', 'b')!.source;
  const result = await compile(changed);
  expect(pairs(result.diagram)).toEqual([
    ['b', 'child', 'Three'], ['child', 'child', 'Again'], ['child', 'leaf', ''], ['b', 'child', 'One'], ['b', 'child', 'Two'],
  ]);
  const next = await model(changed);
  const final = await compile(next.moves.move('root', 'child', 'c')!.source);
  expect(final.diagram.connections.filter(edge => edge.dst === 'child' && edge.src !== 'child').map(edge => edge.src)).toEqual(['c', 'c', 'c']);
  expect(pairs(final.diagram)).toContainEqual(['child', 'leaf', '']);
});

it('keeps builder flows editable, including merges, parallel arrows, loops and unattached steps', async () => {
  const flow = flowTemplate('simple');
  flow.steps.push({ id: 'step_4', label: 'Another parent', shape: 'rectangle' });
  flow.connections.push({ from: 'step_2', to: 'step_2', label: 'Retry' });
  flow.connections.push({ from: 'step_3', to: 'step_2', label: 'Return' });
  const own = flowSource(flow);
  const { moves } = await model(own);
  const changed = moves.move('root', 'step_2', 'step_4', own)!.own!;
  expect(readFlow(changed)!.connections).toEqual([
    { from: 'step_4', to: 'step_2', label: '' }, { from: 'step_2', to: 'step_3', label: '' }, { from: 'step_2', to: 'step_2', label: 'Retry' },
    { from: 'step_3', to: 'step_2', label: 'Return' },
  ]);
  expect(moves.move('root', 'step_4', 'step_1', own)!.own).toContain('step_1 -> step_4');
});

it('keeps feedback loops inside the moved downstream branch and treats the old external parent as a no-op', async () => {
  const source = 'a -> child: Start\nchild -> work\nwork -> child: Retry\nb';
  const { moves } = await model(source);
  expect(moves.branch('root', 'child')!.destinations.map(item => item.id)).toEqual(['b']);
  expect(moves.move('root', 'child', 'a')).toBeUndefined();
  const changed = await compile(moves.move('root', 'child', 'b')!.source);
  expect(pairs(changed.diagram)).toEqual([['child', 'work', ''], ['work', 'child', 'Retry'], ['b', 'child', 'Start']]);
});

it('preserves final indexed styling, arrowhead labels, links, tooltips and backward arrows', async () => {
  const source = `classes: {edge: {style.stroke: red; style.stroke-width: 4}}
child <- a: Yes {class: edge; tooltip: Help; link: https://example.org; source-arrowhead: In {shape: diamond; style.filled: true}; target-arrowhead: End {shape: circle}}
(child <- a)[0].style.stroke: blue
child -> leaf
b`;
  const { compiled, moves } = await model(source);
  const changedSource = moves.move('root', 'child', 'b')!.source;
  const changed = await compile(changedSource);
  const edge = changed.diagram.connections.find(item => item.src === 'child' && item.dst === 'b')!;
  const original = compiled.diagram.connections[0];
  for (const key of ['label', 'classes', 'stroke', 'strokeWidth', 'tooltip', 'link', 'srcArrow', 'dstArrow', 'srcLabel', 'dstLabel'] as const) expect(edge[key]).toEqual(original[key]);
});

it('preserves Markdown labels and CRLF sources while moving a styled branch', async () => {
  const source = 'a -> child: |md\n  **Important**\n| {style.font-size: 19}\nchild -> leaf\nb\n'.replaceAll('\n', '\r\n');
  const { compiled, moves } = await model(source);
  const changed = moves.move('root', 'child', 'b')!.source;
  expect(changed.startsWith(source)).toBe(true);
  const next = await compile(changed);
  const edge = next.diagram.connections.find(item => item.src === 'b')!;
  expect(edge.language).toBe(compiled.diagram.connections[0].language);
  expect(edge.label.trim()).toBe(compiled.diagram.connections[0].label.trim());
  expect(edge.fontSize).toBe(19);
});

it('preserves each parallel SQL column connection and rebased links from imported files', async () => {
  const source = 'parent: {shape: sql_table; id: int; code: int}\nchild: {shape: sql_table; id: int; code: int}\nparent.id -> child.id: ID\nparent.code -> child.code: Code\nparent.id -> child.id: Again\nb\nc';
  const { moves } = await model(source);
  const changedSource = moves.move('root', 'child', 'b')!.source;
  const changed = await compile(changedSource);
  expect(changed.diagram.connections.map(edge => [edge.src, edge.dst, edge.label])).toEqual([['b', 'child', 'ID'], ['b', 'child', 'Code'], ['b', 'child', 'Again']]);
  expect((changed.graph as any).edges.map((edge: any) => edge.dstTableColumnIndex)).toEqual([0, 1, 0]);
  const next = graphBranches(changedSource, changed.diagram, changed.graph);
  const twice = await compile(next.move('root', 'child', 'c')!.source);
  expect(twice.diagram.connections.map(edge => edge.src)).toEqual(['c', 'c', 'c']);
  const imported = '...@sub/shared\nb';
  const fs = { 'sub/shared.d2': 'a -> child: {link: "./detail.d2"}' };
  const compiled = await compile(imported, fs);
  const diagram = rebaseFileLinks(compiled, 'index.d2');
  const move = graphBranches(imported, diagram, compiled.graph).move('root', 'child', 'b')!;
  const result = await compile(move.source, fs);
  expect(result.diagram.connections[0].link).toBe('./sub/detail.d2');
});

it('supports quoted names, container endpoints, undirected branches, and nodes with no incoming connection', async () => {
  const source = '"group (A)": {"x -> y" -- leaf: Joined}\n"new parent"\nlonely';
  const { moves } = await model(source);
  const changed = await compile(moves.move('root', '"group (A)".leaf', 'new parent')!.source);
  expect(pairs(changed.diagram)).toContainEqual(['new parent', '"group (A)".leaf', 'Joined']);
  const added = await compile(moves.move('root', 'lonely', 'new parent')!.source);
  expect(pairs(added.diagram)).toContainEqual(['new parent', 'lonely', '']);
  expect(moves.move('root', '"group (A)"', '"group (A)".leaf')).toBeUndefined();
});

it('reparents inside layers, scenarios and steps without mixing repeated shape IDs across boards', async () => {
  const source = 'a -> child\nb\nlayers: {detail: {a -> child -> leaf; b}}\nscenarios: {alternate: {b}}\nsteps: {first: {b}}';
  const { moves } = await model(source);
  for (const board of ['root.layers.detail', 'root.scenarios.alternate', 'root.steps.first']) {
    const changed = await compile(moves.move(board, 'child', 'b')!.source);
    const boards = indexBoards(changed.diagram);
    expect(pairs(boards.get(board)!.diagram)).toContainEqual(['b', 'child', '']);
    expect(pairs(changed.diagram)).toEqual([['a', 'child', '']]);
  }
});

it('retains column endpoints and imported relationships through local connection overrides', async () => {
  const source = 'parent: {shape: sql_table; id: int}\nchild: {shape: sql_table; id: int}\nparent.id -> child.id: FK\nb';
  const { moves } = await model(source);
  const changed = await compile(moves.move('root', 'child', 'b')!.source);
  expect(changed.diagram.connections).toHaveLength(1);
  expect(pairs(changed.diagram)).toEqual([['b', 'child', 'FK']]);
  expect((changed.graph as any).edges[0].dstTableColumnIndex).toBe(0);
  const imported = '...@shared\nb';
  const fs = { 'shared.d2': 'a -> child: Imported\nchild -> leaf' };
  const project = await model(imported, fs);
  const result = await compile(project.moves.move('root', 'child', 'b')!.source, fs);
  expect(pairs(result.diagram)).toEqual([['child', 'leaf', ''], ['b', 'child', 'Imported']]);
});

it('writes resolved board links back in valid D2 syntax for child, parent, sibling and self routes', async () => {
  for (const link of ['layers.detail', 'layers.detail.layers.deep']) {
    const source = `a -> child: {link: ${link}}\nb\nlayers: {detail: {x; layers: {deep: {y}}}}`;
    const { compiled, moves } = await model(source);
    const changed = await compile(moves.move('root', 'child', 'b')!.source);
    expect(indexBoards(compiled.diagram).has(compiled.diagram.connections[0].link)).toBe(true);
    expect(changed.diagram.connections[0].link).toBe(compiled.diagram.connections[0].link);
  }
  for (const link of ['layers.detail', '_', '_.layers.other', '_.layers.inner']) {
    const source = `layers: {inner: {a -> child: {link: ${link}}; b; layers: {detail: {x}}}; other: {y}}`;
    const { compiled, moves } = await model(source);
    const id = 'root.layers.inner';
    const changed = await compile(moves.move(id, 'child', 'b')!.source);
    expect(indexBoards(compiled.diagram).has(indexBoards(compiled.diagram).get(id)!.diagram.connections[0].link)).toBe(true);
    expect(indexBoards(changed.diagram).get(id)!.diagram.connections[0].link).toBe(indexBoards(compiled.diagram).get(id)!.diagram.connections[0].link);
  }
});
