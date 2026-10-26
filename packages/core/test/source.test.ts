import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { boardBlocks, indexBoards, indexShapeSources, parseSourceRange } from '../src';

const d2 = new D2();
afterAll(() => d2.dispose());

it('maps compiler references across containers, Unicode, layers and inherited boards', async () => {
  const source = '😀: Emoji\nbox: {a: Nested}\na: Root\na -> box.a\nlayers: {child: {a: Child}}\nscenarios: {alt: {b}}\nsteps: {one: {c}}';
  const compiled = await d2.compile(source, { layout: 'elk' });
  const map = indexShapeSources(compiled.diagram, compiled.graph, source);
  expect(map.find((entry) => entry.board === 'root' && entry.shape === '😀')).toEqual({
    board: 'root', shape: '😀', from: 0, to: 2,
  });
  for (const board of ['root', 'root.scenarios.alt', 'root.steps.one']) {
    expect(map.filter((entry) => entry.board === board && entry.shape === 'box.a').map((entry) => entry.from))
      .toEqual([source.indexOf('a: Nested'), source.indexOf('box.a') + 4]);
    expect(map.filter((entry) => entry.board === board && entry.shape === 'a').map((entry) => entry.from))
      .toEqual([source.indexOf('a: Root'), source.indexOf('a ->')]);
  }
  expect(map.find((entry) => entry.board === 'root.layers.child' && entry.shape === 'a')?.from)
    .toBe(source.indexOf('a: Child'));
  for (const entry of map) expect(source.slice(entry.from, entry.to)).toMatch(/^(😀|box|a|b|c)$/);
});

it('rejects unavailable/imported and invalid source positions', () => {
  expect(parseSourceRange('other.d2,0:0:0-0:1:1', 'a')).toBeUndefined();
  expect(parseSourceRange('index,0:0:0-0:8:8', 'a')).toBeUndefined();
  expect(parseSourceRange('index,0:1:1-0:0:0', 'a')).toBeUndefined();
});

it('maps every order fixture shape despite fractional graph positions', async () => {
  const source = readFileSync('fixtures/order.d2', 'utf8');
  const compiled = await d2.compile(source, { layout: 'elk', pad: 100, themeID: 0, darkThemeID: 200 });
  const map = indexShapeSources(compiled.diagram, compiled.graph, source);
  for (const board of indexBoards(compiled.diagram).values()) {
    for (const shape of board.diagram.shapes) {
      expect(map.some((entry) => entry.board === board.id && entry.shape === shape.id), `${board.id}/${shape.id}`).toBe(true);
    }
  }
});

it('rejects malformed ranges without throwing', () => {
  expect(parseSourceRange('', 'a')).toBeUndefined();
  expect(parseSourceRange('index', 'a')).toBeUndefined();
  expect(parseSourceRange('index,0:0:0-0:1:1', 'a')).toEqual({ from: 0, to: 1 });
});

it('finds the block of each board declared once in the main file', async () => {
  const source = 'a\nlayers: {\n  x: {\n    b\n    layers."Two words": {c}\n  }\n  twice: {d}\n}\nlayers.twice.e\nlayers.y: {f}\nlayers.imp: null\nscenarios: {s: {g}}\n';
  const compiled = await d2.compile(source, { layout: 'elk' });
  const blocks = boardBlocks(compiled.graph, source);
  const text = (id: string) => { const range = blocks.get(id); return range && source.slice(range.from, range.to); };
  expect(text('root')).toBe(source);
  expect(text('root.layers.x')).toBe('\n    b\n    layers."Two words": {c}\n  ');
  expect(text('root.layers.x.layers.Two words')).toBe('c');
  expect(text('root.layers.y')).toBe('f');
  expect(blocks.has('root.layers.twice')).toBe(false);
  expect(blocks.has('root.layers.imp')).toBe(false);
  expect(blocks.has('root.scenarios.s')).toBe(false);
});
