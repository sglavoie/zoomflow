
import { expect, it } from 'vitest';
import { indexBoards, lint } from '@zoomflow/core';
import { blockText, builderKind, joinBoard, reattach, splitBoard } from '../src/board-model';
import { editOnCanvas, moveBranch } from '../src/canvas-model';
import { flowSource, flowTemplate, readFlow } from '../src/flow-model';
import { mindMapSource, readMindMap } from '../src/mind-map-model';
import { graphBranches } from '../src/graph-branches';

import { compile, sites, flow, map } from './board-model-helpers';

it('keeps the parent builder editable when reparenting on a custom attached board and its inherited scenario', async () => {
  const own = mindMapSource(map('Plan\n  Work\n  Other'));
  let site = (await sites(own)).sites;
  const source = site.add('root', 'n_1', 'a -> child -> leaf\nb\nscenarios: {alternate: {b}}', 'Custom').source;
  const compiled = await compile(source);
  site = (await sites(source)).sites;
  const moves = graphBranches(source, compiled.diagram, compiled.graph);
  for (const board of ['root.layers.Custom', 'root.layers.Custom.scenarios.alternate']) {
    const change = moves.move(board, 'child', 'b')!;
    const result = site.append(board, change.additions!);
    const next = await sites(result);
    expect(next.sites.builder('root')?.kind).toBe('mind map');
    expect(next.sites.builder('root')?.own.trim()).toBe(own.trim());
    expect(next.boards.get(board)!.diagram.connections.map(edge => [edge.src, edge.dst])).toContainEqual(['b', 'child']);
    expect(next.sites.shapeAction('root', 'n_1')).toEqual({ action: 'none', reason: 'This shape already opens another board or link.' });
  }
});

it('moves branches across details without mixing duplicate topics, file links or attached boards', async () => {
  let source = mindMapSource(map('Plan\n  A\n    Task\n      Notes\n  B\n    Task', 1));
  let site = (await sites(source)).sites;
  source = site.add('root.layers.A.layers.Task', 'n_1', flow, 'Tour').source;
  site = (await sites(source)).sites;
  source = site.add('root.layers.A', 'n', flow, 'Overview').source;
  site = (await sites(source)).sites;
  source = site.linkFile('root.layers.B', 'n_1', './task.d2');
  site = (await sites(source)).sites;
  const moved = moveBranch(site.builder('root')!.own, ['A'], 'n_1', 'n_2')!;
  const updated = site.update('root', moved.own, moved.moved);
  if (!('source' in updated)) throw new Error(updated.error);
  const compiled = await compile(updated.source);
  site = (await sites(updated.source)).sites;
  expect(site.builder('root')?.kind).toBe('mind map');
  expect(site.shapeAction('root.layers.B.layers.Task', 'n_1')).toEqual({ action: 'edit', kind: 'flow', board: 'root.layers.B.layers.Task.layers.Tour' });
  expect(site.shapeAction('root.layers.B', 'n_1')).toEqual({ action: 'file', link: './task.d2', attached: true });
  // A centre whose generated board disappeared follows its actual topic onto the main board.
  expect(site.shapeAction('root', 'n_1')).toEqual({ action: 'edit', kind: 'flow', board: 'root.layers.Overview' });
  expect(indexBoards(compiled.diagram).has('root.layers.A')).toBe(false);
});

it('explains a move that would give one topic both a generated detail and an attached board', async () => {
  const own = mindMapSource(map('Plan\n  A\n  B', 1));
  let site = (await sites(own)).sites;
  const source = site.add('root', 'n_2', flow, 'Work').source;
  site = (await sites(source)).sites;
  const moved = moveBranch(site.builder('root')!.own, [], 'n_1', 'n_2')!;
  expect(site.update('root', moved.own, moved.moved)).toEqual({ error: 'The topic “B” would open a detail board and the board “Work”. Choose fewer detail boards, or delete its board in the source first.' });
  expect(site.builder('root')!.own.trim()).toBe(own.trim());
});

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

it('keeps every builder editable through repeated alternating attachments', async () => {
  let source = flow;
  let board = 'root';
  for (let level = 0; level < 6; level++) {
    const { sites: site } = await sites(source);
    const kind = level % 2 ? 'mind map' : 'flow';
    expect(site.builder(board)?.kind).toBe(kind);
    const shape = kind === 'flow' ? 'step_3' : 'n_1';
    expect(site.shapeAction(board, shape)).toEqual({ action: 'add' });
    const added = site.add(board, shape, kind === 'flow' ? mindMapSource(map('Ideas\n  Topic')) : flow, `Level ${level}`);
    source = added.source;
    board += `.layers.${added.name}`;
  }
  const { sites: site } = await sites(source);
  expect(site.builder('root')?.kind).toBe('flow');
  expect(site.builder(board)?.kind).toBe('flow');
});

it('styles and lints every detail board of a mind map attached to an unstyled diagram', async () => {
  const source = 'triage: Review the request\n';
  const mindMap = map('Review the request\n  Ideas\n    Detail\n      Next\n        Deeper\n          Last', 2);
  const { sites: site } = await sites(source);
  const added = site.add('root', 'triage', mindMapSource(mindMap), 'Review the request');
  const compiled = await compile(added.source);
  expect(lint(compiled).diagnostics).toEqual([]);
  const boards = [...indexBoards(compiled.diagram).values()].slice(1);
  expect(boards.map(board => board.id)).toEqual([
    'root.layers.Review the request',
    'root.layers.Review the request.layers.Detail',
    'root.layers.Review the request.layers.Detail.layers.Deeper',
  ]);
  for (const board of boards) {
    expect(board.diagram.shapes[0]).toMatchObject({ borderRadius: 18, fontSize: 20, bold: true });
    expect(board.diagram.shapes[1]).toMatchObject({ borderRadius: 12, fontSize: 16 });
    expect(board.diagram.connections[0]).toMatchObject({ stroke: '#be667a', strokeWidth: 2 });
  }
  const attached = splitBoard(added.source).attachments[0];
  expect('body' in attached && readMindMap(attached.body)).toEqual(mindMap);
});

it('adds boards to topics on a mind map, its attached boards and its detail boards', async () => {
  let source = mindMapSource(map('Trip\n  Places\n    Lisbon\n      Alfama\n  Budget', 2));
  let { sites: site, boards } = await sites(source);
  expect(site.shapeAction('root', 'n_1_1')).toEqual({ action: 'none', reason: 'This shape already opens another board or link.' });
  expect(site.owner('root.layers.Lisbon')).toBe('root');
  expect(site.shapeAction('root.layers.Lisbon', 'n_1')).toEqual({ action: 'add' });
  // A board named like a detail board gets a distinct name.
  const added = site.add('root', 'n_2', flow, 'Lisbon');
  expect(added.name).toBe('Lisbon 2');
  source = added.source;
  ({ sites: site, boards } = await sites(source));
  expect(boards.has('root.layers.Lisbon 2')).toBe(true);
  expect(site.owner('root')).toBe('root');
  expect(site.shapeAction('root.layers.Lisbon 2', 'step_1')).toEqual({ action: 'add' });
});

it('round-trips attachments on generated detail boards without absorbing their independent builders', () => {
  const own = mindMapSource(map('Trip\n  Places\n    Lisbon\n      Alfama\n  Budget\n    Costs', 1));
  const attachments = [
    { shape: 'n', name: 'Overview', body: flow },
    { trail: ['Places'], shape: 'n', file: './places.d2' },
    { trail: ['Places', 'Lisbon'], shape: 'n_1', name: 'Walk', body: joinBoard({ own: flow,
      attachments: [{ shape: 'step_3', name: 'Ideas', body: mindMapSource(map('Ideas\n  First\n    Next', 1)) }] }) },
    { trail: ['Budget'], shape: 'n_1', name: 'Walk', body: flow },
  ];
  const source = joinBoard({ own, attachments });
  const parts = splitBoard(source);
  expect(parts.own.trim()).toBe(own.trim());
  const normalize = (items: typeof parts.attachments) => items.map(item => 'body' in item ? { ...item, body: item.body.trim() } : item)
    .sort((a, b) => JSON.stringify(a.trail ?? []).localeCompare(JSON.stringify(b.trail ?? [])));
  expect(normalize(parts.attachments)).toEqual(normalize(attachments));
  expect(joinBoard(parts)).toBe(source);
  expect(splitBoard(source.replaceAll('\n', '\r\n')).own.trim()).toBe(own.trim());
  // An edited attachment section stays source text, so a builder cannot discard it.
  const custom = source.replace('n_1.link: layers."Walk"', '# custom\n    n_1.link: layers."Walk"');
  expect(builderKind(splitBoard(custom).own)).toBeUndefined();
});

it('alternates flows and maps from generated detail boards at repeated depths', async () => {
  let source = mindMapSource(map('Root\n  Branch\n    Leaf', 1));
  let board = 'root';
  const owners = [board];
  for (let level = 0; level < 4; level++) {
    let site = (await sites(source)).sites;
    const detail = `${board}.layers.Branch`;
    expect(site.owner(detail)).toBe(board);
    expect(site.shapeAction(detail, 'n_1')).toEqual({ action: 'add' });
    const added = site.add(detail, 'n_1', flow, 'Flow');
    source = added.source;
    site = (await sites(source)).sites;
    const flowBoard = `${detail}.layers.Flow`;
    expect(site.shapeAction(detail, 'n_1')).toEqual({ action: 'edit', board: flowBoard, kind: 'flow' });
    expect(site.canvas(detail)).toMatchObject({ owner: board, trail: ['Branch'] });
    owners.push(flowBoard);
    source = site.add(flowBoard, 'step_3', mindMapSource(map('More\n  Branch\n    Leaf', 1)), 'Map').source;
    board = `${flowBoard}.layers.Map`;
    owners.push(board);
  }
  const { sites: site } = await sites(source);
  for (const owner of owners) expect(site.owner(owner)).toBe(owner);
  expect(lint(await compile(source)).diagnostics).toEqual([]);
});

it('keeps custom attached source independent of the map that generates its parent detail board', async () => {
  const { sites: site } = await sites(mindMapSource(map('Plan\n  Branch\n    Leaf', 1)));
  const source = site.add('root.layers.Branch', 'n_1', 'a -> b', 'Custom').source;
  const { sites: added } = await sites(source);
  expect(added.owner('root.layers.Branch')).toBe('root');
  expect(added.owner('root.layers.Branch.layers.Custom')).toBeUndefined();
  expect(added.canvas('root.layers.Branch.layers.Custom')).toBeUndefined();
  expect(added.shapeAction('root.layers.Branch.layers.Custom', 'b')).toEqual({ action: 'add' });
});

it('keeps detail attachments through canvas renames and removals, and rejects stranding them', async () => {
  const own = mindMapSource(map('Trip\n  Places\n    Lisbon\n      First\n      Walk', 1));
  let site = (await sites(own)).sites;
  let source = site.add('root.layers.Places.layers.Lisbon', 'n_2', flow, 'Tour').source;
  site = (await sites(source)).sites;
  expect(site.builder('root')?.own.trim()).toBe(own.trim());
  const rename = editOnCanvas(site.builder('root')!.own, ['Places'], 'n', { type: 'rename', label: 'Destinations' })!;
  let updated = site.update('root', rename.own, rename.moved);
  if (!('source' in updated)) throw new Error(updated.error);
  source = updated.source;
  site = (await sites(source)).sites;
  const board = 'root.layers.Destinations.layers.Lisbon';
  expect(site.shapeAction(board, 'n_2')).toEqual({ action: 'edit', board: `${board}.layers.Tour`, kind: 'flow' });
  const remove = editOnCanvas(site.builder('root')!.own, ['Destinations', 'Lisbon'], 'n_1', { type: 'remove' })!;
  updated = site.update('root', remove.own, remove.moved);
  if (!('source' in updated)) throw new Error(updated.error);
  site = (await sites(updated.source)).sites;
  expect(site.shapeAction(board, 'n_1')).toEqual({ action: 'edit', board: `${board}.layers.Tour`, kind: 'flow' });
  const gone = editOnCanvas(site.builder('root')!.own, [], 'n_1', { type: 'remove' })!;
  expect(site.update('root', gone.own, gone.moved)).toEqual({ error: 'The topic “Walk” opens the board “Tour”. Keep the topic, or delete its board in the source first.' });
});

it('keeps file links scoped to their own board when generated details reuse shape identifiers', async () => {
  const own = mindMapSource(map('Plan\n  Team\n    Hiring\n    Recruiting\n  Money', 1));
  let site = (await sites(own)).sites;
  let source = site.linkFile('root.layers.Team', 'n_2', './recruiting.d2');
  site = (await sites(source)).sites;
  source = site.linkFile('root', 'n_2', './money.d2');
  site = (await sites(source)).sites;
  expect(site.shapeAction('root', 'n_2')).toEqual({ action: 'file', link: './money.d2', attached: true });
  expect(site.shapeAction('root.layers.Team', 'n_2')).toEqual({ action: 'file', link: './recruiting.d2', attached: true });
  site = (await sites(site.unlinkFile('root', 'n_2'))).sites;
  expect(site.shapeAction('root', 'n_2')).toEqual({ action: 'add' });
  expect(site.shapeAction('root.layers.Team', 'n_2')).toEqual({ action: 'file', link: './recruiting.d2', attached: true });
});

it('preserves boards across split changes and rejects merging boards with the same name', async () => {
  const outline = 'Plan\n  People\n    Hiring\n  Money\n    Budget';
  const own = mindMapSource(map(outline, 1));
  let site = (await sites(own)).sites;
  let source = site.add('root.layers.People', 'n_1', flow, 'Work').source;
  site = (await sites(source)).sites;
  const unsplit = site.update('root', mindMapSource(map(outline)));
  if (!('source' in unsplit)) throw new Error(unsplit.error);
  expect((await sites(unsplit.source)).sites.shapeAction('root', 'n_1_1')).toEqual({ action: 'edit', board: 'root.layers.Work', kind: 'flow' });
  source = site.add('root.layers.Money', 'n_1', flow, 'Work').source;
  site = (await sites(source)).sites;
  expect(site.update('root', mindMapSource(map(outline)))).toEqual({
    error: 'Two boards named “Work” would share one board. Keep them on separate detail boards, or rename one in the source first.' });
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
  expect(splitBoard(next).attachments.map(item => 'name' in item && item.name)).toEqual(['Empty', 'Quoted', 'Apostrophe']);
});

it('adds boards and file links to shapes keyed by a quoted keyword, which D2 reports unquoted', async () => {
  for (const [source, shape] of [['"label": Hi\n', 'label'], ['"style": Hi\n', 'style'], ['c: {"near": Hi}\n', 'c.near'], ['"_": Hi\n', '_'], ['"Layers": Hi\n', 'layers']]) {
    const { sites: site } = await sites(source);
    expect(site.shapeAction('root', shape)).toEqual({ action: 'add' });
    const added = await sites(site.add('root', shape, flow, 'Detail').source);
    expect(added.boards.get('root')!.diagram.shapes.find(item => item.id === shape)!.link).toBe('root.layers.Detail');
    expect(added.sites.shapeAction('root', shape).action).toBe('edit');
    const linked = await sites(site.linkFile('root', shape, './other.d2'));
    expect(linked.boards.get('root')!.diagram.shapes.find(item => item.id === shape)!.link).toBe('./other.d2');
    expect(linked.sites.shapeAction('root', shape)).toEqual({ action: 'file', link: './other.d2', attached: true });
  }
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

it('does not move an attached board onto a topic that was already there when the outline removes its topic', () => {
  // Removing an earlier branch shifts the identifiers, so the remaining topics take the removed topic's.
  const hiring = [{ shape: 'n_1_1', name: 'People hiring', body: flow }];
  expect(reattach(mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Hiring')), mindMapSource(map('Plan\n  Money\n    Hiring')), hiring))
    .toMatch(/^The topic “Hiring” opens the board “People hiring”. Keep the topic/);
  const first = [{ shape: 'n_1', name: 'A board', body: flow }];
  expect(reattach(mindMapSource(map('Plan\n  A\n  B')), mindMapSource(map('Plan\n  B\n  C')), first)).toMatch(/^The topic “A” opens the board “A board”. Keep the topic/);
  expect(reattach(mindMapSource(map('Plan\n  A\n    x\n  B\n    y')), mindMapSource(map('Plan\n  B\n    y\n  C\n    z')), [{ ...first[0], shape: 'n_1_1' }]))
    .toMatch(/^The topic “x” opens the board/);
  // A topic renamed in place, or moved to a new place, still keeps its board.
  expect(reattach(mindMapSource(map('Plan\n  A\n  B')), mindMapSource(map('Plan\n  Z\n  B')), first)).toEqual(first);
  expect(reattach(mindMapSource(map('Plan\n  People\n    Hiring\n  Money')), mindMapSource(map('Plan\n  Money\n    Hiring')), hiring))
    .toEqual(hiring);
});
