import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { boardKey, boardLabel, indexBoards, lint, rebaseFileLinks, type LintDiagnostic } from '../src';
import { definedClasses } from '../src/classes';

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

it('matches boundary ports to neighbours regardless of case, as D2 IDs are', async () => {
  const result = strictLint(await compile('API -> svc\nsvc.link: layers.svc\nlayers.svc: {api.class: zf-in}'));
  expect(result.diagnostics).toEqual([]);
  expect(result.boundaries).toMatchObject([{ shape: 'svc', expected: 1, evaluated: 1 }]);
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

it('points an unquoted dotted link at the board whose name has the dots', async () => {
  const result = lint(await compile('e.link: "layers.x.y"\nf.link: layers.x.y\nlayers."x.y": {k}'));
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.message)).toEqual(Array(2).fill(
    'Link targets missing board "Root > x.y". A board named "x.y" exists; quote names with dots to link to it, as in layers."x.y".'));
});

it('warns about links the viewer ignores, such as a parent of root or a relative path', async () => {
  const result = lint(await compile(`a.link: _
b.link: ./x
c -> d: {link: ./y}
file.link: ./other.d2
open.link: layers.L
layers.L: {up.link: _; over.link: _._; there.link: _.layers.L; e.link: mailto:a@b.c; m.link: layers.M; layers.M: {f.link: _._._}}`));
  expect(result.diagnostics.map(({ rule, severity, board, shape, connection, message }) => ({ rule, severity, board, item: shape ?? connection, message }))).toEqual([
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: 'b', message: 'Link "./x" is not a board or web address, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: '(c -> d)[0]', message: 'Link "./y" is not a board or web address, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root', item: 'a', message: 'Link "_" goes above the root board, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root.layers.L', item: 'over', message: 'Link "_._" goes above the root board, so the viewer ignores it.' },
    { rule: 'ignored-link', severity: 'warning', board: 'root.layers.L.layers.M', item: 'f', message: 'Link "_._._" goes above the root board, so the viewer ignores it.' },
  ]);
  expect(result.diagnostics.every((item) => item.range?.startsWith('index,'))).toBe(true);
});

it('checks file links against the project when given its files', async () => {
  const result = await compile(`ok.link: ./health.d2
deep.link: "./health.d2#/Sleep/Night"
spaced.link: "./health.d2#/My Board"
gone.link: "./health.d2#/Gone"
missing.link: ./missing.d2
c -> d: {link: ../index.d2}
up.link: ../../outside.d2
bare.link: health.d2
folder.link: "work/plan.d2#/A"
layers.L: {back.link: "../index.d2#/"; x.link: ./nope.d2}`);
  const files = { inputPath: 'life/index.d2', exists: (path: string) => ['life/health.d2', 'index.d2'].includes(path),
    boards: (path: string) => path === 'life/health.d2' ? new Set(['#/', '#/Sleep', '#/Sleep/Night', '#/My%20Board']) : undefined };
  const summary = (diagnostics: LintDiagnostic[]) => diagnostics.filter((item) => item.rule.includes('file'))
    .map(({ rule, severity, board, shape, connection, message }) => ({ rule, severity, board, item: shape ?? connection, message }));
  expect(summary(lint(result, { files }).diagnostics)).toEqual([
    { rule: 'missing-file-board', severity: 'warning', board: 'root', item: 'gone',
      message: 'Link targets missing board "Gone" in "life/health.d2", so the viewer opens its nearest existing board.' },
    { rule: 'dangling-file-link', severity: 'error', board: 'root', item: 'missing', message: 'Link targets missing file "life/missing.d2".' },
    { rule: 'dangling-file-link', severity: 'error', board: 'root', item: 'up',
      message: 'Link "../../outside.d2" points outside the project folder or at a file that cannot be a diagram.' },
    { rule: 'dangling-file-link', severity: 'error', board: 'root.layers.L', item: 'x', message: 'Link targets missing file "life/nope.d2".' },
    { rule: 'bare-file-link', severity: 'warning', board: 'root', item: 'bare',
      message: 'Link "health.d2" is read as a board path, so D2 drops it. To open the file, write link: "./health.d2".' },
    { rule: 'bare-file-link', severity: 'warning', board: 'root', item: 'folder',
      message: 'Link "work/plan.d2#/A" is read as a board path, so D2 drops it. To open the file, write link: "./work/plan.d2#/A".' },
  ]);
  expect(lint(result, { files }).diagnostics.filter((item) => item.rule.includes('file')).every((item) => item.range?.startsWith('index,'))).toBe(true);
  // Without board sets, fragments are not checked.
  expect(summary(lint(result, { files: { ...files, boards: undefined } }).diagnostics).map((item) => item.rule))
    .toEqual(['dangling-file-link', 'dangling-file-link', 'dangling-file-link', 'bare-file-link', 'bare-file-link']);
  // A single file cannot know its neighbours, so only the bare links D2 drops are reported.
  expect(summary(lint(result).diagnostics).map((item) => item.rule)).toEqual(['bare-file-link', 'bare-file-link']);
  expect(lint(result).diagnostics.some((item) => item.rule === 'ignored-link')).toBe(false);
});

it('says which bare file links D2 keeps, and suggests forward slashes for backslashed ones', async () => {
  const result = await compile('win.link: ".\\\\health.d2"\nup.link: "..\\\\index.d2#/"\nabs.link: /health.d2\nbare.link: health.d2');
  expect(lint(result).diagnostics.filter((item) => item.rule === 'bare-file-link').map(({ shape, message }) => [shape, message])).toEqual([
    ['win', 'Link ".\\health.d2" is not a ./ or ../ path, so the viewer ignores it. To open the file, write link: "./health.d2".'],
    ['up', 'Link "..\\index.d2#/" is not a ./ or ../ path, so the viewer ignores it. To open the file, write link: "../index.d2#/".'],
    ['abs', 'Link "/health.d2" is not a ./ or ../ path, so the viewer ignores it. To open the file, write link: "./health.d2".'],
    ['bare', 'Link "health.d2" is read as a board path, so D2 drops it. To open the file, write link: "./health.d2".'],
  ]);
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

it('warns about Markdown images, which D2 drops, but not about ordinary Markdown, code or LaTeX', async () => {
  const result = lint(await compile(`ok: |md **bold** [link](https://example.com)|
code: |go x := "![a](b)"|
math: |latex x^2|
pic: |\`md
  Logo ![logo](https://example.com/logo.png)
\`|
a -> b: |\`md ![arrow](a.png)\`|
ok.link: layers.x
layers.x: {c: |\`md ![c](c.png)\`|}`));
  expect(result.diagnostics.map(({ rule, severity, board, shape, connection }) => ({ rule, severity, board, item: shape ?? connection }))).toEqual([
    { rule: 'unsupported-label', severity: 'warning', board: 'root', item: 'pic' },
    { rule: 'unsupported-label', severity: 'warning', board: 'root', item: '(a -> b)[0]' },
    { rule: 'unsupported-label', severity: 'warning', board: 'root.layers.x', item: 'c' },
  ]);
  expect(result.diagnostics[0].message).toBe('Markdown images are not rendered, so this label shows without them. Use an icon or an image shape instead.');
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

it('keeps scanning classes after apostrophes, inch marks, pipes and one-line block strings in labels', async () => {
  const undefinedClasses = async (index: string) => lint(await d2.compile({ fs: { index }, options: { layout: 'elk' } }))
    .diagnostics.filter((item) => item.rule === 'undefined-class').map((item) => item.message.split('"')[1]);
  const classes = 'classes: {k: {style.fill: red}}\ny.class: k';
  expect(await undefinedClasses(`x: Don't stop\n${classes}`)).toEqual([]);
  expect(await undefinedClasses(`tv: 55" TV\n${classes}`)).toEqual([]);
  expect(await undefinedClasses(`a: |md x|\n${classes}\nz.class: nope`)).toEqual(['nope']);
  expect(await undefinedClasses(`${classes}\nb: |md last line|`)).toEqual([]);
  expect(await undefinedClasses(`x: in | out\n${classes}\nw: yes | no\nz.class: nope`)).toEqual(['nope']);
  expect(await undefinedClasses(`x: in | out\n${classes}\nz.class: nope`)).toEqual(['nope']);
  expect(await undefinedClasses('classes: {a: {label: Issue \\#1}; b: {style.fill: red}}\nx.class: [a; b]')).toEqual([]);
});

it('names a board that a link cannot reach because its name has a backslash or quote', async () => {
  const result = lint(await compile('a.link: layers."q\\"x"\nb.link: layers."b\\\\s"\nlayers."q\\"x": {c}\nlayers."b\\\\s": {d}'));
  expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.message)).toEqual([
    'Link targets missing board "Root > q.x". Did you mean "Root > q"x"? Board names with backslashes or quotes cannot be link targets, so rename it.',
    'Link targets missing board "Root > bs". Did you mean "Root > b\\s"? Board names with backslashes or quotes cannot be link targets, so rename it.',
  ]);
  expect(lint(await compile('a.link: layers.qx\nlayers."q\\"y": {c}')).diagnostics[0].message).toBe('Link targets missing board "Root > qx".');
});

it('finds dropped links written in imported files, at the root and in layers, from their own text', async () => {
  const part = 'a.link: layers.missing\nb: Label {style: {fill: red}; link: other.d2} # note\nc: {d: {link: ok}; link: "x\\".d2"}\n' +
    'e: {link: "./kept.d2#/A"}\nf.link: ./kept.d2#/B';
  const fs = { index: '...@part\ng: @part\nlayers.x: {...@part}\nz.link: layers.x', 'part.d2': part };
  const result = await d2.compile({ fs, options: { layout: 'elk' } });
  const files = { inputPath: 'index', exists: () => true };
  // `c.d`'s own link is not `c`'s; kept links, such as `e` and `f`, were checked in their compiled form.
  expect(lint({ ...result, fs }, { files }).diagnostics.map(({ rule, board, shape, range }) => [rule, board, shape, range])).toEqual([
    ['dangling-link', 'root', 'a', 'part.d2,0:8:8-0:22:22'],
    ['dangling-link', 'root', 'g.a', 'part.d2,0:8:8-0:22:22'],
    ['bare-file-link', 'root', 'b', 'part.d2,1:36:59-1:44:67'],
    ['bare-file-link', 'root', 'g.b', 'part.d2,1:36:59-1:44:67'],
    ['bare-file-link', 'root', 'g.c', 'part.d2,2:25:101-2:33:109'],
    ['bare-file-link', 'root', 'c', 'part.d2,2:25:101-2:33:109'],
    ['ignored-link', 'root', 'c.d', 'part.d2,2:14:90-2:16:92'],
    ['ignored-link', 'root', 'g.c.d', 'part.d2,2:14:90-2:16:92'],
    ['dangling-link', 'root.layers.x', 'a', 'part.d2,0:8:8-0:22:22'],
    ['bare-file-link', 'root.layers.x', 'b', 'part.d2,1:36:59-1:44:67'],
    ['ignored-link', 'root.layers.x', 'c.d', 'part.d2,2:14:90-2:16:92'],
    ['bare-file-link', 'root.layers.x', 'c', 'part.d2,2:25:101-2:33:109'],
  ]);
});

it('finds dropped links that globs, substitutions and block strings set, in the entry file and imported ones', async () => {
  const source = 'c: {d}\nab\nx\n"*": {y}\na*.link: layers.one\nc.*.link: layers.two\n"*".link: layers.three\n' +
    'vars: {t: layers.k}\nx.link: ${t}\ny: {link: "${t}"}\nf: {link: |md layers.k|}\ng.link: |md layers.gone|\nlayers.k: {z}\nk.link: layers.k';
  const rows = (result: Awaited<ReturnType<typeof d2.compile>>, fs: Record<string, string>) => lint({ ...result, fs }).diagnostics
    .filter((item) => item.rule !== 'orphan-board').map(({ rule, shape, range, message }) => [rule, shape, range?.replace(/,.*/, ''), message]);
  const expected = (file: string) => [
    ['dangling-link', 'ab', file, 'Link targets missing board "Root > one".'],
    ['dangling-link', 'c.d', file, 'Link targets missing board "Root > two".'],
    ['dangling-link', '"*"', file, 'Link targets missing board "Root > three".'],
    ['ignored-link', 'x', file, 'Link "${t}" uses a substitution, which D2 drops from board links, so the viewer ignores it. Write the board path itself.'],
    ['ignored-link', 'y', file, 'Link "${t}" uses a substitution, which D2 drops from board links, so the viewer ignores it. Write the board path itself.'],
    // D2 keeps a block string's link to a board that exists, as `f` has.
    ['dangling-link', 'g', file, 'Link targets missing board "Root > gone".'],
  ];
  const entry = { index: source };
  expect(rows(await d2.compile({ fs: entry, options: { layout: 'elk' } }), entry).sort()).toEqual(expected('index').sort());
  const imported = { index: '...@part', 'part.d2': source };
  expect(rows(await d2.compile({ fs: imported, options: { layout: 'elk' } }), imported).sort()).toEqual(expected('part.d2').sort());
});

it('applies globs only to the shapes their filters pass, as D2 does, and reads globs inside layers', async () => {
  const base = 'a: A {shape: circle; style.fill: red; width: 90}\nb: B {icon: https://x.y/i.svg}\nc: {d}\na -> b\n';
  const shapes = async (fs: Record<string, string>) => lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs }).diagnostics
    .filter((item) => item.rule === 'dangling-link').map((item) => item.shape).sort();
  for (const [filter, expected] of [['&shape: circle', ['a']], ['!&shape: circle', ['b', 'c', 'c.d']], ['&label: A*', ['a']], ['&label: "A*"', []],
    ['&style.fill: red', ['a']], ['&width: 90', ['a']], ['&icon: https://x.y/i.svg', ['b']], ['&connected: false', ['c', 'c.d']],
    ['&leaf: false', ['c']], ['&level: 1', ['c.d']], ['&id: c', []], ['&shape: circle; !&label: A', []]] as const) {
    const glob = `**: {${filter}; link: layers.missing}`;
    expect(await shapes({ index: base + glob }), filter).toEqual(expected);
    // An imported glob reaches only the shapes its own file writes, never `z`.
    expect(await shapes({ index: '...@part\nz', 'part.d2': base + glob }), `${filter} imported`).toEqual(expected);
  }
  const layered = lint(await compile('layers.x: {*.link: layers.missing; a}\nz.link: layers.x')).diagnostics;
  expect(layered.map(({ rule, board, shape, message }) => [rule, board, shape, message]))
    .toEqual([['dangling-link', 'root.layers.x', 'a', 'Link targets missing board "Root > x > missing".']]);
});

it('applies an imported file\'s globs to its own shapes only, at every place it is imported', async () => {
  const rows = async (fs: Record<string, string>) => lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs }).diagnostics
    .map(({ rule, shape, message }) => [rule, shape, message]);
  // D2 links `s` but leaves the importer's `a` alone.
  expect(await rows({ index: 'a\n...@lib\nlayers.k: {z}', 'lib.d2': 's\n*.link: layers.k' })).toEqual([]);
  expect(await rows({ index: '...@a', 'a.d2': 'x: @b\ny: @b', 'b.d2': '*.link: layers.missing\ns' })).toEqual([
    ['dangling-link', 'x.s', 'Link targets missing board "Root > missing".'],
    ['dangling-link', 'y.s', 'Link targets missing board "Root > missing".'],
  ]);
});

it('reads links inside block comments as comments, and an unquoted null as no link', async () => {
  const rows = async (fs: Record<string, string>) => lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs }).diagnostics
    .map(({ rule, shape, message }) => [rule, shape, message]);
  expect(await rows({ index: '...@lib\nb.class: x', 'lib.d2': 's\n"""\n*.link: layers.gone\nclasses.x.link: layers.gone\n"""\n' +
    'classes: {x: {style.fill: red}}' })).toEqual([]);
  for (const fs of [<Record<string, string>>{ index: 'a.link: layers.x\na.link: null\nlayers.x: {b}\nc.link: layers.x' }, { index: 'a: {link: NULL}\n*.link: null' },
    { index: '...@p\na', 'p.d2': 'a.link: null\nb: {link: Null}' }]) expect(await rows(fs), fs.index).toEqual([]);
});

it('finds dropped links that classes set, from the board that defines the class', async () => {
  const rows = async (fs: Record<string, string>) => lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs }).diagnostics
    .filter((item) => item.rule !== 'orphan-board').map(({ rule, board, shape, range, message }) => [rule, board, shape, range, message]);
  expect(await rows({ index: 'classes: {x: {link: layers.one}}\nclasses.x.link: layers.two\na.class: x\nb: {class: x; link: layers.k}\n' +
    'layers.k: {c.class: x; layers.two: {d}}' })).toEqual([
    ['dangling-link', 'root', 'a', 'index,1:16:49-1:26:59', 'Link targets missing board "Root > two".'],
    // D2 resolves the class's link from the root, which defines it, not from `k`, which has a `two`; the layer's AST
    // places the class at its first definition, so the place comes from the root's own.
    ['dangling-link', 'root.layers.k', 'c', 'index,1:16:49-1:26:59', 'Link targets missing board "Root > two".'],
  ]);
  expect(await rows({ index: '...@lib\na.class: [x; y]', 'lib.d2': 'classes: {x: {link: layers.gone}; y.link: other.d2}' })).toEqual([
    ['bare-file-link', 'root', 'a', 'lib.d2,0:42:42-0:50:50', 'Link "other.d2" is read as a board path, so D2 drops it. To open the file, write link: "./other.d2".'],
  ]);
});

it('checks the link of a class no shape takes where the class is written, without counting it as incoming', async () => {
  const result = lint(await compile('classes: {x: {link: layers.gone}; y: {link: layers.k}; z: {link: "./x.d2"}}\nlayers.k: {a}'));
  expect(result.diagnostics.map(({ rule, board, shape, range, message }) => [rule, board, shape, range, message])).toEqual([
    ['dangling-link', 'root', undefined, 'index,0:20:20-0:31:31', 'Link targets missing board "Root > gone".'],
    ['orphan-board', 'root.layers.k', undefined, 'index,1:7:83-1:8:84', 'Layer "Root > k" has no incoming board link.'],
  ]);
});

it('explains that D2 applies no classes from a file imported under a key', async () => {
  const fs = { index: 'g: @lib\ng.b.class: x\nc.class: nope', 'lib.d2': 'classes: {x: {link: layers.missing}}\na.class: x' };
  const result = lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs });
  const message = 'Class "x" is defined only in "lib", which is imported under a key, and D2 applies no classes from such a file, ' +
    'so it changes nothing. Spread the file at the top, as in ...@lib, to use its classes.';
  expect(result.diagnostics.map(({ rule, shape, message }) => [rule, shape, message])).toEqual([
    // The class never applies, but its link is still broken where it is written.
    ['dangling-link', undefined, 'Link targets missing board "Root > missing".'],
    ['undefined-class', 'g.b', message],
    ['undefined-class', 'c', 'Class "nope" is not defined, so it changes nothing. Check the spelling, or define it under classes.'],
  ]);
});

it('finds dropped links on shapes whose IDs D2 quotes unlike board names', async () => {
  for (const shape of ["'a$b'", 'a$b', 'NULL', 'Null', "c.'a$b'"]) {
    const result = lint(await compile(`${shape}.link: layers.missing`));
    expect(result.diagnostics.map((item) => item.rule), shape).toEqual(['dangling-link']);
  }
});

it('names the board a connection link to a board named NULL meant', async () => {
  const result = lint(await compile('a -> b: {link: layers.NULL}\nlayers.NULL: {x}'));
  expect(result.diagnostics.map(({ rule, range, message }) => [rule, range, message])).toEqual([
    ['ignored-link', 'index,0:15:15-0:26:26', 'D2 reads the link to board "Root > NULL" as one to "null", so the viewer ignores it. Rename the board to link to it.'],
    ['orphan-board', 'index,1:7:35-1:11:39', 'Layer "Root > NULL" has no incoming board link.'],
  ]);
});

it('resolves file links in imported files from the file that wrote them', async () => {
  const result = await d2.compile({ fs: { index: '...@sub/part\nlayers.L: {...@sub/part}\nhome.link: ./sub/other.d2',
    'sub/part.d2': 'a.link: ./other.d2\nb: {link: ../x.d2}\nc.link: ./gone.d2\na -> b: {link: ./other.d2}' }, inputPath: 'index', options: { layout: 'elk' } });
  const files = { inputPath: 'index', exists: (path: string) => ['sub/other.d2', 'x.d2'].includes(path) };
  expect(lint(result, { files }).diagnostics.map(({ board, shape, message }) => [board, shape, message])).toEqual([
    ['root', 'c', 'Link targets missing file "sub/gone.d2".'],
    ['root.layers.L', 'c', 'Link targets missing file "sub/gone.d2".'],
    ['root.layers.L', undefined, 'Layer "Root > L" has no incoming board link.'],
  ]);
});

it('resolves a class\'s file link from the file that defines the class', async () => {
  const fs = { index: '...@sub/lib\na.class: x', 'sub/lib.d2': 'classes: {x: {link: ./other.d2}}' };
  const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
  expect(lint(result, { files: { inputPath: 'index', exists: (path: string) => path === 'sub/other.d2' } }).diagnostics).toEqual([]);
  expect(rebaseFileLinks(result, 'index').shapes.map((shape) => [shape.id, shape.link])).toEqual([['a', './sub/other.d2']]);
});

it('rewrites file links of imported files to open from the entry file, leaving the compiled diagram for lint', async () => {
  const result = await d2.compile({ fs: { 'work/index.d2': '...@sub/part\nhome.link: ./sub/other.d2',
    'work/sub/part.d2': 'a.link: ./other.d2\nb: {link: "../../x.d2#/Q"}\na -> b: {link: ./other.d2}' }, inputPath: 'work/index.d2', options: { layout: 'elk' } });
  const links = (diagram: typeof result.diagram) => [...diagram.shapes, ...diagram.connections].map((item) => [item.id, item.link]);
  const before = links(result.diagram);
  expect(links(rebaseFileLinks(result, 'work/index.d2'))).toEqual([
    ['a', './sub/other.d2'], ['home', './sub/other.d2'], ['b', '../x.d2#/Q'], ['(a -> b)[0]', './sub/other.d2'],
  ]);
  expect(links(result.diagram)).toEqual(before);
  const plain = await compile('a.link: ./other.d2');
  expect(rebaseFileLinks(plain, 'index.d2')).toBe(plain.diagram);
});

it('checks file links into hidden and build folders by the caller\'s project rules', async () => {
  const result = await compile('a.link: ./dist/x.d2\nb.link: ./.hidden/y.d2');
  const files = { inputPath: 'index.d2', exists: () => true };
  expect(lint(result, { files }).diagnostics.map((item) => item.message)).toEqual([
    'Link "./dist/x.d2" opens a hidden or build folder, which the project leaves out.',
    'Link "./.hidden/y.d2" opens a hidden or build folder, which the project leaves out.',
  ]);
  expect(lint(result, { files: { ...files, scanned: false } }).diagnostics).toEqual([]);
});

it('quotes a board named null as D2 does, and warns when D2 drops a link to another casing of it', async () => {
  expect(boardKey('null')).toBe("'null'");
  expect(boardKey('NULL')).toBe('NULL');
  expect(lint(await compile('s.link: layers."null"\nlayers."null": {t; u.link: _}')).diagnostics).toEqual([]);
  const dropped = lint(await compile('s.link: layers."NULL"\nlayers."NULL": {t; u.link: _}')).diagnostics;
  expect(dropped.map(({ rule, shape, message }) => [rule, shape, message])).toEqual([
    ['ignored-link', 's', 'D2 drops the link to board "Root > NULL", so the viewer ignores it. Rename the board to link to it.'],
    ['orphan-board', undefined, 'Layer "Root > NULL" has no incoming board link.'],
  ]);
  expect(dropped[0].range).toMatch(/^index,0:/);
  expect(boardLabel("root.layers.'null'.layers.x", indexBoards((await compile('a')).diagram))).toBe('Root > null > x');
});

it('scans past Markdown block strings fenced with backticks for classes', async () => {
  const index = 'x: |`md\n| a | b {\n`|\nclasses.k: {style.fill: red}\ny.class: k';
  expect(definedClasses({ index }, 'index')).toEqual(new Set(['k']));
  expect(definedClasses({ index: 'x: ||`md\n| a |` b |\n`||\nclasses.k: {}' }, 'index')).toEqual(new Set(['k']));
  expect(lint(await d2.compile({ fs: { index }, options: { layout: 'elk' } })).diagnostics).toEqual([]);
});

it('locates boards declared through dotted layers keys at their own name', async () => {
  const result = lint(await compile('a\nlayers.x: {t}\nlayers.t: {u}\nlayers.y.z: 1\nlayers: {w: {v}}'), { missingBacklink: true });
  expect(result.diagnostics.filter((item) => item.rule === 'orphan-board').map(({ board, range }) => [board, range])).toEqual([
    ['root.layers.x', 'index,1:7:9-1:8:10'],
    ['root.layers.t', 'index,2:7:23-2:8:24'],
    ['root.layers.y', 'index,3:7:37-3:8:38'],
    ['root.layers.w', 'index,4:9:53-4:10:54'],
  ]);
  expect(result.diagnostics.filter((item) => item.rule === 'missing-backlink').map(({ board, range }) => [board, range?.split(',')[1].split('-')[0]]))
    .toEqual([['root.layers.x', '1:7:9'], ['root.layers.t', '2:7:23'], ['root.layers.y', '3:7:37'], ['root.layers.w', '4:9:53']]);
});

it('resolves a file link the entry file\'s glob sets on an imported shape from the entry file', async () => {
  for (const glob of ['*.link: ./x.d2', '**: {&shape: rectangle; link: ./x.d2}']) {
    const fs = { index: `...@sub/lib\n${glob}`, 'sub/lib.d2': 'q' };
    const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
    expect(lint(result, { files: { inputPath: 'index', exists: (path: string) => path === 'x.d2' } }).diagnostics).toEqual([]);
    expect(rebaseFileLinks(result, 'index').shapes.map((shape) => [shape.id, shape.link])).toEqual([['q', './x.d2']]);
  }
});

it('resolves an imported shape\'s map link from its file when the entry file holds the same text', async () => {
  const fs = { index: '...@sub/lib\na: label # see ./x.d2', 'sub/lib.d2': 'a: {link: ./x.d2}' };
  const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
  expect(lint(result, { files: { inputPath: 'index', exists: (path: string) => path === 'sub/x.d2' } }).diagnostics).toEqual([]);
  expect(rebaseFileLinks(result, 'index').shapes.map((shape) => [shape.id, shape.link])).toEqual([['a', './sub/x.d2']]);
});

it('follows nested imports written with CRLF line endings or a quoted path', async () => {
  const rules = async (lib: string, deep: string) => {
    const fs = { index: '...@lib', 'lib.d2': lib, 'deep.d2': deep };
    const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
    return lint(result, { files: { inputPath: 'index', exists: () => true } }).diagnostics.map((item) => [item.rule, item.shape]);
  };
  const expected = await rules('...@deep\nq', '*.link: other.d2\nq');
  expect(expected).toEqual([['bare-file-link', 'q']]);
  expect(await rules('...@deep\r\nq', '*.link: other.d2\r\nq')).toEqual(expected);
  expect(await rules('...@"deep"\nq', '*.link: other.d2\nq')).toEqual(expected);
  expect(await rules("...@'deep'\nq", '*.link: other.d2\nq')).toEqual(expected);
});

it('reads classes after a single-quoted label with an escaped quote', async () => {
  const source = "a: 'it''s {'\nclasses: {c: {style.fill: red}}\nb.class: c";
  expect(lint(await compile(source)).diagnostics).toEqual([]);
  expect([...definedClasses({ index: source }, 'index') ?? []]).toEqual(['c']);
});
