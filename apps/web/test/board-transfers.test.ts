import { readFileSync } from 'node:fs';
import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { boardBlocks, indexBoards, lint } from '@zoomflow/core';
import { boardTransfers, transferView } from '../src/board-transfers';
import { boardSites, isFileAttachment, joinBoard, splitBoard } from '../src/board-model';
import { readFlow } from '../src/flow-model';
import { mindMapSource, readMindMap } from '../src/mind-map-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2.dispose(); });
const mapBoard = 'root.layers.Plan the launch';
const onboarding = `${mapBoard}.layers.Onboarding`;
function fixture() {
  return readFileSync(new URL('../../../fixtures/mixed-transfers.d2', import.meta.url), 'utf8');
}
async function model(source: string) {
  const compiled = await d2.compile({ ...projectFileSystem('index.d2', {}, source), options: { layout: 'elk' } });
  const boards = indexBoards(compiled.diagram);
  return { compiled, boards, moves: boardTransfers(source, boards, compiled.graph),
    sites: boardSites(source, boardBlocks(compiled.graph, source, compiled.inputPath), boards) };
}
async function move(fromBoard: string, fromShape: string, toBoard: string, toShape: string, source = fixture()) {
  const before = await model(source);
  const key = before.moves.key(toBoard, toShape)!;
  expect(before.moves.choices(fromBoard, fromShape).map(item => item.id)).toContain(key);
  const result = before.moves.move(fromBoard, fromShape, key)!;
  const after = await model(result.source);
  expect(lint(after.compiled).diagnostics).toEqual([]);
  return { before, result, after };
}

it('moves Product’s entire mind map from Plan the launch to New idea, as in the screenshot', async () => {
  const { result, after } = await move(mapBoard, 'n', 'root', 'step_1');
  expect(after.boards.get('root')!.diagram.shapes.find(shape => shape.id === 'step_1')!.link).toBe(mapBoard);
  expect(after.boards.get('root')!.diagram.shapes.find(shape => shape.id === 'step_2')!.link).toBe('');
  expect(after.boards.get(onboarding)!.diagram.shapes[0].id).toBe('step_1');
  expect(after.sites.builder('root')?.kind).toBe('flow');
  expect(after.sites.builder(mapBoard)?.kind).toBe('mind map');
  expect(result.board).toBe(mapBoard); expect(result.shape).toBe('n');
});

it('moves Pricing and its Audience/Small teams branch under Sign up across diagram types', async () => {
  const { after, result } = await move(mapBoard, 'n_1', onboarding, 'step_1');
  const pricing = `${onboarding}.layers.Pricing`;
  expect(after.boards.get(onboarding)!.diagram.shapes.find(shape => shape.id === 'step_1')!.link).toBe(pricing);
  expect(after.boards.get(pricing)!.diagram.shapes.map(shape => 'label' in shape && shape.label)).toEqual(['Pricing', 'Audience', 'Small teams']);
  expect(after.boards.get(mapBoard)!.diagram.shapes.some(shape => 'label' in shape && shape.label === 'Pricing')).toBe(false);
  expect(after.sites.builder(mapBoard)?.kind).toBe('mind map');
  expect(after.sites.builder(onboarding)?.kind).toBe('flow');
  expect(result.board).toBe(pricing);
  expect(result.remap.get(JSON.stringify([mapBoard, 'n_2']))).toEqual({ board: mapBoard, shape: 'n_1' });
});

it('moves Launched out of the main flow and under Short videos without changing its terminal shape', async () => {
  const { after, result } = await move('root', 'step_5', mapBoard, 'n_3_1_2');
  const launched = `${mapBoard}.layers.Launched`;
  expect(readFlow(after.sites.builder('root')!.own)!.steps.map(step => step.id)).toEqual(['step_1', 'step_2', 'step_3', 'step_4']);
  expect(after.boards.get(mapBoard)!.diagram.shapes.find(shape => shape.id === 'n_3_1_2')!.link).toBe(launched);
  expect(after.boards.get(launched)!.diagram.shapes[0]).toMatchObject({ id: 'step_5', label: 'Launched', type: 'oval' });
  expect(after.sites.builder(launched)?.kind).toBe('flow');
  expect(result).toMatchObject({ board: launched, shape: 'step_5' });
});

it('rejects transfers into attached descendants and keeps a root board’s current parent as a no-op', async () => {
  const { moves } = await model(fixture());
  expect(moves.choices(mapBoard, 'n').map(item => item.id)).not.toContain(moves.key(onboarding, 'step_1'));
  expect(moves.choices(mapBoard, 'n').map(item => item.id)).not.toContain(moves.key('root', 'step_2'));
  expect(moves.choices('root', 'step_1')).toEqual([]);
});

it('keeps an occupied parent’s detail board while adding the moved branch as another child', async () => {
  const { after, result } = await move('root', 'step_5', mapBoard, 'n_2');
  const map = readMindMap(after.sites.builder(mapBoard)!.own)!;
  expect(map.root.children.find(topic => topic.label === 'Onboarding')!.children.map(topic => topic.label)).toEqual(['Launched']);
  expect(after.boards.has(onboarding)).toBe(true);
  expect(after.boards.get(result.board)!.diagram.shapes.find(shape => shape.id === result.shape)).toMatchObject({ label: 'Launched' });
});

it('carries a moved topic’s attached flow and its children into the new scope', async () => {
  const { after, result } = await move(mapBoard, 'n_2', 'root', 'step_5');
  const moved = 'root.layers.Onboarding';
  expect(result).toMatchObject({ board: moved, shape: 'n' });
  expect(after.boards.has(onboarding)).toBe(false);
  expect(after.sites.builder(`${moved}.layers.Onboarding`)?.kind).toBe('flow');
  expect(after.boards.get(`${moved}.layers.Onboarding`)!.diagram.shapes).toHaveLength(4);
  expect(after.boards.get(mapBoard)!.diagram.shapes.find(shape => shape.id === 'n_2')).toMatchObject({ label: 'Risks' });
});

function splitFixture(depth: number) {
  const root = splitBoard(fixture());
  const attached = root.attachments[0];
  if (isFileAttachment(attached)) throw new Error('Missing map');
  const parts = splitBoard(attached.body);
  const map = readMindMap(parts.own)!;
  map.split = depth;
  attached.body = joinBoard({ ...parts, own: mindMapSource(map) });
  return joinBoard(root);
}

it('moves a repeated detail-board centre and rebases its generated subboards', async () => {
  const pricing = `${mapBoard}.layers.Pricing`;
  const { after, result } = await move(pricing, 'n', onboarding, 'step_1', splitFixture(1));
  const moved = `${onboarding}.layers.Pricing`;
  expect(after.sites.builder(moved)?.kind).toBe('mind map');
  expect(after.boards.has(pricing)).toBe(false);
  expect(after.boards.get(`${moved}.layers.Audience`)!.diagram.shapes).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Small teams' })]));
  expect(result.boards.get(pricing)).toBe(moved);
});

it('attaches a transferred flow to the shared centre of a generated detail board', async () => {
  const { after, result } = await move('root', 'step_5', mapBoard, 'n_1', splitFixture(1));
  const detail = `${mapBoard}.layers.Pricing`;
  expect(result.board).toBe(`${detail}.layers.Launched`);
  expect(after.boards.get(detail)!.diagram.shapes.find(shape => shape.id === 'n')!.link).toBe(result.board);
  expect(after.sites.builder(mapBoard)?.kind).toBe('mind map');
});

it('remaps hidden choices by identity after a cut renumbers the original map', async () => {
  const { result } = await move(mapBoard, 'n_1', onboarding, 'step_1');
  const moved = `${onboarding}.layers.Pricing`;
  const view = transferView({ hidden: [[mapBoard, ['n_1_1_1', 'n_3_1_2']], [onboarding, ['step_2']]],
    layers: { root: 'root', expanded: [mapBoard, onboarding], all: false } }, result);
  expect(view.hidden).toEqual([[moved, ['n_1_1']], [mapBoard, ['n_2_1_2']], [onboarding, ['step_2']]]);
  expect(view.layers).toEqual({ root: 'root', expanded: [mapBoard, onboarding], all: false });
});

it('can move the same branch again from its new owner without losing either builder', async () => {
  const first = await move('root', 'step_5', mapBoard, 'n_3_1_2');
  const second = await move(first.result.board, first.result.shape, onboarding, 'step_1', first.result.source);
  expect(second.after.boards.has(first.result.board)).toBe(false);
  expect(second.after.sites.builder(second.result.board)?.kind).toBe('flow');
  expect(second.after.sites.builder(mapBoard)?.kind).toBe('mind map');
});

it('detaches a hand-written layer containing a builder without leaving a duplicate declaration', async () => {
  const main = splitBoard(fixture());
  const attached = main.attachments[0];
  if (isFileAttachment(attached)) throw new Error('Missing map');
  const source = `a\nb\nlayers: {\n  map: {\n${attached.body.split('\n').map(line => `    ${line}`).join('\n')}\n  }\n}\na.link: layers.map\n`;
  const { after, result } = await move('root.layers.map', 'n', 'root', 'b', source);
  expect(after.boards.get('root')!.diagram.shapes.find(shape => shape.id === 'b')!.link).toBe(result.board);
  expect(after.boards.get('root')!.diagram.shapes.find(shape => shape.id === 'a')!.link).toBe('');
  expect(after.boards.get(result.board)!.diagram.shapes.find(shape => shape.id === 'n')).toMatchObject({ label: 'Product' });
  expect(result.source.match(/# Created with the Zoomflow mind map builder\./g)).toHaveLength(1);
});

it('keeps a file link on a moved descendant and resolves duplicate board names without overwriting', async () => {
  const root = splitBoard(fixture());
  const attached = root.attachments[0];
  if (isFileAttachment(attached)) throw new Error('Missing map');
  const map = splitBoard(attached.body);
  map.attachments.push({ shape: 'n_1_1_1', file: './notes.d2#/Small%20teams' },
    { shape: 'n_3_1_1', name: 'Launched', body: 'kept: Original board\n' });
  attached.body = joinBoard(map);
  const first = await move(mapBoard, 'n_1', onboarding, 'step_1', joinBoard(root));
  expect(first.after.boards.get(first.result.board)!.diagram.shapes.find(shape => 'label' in shape && shape.label === 'Small teams')!.link).toBe('./notes.d2#/Small%20teams');
  const second = await move('root', 'step_5', mapBoard, 'n_2_1_2', first.result.source);
  expect(second.result.board).toBe(`${mapBoard}.layers.Launched 2`);
  expect(second.after.boards.get(`${mapBoard}.layers.Launched`)!.diagram.shapes[0]).toMatchObject({ label: 'Original board' });
});

it('retains an occupied topic’s flow when adding a child creates a generated detail board', async () => {
  const { after, result } = await move('root', 'step_5', mapBoard, 'n_2', splitFixture(1));
  const movedOnboarding = `${onboarding}.layers.Onboarding`;
  expect(after.sites.builder(movedOnboarding)?.kind).toBe('flow');
  expect(after.boards.get(movedOnboarding)!.diagram.shapes).toHaveLength(4);
  expect(after.sites.builder(mapBoard)?.kind).toBe('mind map');
  expect(result).toMatchObject({ board: onboarding, shape: 'n_1' });
});
