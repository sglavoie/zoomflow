import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { flowFilename, flowSource, flowTemplate, readFlow } from '../src/flow-model';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

it.each(['simple', 'approval'])('creates a usable %s diagram and reopens it losslessly', async template => {
  const flow = flowTemplate(template);
  const source = flowSource(flow);
  const compiled = await d2.compile(source, { layout: 'elk' });
  expect(compiled.diagram.shapes).toHaveLength(flow.steps.length);
  expect(compiled.diagram.connections).toHaveLength(flow.connections.length);
  expect(await d2.render(compiled.diagram, compiled.renderOptions)).toContain('<svg');
  expect(readFlow(source)).toEqual(flow);
  expect(readFlow(compiled.fs[compiled.inputPath])).toEqual(flow);
});

it('keeps ordinary text and D2 punctuation literal, including duplicate names', async () => {
  const flow = flowTemplate('simple');
  const label = 'Review "A": {B} -> C #tag; \\path $5 ${hello} … 日本語';
  flow.steps[0].label = label;
  flow.steps[1].label = label;
  flow.connections[0].label = 'Yes: "ready" -> {done}';
  const source = flowSource(flow);
  const compiled = await d2.compile(source, { layout: 'elk' });
  expect(compiled.diagram.shapes).toHaveLength(3);
  expect(compiled.diagram.shapes[0]).toHaveProperty('label', label);
  expect(compiled.diagram.shapes[1]).toHaveProperty('label', label);
  expect(compiled.diagram.connections[0].label).toBe(flow.connections[0].label);
  expect(readFlow(source)).toEqual(flow);
});

it('does not offer form editing when it would discard custom source', () => {
  const source = flowSource(flowTemplate('simple'));
  expect(readFlow(source + 'step_1.style.fill: red\n')).toBeUndefined();
  expect(readFlow(source + '# Custom notes\n')).toBeUndefined();
  expect(readFlow(source.replace('step_1 -> step_2', 'step_1 -> step_99'))).toBeUndefined();
  expect(readFlow(source.replace('step_2:', 'step_1:'))).toBeUndefined();
  expect(readFlow('a -> b')).toBeUndefined();
  expect(readFlow(source.replace('"Start"', '"Changed"'))?.steps[0].label).toBe('Changed');
});

it('uses a portable filename without losing non-English names', () => {
  expect(flowFilename('  My flow.d2  ')).toBe('My flow.d2');
  expect(flowFilename('../承認/flow: draft')).toBe('..-承認-flow- draft.d2');
  expect(flowFilename('...')).toBe('My flow.d2');
});
