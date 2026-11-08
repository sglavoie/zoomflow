
import { expect, it } from 'vitest';
import { indexBoards, lint, rebaseFileLinks, } from '../src';
import { definedClasses } from '../src/classes';
import { d2, compile, } from './lint-helpers';

export function registerLintImportCases() {
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
    for (const [filter, expected] of [['&shape: circle', ['a']], ['!&shape: circle', ['b', 'c', 'c.d']], ['&label: A*', ['a']], ['&label: a*', ['a']], ['&label: "A*"', []],
      // Without `*`, an unquoted value matches exactly too.
      ['&label: a', []], ['&shape: CIRCLE', []],
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


  it('reads globs after a quoted key holding a comment mark or brace', async () => {
    for (const key of ['c."k#1"', 'c."k{1"', "c.'k#1'"]) {
      const fs = { index: '...@lib', 'lib.d2': `${key}: {\n  d\n}\n*.link: layers.missing\nq` };
      const diagnostics = lint({ ...await d2.compile({ fs, options: { layout: 'elk' } }), fs }).diagnostics;
      expect(diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.shape).sort(), key).toEqual(['c', 'q']);
    }
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


  it('credits a file link to whichever reference or glob D2 applies last, on the board it is written for', async () => {
    const exists = (path: string) => ['y.d2', 'sub/x.d2'].includes(path);
    const lib = { 'sub/lib.d2': 'a.link: ./x.d2' };
    for (const [index, expected] of [
      // A glob after an import overrides the imported file's own link, and an import after the entry's link overrides it.
      ['...@sub/lib\n*.link: ./y.d2', [['root', 'a', './y.d2']]],
      ['a.link: ./y.d2\n...@sub/lib', [['root', 'a', './sub/x.d2']]],
      ['...@sub/lib\na.link: ./y.d2', [['root', 'a', './y.d2']]],
      // Globs in layers, scenarios and shape maps apply after the imports beside them.
      ['z.link: layers.x\nlayers.x: {...@sub/lib\n*.link: ./y.d2}', [['root', 'z', 'root.layers.x'], ['root.layers.x', 'a', './y.d2']]],
      ['...@sub/lib\nscenarios.s: {*.link: ./y.d2}', [['root', 'a', './sub/x.d2'], ['root.scenarios.s', 'a', './y.d2']]],
      ['g: {...@sub/lib\n*.link: ./y.d2}', [['root', 'g.a', './y.d2']]],
    ] as const) {
      const fs = { index, ...lib };
      const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
      expect(lint(result, { files: { inputPath: 'index', exists } }).diagnostics.filter((item) => item.rule.includes('file')), index).toEqual([]);
      const links = [...indexBoards(rebaseFileLinks(result, 'index')).values()].flatMap((board) =>
        board.diagram.shapes.filter((shape) => shape.link).map((shape) => [board.id, shape.id, shape.link]));
      expect(links, index).toEqual(expected);
    }
  });


  it('finds a dropped link that overrides an earlier one, and globs from imports nested in imported maps', async () => {
    const shapes = async (fs: Record<string, string>) => lint({ ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs })
      .diagnostics.filter((item) => item.rule === 'dangling-link').map((item) => item.shape);
    expect(await shapes({ index: 'a.link: https://e.com\n*.link: layers.missing\nb' })).toEqual(['a', 'b']);
    expect(await shapes({ index: 'a.link: https://e.com\n...@lib', 'lib.d2': 'a.link: layers.missing' })).toEqual(['a']);
    expect(await shapes({ index: '...@a', 'a.d2': 'x: {...@b}', 'b.d2': '*.link: layers.missing\ns' })).toEqual(['x.s']);
    // A link written later, or on the scenario itself, still wins.
    expect(await shapes({ index: '*.link: layers.missing\na.link: https://e.com' })).toEqual([]);
    expect(await shapes({ index: '...@lib\na.link: https://e.com', 'lib.d2': 'a.link: layers.missing' })).toEqual([]);
    expect(await shapes({ index: 'a\nscenarios.s: {a.link: https://e.com}\n*.link: https://g.com' })).toEqual([]);
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


  it('keeps invalid imported file links missing instead of opening another file relative to the entry', async () => {
    const inputPath = 'work/deep/index.d2';
    const fs = { [inputPath]: '...@../../lib/part',
      'lib/part.d2': 'a.link: ../../other.d2\nb.link: ./dist/other.d2\na -> b: {link: ../../other.d2}' };
    const result = { ...await d2.compile({ fs, inputPath, options: { layout: 'elk' } }), fs };
    const diagram = rebaseFileLinks(result, inputPath);
    expect([...diagram.shapes, ...diagram.connections].map(item => item.link)).toEqual([
      '../../../other.d2', '../../lib/dist/other.d2', '../../../other.d2',
    ]);
    expect(result.diagram.shapes[0].link).toBe('../../other.d2');
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


  it('follows `./` and `../` imports to the files they name', async () => {
    const run = async (fs: Record<string, string>) => lint(await d2.compile({ fs, inputPath: 'app/main.d2', options: { layout: 'elk' } }));
    const glob = await run({ 'sub/part.d2': '*.link: layers.nope\nk\n', 'app/main.d2': '...@../sub/part\nr\n' });
    expect(glob.diagnostics.map(({ rule, range }) => [rule, range?.split(',')[0]])).toEqual([['dangling-link', 'sub/part.d2']]);
    const spread = await run({ 'lib.d2': 'classes: {go: {link: layers.nope}}\n', 'app/main.d2': '...@../lib\nx: {class: go}\n' });
    expect(spread.diagnostics.map(({ rule }) => rule)).toEqual(['dangling-link']);
    const keyed = await run({ 'app/lib.d2': 'classes: {hot: {style.fill: red}}\n', 'app/main.d2': 'g: @./lib\nx: {class: hot}\n' });
    expect(keyed.diagnostics[0].message).toContain('...@./lib');
  });


  it('credits globs in imported files to the board D2 writes them on, past quoted keys after arrows and parentheses', async () => {
    const rows = async (fs: Record<string, string>) => {
      const result = { ...await d2.compile({ fs, inputPath: 'index', options: { layout: 'elk' } }), fs };
      return lint(result, { files: { inputPath: 'index', exists: (path: string) => path === 'sub/y.d2' } }).diagnostics
        .filter((item) => item.rule === 'dangling-file-link').map((item) => [item.board, item.shape]);
    };
    // Each entry file also holds the link text, so only the glob can credit the link to `sub/x.d2`.
    for (const edge of ['p ->"q}"', 'p <-"q{"', '"q}" -> p\n("q}" -> p)[0].style.bold: true']) {
      expect(await rows({ index: '...@sub/x\na\n# ./y.d2', 'sub/x.d2': `${edge}\na\n*.link: ./y.d2` }), edge).toEqual([]);
    }
    for (const index of ['layers.x: @sub/x', 'layers: {x: @sub/x}']) {
      expect(await rows({ index: `${index}\nlayers.x.q.style.bold: true\n# ./y.d2`, 'sub/x.d2': 'q\n*.link: ./y.d2' }), index).toEqual([]);
    }
    // D2 merges `LAYERS` into `layers`, and reads a quoted `"layers"` as a shape.
    expect(await rows({ index: '...@sub/x\nlayers: {l: {q}}\n# ./y.d2', 'sub/x.d2': 'layers: {l: {q}}\nLAYERS.l.*.link: ./y.d2' })).toEqual([]);
    expect(await rows({ index: '...@sub/x\n"layers".x.q\n# ./y.d2', 'sub/x.d2': '"layers".x.q\n"layers".x.*.link: ./y.d2' })).toEqual([]);
  });


  it('reads quoted keyword keys, such as "layers", "vars" and "classes", as the shapes D2 makes of them', async () => {
    const rows = async (index: string) => {
      const result = { ...await d2.compile({ fs: { index }, inputPath: 'index', options: { layout: 'elk' } }), fs: { index } };
      return lint(result, { files: { inputPath: 'index', exists: () => false } }).diagnostics.map((item) => [item.rule, item.shape]);
    };
    expect(await rows('"layers".x.q.link: layers.nope')).toEqual([['dangling-link', 'layers.x.q']]);
    expect(await rows('"vars".q.link: layers.nope')).toEqual([['dangling-link', 'vars.q']]);
    // D2 styles `a` with no class from a quoted `"classes"`.
    expect(await rows('"classes".k.style.fill: red\na.class: k')).toEqual([['undefined-class', 'a']]);
    expect(await rows('a.class: k\n"classes".k.link: layers.nope')).toEqual([['dangling-link', 'classes.k'], ['undefined-class', 'a']]);
    expect(await rows('"classes": {k: {link: ./y.d2}}\na.class: k')).toEqual([['dangling-file-link', 'classes.k'], ['undefined-class', 'a']]);
    expect([...definedClasses({ index: '"classes".k.style.fill: red\n\'classes\': {j}' }, 'index') ?? []]).toEqual([]);
  });
}
