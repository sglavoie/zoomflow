import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { indexBoards } from '@zoomflow/core';
import { countTopics, detailBoardName, mindMapExample, mindMapSource, outlineText, parseOutline, readMindMap, type MindMap } from '../src/mind-map-model';
import { plainLook } from '../src/flow-model';
import { projectFileSystem } from '../src/project-files';
import { joinBoard, splitBoard } from '../src/board-model';
import { newFileSource } from '../src/file-link-dialog';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

const compile = (source: string) => d2.compile({ ...projectFileSystem('index.d2', {}, source), options: { layout: 'elk' } });
const plain = plainLook();
const example = (split: number): MindMap => ({ direction: 'right', split, look: plain, root: parseOutline(mindMapExample)! });

it('reads indented outlines with optional bullets and headings', () => {
  expect(parseOutline('# Plan\n- A\n  * A1\n\n\t+ A2\nB\n  B1\n    B11\n  B2')).toEqual({ label: 'Plan', children: [
    { label: 'A', children: [{ label: 'A1', children: [] }, { label: 'A2', children: [] }] },
    { label: 'B', children: [{ label: 'B1', children: [{ label: 'B11', children: [] }] }, { label: 'B2', children: [] }] },
  ] });
  expect(parseOutline(' \n\n')).toBeUndefined();
  const root = parseOutline('Centre\n  - - starts with a bullet\n  #hashtag\n  ## Heading text')!;
  expect(root.children.map(topic => topic.label)).toEqual(['- starts with a bullet', '#hashtag', 'Heading text']);
  expect(parseOutline(outlineText(root))).toEqual(root);
});

it('keeps every topic on one board unless asked to split', async () => {
  const map = example(0);
  const source = mindMapSource(map);
  const compiled = await compile(source);
  expect(compiled.diagram.shapes).toHaveLength(13);
  expect(compiled.diagram.connections).toHaveLength(12);
  expect(compiled.diagram.connections.every(edge => edge.dstArrow === 'none' && edge.stroke.startsWith('#'))).toBe(true);
  expect(compiled.diagram.layers ?? []).toHaveLength(0);
  expect(await d2.render(compiled.diagram, compiled.renderOptions)).toContain('<svg');
  expect(readMindMap(source)).toEqual(map);
  expect(countTopics(map)).toEqual({ topics: 13, boards: 0 });
});

it('opens deep branches as linked detail boards, recursively', async () => {
  const map: MindMap = { direction: 'down', split: 1, look: plain, root: parseOutline('Plan\n  Style\n    S1\n      S11\n  Style\n    T1\n  Lone')! };
  const source = mindMapSource(map);
  const compiled = await compile(source);
  const boards = [...indexBoards(compiled.diagram).values()].map(board => [board.name, board.parent, board.diagram.shapes.length]);
  expect(boards).toEqual([['Root', undefined, 4], ['style', 'root', 2], ['S1', 'root.layers.style', 2], ['style 2', 'root', 2]]);
  expect(compiled.diagram.shapes.filter(shape => shape.link).map(shape => shape.link)).toEqual(['root.layers.style', 'root.layers.style 2']);
  // Detail boards inherit the root's library import, and a main branch keeps its colour on them.
  expect(source.match(/\.\.\.@zoomflow/g)).toHaveLength(1);
  const tone = compiled.diagram.shapes[1].stroke;
  expect(compiled.diagram.layers?.[0]?.shapes.map(shape => shape.stroke)).toEqual([tone, tone]);
  expect(readMindMap(source)).toEqual(map);
  expect(countTopics(map)).toEqual({ topics: 7, boards: 3 });
  expect(countTopics(example(2))).toEqual({ topics: 13, boards: 1 });
});

it('keeps labels literal and board names linkable', async () => {
  const label = 'Review "A": {B} -> C #tag; [x] \\path $5 ${hello} … 日本語';
  const map: MindMap = { direction: 'right', split: 1, look: plain, root: { label, children: [
    { label, children: [{ label: 'x', children: [] }] },
    ...['Label', 'TOP', '_', '#'].map(name => ({ label: name, children: [{ label: 'y', children: [] }] })),
  ] } };
  const source = mindMapSource(map);
  const compiled = await compile(source);
  expect(compiled.diagram.shapes.map(shape => 'label' in shape && shape.label)).toEqual([label, label, 'Label', 'TOP', '_', '#']);
  expect(compiled.diagram.shapes.slice(1).every(shape => shape.link)).toBe(true);
  expect(compiled.diagram.layers?.map(layer => layer?.name)).toEqual([
    "Review 'A': (B) -> C tag, (x) /path 5 (hello) … 日本語", 'label', 'top', 'Topic', 'Topic 2']);
  expect(readMindMap(source)).toEqual(map);
  expect(detailBoardName('  ')).toBe('Topic');
});

it('links detail boards for topics named like board containers, null, or holding dollar signs', async () => {
  const names = ['Steps', 'layers', 'SCENARIOS', 'steps topic', '$x', 'US$ 5', 'Null', 'null'];
  const map: MindMap = { direction: 'right', split: 1, look: plain, root: { label: 'Root', children:
    names.map(label => ({ label, children: [{ label: 'child', children: [] }] })) } };
  const source = mindMapSource(map);
  const compiled = await compile(source);
  const boards = [...indexBoards(compiled.diagram).values()].slice(1).map(board => board.name);
  expect(boards).toEqual(['Steps topic', 'layers topic', 'SCENARIOS topic', 'steps topic 2', 'x', 'US 5', 'Null topic', 'null topic 2']);
  expect(compiled.diagram.shapes.slice(1).map(shape => shape.link)).toEqual(boards.map(name => `root.layers.${name}`));
  expect(readMindMap(source)).toEqual(map);
});

it('does not offer form editing when it would discard custom source', () => {
  const source = mindMapSource(example(2));
  expect(readMindMap(source)).toEqual(example(2));
  expect(readMindMap(source + 'n.style.fill: red\n')).toBeUndefined();
  expect(readMindMap(source.replace('n -- n_1:', 'n -> n_1:'))).toBeUndefined();
  expect(readMindMap(source.replace('n_4: ', 'n_9: '))).toBeUndefined();
  expect(readMindMap(source.replace('"Social media" {class: [zf-topic', '"Changed" {class: [zf-topic'))).toBeUndefined();
  expect(readMindMap(source.replace('direction: right', 'direction: left'))).toBeUndefined();
  expect(readMindMap('a -> b')).toBeUndefined();
  expect(readMindMap(source.replace('"Pricing"', '"Price"'))?.root.children[2].children[0].label).toBe('Price');
  expect(readMindMap(source.replace('"Pricing"', '"  "'))).toBeUndefined();
  expect(readMindMap(source.replace('"Pricing"', '"Two\\nlines"'))).toBeUndefined();
});

it('writes looks as library classes that apply on every board', async () => {
  const map: MindMap = { ...example(1), look: { filled: true, compact: true, shadow: false } };
  const source = mindMapSource(map);
  expect(source).toContain('n: "Product launch" {class: [zf-topic; zf-filled; zf-compact]}');
  const compiled = await compile(source);
  for (const board of indexBoards(compiled.diagram).values()) {
    expect(board.diagram.shapes.every(shape => shape.fill === '#e2e8f0' && 'fontSize' in shape && shape.fontSize === 13)).toBe(true);
  }
  expect(readMindMap(source)).toEqual(map);
  const shadowed = { filled: false, compact: false, shadow: true };
  expect(readMindMap(mindMapSource({ ...map, look: shadowed }))?.look).toEqual(shadowed);
  // Every topic shares one look; a mix is custom source.
  expect(readMindMap(source.replace('{class: [zf-topic; zf-filled; zf-compact]}', '{class: zf-topic}'))).toBeUndefined();
});

it('reopens maps written when every board imported the library', () => {
  const map = example(1);
  const legacy = mindMapSource(map, true);
  expect(legacy.match(/\.\.\.@zoomflow/g)!.length).toBeGreaterThan(1);
  expect(readMindMap(legacy)).toEqual(map);
});

it('stays editable with topics that open other files, and round-trips their links', async () => {
  const map = example(2);
  const attachments = [{ shape: 'n_1', file: './audience.d2' }, { shape: 'n_4', file: './risks.d2#/Open' }];
  const source = joinBoard({ own: mindMapSource(map), attachments });
  const parts = splitBoard(source);
  expect(readMindMap(parts.own)).toEqual(map);
  expect(parts.attachments).toEqual(attachments);
  expect(joinBoard(parts)).toBe(source);
  const compiled = await compile(source);
  expect(compiled.diagram.shapes.filter(shape => shape.link?.endsWith('.d2') || shape.link?.includes('.d2#'))
    .map(shape => [shape.id, shape.link])).toEqual([['n_1', './audience.d2'], ['n_4', './risks.d2#/Open']]);
});

it('starts a new linked mind map file centred on its name', () => {
  const map = readMindMap(newFileSource('mind map', 'Health.d2'));
  expect(map?.root.label).toBe('Health');
  expect(map?.root.children.map(topic => topic.label)).toEqual(['First idea', 'Second idea']);
});
