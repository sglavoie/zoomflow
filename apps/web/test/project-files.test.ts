import { D2 } from '@d2lang/d2';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { indexShapeSources, parseSourceRange } from '@zoomflow/core';
import { projectFileSystem, validProjectPath } from '../src/project-files';

const d2 = new D2();
afterAll(() => d2.dispose());

it('compiles root and nested project imports with their own relative paths', async () => {
  const main = readFileSync(new URL('../../../fixtures/browser-project/main.d2', import.meta.url), 'utf8');
  const nodes = readFileSync(new URL('../../../fixtures/browser-project/lib/nodes.d2', import.meta.url), 'utf8');
  const nested = readFileSync(new URL('../../../fixtures/browser-project/lib/nested.d2', import.meta.url), 'utf8');
  const sources = { 'main.d2': main, 'lib/nodes.d2': nodes, 'lib/nested.d2': nested };
  const root = await d2.compile(projectFileSystem('main.d2', sources, main));
  expect(root.diagram.shapes.map((shape) => shape.id)).toContain('Imported');
  expect(indexShapeSources(root.diagram, root.graph, main, root.inputPath).some((item) => item.shape === 'Other')).toBe(true);
  const child = await d2.compile(projectFileSystem('lib/nested.d2', sources, nested));
  expect(child.diagram.shapes.map((shape) => shape.id)).toContain('Imported');
  expect(child.inputPath).toBe('lib/nested.d2');
});

it('keeps source ranges on the selected project file and rejects unsafe paths', () => {
  expect(parseSourceRange('lib/nested.d2,1:1:0-1:7:6', 'Nested', 'lib/nested.d2')).toEqual({ from: 0, to: 6 });
  expect(parseSourceRange('lib/nodes.d2,1:1:0-1:7:6', 'Nested', 'lib/nested.d2')).toBeUndefined();
  expect(validProjectPath('lib/nested.d2')).toBe(true);
  for (const path of ['../secret.d2', 'lib/../secret.d2', '/absolute.d2', 'node_modules/file.d2', 'image.png']) {
    expect(validProjectPath(path)).toBe(false);
  }
});
