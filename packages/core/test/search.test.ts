import { D2 } from '@d2lang/d2';
import { afterAll, expect, it } from 'vitest';
import { indexBoards, indexDiagramSearch, searchDiagram } from '../src';

const d2 = new D2();
afterAll(() => d2.dispose());

it('finds labels across nested boards, scenarios and steps with unambiguous destinations', async () => {
  const compiled = await d2.compile(`start: Refund approval
layers: {
  Payments: {
    layers: {
      Refunds: {approve: Refund approval}
    }
  }
}
scenarios: {Alternative: {approve: Refund approval}}
steps: {Later: {approve: Refund approval}}`, { layout: 'elk' });
  const boards = indexBoards(compiled.diagram);
  const entries = indexDiagramSearch(boards);
  const matches = searchDiagram(entries, '  REFUND APPROVAL  ');
  expect(matches.map(entry => [entry.board, entry.shape])).toEqual([
    ['root', 'start'],
    ['root.layers.Payments.layers.Refunds', 'approve'],
    ['root.scenarios.Alternative', 'start'],
    ['root.scenarios.Alternative', 'approve'],
    ['root.steps.Later', 'start'],
    ['root.steps.Later', 'approve'],
  ]);
  const nested = matches.find(entry => entry.board === 'root.layers.Payments.layers.Refunds')!;
  expect(nested.breadcrumb).toBe('Root › Payments › Refunds');
  expect(nested.trail).toEqual(['root', 'root.layers.Payments', 'root.layers.Payments.layers.Refunds']);
  expect(searchDiagram(entries, 'Refunds')).toEqual([
    { board: nested.board, label: 'Refunds', breadcrumb: nested.breadcrumb, trail: nested.trail },
  ]);
});

it('matches literal Unicode labels, falls back to shape IDs, and leaves empty queries empty', async () => {
  const { diagram } = await d2.compile('plain\nx: "Café [review]"', { layout: 'elk' });
  const entries = indexDiagramSearch(indexBoards(diagram));
  expect(searchDiagram(entries, 'CAFÉ [')).toMatchObject([{ shape: 'x', label: 'Café [review]' }]);
  expect(searchDiagram(entries, 'plain')).toMatchObject([{ shape: 'plain', label: 'plain' }]);
  expect(searchDiagram(entries, '   ')).toEqual([]);
  expect(searchDiagram(entries, 'missing')).toEqual([]);
  expect(indexDiagramSearch(new Map())).toEqual([]);
});
