import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyHref, indexBoards, shapeClass } from '../src/index';

describe('href classification', () => {
  it.each([
    'root', 'root.layers.checkout', 'root.layers.checkout.layers.charge', 'root.scenarios.alternate', 'root.steps.first',
    'root.scenarios.s.layers.k', 'root.layers."a.b"', 'root.layers.a b',
  ])('%s targets a board', (href) => {
    expect(classifyHref(href)).toEqual({ kind: 'board', target: href });
  });
  it.each(['https://example.com/docs', 'http://localhost/test', 'mailto:user@example.com'])('allows external %s', (url) => {
    expect(classifyHref(url)).toEqual({ kind: 'external', url });
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'layers.checkout', '#anchor', '', 'rooted.layers.x'])('rejects %s', (href) => {
    expect(classifyHref(href)).toEqual({ kind: 'invalid', href });
  });
  it.each([
    ['./a.d2', './a.d2', ''], ['./a.d2#/x', './a.d2', '#/x'], ['../a.d2', '../a.d2', ''],
    ['./health.d2#/Sleep/@scenarios/Night', './health.d2', '#/Sleep/@scenarios/Night'], ['./My Life.d2', './My Life.d2', ''],
    ['./work/plan.d2#/', './work/plan.d2', '#/'], ['../../a/b.d2', '../../a/b.d2', ''],
    ['./Other.D2#/Board', './Other.D2', '#/Board'], ['../Main.d2', '../Main.d2', ''],
  ])('%s links to a file', (href, path, hash) => {
    expect(classifyHref(href)).toEqual({ kind: 'file', path, hash });
  });
  it.each(['./a.txt', './a.d2?x', './a.d2#x', 'a.d2', 'work/plan.d2', '/a.d2', '.a.d2', './a.d2x', 'https://x.test/a.d2'])('%s is not a file link', (href) => {
    expect(classifyHref(href).kind).not.toBe('file');
  });
  it('keeps web addresses ending in .d2 external', () => {
    expect(classifyHref('https://x.test/a.d2')).toEqual({ kind: 'external', url: 'https://x.test/a.d2' });
    expect(classifyHref('./a.txt')).toEqual({ kind: 'invalid', href: './a.txt' });
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
  it('classifies the actual SVG hrefs for board and external links', async () => {
    const root = boards.get('root')!;
    const svg = await d2.render(root.diagram);
    const hrefs = [...svg.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.map((href) => classifyHref(href))).toEqual([
      { kind: 'board', target: 'root.layers.checkout' }, { kind: 'board', target: 'root.scenarios.alternate' },
      { kind: 'board', target: 'root.steps.first' }, { kind: 'external', url: 'https://example.com/docs' },
    ]);
    const child = boards.get('root.layers.checkout')!;
    expect(classifyHref(child.diagram.shapes[0].link)).toEqual({ kind: 'board', target: 'root' });
    const grandchild = boards.get('root.layers.checkout.layers.charge')!;
    expect(classifyHref(grandchild.diagram.shapes[0].link)).toEqual({ kind: 'board', target: child.id });
  });
  it('indexes render targets, parents and unambiguous deep links', () => {
    expect(boards.size).toBe(5);
    expect(boards.get('root.layers.checkout.layers.charge')).toMatchObject({
      target: 'layers.checkout.layers.charge', parent: 'root.layers.checkout', hash: '#/checkout/charge',
    });
    expect(boards.get('root.scenarios.alternate')?.hash).toBe('#/@scenarios/alternate');
    expect(boards.get('root.steps.first')?.hash).toBe('#/@steps/first');
  });
  it('quotes board IDs and render targets exactly as the compiler quotes its links', async () => {
    const names = ['a b', 'a.b', 'a-b', "a'b", 'a:b', 'a--b', 'a-', '-a', 'a,b', 'a/b', 'x y.z'];
    const source = names.map((name, i) => `s${i}: {link: layers.${JSON.stringify(name)}}`).join('\n') +
      `\nlayers: {${names.map((name) => `${JSON.stringify(name)}: {layers: {"n.n": {z}}}`).join('; ')}}`;
    const { diagram } = await d2.compile(source, { layout: 'elk' });
    const indexed = indexBoards(diagram);
    expect(indexed.size).toBe(1 + names.length * 2);
    for (const shape of diagram.shapes) expect(indexed.has(shape.link), shape.link).toBe(true);
    expect(indexed.get('root.layers."a.b".layers."n.n"')).toMatchObject({ name: 'n.n', parent: 'root.layers."a.b"', hash: '#/a.b/n.n' });
    expect(indexed.get('root.layers.a b')?.target).toBe('layers.a b');
    const nested = indexed.get('root.layers."a.b".layers."n.n"')!;
    expect(await d2.render(diagram, { target: nested.target })).toMatch(/>z<\/text>/);
  });
  it('encodes shape classes as the renderer does, including non-ASCII and URL-unsafe base64', async () => {
    const { diagram } = await d2.compile(`"ü?>~": x\n😀: y\nab\n"it's & <b>": z`, { layout: 'elk' });
    const svg = await d2.render(diagram);
    for (const shape of diagram.shapes) expect(svg).toContain(`<g class="${shapeClass(shape.id)}"`);
    // The renderer HTML-escapes IDs before encoding them.
    expect(shapeClass('"ü?>~"')).toBe(Buffer.from('&#34;ü?&gt;~&#34;').toString('base64url'));
    expect(shapeClass('😀')).toBe('8J-YgA==');
  });
});
