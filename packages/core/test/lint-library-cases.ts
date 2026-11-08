
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lint, } from '../src';
import { definedClasses } from '../src/classes';
import { d2, library, compile, } from './lint-helpers';

export function registerLintLibraryCases() {
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
    expect(shape('zf-accent-3')).toMatchObject({ stroke: '#448e77' });
    // Unstyled lines keep a theme colour.
    expect(result.diagram.connections.map((edge) => [edge.stroke.startsWith('#') ? edge.stroke : 'theme', edge.strokeDash, edge.animated, edge.dstArrow])).toEqual([
      ['#30a46c', 0, false, 'triangle'], ['#e5484d', 4, false, 'triangle'], ['theme', 4, true, 'triangle'],
      ['theme', 2, false, 'triangle'], ['theme', 0, false, 'cf-many']]);
    const svg = await d2.render(result.diagram, result.renderOptions);
    expect(svg).toContain('<image href="data:image/svg+xml;utf8,');
  });


  it('recolours every class from one palette value in a project copy of the library', async () => {
    const copy = library.replace('zf-accent-3: "#448e77"', 'zf-accent-3: "#123456"').replace('zf-yes: "#30a46c"', 'zf-yes: "#654321"');
    const result = await d2.compile({ fs: { index: '...@zoomflow\na.class: zf-accent-3\na -> b: {class: zf-yes}\na.link: layers.x\nlayers.x: {c.class: zf-accent-3}',
      'zoomflow.d2': copy }, options: { layout: 'elk' } });
    expect(result.diagram.shapes[0].stroke).toBe('#123456');
    expect(result.diagram.connections[0].stroke).toBe('#654321');
    expect(result.diagram.layers?.[0]?.shapes[0].stroke).toBe('#123456');
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


  it('scans past Markdown block strings fenced with backticks for classes', async () => {
    const index = 'x: |`md\n| a | b {\n`|\nclasses.k: {style.fill: red}\ny.class: k';
    expect(definedClasses({ index }, 'index')).toEqual(new Set(['k']));
    expect(definedClasses({ index: 'x: ||`md\n| a |` b |\n`||\nclasses.k: {}' }, 'index')).toEqual(new Set(['k']));
    expect(lint(await d2.compile({ fs: { index }, options: { layout: 'elk' } })).diagnostics).toEqual([]);
  });


  it('reads classes after a single-quoted label with an escaped quote', async () => {
    const source = "a: 'it''s {'\nclasses: {c: {style.fill: red}}\nb.class: c";
    expect(lint(await compile(source)).diagnostics).toEqual([]);
    expect([...definedClasses({ index: source }, 'index') ?? []]).toEqual(['c']);
  });
}
