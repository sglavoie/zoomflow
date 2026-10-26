import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { boardLabel, indexBoards, lint } from '../src';

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

it('compiles every library class in real D2 and lints them clean', async () => {
  const names = [...library.matchAll(/^ {2}(zf-[\w-]+): \{/gm)].map((match) => match[1]);
  const edges = ['zf-yes', 'zf-no', 'zf-async', 'zf-optional', 'zf-to-many'];
  expect(names).toEqual(expect.arrayContaining([...edges, 'zf-icon-user', 'zf-lane', 'zf-shadow']));
  const shapes = names.filter((name) => !edges.includes(name));
  const source = ['...@zoomflow', ...shapes.map((name, i) => `s${i}.class: ${name}`),
    ...edges.map((name, i) => `e${i} -> f${i}: {class: ${name}}`), 'group: {class: zf-lane; inner}'].join('\n');
  const result = await compile(source);
  expect(lint(result).diagnostics).toEqual([]);
  const shape = (name: string) => result.diagram.shapes[shapes.indexOf(name)];
  expect(shape('zf-icon-database').icon).toMatchObject({ Scheme: 'data' });
  expect(shape('zf-stack')).toMatchObject({ multiple: true });
  expect(shape('zf-code')).toMatchObject({ fontFamily: 'mono' });
  expect(shape('zf-accent-3')).toMatchObject({ stroke: '#30a46c' });
  // Unstyled lines keep a theme colour.
  expect(result.diagram.connections.map((edge) => [edge.stroke.startsWith('#') ? edge.stroke : 'theme', edge.strokeDash, edge.animated, edge.dstArrow])).toEqual([
    ['#30a46c', 0, false, 'triangle'], ['#e5484d', 4, false, 'triangle'], ['theme', 4, true, 'triangle'],
    ['theme', 2, false, 'triangle'], ['theme', 0, false, 'cf-many']]);
  const svg = await d2.render(result.diagram, result.renderOptions);
  expect(svg).toContain('<image href="data:image/svg+xml;utf8,');
});

it('recolours every class from one palette value in a project copy of the library', async () => {
  const copy = library.replace('zf-accent-3: "#30a46c"', 'zf-accent-3: "#123456"').replace('zf-yes: "#30a46c"', 'zf-yes: "#654321"');
  const result = await d2.compile({ fs: { index: '...@zoomflow\na.class: zf-accent-3\na -> b: {class: zf-yes}\na.link: layers.x\nlayers.x: {c.class: zf-accent-3}',
    'zoomflow.d2': copy }, options: { layout: 'elk' } });
  expect(result.diagram.shapes[0].stroke).toBe('#123456');
  expect(result.diagram.connections[0].stroke).toBe('#654321');
  expect(result.diagram.layers?.[0]?.shapes[0].stroke).toBe('#123456');
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

it('finds links D2 silently removes, permits cycles/external links, and flags only unlinked layers', async () => {
  const compiled = await compile(fixture('navigation'));
  expect(compiled.diagram.shapes.find((shape) => shape.id === 'missing')?.link).toBe('');
  const result = lint(compiled);
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.board))
    .toEqual(['root', 'root.layers.A']);
  // Child boards' expanded ASTs have file-less ranges; fall back to the shape's source.
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.range?.split(',')[0])).toEqual(['index', 'index']);
  expect(result.diagnostics.filter((item) => item.rule === 'orphan-board').map((item) => item.board))
    .toEqual(['root.layers.unused']);
  expect(result.diagnostics.some((item) => item.rule === 'missing-backlink')).toBe(false);
  expect(lint(compiled, { missingBacklink: true }).diagnostics.filter((item) => item.rule === 'missing-backlink').map((item) => item.board))
    .toEqual(['root.layers.A', 'root.layers.unused']);
});

it('asks only layers, not scenarios or steps, for a backlink to their parent', async () => {
  const compiled = await compile('a.link: layers.l\nlayers: {l: {x}}\nscenarios: {s: {y}}\nsteps: {t: {z}}');
  expect(lint(compiled, { missingBacklink: true }).diagnostics.filter((item) => item.rule === 'missing-backlink').map((item) => item.board))
    .toEqual(['root.layers.l']);
});

it('handles dangling connection links and last-assignment overrides', async () => {
  const compiled = await compile('a.link: layers.missing\na.link: https://example.com\na -> b: {link: layers.absent}');
  const result = lint(compiled);
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link')).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({ target: 'root.layers.absent', message: 'Link targets missing board "Root > absent".' });
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

it('resolves quoted board names in authored links as the compiler does', async () => {
  const result = lint(await compile(`x: {link: layers."a b"}
y: {link: layers."c.d"}
z.link: layers."c.d".layers."e f"
gone: {link: layers."a b".layers.absent}
layers: {"a b": {back.link: _}; "c.d": {w.link: layers."e f"; layers: {"e f": {v}}}}`));
  expect(result.diagnostics).toEqual([expect.objectContaining({ rule: 'dangling-link', shape: 'gone',
    target: 'root.layers.a b.layers.absent', message: 'Link targets missing board "Root > a b > absent".' })]);
});

it('flags layers unreachable from root, including linked cycles, but not scenarios of reachable boards', async () => {
  const result = lint(await compile(`open.link: layers.A
alt.link: scenarios.alt
layers: {
  A: {b.link: _.layers.B}
  B: {a.link: _.layers.A}
  C: {d.link: _.layers.D}
  D: {c.link: _.layers.C}
}
scenarios: {alt: {deep.link: layers.E; layers: {E: {x}}}}
steps: {one: {more.link: layers.F; layers: {F: {y}}}}`));
  const orphans = result.diagnostics.filter((item) => item.rule === 'orphan-board');
  expect(orphans.map((item) => item.board)).toEqual(['root.layers.C', 'root.layers.D']);
  expect(orphans[0].message).toBe('Layer "Root > C" is linked only from boards unreachable from the root.');
  expect(orphans[0].range).toMatch(/^index,/);
  const unlinked = lint(await compile('layers: {lonely: {x}}')).diagnostics;
  expect(unlinked.map((item) => item.message)).toEqual(['Layer "Root > lonely" has no incoming board link.']);
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

it('reports each dangling connection link separately at its own source line', async () => {
  const result = lint(await compile('c -> d: {link: layers.nope}\ne -> f: {link: layers.nope}\nk.link: layers.k\nlayers.k: {g -> h: {link: layers.zz}}'));
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link')).toMatchObject([
    { connection: '(c -> d)[0]', target: 'root.layers.nope', range: expect.stringMatching(/^index,0:15:/) },
    { connection: '(e -> f)[0]', target: 'root.layers.nope', range: expect.stringMatching(/^index,1:15:/) },
    { board: 'root.layers.k', connection: '(g -> h)[0]', target: 'root.layers.k.layers.zz' },
  ]);
});

it('recovers dropped links on quoted, nested and differently cased shape keys', async () => {
  const result = lint(await compile(`"x y": {link: layers.nope}
Api
api.link: layers.nope2
"plain": {link: layers.nope3}
outer: {"in ner": {link: layers.nope4}}
"a.b": {link: layers.nope5}
outer: {_.Plain.link: layers.nope6}`));
  expect(result.diagnostics.map(({ rule, shape, target, range }) => ({ rule, shape, target, line: range?.split(',')[1].split(':')[0] }))).toEqual([
    { rule: 'dangling-link', shape: 'x y', target: 'root.layers.nope', line: '0' },
    { rule: 'dangling-link', shape: 'Api', target: 'root.layers.nope2', line: '2' },
    { rule: 'dangling-link', shape: 'plain', target: 'root.layers.nope6', line: '6' },
    { rule: 'dangling-link', shape: 'outer.in ner', target: 'root.layers.nope4', line: '4' },
    { rule: 'dangling-link', shape: '"a.b"', target: 'root.layers.nope5', line: '5' },
  ]);
});

it('locates connection links set through edge references by edge identity', async () => {
  const result = lint(await compile(`a -> b
c -> d: {link: layers.missing}
(a -> b)[0].link: layers.missing
o: {x <- y; x <- y: {link: layers.gone}}
(O.x <- o.Y)[0]: {link: layers.gone}
p -> q
p -> q
(p -> q)[*].link: layers.all`));
  expect(result.diagnostics.map(({ connection, range }) => [connection, range?.split(',')[1].split(':').slice(0, 2).join(':')])).toEqual([
    ['(a -> b)[0]', '2:18'], ['(c -> d)[0]', '1:15'], ['o.(x <- y)[0]', '4:24'], ['o.(x <- y)[1]', '3:27'],
    // A glob reference has no single edge identity, so its location is omitted rather than guessed.
    ['(p -> q)[0]', undefined], ['(p -> q)[1]', undefined],
  ]);
});

it('names missing boards with quoted segments as authored', async () => {
  const result = lint(await compile('a.link: layers."x.y"\nb.link: layers.k.layers."m n".layers."x.layers.y"\nlayers.k: {z}'));
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.message)).toEqual([
    'Link targets missing board "Root > x.y".', 'Link targets missing board "Root > k > m n > x.layers.y".',
  ]);
});

it('warns about links the viewer ignores, such as a parent of root or a relative path', async () => {
  const result = lint(await compile(`a.link: _
b.link: ./x
c -> d: {link: ./y}
open.link: layers.L
layers.L: {up.link: _; over.link: _._; there.link: _.layers.L; e.link: mailto:a@b.c; m.link: layers.M; layers.M: {f.link: _._._}}`));
  expect(result.diagnostics.map(({ rule, severity, board, shape, connection, message }) => ({ rule, severity, board, item: shape ?? connection, message }))).toEqual([
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: 'b', message: 'Link "./x" is not a board or web address, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: '(c -> d)[0]', message: 'Link "./y" is not a board or web address, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: 'a', message: 'Link "_" goes above the root board, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root.layers.L', item: 'over', message: 'Link "root._" goes above the root board, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root.layers.L.layers.M', item: 'f', message: 'Link "root._" goes above the root board, so the viewer ignores it.' },
  ]);
  expect(result.diagnostics.every((item) => item.range?.startsWith('index,'))).toBe(true);
});

it('warns about classes nothing defines, on the root and in layers that inherit its classes', async () => {
  const result = lint(await compile(`...@zoomflow
classes.mine.style.bold: true
a.class: [zf-state; zf-stat]
b.class: mine
c.class: zf-stat
a -> b: {class: [zf-accent-1; edge-typo]}
a.link: layers.detail
layers.detail: {
  d.class: [zf-leaf; mine]
  e.class: missing
  back.link: _
}`));
  expect(result.diagnostics.map(({ rule, board, shape, connection, message }) => ({ rule, board, item: shape ?? connection, message }))).toEqual([
    { rule: 'undefined-class', board: 'root', item: 'a', message: 'Class "zf-stat" is not defined, so it changes nothing. Check the spelling, and import the Zoomflow library with ...@zoomflow.' },
    { rule: 'undefined-class', board: 'root', item: '(a -> b)[0]', message: 'Class "edge-typo" is not defined, so it changes nothing. Check the spelling, or define it under classes.' },
    { rule: 'undefined-class', board: 'root.layers.detail', item: 'e', message: 'Class "missing" is not defined, so it changes nothing. Check the spelling, or define it under classes.' },
  ]);
  expect(result.diagnostics[0].range).toMatch(/^index,/);
});

it('finds classes through nested and relative imports, and skips the root when it cannot follow one', async () => {
  const files = { 'zoomflow.d2': library, 'lib/style.d2': '# Shared look\n...@../more\nclasses: {\n  "quoted.name": {style.fill: red}; plain: {label: "a: {b}"}\n}',
    'more.d2': 'classes.deep.style.fill: blue\nnote: |md\n  classes.fake: x\n|' };
  const run = async (index: string) => lint(await d2.compile({ fs: { index, ...files }, options: { layout: 'elk' } }))
    .diagnostics.filter((item) => item.rule === 'undefined-class').map((item) => `${item.board}:${item.message.split('"')[1]}`);
  expect(await run('...@lib/style\na.class: [plain; deep; "quoted.name"; fake]')).toEqual(['root:fake']);
  expect(await run('classes: {...@zoomflow.classes}\na.class: [zf-leaf; zf-nope]')).toEqual(['root:zf-nope']);
  // An import the scan cannot follow leaves the root unchecked, but layers still list their classes.
  expect(await run('classes: @lib/style.classes\na.class: nope\nlayers.x: {b.class: [plain; nope]}')).toEqual(['root.layers.x:nope']);
  expect(lint((await compile('a.class: nope')), {}).diagnostics).toHaveLength(1);
  const { diagram, graph } = await compile('a.class: nope');
  expect(lint({ diagram, graph }).diagnostics).toEqual([]);
});

it('compiles every D2 example in the library guide', async () => {
  const guide = readFileSync('stdlib/README.md', 'utf8');
  const examples = [...guide.matchAll(/```d2\n([\s\S]*?)```/g)].map((match) => match[1]);
  const house = examples.find((example) => example.startsWith('# house.d2'))!;
  expect(examples.length).toBeGreaterThanOrEqual(5);
  for (const example of examples) {
    const result = await d2.compile({ fs: { index: example, 'zoomflow.d2': library, 'house.d2': house }, options: { layout: 'elk' } });
    expect(lint(result).diagnostics.filter((item) => item.rule === 'undefined-class')).toEqual([]);
  }
  const styled = await d2.compile({ fs: { index: '...@zoomflow\n...@house\na.class: zf-decision', 'zoomflow.d2': library, 'house.d2': house }, options: { layout: 'elk' } });
  expect(styled.diagram.shapes[0]).toMatchObject({ type: 'diamond', stroke: '#0090ff', fontFamily: 'mono' });
  expect(styled.renderOptions).toMatchObject({ themeID: 0, darkThemeID: 200, themeOverrides: { b1: '#1d4ed8' } });
});
