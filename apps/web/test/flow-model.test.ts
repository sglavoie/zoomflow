import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { flowFilename, flowSource, flowTemplate, readFlow } from '../src/flow-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });
const compile = (source: string) => d2.compile({ ...projectFileSystem('index.d2', {}, source), options: { layout: 'elk' } });

it.each(['simple', 'approval'])('creates a usable %s diagram and reopens it losslessly', async template => {
  const flow = flowTemplate(template);
  const source = flowSource(flow);
  const compiled = await compile(source);
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
  const compiled = await compile(source);
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

it('styles steps with library classes, so restyling a class restyles every flow', async () => {
  const flow = flowTemplate('approval');
  const source = flowSource(flow);
  expect(source).toContain('...@zoomflow\n');
  expect(source).toContain('step_2: "Approved?" {class: zf-decision}');
  const compiled = await compile(source);
  expect(compiled.diagram.shapes.map(shape => shape.type)).toEqual(['oval', 'diamond', 'oval', 'rectangle']);
  expect(compiled.diagram.shapes.map(shape => shape.classes)).toEqual([['zf-terminal'], ['zf-decision'], ['zf-terminal'], ['zf-step']]);
});

it('writes looks as classes after each role and reads them back', async () => {
  const flow = { ...flowTemplate('simple'), look: { filled: true, compact: false, shadow: false } };
  const source = flowSource(flow);
  expect(source).toContain('step_2: "Do something" {class: [zf-step; zf-filled]}');
  const compiled = await compile(source);
  expect(compiled.diagram.shapes.every(shape => shape.fill === '#e2e8f0')).toBe(true);
  expect(readFlow(source)).toEqual(flow);
  const all = { ...flow, look: { filled: true, compact: true, shadow: true } };
  expect(flowSource(all)).toContain('{class: [zf-step; zf-filled; zf-compact; zf-shadow]}');
  expect(readFlow(flowSource(all))).toEqual(all);
  // Every step shares one look; a mix is custom source.
  expect(readFlow(source.replace('[zf-step; zf-filled]', 'zf-step'))).toBeUndefined();
  expect(readFlow(source.replace('[zf-step; zf-filled]', '[zf-filled; zf-step]'))).toBeUndefined();
  expect(readFlow(source.replace('zf-step', 'constructor'))).toBeUndefined();
});

it('reopens flows written before steps used library classes', () => {
  const flow = flowTemplate('approval');
  const legacy = flowSource(flow).replace('...@zoomflow\n', '').replace(/ \{class: zf-(?:yes|no)\}/g, '')
    .replace(/\{class: zf-(\w+)\}/g, (_, role) => `{shape: ${({ step: 'rectangle', decision: 'diamond', terminal: 'oval' } as Record<string, string>)[role]}}`);
  expect(legacy).toContain('{shape: diamond}');
  expect(readFlow(legacy)).toEqual(flow);
  expect(readFlow(legacy.replace('{shape: diamond}', '{shape: circle}'))).toBeUndefined();
  expect(readFlow(legacy.replace('{shape: diamond}', '{shape: constructor}'))).toBeUndefined();
  expect(readFlow(legacy.replace('{shape: diamond}', '{class: zf-decision}'))).toBeUndefined();
});

it('colours lines labelled Yes and No with the library branch classes', async () => {
  const flow = flowTemplate('approval');
  flow.connections[2].label = ' no ';
  const source = flowSource(flow);
  expect(source).toContain('step_2 -> step_3: "Yes" {class: zf-yes}');
  expect(source).toContain('step_2 -> step_4: " no " {class: zf-no}');
  expect(source).toContain('step_4 -> step_2: "Try again"\n');
  const compiled = await compile(source);
  expect(compiled.diagram.connections.map(edge => edge.stroke)).toEqual(['B1', '#30a46c', '#e5484d', 'B1']);
  expect(readFlow(source)).toEqual(flow);
  // The class follows the label, so a class the label does not imply is custom source.
  expect(readFlow(source.replace('"Try again"', '"Try again" {class: zf-yes}'))).toBeUndefined();
  expect(readFlow(source.replace(' {class: zf-yes}', ''))).toBeUndefined();
});
