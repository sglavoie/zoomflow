
import { expect, it } from 'vitest';
import { builderKind, joinBoard, reattach, splitBoard } from '../src/board-model';
import { editOnCanvas } from '../src/canvas-model';
import { flowSource, flowTemplate, readFlow } from '../src/flow-model';
import { mindMapSource } from '../src/mind-map-model';

import { sites, flow, map } from './board-model-helpers';

it('keeps file links in the attachment section, beside attached boards, and reads only file links there', () => {
  const parts = { own: flow, attachments: [{ shape: 'step_1', file: './health.d2' }, { shape: 'step_3', name: 'Ideas', body: 'a -> b' },
    { shape: 'step_4', file: '../My Life.d2#/Sleep/Night' }] };
  const text = joinBoard(parts);
  expect(text).toContain('# Boards that open from shapes on this board.\nstep_1.link: "./health.d2"\n\nstep_3.link: layers."Ideas"\nlayers."Ideas": {\n  a -> b\n}\n\nstep_4.link: "../My Life.d2#/Sleep/Night"\n');
  expect(splitBoard(text).attachments).toEqual(parts.attachments);
  expect(builderKind(splitBoard(text).own)).toBe('flow');
  // Links D2 drops or that open no file stay part of the own text.
  for (const link of ['"health.d2"', '"https://example.com"', './health.d2']) {
    const changed = text.replace('"./health.d2"', link);
    expect(splitBoard(changed)).toEqual({ own: changed, attachments: [] });
  }
});

it('links shapes to other files, changes and removes those links, and keeps the flow editable', async () => {
  const { sites: site } = await sites(flow);
  expect(site.shapeAction('root', 'step_3')).toEqual({ action: 'add' });
  let source = site.linkFile('root', 'step_3', './work/plan.d2#/Q1');
  expect(source).toContain('\n\n# Boards that open from shapes on this board.\nstep_3.link: "./work/plan.d2#/Q1"\n');
  let { sites: linked, boards } = await sites(source);
  expect(boards.get('root')!.diagram.shapes.find(shape => shape.id === 'step_3')!.link).toBe('./work/plan.d2#/Q1');
  expect(linked.shapeAction('root', 'step_3')).toEqual({ action: 'file', link: './work/plan.d2#/Q1', attached: true });
  expect(linked.builder('root')).toEqual({ kind: 'flow', own: expect.stringContaining('step_4') });
  // Changing the link replaces it in place.
  source = linked.linkFile('root', 'step_3', '../other.d2');
  expect(splitBoard(source).attachments).toEqual([{ shape: 'step_3', file: '../other.d2' }]);
  ({ sites: linked } = await sites(source));
  // Editing the flow keeps the link on its step.
  const edited = linked.update('root', flowSource({ ...readFlow(linked.builder('root')!.own)!, direction: 'right' }));
  if (!('source' in edited)) throw new Error(edited.error);
  expect(splitBoard(edited.source).attachments).toEqual([{ shape: 'step_3', file: '../other.d2' }]);
  // Removing the last link removes the section too.
  expect(linked.unlinkFile('root', 'step_3')).toBe(`${flow.trimEnd()}\n`);
});

it('links shapes on hand-written boards, and opens links written elsewhere without changing them', async () => {
  const source = 'a: {link: ./b.d2}\nc\nlayers: {\n  inner: {\n    d\n  }\n}\n';
  const { sites: site } = await sites(source);
  expect(site.shapeAction('root', 'a')).toEqual({ action: 'file', link: './b.d2', attached: false });
  const next = site.linkFile('root.layers.inner', 'd', '../up.d2');
  expect(next).toContain('  inner: {\n    d\n\n    # Boards that open from shapes on this board.\n    d.link: "../up.d2"\n  }');
  const { sites: linked } = await sites(next);
  expect(linked.shapeAction('root.layers.inner', 'd')).toEqual({ action: 'file', link: '../up.d2', attached: true });
});

it('drops a file link with its removed step or topic, and moves it with a moved topic', () => {
  const steps = flowTemplate('approval');
  const links = [{ shape: 'step_4', file: './changes.d2' }];
  expect(reattach(flowSource(steps), flowSource({ ...steps, steps: steps.steps.slice(0, 3), connections: [] }), links)).toEqual([]);
  const before = mindMapSource(map('Plan\n  People\n    Hiring\n  Money'));
  const topics = [{ shape: 'n_1_1', file: './hiring.d2' }];
  expect(reattach(before, mindMapSource(map('Plan\n  Money\n  People\n    Hiring')), topics)).toEqual([{ ...topics[0], shape: 'n_2_1' }]);
  expect(reattach(before, mindMapSource(map('Plan\n  Money')), topics)).toEqual([]);
  expect(reattach(before, mindMapSource(map('Plan\n  People\n    Hiring\n      Roles', 2)), topics)).toMatch(/would open a detail board and the file/);
});

it('reads the section it writes after one edited by hand, so the new link stays attached', async () => {
  let source = (await sites('a\nb\nc\n')).sites.linkFile('root', 'a', './other.d2').replace('a.link', '# see other\na.link');
  source = (await sites(source)).sites.linkFile('root', 'b', './third.d2');
  expect(splitBoard(source).attachments).toEqual([{ shape: 'b', file: './third.d2' }]);
  const { sites: linked } = await sites(source);
  expect(linked.shapeAction('root', 'b')).toEqual({ action: 'file', link: './third.d2', attached: true });
  // Linking again rewrites that section rather than adding another.
  const again = linked.linkFile('root', 'c', './other.d2');
  expect(again.split('# Boards that open from shapes on this board.').length).toBe(3);
  expect(splitBoard(again).attachments).toEqual([{ shape: 'b', file: './third.d2' }, { shape: 'c', file: './other.d2' }]);
});

it('keeps the link of a topic that moves to a detail board rather than dropping it', async () => {
  const outline = 'Plan\n  People\n    Hiring\n  Money';
  const { sites: site } = await sites(mindMapSource(map(outline)));
  const { sites: linked } = await sites(site.linkFile('root', 'n_1_1', './hiring.d2'));
  const updated = linked.update('root', mindMapSource(map(outline, 1)));
  if (!('source' in updated)) throw new Error(updated.error);
  const { sites: moved } = await sites(updated.source);
  expect(moved.shapeAction('root.layers.People', 'n_1')).toEqual({ action: 'file', link: './hiring.d2', attached: true });
  expect(moved.builder('root')?.kind).toBe('mind map');
  const unsplit = moved.update('root', mindMapSource(map(outline)));
  if (!('source' in unsplit)) throw new Error(unsplit.error);
  expect((await sites(unsplit.source)).sites.shapeAction('root', 'n_1_1')).toEqual({ action: 'file', link: './hiring.d2', attached: true });
  // A removed topic still takes its link along.
  expect(linked.update('root', mindMapSource(map('Plan\n  People\n  Money')))).not.toHaveProperty('error');
});

it('keeps the boards and links of the central topic when an edit renames it and adds a topic', async () => {
  const edited = mindMapSource(map('Roadmap\n  People\n  Money\n  Risks'));
  const { sites: site } = await sites(mindMapSource(map('Plan\n  People\n  Money')));
  const { sites: linked } = await sites(site.linkFile('root', 'n', './plan.d2'));
  const relinked = linked.update('root', edited);
  expect('source' in relinked && (await sites(relinked.source)).sites.shapeAction('root', 'n')).toEqual({ action: 'file', link: './plan.d2', attached: true });
  const added = site.add('root', 'n', mindMapSource(map('Sub\n  x')), 'Plan');
  const { sites: withBoard } = await sites(added.source);
  const kept = withBoard.update('root', edited);
  expect('source' in kept && (await sites(kept.source)).sites.shapeAction('root', 'n')).toMatchObject({ action: 'edit' });
});

it('drops the file link of a removed topic when a detail board has a topic with the same label', () => {
  const before = mindMapSource(map('Plan\n  Team\n    Hiring\n  Hiring', 1));
  const links = [{ shape: 'n_2', file: './hiring.d2' }];
  const removed = editOnCanvas(before, [], 'n_2', { type: 'remove' })!;
  expect(reattach(before, removed.own, links, removed.moved)).toEqual([]);
  // Removed in the outline: fewer topics have its label, so it did not move to a detail board.
  expect(reattach(before, mindMapSource(map('Plan\n  Team\n    Hiring', 1)), links)).toEqual([]);
  // Two indistinguishable destinations cannot silently take or drop the link.
  expect(reattach(before, mindMapSource(map('Plan\n  Team\n    Hiring\n    Hiring', 1)), links)).toMatch(/cannot be matched after this edit/);
});
