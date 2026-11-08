
import { expect, it } from 'vitest';
import { boardKey, boardLabel, indexBoards, lint, type LintDiagnostic } from '../src';
import { d2, fixture, compile, } from './lint-helpers';

export function registerLintLinkCases() {
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
slash.link: "./health.d2#/Sleep//Night/"
percent.link: "./health.d2#/50%"
layers.L: {back.link: "../index.d2#/"; x.link: ./nope.d2}`);
    const files = { inputPath: 'life/index.d2', exists: (path: string) => ['life/health.d2', 'index.d2'].includes(path),
      boards: (path: string) => path === 'life/health.d2' ? new Set(['#/', '#/Sleep', '#/Sleep/Night', '#/My%20Board', '#/50%25']) : undefined };
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


  it('recognizes mixed-case file extensions in kept and dropped file links', async () => {
    const result = await compile('kept.link: ./Other.D2\nbare.link: Other.D2');
    expect(result.diagram.shapes.find(shape => shape.id === 'kept')?.link).toBe('./Other.D2');
    const diagnostics = lint(result, { files: { inputPath: 'index.d2', exists: path => path === 'Other.D2' } }).diagnostics;
    expect(diagnostics.filter(item => item.rule.includes('file')).map(({ rule, shape }) => [rule, shape]))
      .toEqual([['bare-file-link', 'bare']]);
    expect(diagnostics.some(item => item.rule === 'ignored-link')).toBe(false);
  });


  it('names a board that a link cannot reach because its name has a backslash or quote', async () => {
    const result = lint(await compile('a.link: layers."q\\"x"\nb.link: layers."b\\\\s"\nlayers."q\\"x": {c}\nlayers."b\\\\s": {d}'));
    expect(result.diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.message)).toEqual([
      'Link targets missing board "Root > q.x". Did you mean "Root > q"x"? Board names with backslashes or quotes cannot be link targets, so rename it.',
      'Link targets missing board "Root > bs". Did you mean "Root > b\\s"? Board names with backslashes or quotes cannot be link targets, so rename it.',
    ]);
    expect(lint(await compile('a.link: layers.qx\nlayers."q\\"y": {c}')).diagnostics[0].message).toBe('Link targets missing board "Root > qx".');
  });


  it('matches percent-encoded icons, and applies `***` at every depth and in layers', async () => {
    const shapes = async (source: string) => lint(await d2.compile(source, { layout: 'elk' })).diagnostics
      .filter((item) => item.rule === 'dangling-link').map((item) => `${item.board}/${item.shape}`).sort();
    const icons = 'i.icon: https://icons.terrastruct.com/essentials%2F004-picture.svg\nm.icon: https://e.com/a%20b.svg\n';
    expect(await shapes(`${icons}*: {&icon: https://icons.terrastruct.com/essentials%2F004-picture.svg; link: layers.missing}`)).toEqual(['root/i']);
    expect(await shapes(`${icons}*: {&icon: https://e.com/a%20b.svg; link: layers.missing}`)).toEqual(['root/m']);
    expect(await shapes('a\ng.b\nlayers.x: {c}\n***.link: layers.missing'))
      .toEqual(['root.layers.x/c', 'root/a', 'root/g', 'root/g.b']);
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
}
