import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { boardBlocks, indexBoards } from '@zoomflow/core';
import { blockText, boardSites, joinBoard, reattach, splitBoard } from '../src/board-model';
import { editOnCanvas } from '../src/canvas-model';
import { flowSource, flowTemplate, readFlow } from '../src/flow-model';
import { mindMapSource, parseOutline, readMindMap, type MindMap } from '../src/mind-map-model';
import { plainLook } from '../src/flow-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

const compile = (source: string) => d2.compile({ ...projectFileSystem('index.d2', {}, source), options: { layout: 'elk' } });
async function sites(source: string) {
  const compiled = await compile(source);
  const boards = indexBoards(compiled.diagram);
  return { boards, sites: boardSites(source, boardBlocks(compiled.graph, source, compiled.inputPath), boards) };
}
const flow = flowSource(flowTemplate('approval'));
const map = (outline: string, split = 0): MindMap => ({ direction: 'right', split, look: plainLook(), root: parseOutline(outline)! });

it('keeps attached boards apart from the own text, and reads only the exact form it writes', () => {
  const parts = { own: flow, attachments: [{ shape: 'step_3', name: 'Ideas "1"', body: 'a -> b\n\nc: {\n  d\n}' }] };
  const text = joinBoard(parts);
  expect(text).toContain('\n\n# Boards that open from shapes on this board.\nstep_3.link: layers."Ideas \\"1\\""\nlayers."Ideas \\"1\\"": {\n  a -> b\n\n  c: {\n    d\n  }\n}\n');
  const split = splitBoard(text);
  expect(readFlow(split.own)).toBeTruthy();
  expect(split.attachments).toEqual(parts.attachments);
  expect(joinBoard({ own: flow, attachments: [] })).toBe(flow);
  // A section that does not follow the written form stays part of the own text.
  for (const changed of [text.replace('layers."Ideas', 'layers.Ideas'), text.replace('\n  a -> b', '\na -> b'), `${text}x\n`]) {
    expect(splitBoard(changed)).toEqual({ own: changed, attachments: [] });
  }
});

it('reads a nested block without its indentation and writes it back in place', () => {
  const source = 'a\nlayers: {\n  x: {\n    b -> c\n\n    d: {\n      e\n    }\n  }\n}\n';
  const from = source.indexOf('{\n    b') + 1;
  const block = blockText(source, { from, to: source.indexOf('\n  }\n}') + 3 });
  expect(block.text).toBe('b -> c\n\nd: {\n  e\n}');
  expect(block.replace(block.text)).toBe(source);
  expect(block.replace('f\ng')).toBe('a\nlayers: {\n  x: {\n    f\n    g\n  }\n}\n');
  const inline = 'layers: {y: {a; b}}';
  expect(blockText(inline, { from: 13, to: 17 }).replace('c')).toBe('layers: {y: {\n  c\n}}');
});

it('adds a mind map board to a flow step and keeps the flow editable', async () => {
  let source = flow;
  let { sites: site } = await sites(source);
  expect(site.owner('root')).toBe('root');
  expect(site.shapeAction('root', 'step_3')).toEqual({ action: 'add' });
  const added = site.add('root', 'step_3', mindMapSource(map('Complete request\n  Notify\n  Archive')), 'Complete request');
  expect(added.name).toBe('Complete request');
  source = added.source;
  ({ sites: site } = await sites(source));
  const board = 'root.layers.Complete request';
  expect(site.shapeAction('root', 'step_3')).toEqual({ action: 'edit', board, kind: 'mind map' });
  expect(site.owner(board)).toBe(board);
  expect(site.builder('root')).toEqual({ kind: 'flow', own: expect.stringContaining('step_4') });
  // Editing the flow keeps the attached board on its step.
  const edited = flowSource({ ...readFlow(site.builder('root')!.own)!, direction: 'right' });
  const updated = site.update('root', edited);
  if (!('source' in updated)) throw new Error(updated.error);
  expect(splitBoard(updated.source).attachments.map(item => item.shape)).toEqual(['step_3']);
  // Editing the attached map rewrites only its block.
  const nested = site.update(board, mindMapSource(map('Complete request\n  Notify\n  Archive\n  Celebrate')));
  if (!('source' in nested)) throw new Error(nested.error);
  expect(nested.source.startsWith(splitBoard(source).own.trimEnd())).toBe(true);
  expect((await compile(nested.source)).diagram.layers?.[0]?.shapes.map(shape => shape.id)).toContain('n_3');
});

it('adds boards to topics on a mind map and to its attached boards, not to its detail boards', async () => {
  let source = mindMapSource(map('Trip\n  Places\n    Lisbon\n      Alfama\n  Budget', 2));
  let { sites: site, boards } = await sites(source);
  expect(site.shapeAction('root', 'n_1_1')).toEqual({ action: 'none', reason: 'This shape already opens another board or link.' });
  expect(site.owner('root.layers.Lisbon')).toBe('root');
  expect(site.shapeAction('root.layers.Lisbon', 'n_1')).toEqual({ action: 'none',
    reason: 'This board is part of the mind map on “Root”. Add boards from its main board.' });
  // A board named like a detail board gets a distinct name.
  const added = site.add('root', 'n_2', flow, 'Lisbon');
  expect(added.name).toBe('Lisbon 2');
  source = added.source;
  ({ sites: site, boards } = await sites(source));
  expect(boards.has('root.layers.Lisbon 2')).toBe(true);
  expect(site.owner('root')).toBe('root');
  expect(site.shapeAction('root.layers.Lisbon 2', 'step_1')).toEqual({ action: 'add' });
});

it('adds boards to hand-written boards declared once in the file', async () => {
  const source = 'a -> b\nb.link: layers.detail\nlayers: {\n  detail: {\n    c -> d\n  }\n  twice: {e}\n}\nlayers.twice.f\n';
  const { sites: site } = await sites(source);
  expect(site.owner('root.layers.detail')).toBeUndefined();
  expect(site.shapeAction('root.layers.detail', 'c')).toEqual({ action: 'add' });
  expect(site.shapeAction('root.layers.twice', 'e')).toMatchObject({ action: 'none' });
  const added = site.add('root.layers.detail', 'c', flow, 'C');
  expect(added.source).toContain('  detail: {\n    c -> d\n\n    # Boards that open from shapes on this board.\n    c.link: layers."C"\n    layers."C": {\n      # Created with');
  const compiled = await compile(added.source);
  expect(indexBoards(compiled.diagram).has('root.layers.detail.layers.C')).toBe(true);
});

it('adds boards to shapes whose identifiers D2 single-quotes, in a form board indexing reads', async () => {
  const source = '"null"\n"has \\"quote\\""\n"it\'s"\n';
  const { sites: site } = await sites(source);
  let next = site.add('root', "'null'", flow, 'Empty').source;
  next = (await sites(next)).sites.add('root', '\'has "quote"\'', flow, 'Quoted').source;
  next = (await sites(next)).sites.add('root', '"it\'s"', flow, 'Apostrophe').source;
  expect(next).toContain('"null".link: layers."Empty"');
  expect(next).toContain('"has \\"quote\\"".link: layers."Quoted"');
  expect(next).toContain('"it\'s".link: layers."Apostrophe"');
  const { boards, sites: added } = await sites(next);
  expect(boards.get('root')!.diagram.shapes.map(shape => shape.link)).toEqual(['root.layers.Empty', 'root.layers.Quoted', 'root.layers.Apostrophe']);
  // The attached boards are still read as such, so builders keep them.
  expect(added.builder('root')).toBeUndefined();
  expect(splitBoard(next).attachments.map(item => item.name)).toEqual(['Empty', 'Quoted', 'Apostrophe']);
});

it('keeps an attached board on its own topic when another topic has the same labels', () => {
  const before = mindMapSource(map('Plan\n  Ideas\n  Ideas'));
  const attachments = [{ shape: 'n_2', name: 'Second ideas', body: flow }];
  expect(reattach(before, mindMapSource({ ...map('Plan\n  Ideas\n  Ideas'), direction: 'down' }), attachments)).toEqual(attachments);
});

it('moves attached boards with their topics and explains what it cannot keep', () => {
  const before = mindMapSource(map('Plan\n  People\n    Hiring\n  Money'));
  const attachments = [{ shape: 'n_1_1', name: 'Hiring', body: flow }];
  expect(reattach(before, mindMapSource(map('Plan\n  Money\n  People\n    Hiring')), attachments)).toEqual([{ ...attachments[0], shape: 'n_2_1' }]);
  // A topic moved under another parent is found by its label when that is unique.
  expect(reattach(before, mindMapSource(map('Plan\n  Money\n    Hiring')), attachments)).toEqual([{ ...attachments[0], shape: 'n_1_1' }]);
  expect(reattach(before, mindMapSource(map('Plan\n  Money')), attachments)).toMatch(/^The topic “Hiring” opens the board “Hiring”/);
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n      Roles', 2)), attachments)).toMatch(/would open a detail board/);
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Hiring\n      Roles', 2)), attachments))
    .toMatch(/same name as a detail board/);
  const steps = flowTemplate('approval');
  const flowAttachments = [{ shape: 'step_4', name: 'Changes', body: flow }];
  expect(reattach(flowSource(steps), flowSource({ ...steps, steps: steps.steps.slice(0, 3), connections: [] }), flowAttachments))
    .toBe('The step “Request changes” opens the board “Changes”. Keep the step, or delete its board in the source first.');
  expect(reattach(flowSource(steps), flowSource({ ...steps, direction: 'right' }), flowAttachments)).toBe(flowAttachments);
  expect(readMindMap(before)).toBeTruthy();
});

it('keeps attached boards on renamed topics', () => {
  const before = mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Hiring'));
  const attachments = [{ shape: 'n_2_1', name: 'Budget hiring', body: flow }];
  // Renamed on the diagram: the edit says where each topic went.
  const renamed = editOnCanvas(before, [], 'n_2_1', { type: 'rename', label: 'Contractors' })!;
  expect(reattach(before, renamed.own, attachments, renamed.moved)).toEqual(attachments);
  const parent = editOnCanvas(before, [], 'n_2', { type: 'rename', label: 'Budget' })!;
  expect(reattach(before, parent.own, attachments, parent.moved)).toEqual(attachments);
  const removed = editOnCanvas(before, [], 'n_1', { type: 'remove' })!;
  expect(reattach(before, removed.own, attachments, removed.moved)).toEqual([{ ...attachments[0], shape: 'n_1_1' }]);
  // A removed topic's board is not moved to another topic with the same label.
  const gone = editOnCanvas(before, [], 'n_2', { type: 'remove' })!;
  expect(reattach(before, gone.own, attachments, gone.moved)).toMatch(/^The topic “Hiring” opens the board/);
  // Renamed in the outline: a renamed ancestor or topic keeps its place when no topic was added or removed.
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n  Budget\n    Hiring')), attachments)).toEqual(attachments);
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Contractors')), attachments)).toEqual(attachments);
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Contractors\n  Risks')), attachments))
    .toMatch(/^The topic “Hiring” opens the board/);
});
