import { expect, it } from 'vitest';
import { canvasShape, editOnCanvas } from '../src/canvas-model';
import { flowSource, flowTemplate, plainLook, readFlow } from '../src/flow-model';
import { mindMapSource, outlineText, parseOutline, readMindMap, type MindMap } from '../src/mind-map-model';

const flow = flowSource(flowTemplate('approval'));
const map = (outline: string, split = 0): MindMap => ({ direction: 'right', split, look: plainLook(), root: parseOutline(outline)! });
const outline = (own: string) => outlineText(readMindMap(own)!.root);

it('renames, adds after and removes flow steps', () => {
  expect(canvasShape(flow, [], 'step_2')).toEqual({ kind: 'flow', label: 'Approved?', add: 'Add next step', sibling: false, remove: true });
  const renamed = editOnCanvas(flow, [], 'step_2', { type: 'rename', label: '  Approved   by lead? ' })!;
  expect(readFlow(renamed.own)!.steps[1].label).toBe('Approved by lead?');
  expect(renamed.select).toBe('step_2');
  expect(editOnCanvas(flow, [], 'step_2', { type: 'rename', label: ' ' })).toBeUndefined();
  expect(editOnCanvas(flow, [], 'step_2', { type: 'rename', label: 'Approved?' })).toBeUndefined();
  const added = editOnCanvas(flow, [], 'step_3', { type: 'add' })!;
  expect(added.select).toBe('step_5');
  expect(readFlow(added.own)!.connections.at(-1)).toEqual({ from: 'step_3', to: 'step_5', label: '' });
  // Removing a step selects the step that led to it, else the one before it.
  expect(editOnCanvas(flow, [], 'step_3', { type: 'remove' })!.select).toBe('step_2');
  expect(editOnCanvas(flow, [], 'step_1', { type: 'remove' })!.select).toBe('step_2');
  const removed = readFlow(editOnCanvas(flow, [], 'step_2', { type: 'remove' })!.own)!;
  expect(removed.steps.map(step => step.id)).toEqual(['step_1', 'step_3', 'step_4']);
  expect(removed.connections).toEqual([]);
  const single = flowSource({ ...flowTemplate('simple'), steps: [flowTemplate('simple').steps[0]], connections: [] });
  expect(canvasShape(single, [], 'step_1')?.remove).toBe(false);
  expect(editOnCanvas(single, [], 'step_1', { type: 'remove' })).toBeUndefined();
});

it('adds subtopics and siblings, renames and removes topics on a mind map board', () => {
  const own = mindMapSource(map('Plan\n  People\n    Hiring\n  Money'));
  expect(canvasShape(own, [], 'n')).toEqual({ kind: 'mind map', label: 'Plan', add: 'Add subtopic', sibling: false, remove: false });
  const child = editOnCanvas(own, [], 'n_1', { type: 'add' })!;
  expect(outline(child.own)).toBe('Plan\n  People\n    Hiring\n    New topic\n  Money');
  expect(child.select).toBe('n_1_2');
  const sibling = editOnCanvas(own, [], 'n_1', { type: 'sibling' })!;
  expect(outline(sibling.own)).toBe('Plan\n  People\n    Hiring\n  New topic\n  Money');
  expect(sibling.select).toBe('n_2');
  const removed = editOnCanvas(own, [], 'n_1', { type: 'remove' })!;
  expect(outline(removed.own)).toBe('Plan\n  Money');
  expect(removed.select).toBe('n_1');
  expect(outline(editOnCanvas(own, [], 'n_1_1', { type: 'rename', label: 'Recruiting' })!.own)).toContain('Recruiting');
});

it('edits topics on detail boards and follows a renamed detail board', () => {
  const own = mindMapSource(map('Trip\n  Places\n    Lisbon\n      Alfama\n    Porto', 2));
  // A detail topic is edited from the main board too; renaming it renames its board.
  expect(canvasShape(own, [], 'n_1_1')).toMatchObject({ label: 'Lisbon', sibling: true, remove: true });
  expect(outline(editOnCanvas(own, [], 'n_1_1', { type: 'rename', label: 'Lisboa' })!.own)).toContain('    Lisboa\n      Alfama');
  expect(canvasShape(own, ['Lisbon'], 'n')).toMatchObject({ label: 'Lisbon', sibling: false, remove: false });
  const added = editOnCanvas(own, ['Lisbon'], 'n_1', { type: 'sibling' })!;
  expect(outline(added.own)).toBe('Trip\n  Places\n    Lisbon\n      Alfama\n      New topic\n    Porto');
  expect(added.select).toBe('n_2');
  const renamed = editOnCanvas(own, ['Lisbon'], 'n', { type: 'rename', label: 'Lisboa' })!;
  expect(renamed.trail).toEqual(['Lisboa']);
  expect(renamed.select).toBe('n');
  // A subtopic past the detail level opens on a new detail board, so its parent stays selected.
  const deeper = editOnCanvas(own, [], 'n_1_2', { type: 'add' })!;
  expect(outline(deeper.own)).toContain('    Porto\n      New topic');
  expect(deeper.select).toBe('n_1_2');
});

it('goes up a board with its centre selected when a remove takes a detail board’s last subtopic', () => {
  // Boards “A” and “A 2”: once the first A has no subtopics, the second takes the name “A”.
  const own = mindMapSource(map('Root\n  A\n    first child\n  A\n    second child', 1));
  const removed = editOnCanvas(own, ['A'], 'n_1', { type: 'remove' })!;
  expect(outline(removed.own)).toBe('Root\n  A\n  A\n    second child');
  expect(removed.trail).toEqual([]);
  expect(removed.select).toBe('n_1');
  // A board that keeps a subtopic, or loses a deeper one, stays on view.
  const nested = mindMapSource(map('Trip\n  Places\n    Lisbon\n      Alfama\n        Castle\n      Belém', 2));
  expect(editOnCanvas(nested, ['Lisbon'], 'n_2', { type: 'remove' })!.trail).toBeUndefined();
  const deeper = editOnCanvas(nested, ['Lisbon'], 'n_1_1', { type: 'remove' })!;
  expect(deeper.trail).toBeUndefined();
  expect(deeper.select).toBe('n_1');
  const last = editOnCanvas(editOnCanvas(nested, ['Lisbon'], 'n_2', { type: 'remove' })!.own, ['Lisbon'], 'n_1', { type: 'remove' })!;
  expect(last.trail).toEqual([]);
  expect(last.select).toBe('n_1_1');
});

it('reports where each main board topic moved, so attached boards follow renames and removals', () => {
  const own = mindMapSource(map('Plan\n  People\n    Hiring\n  Money\n    Hiring'));
  expect(editOnCanvas(own, [], 'n_1_1', { type: 'rename', label: 'Recruiting' })!.moved!.get('n_1_1')).toBe('n_1_1');
  const removed = editOnCanvas(own, [], 'n_1', { type: 'remove' })!.moved!;
  expect([...removed]).toEqual([['n', 'n'], ['n_2', 'n_1'], ['n_2_1', 'n_1_1']]);
  expect(editOnCanvas(own, [], 'n_1', { type: 'sibling' })!.moved!.get('n_2_1')).toBe('n_3_1');
});
