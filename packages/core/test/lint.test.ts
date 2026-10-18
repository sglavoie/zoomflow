import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { lint } from '../src';

const d2 = new D2();
afterAll(() => d2.dispose());
const library = readFileSync('stdlib/zoomflow.d2', 'utf8');
const fixture = (name: string) => readFileSync(`fixtures/lint/${name}.d2`, 'utf8');
const compile = (source: string) => d2.compile({ fs: { index: source, 'zoomflow.d2': library,
  'nodes.d2': fixture('nodes') }, options: { layout: 'elk' } });
const strictLint = (compiled: Awaited<ReturnType<typeof compile>>) => lint(compiled, { boundaryPorts: true });

it('compiles the importable stdlib, state pieces and neutral theme in real D2', async () => {
  const result = await compile('...@zoomflow\nstart.class: zf-initial\nend.class: zf-final\nwork.class: zf-state\nstart -> work -> end');
  expect(result.renderOptions).toMatchObject({ themeID: 0, darkThemeID: 200 });
  expect(result.diagram.shapes.find((shape) => shape.id === 'start')).toMatchObject({ type: 'oval', width: 20, height: 20, label: '', fill: '#64748b' });
  expect(result.diagram.shapes.find((shape) => shape.id === 'end')).toMatchObject({ type: 'oval', width: 24, height: 24, 'double-border': true });
  expect(result.diagram.shapes.find((shape) => shape.id === 'work')).toMatchObject({ borderRadius: 8 });
  expect(await d2.render(result.diagram, result.renderOptions)).toContain('<svg');
});

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

it('guards zero pairs per drillable node, even when another node matches successfully', async () => {
  const result = strictLint(await compile(fixture('zero-pairs') + '\na -> good\ngood.link: layers.good\nlayers.good: {a.class: zf-in}'));
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

it('uses reverse and bidirectional arrows, deduplicates parallel neighbours, and guards undirected edges', async () => {
  const result = strictLint(await compile(`...@zoomflow
checkout <- a
checkout <- a: Again
checkout <-> b
checkout.link: layers.child
layers.child: {a.class: zf-in; b.class: [zf-in; zf-out]}`));
  expect(result.diagnostics).toEqual([]);
  expect(result.boundaryPairsEvaluated).toBe(3);
  const undirected = strictLint(await compile('a -- checkout\ncheckout.link: layers.child\nlayers.child: {x}'));
  expect(undirected.diagnostics.some((item) => /Zero boundary pairs/.test(item.message))).toBe(true);
});

it('preserves full container identities and distinguishes quoted literal dots', async () => {
  const result = strictLint(await compile(fixture('dotted').replace('shop.browse: Entry', '"shop.browse": Entry')));
  expect(result.diagnostics.some((item) => item.rule === 'boundary-in')).toBe(true);
  expect(result.boundaryPairsEvaluated).toBe(1);
});

it('finds links D2 silently removes, permits cycles/external links, and flags only unlinked layers', async () => {
  const compiled = await compile(fixture('navigation'));
  expect(compiled.diagram.shapes.find((shape) => shape.id === 'missing')?.link).toBe('');
  const result = lint(compiled);
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.board))
    .toEqual(['root', 'root.layers.A']);
  expect(result.diagnostics.filter((item) => item.rule === 'orphan-board').map((item) => item.board))
    .toEqual(['root.layers.unused']);
  expect(result.diagnostics.some((item) => item.rule === 'missing-backlink')).toBe(false);
  expect(lint(compiled, { missingBacklink: true }).diagnostics.filter((item) => item.rule === 'missing-backlink').map((item) => item.board))
    .toEqual(['root.layers.A', 'root.layers.unused']);
});

it('handles dangling connection links and last-assignment overrides', async () => {
  const compiled = await compile('a.link: layers.missing\na.link: https://example.com\na -> b: {link: layers.absent}');
  const result = lint(compiled);
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link')).toHaveLength(1);
  expect(result.diagnostics[0].message).toContain('root.layers.absent');
});

it('does not require boundary ports for sibling links or scenario switches', async () => {
  const result = strictLint(await compile('a -> b\nb.link: scenarios.alt\nscenarios.alt: {c}\nlayers: {A: {a -> b; b.link: _.layers.B}; B: {back.link: _.layers.A}}'));
  expect(result.diagnostics).toEqual([]);
  expect(result.boundaries).toEqual([]);
});

it('allows nested navigation without ports and only flags the missing link', async () => {
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
  expect(strict.boundaries).toHaveLength(3);
  expect(strict.diagnostics.filter((item) => item.rule.startsWith('boundary-'))).toHaveLength(9);
});

it('makes even authored boundary ports opt-in without disabling other checks', async () => {
  const compiled = await compile(fixture('mismatched'));
  expect(lint(compiled).diagnostics).toEqual([]);
  expect(strictLint(compiled).diagnostics).toHaveLength(5);
});

it('suggests ancestor paths without rewriting valid child links or unrelated missing links', async () => {
  const source = `open.link: layers.A
layers.A: {
  open.link: layers.B
  layers.B: {
    open.link: layers.C
    layers.C: {wrong.link: layers.A; unrelated.link: layers.absent}
  }
}`;
  const result = lint(await compile(source));
  expect(result.diagnostics).toHaveLength(2);
  expect(result.diagnostics.find((item) => item.shape === 'wrong')?.message)
    .toContain('Did you mean the ancestor board "A"? Use link: _._.');
  expect(result.diagnostics.find((item) => item.shape === 'unrelated')?.message).not.toContain('Did you mean');
  const valid = await compile(source.replace('unrelated.link: layers.absent', 'layers.A: {valid}'));
  expect(lint(valid).diagnostics).toEqual([]);
});
