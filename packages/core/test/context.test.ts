import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { indexBoards, parentContext, renderExportBoards } from '../src';

const d2 = new D2();
afterAll(() => d2.dispose());
const compile = (source: string) => d2.compile(source, { layout: 'elk' });

it('infers each level from parent edges and includes the same context in HTML export data', async () => {
  const compiled = await compile(readFileSync('fixtures/lint/nested-navigation.d2', 'utf8'));
  const boards = indexBoards(compiled.diagram);
  const contexts = [...boards.values()].map((board) => parentContext(board, boards));
  expect(contexts).toEqual([
    [],
    [{ shape: 'Checkout', label: 'Checkout', incoming: ['Browse'], outgoing: ['Receipt'] }],
    [{ shape: 'Charge', label: 'Charge', incoming: ['Cart'], outgoing: ['Confirm'] }],
    [{ shape: 'Capture', label: 'Capture', incoming: ['Authorize'], outgoing: ['Receipt'] }],
  ]);
  const exported = await renderExportBoards(compiled.diagram, async () => '<svg/>');
  expect(exported.map((board) => board.parentContext)).toEqual(contexts);
});

it('preserves separate owners, labels and arrow directions without duplicating parallel edges', async () => {
  const compiled = await compile(`a: Browse catalogue
b: Receipt
first: Checkout
first <- a
first <- a: Again
first <-> b
first -- ignored
first.link: layers.detail
x -> second -> y
second.link: layers.detail
layers.detail: {back.link: _}`);
  const boards = indexBoards(compiled.diagram);
  expect(parentContext(boards.get('root.layers.detail')!, boards)).toEqual([
    { shape: 'first', label: 'Checkout', incoming: ['Browse catalogue', 'Receipt'], outgoing: ['Receipt'] },
    { shape: 'second', label: 'second', incoming: ['x'], outgoing: ['y'] },
  ]);
});

it('does not infer flow from navigation-only nodes, sibling links or scenario switches', async () => {
  const compiled = await compile(`open.link: layers.A
before -> switch -> after
switch.link: scenarios.alt
layers: {A: {a -> b; b.link: _.layers.B}; B: {back.link: _.layers.A}; empty: {}}
scenarios.alt: {x}`);
  const boards = indexBoards(compiled.diagram);
  for (const board of boards.values()) expect(parentContext(board, boards)).toEqual([]);
});
