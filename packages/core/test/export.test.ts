import { readFileSync } from 'node:fs';
import { D2, type Diagram } from '@d2lang/d2';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { exportBoardsHtml, exportBoardsZip, exportGlyphSource, exportSourcesZip, renderExportBoards, type ExportBoard } from '../src/index';

const d2 = new D2();
afterAll(() => d2.dispose());

it('downloads the edited D2 project tree without adding bundled library files', () => {
  const files = unzipSync(exportSourcesZip({ 'main.d2': '...@lib/nodes', 'lib/nodes.d2': 'Node: Edited' }));
  expect(Object.keys(files)).toEqual(['main.d2', 'lib/nodes.d2']);
  expect(strFromU8(files['lib/nodes.d2'])).toBe('Node: Edited');
  expect(() => exportSourcesZip({ '../escape.d2': 'Bad' })).toThrow('Invalid project source path');
});

describe('board tree exports', () => {
  it.each([
    ['order', ['root.svg', 'checkout.svg', 'checkout/charge.svg']],
    ['cycle', ['root.svg', 'A.svg', 'B.svg']],
  ] as const)('exports exactly one SVG per %s tree node, without following links', async (fixture, paths) => {
    const compiled = await d2.compile(readFileSync(`fixtures/${fixture}.d2`, 'utf8'), { layout: 'elk' });
    const targets: string[] = [];
    const boards = await renderExportBoards(compiled.diagram, async (target) => {
      targets.push(target);
      return d2.render(compiled.diagram, { ...compiled.renderOptions, target });
    });
    const files = unzipSync(exportBoardsZip(boards));
    expect(Object.keys(files)).toEqual(paths);
    expect(new Set(targets).size).toBe(paths.length);
    for (const board of boards) {
      expect(strFromU8(files[board.path])).toBe(board.svg);
      expect(board.svg).toContain('<svg');
    }
    if (fixture === 'cycle') {
      expect(boards[1].svg).toContain('href="root.layers.B"');
      expect(boards[2].svg).toContain('href="root.layers.A"');
    } else {
      expect(strFromU8(files['checkout/charge.svg'])).toContain('Capture');
      expect(strFromU8(files['root.svg'])).not.toContain('Capture');
    }
  });

  it('includes unlinked, empty, scenario and step boards with safe distinct paths', async () => {
    const compiled = await d2.compile(`Root
layers: {
  root: {}
  "../escape": {Safe}
  other: {Other}
}
scenarios: {alternate: {Scenario}}
steps: {first: {Step}}`, { layout: 'elk' });
    const boards = await renderExportBoards(compiled.diagram, async (target) => `<svg>${target}</svg>`);
    expect(boards).toHaveLength(6);
    expect(boards.find((board) => board.id === 'root.layers.root')?.empty).toBe(true);
    const paths = Object.keys(unzipSync(exportBoardsZip(boards)));
    expect(paths).toContain('@scenarios/alternate.svg');
    expect(paths).toContain('@steps/first.svg');
    expect(paths).toContain('@root.svg');
    expect(paths.every((path) => !path.split('/').includes('..'))).toBe(true);
    expect(new Set(paths).size).toBe(6);
  });

  it('keeps Unicode ZIP names and replaces only unsafe characters, deduplicating case-insensitively', async () => {
    const compiled = await d2.compile(`layers: {
  "Café": {a}
  "v1.2": {b}
  "a/b\\\\c": {c}
  'x<>:"|?*': {d}
  CON: {e}
  "lpt1.txt": {f}
  "end. ": {g}
  ".": {h}
  "..": {i}
  "Ébène": {j; layers: {inner: {k}}}
  "e\u0301bène": {l; layers: {inner: {m}}}
  "ébène.svg": {n; layers: {deep: {o}}}
}`, { layout: 'elk' });
    const boards = await renderExportBoards(compiled.diagram, async (target) => `<svg>${target}</svg>`);
    expect(boards.map((board) => board.path)).toEqual(['root.svg', 'Café.svg', 'v1.2.svg', 'a_b_c.svg', 'x_______.svg',
      '_CON.svg', '_lpt1.txt.svg', 'end__.svg', '_.svg', '__.svg', 'Ébène.svg', 'Ébène/inner.svg', '@e\u0301bène.svg', '@e\u0301bène/inner.svg',
      'ébène.svg.svg', '@@ébène.svg/deep.svg']);
    expect(Object.keys(unzipSync(exportBoardsZip(boards)))).toHaveLength(boards.length);
  });

  it('renders with bounded concurrency in tree order and can skip empty boards', async () => {
    const compiled = await d2.compile('r\nlayers: {a: {x}; b: {}; c: {y}; d: {z}}', { layout: 'elk' });
    let active = 0, peak = 0;
    const rendered: string[] = [];
    const boards = await renderExportBoards(compiled.diagram, async (target) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, target === 'layers.a' ? 30 : 5));
      active--;
      rendered.push(target);
      return `<svg>${target}</svg>`;
    }, [], { concurrency: 2, skipEmpty: true });
    expect(peak).toBe(2);
    expect(rendered).not.toContain('layers.b');
    expect(boards.map((board) => board.svg)).toEqual(['<svg></svg>', '<svg>layers.a</svg>', '', '<svg>layers.c</svg>', '<svg>layers.d</svg>']);
    let calls = 0;
    await expect(renderExportBoards(compiled.diagram, async () => { calls++; throw new Error('render failed'); }, [], { concurrency: 2 }))
      .rejects.toThrow('render failed');
    expect(calls).toBe(2);
  });

  it('escapes labels and titles that would break out of embedded HTML data', async () => {
    const boards = await renderExportBoards({ name: '', shapes: [{ id: 'a' }] } as unknown as Diagram, async () => '<svg><text></script><script>alert(1)</script></text></svg>');
    const html = exportBoardsHtml(boards, { title: '<img src=x onerror=alert(1)>', script: 'void 0;', style: '' });
    expect(html).not.toContain('<img');
    expect(html.match(/<script/g)).toHaveLength(2);
    const json = html.match(/type="application\/json">(.*?)<\/script>/s)![1];
    expect(JSON.parse(json)).toEqual(boards);
  });

  const face = (scope: string, name: string, data: string) => `@font-face {\n\tfont-family: ${scope}-${name};\n\tsrc: url("data:application/font-woff;base64,${data}");\n}`;
  const boardSvg = (scope: string, fills: string, faces = ['font-bold']) => `<svg><svg class="${scope} d2-svg">` +
    `<style type="text/css"><![CDATA[.appendix-icon{}${faces.map((name) => `.${scope} .text-${name}{font-family:"${scope}-${name}";}${face(scope, name, `${scope}${name}`)}`).join('')}]]></style>` +
    `<style type="text/css"><![CDATA[.shape{}${fills.split(',').map((fill) => `.${scope} .fill-${fill}{fill:red;}`).join('')}]]></style><text class="text-bold">${scope}</text></svg></svg>`;
  const embedded = (html: string) => JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)![1]).map((board: { svg: string }) => board.svg);
  const sharedStyle = (html: string) => html.match(/<style id="zoomflow-svg-style">([\s\S]*?)<\/style>/)?.[1];

  it('shares glyph-render fonts and hoists each repeated style variant under its own class', async () => {
    const compiled = await d2.compile('a\nlayers: {b: {c}; d: {e}; empty: {}}', { layout: 'elk' });
    const svgs: Record<string, string> = { '': boardSvg('d2-1', 'N1'), 'layers.b': boardSvg('d2-2', 'N1,N2'),
      'layers.d': boardSvg('d2-3', 'N1', ['font-bold', 'font-mono']) };
    const boards = await renderExportBoards(compiled.diagram, async (target) => svgs[target] ?? '<svg></svg>', [], { skipEmpty: true });
    const glyphs = `<svg class="d2-9 d2-svg"><style><![CDATA[${face('d2-9', 'font-bold', 'ALL')}]]></style></svg>`;
    const html = exportBoardsHtml(boards, { title: 't', script: '', style: '', glyphs });
    const [root, b, d, empty] = embedded(html);
    expect(sharedStyle(html)).toBe([
      '@font-face{font-family:zf-font-bold;src:url("data:application/font-woff;base64,ALL")}',
      '.appendix-icon{}.zf-s0 .text-font-bold{font-family:"zf-font-bold";}',
      '.shape{}.zf-s1 .fill-N1{fill:red;}',
      '.shape{}.zf-s2 .fill-N1{fill:red;}.zf-s2 .fill-N2{fill:red;}',
    ].join('\n'));
    expect(root).toBe('<svg><svg class="d2-1 d2-svg zf-s0 zf-s1"><text class="text-bold">d2-1</text></svg></svg>');
    expect(b).toBe('<svg><svg class="d2-2 d2-svg zf-s0 zf-s2"><text class="text-bold">d2-2</text></svg></svg>');
    // A face the glyph render lacks stays with its board, and so does every later block.
    expect(d).toContain('class="d2-3 d2-svg"');
    expect(d).toContain('font-family:"zf-font-bold"');
    expect(d).toContain(face('d2-3', 'font-mono', 'd2-3font-mono'));
    expect(d).not.toContain('d2-3font-bold');
    expect(empty).toBe('');
  });

  it('keeps styles in each board when unscoped rules differ or no glyph render is available', async () => {
    const compiled = await d2.compile('a\nlayers: {b: {c}}', { layout: 'elk' });
    const svgs: Record<string, string> = { '': boardSvg('d2-1', 'N1'), 'layers.b': boardSvg('d2-2', 'N1').replace('.shape{}', '.shape{x:1}') };
    const boards = await renderExportBoards(compiled.diagram, async (target) => svgs[target]);
    const html = exportBoardsHtml(boards, { title: 't', script: '', style: '' });
    // Without shared fonts, the first block names per-board faces and nothing can move.
    expect(sharedStyle(html)).toBeUndefined();
    expect(embedded(html)).toEqual([svgs[''], svgs['layers.b']]);
    // XMLSerializer output has no CDATA and escapes markup characters in style text.
    const xml = exportBoardsHtml(boards.map((board) => ({ ...board,
      svg: board.svg.replace(/<!\[CDATA\[|\]\]>/g, '').replace('.appendix-icon{}', 'svg &gt; .appendix-icon{}') })),
      { title: 't', script: '', style: '', glyphs: `<svg>${face('d2-9', 'font-bold', 'ALL')}</svg>` });
    expect(sharedStyle(xml)).toContain('svg > .appendix-icon{}.zf-s0 .text-font-bold{font-family:"zf-font-bold";}');
  });

  it('builds glyph source that D2 compiles with every shown character, including quotes', async () => {
    const boards = [{ empty: false, svg: '<svg><style>.x{}</style><text>Ça &amp; "it\'s" ${x} \\ 漢</text></svg>' },
      { empty: true, svg: '<svg><text>never</text></svg>' }] as ExportBoard[];
    const source = exportGlyphSource(boards)!;
    const labels = (await d2.compile(source, { layout: 'elk' })).diagram.shapes.map((shape) => ('label' in shape && shape.label) || '');
    expect(new Set(labels.join(''))).toEqual(new Set('Ça&"it\'s${x}\\漢'));
    expect(exportGlyphSource([{ empty: false, svg: '<svg><text> </text></svg>' }] as ExportBoard[])).toBeUndefined();
  });
});
