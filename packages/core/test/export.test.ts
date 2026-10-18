import { readFileSync } from 'node:fs';
import { D2, type Diagram } from '@d2lang/d2';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { exportBoardsHtml, exportBoardsZip, renderExportBoards } from '../src/index';

const d2 = new D2();
afterAll(() => d2.dispose());

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

  it('escapes labels and titles that would break out of embedded HTML data', async () => {
    const boards = await renderExportBoards({ name: '', shapes: [] } as unknown as Diagram, async () => '<svg><text></script><script>alert(1)</script></text></svg>');
    const html = exportBoardsHtml(boards, { title: '<img src=x onerror=alert(1)>', script: 'void 0;', style: '' });
    expect(html).not.toContain('<img');
    expect(html.match(/<script/g)).toHaveLength(2);
    const json = html.match(/type="application\/json">(.*?)<\/script>/s)![1];
    expect(JSON.parse(json)).toEqual(boards);
  });
});
