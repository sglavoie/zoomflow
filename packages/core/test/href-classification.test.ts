import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyHref, indexBoards } from '../src/index';

describe('href classification', () => {
  it.each([
    ['root.layers.checkout', 'root', 'drill'],
    ['root.layers.checkout.layers.charge', 'root.layers.checkout', 'drill'],
    ['root.scenarios.alternate', 'root', 'switch'],
    ['root.steps.first', 'root', 'switch'],
    ['root', 'root.layers.checkout', 'up'],
    ['root.layers.checkout', 'root.layers.checkout.layers.charge', 'up'],
    ['root.layers.checkout', 'root.layers.checkoutExtra', 'drill'],
  ])('%s from %s is %s', (href, current, kind) => {
    expect(classifyHref(href, current)).toEqual({ kind, target: href });
  });
  it.each(['https://example.com/docs', 'http://localhost/test', 'mailto:user@example.com'])('allows external %s', (url) => {
    expect(classifyHref(url)).toEqual({ kind: 'external', url });
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'layers.checkout', '#anchor', '', 'rooted.layers.x'])('rejects %s', (href) => {
    expect(classifyHref(href)).toEqual({ kind: 'invalid', href });
  });
});

describe('classifier integration with the pinned compiler', () => {
  let d2: D2;
  let boards: ReturnType<typeof indexBoards>;
  beforeAll(async () => {
    d2 = new D2();
    const { diagram } = await d2.compile(`Checkout: {link: layers.checkout}
Scenario: {link: scenarios.alternate}
Step: {link: steps.first}
Docs: {link: https://example.com/docs}
layers: {
  checkout: {
    Back: {link: _}
    Charge: {link: layers.charge}
    layers: {charge: {Back: {link: _}}}
  }
}
scenarios: {alternate: {Alternative}}
steps: {first: {Started}}`, { layout: 'elk' });
    boards = indexBoards(diagram);
  });
  afterAll(async () => { await d2?.dispose(); });
  it('classifies the actual SVG hrefs for all four navigation actions', async () => {
    const root = boards.get('root')!;
    const svg = await d2.render(root.diagram);
    const hrefs = [...svg.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.map((href) => classifyHref(href).kind)).toEqual(['drill', 'switch', 'switch', 'external']);
    const child = boards.get('root.layers.checkout')!;
    expect(classifyHref(child.diagram.shapes[0].link, child.id).kind).toBe('up');
    const grandchild = boards.get('root.layers.checkout.layers.charge')!;
    expect(classifyHref(grandchild.diagram.shapes[0].link, grandchild.id)).toEqual({ kind: 'up', target: child.id });
  });
  it('indexes render targets, parents and unambiguous deep links', () => {
    expect(boards.size).toBe(5);
    expect(boards.get('root.layers.checkout.layers.charge')).toMatchObject({
      target: 'layers.checkout.layers.charge', parent: 'root.layers.checkout', hash: '#/checkout/charge',
    });
    expect(boards.get('root.scenarios.alternate')?.hash).toBe('#/@scenarios/alternate');
    expect(boards.get('root.steps.first')?.hash).toBe('#/@steps/first');
  });
});
