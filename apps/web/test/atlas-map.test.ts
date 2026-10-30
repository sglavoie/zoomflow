import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D2 } from '@d2lang/d2';
import { classifyHref, indexBoards } from '@zoomflow/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { atlasMapSource, fileLinks, unlinkedLabel, type AtlasFile } from '../src/atlas-map';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });
const compile = (path: string, fs: Record<string, string>, source = fs[path]) =>
  d2.compile({ ...projectFileSystem(path, fs, source), options: { layout: 'elk' } });

/** Class shapes carry no label; every shape the map draws has one. */
const labelOf = (shape: object) => 'label' in shape ? shape.label : undefined;

const root = fileURLToPath(new URL('../../../fixtures/atlas', import.meta.url));
function readFolder(folder: string, fs: Record<string, string> = {}) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) readFolder(path, fs);
    else fs[relative(root, path).split('\\').join('/')] = readFileSync(path, 'utf8');
  }
  return fs;
}

it('gathers each link to another file once, resolved to project paths with their fragments', async () => {
  const fs = { 'a/index.d2': 'x: {link: ../b.d2}\ny: {link: "../b.d2#/Q"}\nz: {link: ../b.d2}\nself: {link: ./index.d2}\nx -> y: {link: "../c/d.d2#/"}\nlayers: {\n  L: {\n    w: {link: ../b.d2}\n  }\n}\n',
    'b.d2': 'Q: {link: root.layers.Q}\nlayers: { Q: { q } }\n', 'c/d.d2': 'd' };
  const compiled = await compile('a/index.d2', fs);
  expect(fileLinks(compiled.diagram, 'a/index.d2')).toEqual([
    { path: 'b.d2', hash: '' }, { path: 'b.d2', hash: '#/Q' }, { path: 'c/d.d2', hash: '' },
  ]);
});

it('draws the atlas fixture: every file opens itself, links connect files, and unlinked files are grouped', async () => {
  const fs = readFolder(root);
  const files: AtlasFile[] = [];
  for (const path of Object.keys(fs)) files.push({ path, links: fileLinks((await compile(path, fs)).diagram, path) });
  const source = atlasMapSource(files, 'index.d2');
  const compiled = await compile('index', fs, source);
  const shapes = compiled.diagram.shapes;
  const fileShapes = shapes.filter((shape) => shape.link);
  expect(fileShapes.map((shape) => [labelOf(shape), shape.link]).sort()).toEqual([
    ['broken/links', './broken/links.d2'], ['health', './health.d2'], ['index', './index.d2'],
    ['projects/zoomflow', './projects/zoomflow.d2'], ['work/index', './work/index.d2'],
  ]);
  for (const shape of fileShapes) expect(classifyHref(shape.link!).kind).toBe('file');
  // broken/links.d2 is linked from nowhere; index.d2 is the home board, so it stays out of that group.
  const group = shapes.find((shape) => labelOf(shape) === unlinkedLabel)!;
  expect(shapes.filter((shape) => shape.id.startsWith(`${group.id}.`)).map(labelOf)).toEqual(['broken/links']);
  const label = (id: string) => labelOf(shapes.find((shape) => shape.id === id)!);
  expect(compiled.diagram.connections.map((edge) => [label(edge.src), label(edge.dst), edge.label]).sort()).toEqual([
    ['broken/links', 'index', 'Gone'], ['index', 'health', ''], ['index', 'work/index', ''], ['work/index', 'projects/zoomflow', 'Viewer'],
  ]);
  expect(indexBoards(compiled.diagram).size).toBe(1);
});

it('keeps file names literal, marks files that did not compile, and leaves out links to missing files', async () => {
  const files: AtlasFile[] = [
    { path: 'My "Life" $5.d2', links: [{ path: 'gone.d2', hash: '' }, { path: 'odd #1.d2', hash: '#/A%20B' }] },
    { path: 'odd #1.d2', links: [], failed: true },
  ];
  const source = atlasMapSource(files);
  const compiled = await compile('index', { 'My "Life" $5.d2': '', 'odd #1.d2': '' }, source);
  expect(compiled.diagram.shapes.map(labelOf).sort()).toEqual(['My "Life" $5', unlinkedLabel, 'odd #1']);
  expect(compiled.diagram.shapes.find((shape) => labelOf(shape) === 'My "Life" $5')!.link).toBe('./My "Life" $5.d2');
  expect(compiled.diagram.shapes.find((shape) => labelOf(shape) === 'odd #1')!.link).toBe('./odd #1.d2');
  expect(compiled.diagram.shapes.find((shape) => labelOf(shape) === 'odd #1')!.tooltip).toContain('did not compile');
  expect(compiled.diagram.connections.map((edge) => edge.label)).toEqual(['A B']);
});
