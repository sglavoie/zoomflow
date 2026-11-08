
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { boardLabel, indexBoards, lint, } from '../src';
import { fixture, compile, strictLint } from './lint-helpers';

export function registerLintBoundaryCases() {
  it.each(['labelled', 'dotted', 'imported'])('evaluates real boundary pairs for %s nodes using identifiers, never labels', async (name) => {
    const result = strictLint(await compile(fixture(name)));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaryPairsEvaluated).toBe(2);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0]).toMatchObject({ expected: 2, evaluated: 2 });
  });


  it('reports deliberate name mismatches as boundary errors even with matching display labels', async () => {
    const result = strictLint(await compile(fixture('mismatched')));
    expect(result.diagnostics.filter((item) => item.rule.startsWith('boundary-') && item.severity === 'error').length).toBeGreaterThanOrEqual(1);
    expect(result.boundaryPairsEvaluated).toBe(0);
    expect(result.diagnostics.some((item) => /Zero boundary pairs evaluated/.test(item.message))).toBe(true);
  });


  it('ignores port-free layers even when boundary checking is enabled', async () => {
    const result = strictLint(await compile(readFileSync('fixtures/order.d2', 'utf8')));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries).toEqual([]);
    expect(result.boundaryPairsEvaluated).toBe(0);
  });


  it('guards zero pairs for declared contracts, even when another node matches successfully', async () => {
    const source = fixture('zero-pairs').replace('internal -> work', 'internal: {class: zf-in}\n    internal -> work');
    const result = strictLint(await compile(source + '\na -> good\ngood.link: layers.good\nlayers.good: {a.class: zf-in}'));
    expect(result.boundaryPairsEvaluated).toBe(1);
    expect(result.boundaries.find((item) => item.shape === 'checkout')).toMatchObject({ expected: 2, evaluated: 0 });
    expect(result.diagnostics.find((item) => /Zero boundary pairs evaluated/.test(item.message))).toMatchObject({ shape: 'checkout', severity: 'error' });
  });


  it('reports a partial mismatch even when one pair is valid and rejects unconnected ports', async () => {
    const result = strictLint(await compile(fixture('labelled').replace('b: Exit to receipt', 'extra: Exit to receipt')));
    expect(result.boundaryPairsEvaluated).toBe(1);
    expect(result.diagnostics.some((item) => item.rule === 'boundary-out' && item.shape === 'extra')).toBe(true);
    expect(result.diagnostics.some((item) => item.rule === 'boundary-out' && item.shape === 'checkout')).toBe(true);
    expect(result.diagnostics.some((item) => /Zero boundary/.test(item.message))).toBe(false);
  });


  it('requires the remaining neighbours when a child declares only one port', async () => {
    const source = fixture('labelled').replace('    b: Exit to receipt {class: zf-out}\n', '');
    const result = strictLint(await compile(source));
    expect(result.boundaries).toMatchObject([{ expected: 2, evaluated: 1 }]);
    expect(result.diagnostics.filter((item) => item.rule.startsWith('boundary-'))).toMatchObject([
      { rule: 'boundary-out', shape: 'checkout' },
    ]);
  });


  it('uses reverse and bidirectional arrows, deduplicates parallel neighbours, and guards undirected edges', async () => {
    const result = strictLint(await compile(`...@zoomflow
checkout <- a
checkout <- a: Again
checkout <-> b
checkout.link: layers.child
layers.child: {a.class: zf-in; b.class: [zf-in; zf-out]}`));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaryPairsEvaluated).toBe(3);
    const undirected = strictLint(await compile('a -- checkout\ncheckout.link: layers.child\nlayers.child: {x.class: zf-in}'));
    expect(undirected.diagnostics.some((item) => /Zero boundary pairs/.test(item.message))).toBe(true);
  });


  it('preserves full container identities and distinguishes quoted literal dots', async () => {
    const result = strictLint(await compile(fixture('dotted').replace('shop.browse: Entry', '"shop.browse": Entry')));
    expect(result.diagnostics.some((item) => item.rule === 'boundary-in')).toBe(true);
    expect(result.boundaryPairsEvaluated).toBe(1);
  });


  it('locates boundary diagnostics at the shape or port and names boards by their trail', async () => {
    const result = strictLint(await compile(fixture('mismatched')));
    const ranges = result.diagnostics.map((item) => item.range);
    expect(ranges.every((range) => /^index,\d+:\d+:\d+-/.test(range ?? ''))).toBe(true);
    expect(result.diagnostics.find((item) => item.shape === 'wrong')).toMatchObject({ board: 'root.layers.checkout', range: expect.stringMatching(/^index,7:4:/) });
    expect(result.diagnostics[0].message).toBe('"checkout" needs a zf-in port named "a" in "Root > checkout".');
    const boards = indexBoards((await compile('layers: {a: {layers: {"b.c": {x}}}}\nscenarios: {s: {y}}')).diagram);
    expect(boardLabel('root.layers.a.layers.b.c', boards)).toBe('Root > a > b.c');
    expect(boardLabel('root.layers.a.layers.gone.scenarios.x', boards)).toBe('Root > a > gone > x');
    expect(boardLabel('root.scenarios.s', boards)).toBe('Root > s');
  });


  it('does not require boundary ports for sibling links or scenario switches', async () => {
    const result = strictLint(await compile('a -> b\nb.link: scenarios.alt\nscenarios.alt: {c}\nlayers: {A: {a -> b; b.link: _.layers.B}; B: {back.link: _.layers.A}}\nc.link: layers.A'));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries).toEqual([]);
  });


  it('allows nested navigation without ports, even with boundary checking enabled', async () => {
    const original = await compile(fixture('nested-navigation'));
    const result = lint(original);
    expect(result.boundaries).toEqual([]);
    expect(result.boundaryPairsEvaluated).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ rule: 'dangling-link', shape: 'Capture',
      target: 'root.layers.checkout.layers.charge.layers.capture.layers.charge' });
    expect(result.diagnostics[0].message).toContain('Did you mean the parent board "charge"? Use link: _.');
    const repaired = await compile(fixture('nested-navigation').replace('Capture: {link: layers.charge}', 'Capture: {link: _}'));
    expect(lint(repaired).diagnostics).toEqual([]);
    const strict = strictLint(repaired);
    expect(strict.boundaries).toEqual([]);
    expect(strict.diagnostics).toEqual([]);
  });


  it('makes even authored boundary ports opt-in without disabling other checks', async () => {
    const compiled = await compile(fixture('mismatched'));
    expect(lint(compiled).diagnostics).toEqual([]);
    expect(strictLint(compiled).diagnostics).toHaveLength(5);
  });


  it('accepts a port that matches any one of several nodes drilling into the same layer', async () => {
    const source = 'x -> A\nA.link: layers.c\nB.link: layers.c\nB -> y\nlayers.c: {x.class: zf-in; y.class: zf-out}';
    const result = strictLint(await compile(source));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries).toMatchObject([{ shape: 'A', expected: 1, evaluated: 1 }, { shape: 'B', expected: 1, evaluated: 1 }]);
    const stray = strictLint(await compile(source.replace('}', '; z.class: zf-out}')));
    expect(stray.diagnostics).toMatchObject([{ rule: 'boundary-out', board: 'root.layers.c', shape: 'z',
      message: 'zf-out port "z" has no matching outgoing neighbour of "A" or "B" in "Root".' }]);
  });


  it('matches boundary ports to neighbours regardless of case, as D2 IDs are', async () => {
    const result = strictLint(await compile('API -> svc\nsvc.link: layers.svc\nlayers.svc: {api.class: zf-in}'));
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries).toMatchObject([{ shape: 'svc', expected: 1, evaluated: 1 }]);
  });
}
