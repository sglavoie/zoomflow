import { D2 } from '@d2lang/d2';
import { afterAll, expect, it } from 'vitest';
import { boardDisplayNames, indexBoards, indexDiagramSearch, renderExportBoards } from '../src';

const d2 = new D2();
afterAll(() => d2.dispose());

it.each([
  ['single linking shape', ['Checkout'], 'Checkout'],
  ['several matching shapes', ['Checkout', 'Checkout'], 'Checkout'],
  ['conflicting shapes', ['Checkout', 'Pay'], 'checkout'],
  ['no linking shape', [], 'checkout'],
  ['empty label', [''], 'checkout'],
  ['empty and nonempty labels', ['', 'Checkout'], 'checkout'],
  ['whitespace label', ['  '], 'checkout'],
])('names a board with %s', (_case, labels, expected) => {
  const boards = [
    { id: 'root', name: 'Root', shapes: (labels as string[]).map(label => ({ label, link: 'root.layers.checkout' })) },
    { id: 'root.layers.checkout', name: 'checkout', shapes: [{ label: 'Back', link: 'root' }] },
  ];
  const before = JSON.stringify(boards);
  expect([...boardDisplayNames(boards, 'Order flow')]).toEqual([['root', 'Order flow'], ['root.layers.checkout', expected]]);
  expect(JSON.stringify(boards)).toBe(before);
});

it('shares display names with search while preserving authored names, IDs, routes, targets and export paths', async () => {
  const { diagram } = await d2.compile('open: Checkout {link: layers.checkout}\nlayers.checkout: {pay: Charge {link: layers.charge}\nlayers.charge: {Done}}', { layout: 'elk' });
  const before = JSON.stringify(diagram);
  const authored = indexBoards(diagram);
  const shown = indexBoards(diagram, 'Order flow');
  expect([...shown.values()].map(board => board.name)).toEqual(['Order flow', 'Checkout', 'Charge']);
  for (const [id, board] of authored) expect(shown.get(id)).toEqual({ ...board, name: shown.get(id)!.name });
  expect(authored.get('root.layers.checkout')!.name).toBe('checkout');
  expect(indexDiagramSearch(shown).find(entry => entry.board.endsWith('.charge') && !entry.shape)).toEqual({
    board: 'root.layers.checkout.layers.charge', label: 'Charge', breadcrumb: 'Order flow › Checkout › Charge',
    trail: ['root', 'root.layers.checkout', 'root.layers.checkout.layers.charge'],
  });
  const exported = await renderExportBoards(diagram, async () => '<svg/>');
  expect(exported.map(board => board.path)).toEqual(['root.svg', 'checkout.svg', 'checkout/charge.svg']);
  expect(exported.map(board => board.name)).toEqual(['Root', 'Checkout', 'Charge']);
  expect(JSON.stringify(diagram)).toBe(before);
});

it('keeps empty linked labels on their authored key in exported metadata', async () => {
  const { diagram } = await d2.compile('blank: "" {link: layers.detail}\nlayers.detail: {inside}', { layout: 'elk' });
  const boards = await renderExportBoards(diagram, async () => '<svg/>');
  expect(boards[0].walkthrough!.shapes[0].label).toBe('blank');
  expect(boards[1].name).toBe('detail');
  expect(boards[1].path).toBe('detail.svg');
});
