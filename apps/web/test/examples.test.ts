import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { boardBlocks, indexBoards, lint } from '@zoomflow/core';
import { examples } from '../src/examples';
import { boardSites } from '../src/board-model';
import { projectFileSystem } from '../src/project-files';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

it.each(examples)('compiles and renders every board of $name with no imports but the library', async (example) => {
  const compiled = await d2.compile({ ...projectFileSystem('index', {}, example.source),
    options: { layout: 'elk', themeID: 0, darkThemeID: 200 } });
  const diagnostics = lint(compiled).diagnostics;
  if (example.name === 'diagnostics.d2') {
    expect(diagnostics.map((item) => item.severity).sort()).toEqual(['error', 'warning']);
    const repaired = await d2.compile(example.source.replaceAll('layers.missing', 'layers.details'), { layout: 'elk' });
    expect(lint(repaired).diagnostics).toEqual([]);
  } else {
    expect(diagnostics).toEqual([]);
  }
  if (example.name === 'states.d2') {
    const checked = lint(compiled, { boundaryPorts: true, missingBacklink: true });
    expect(checked.diagnostics).toEqual([]);
    expect(checked.boundaryPairsEvaluated).toBeGreaterThan(0);
  }
  for (const board of indexBoards(compiled.diagram).values()) {
    const svg = await d2.render(compiled.diagram, { ...compiled.renderOptions, target: board.target });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<foreignObject');
  }
});

it('opens every board of the mixed example in its own builder', async () => {
  const { source } = examples.find((example) => example.name === 'mixed.d2')!;
  const compiled = await d2.compile({ ...projectFileSystem('index', {}, source), options: { layout: 'elk' } });
  const boards = indexBoards(compiled.diagram);
  const sites = boardSites(source, boardBlocks(compiled.graph, source, compiled.inputPath), boards);
  expect([...boards.keys()].map((id) => [id, sites.builder(id)?.kind])).toEqual([
    ['root', 'flow'],
    ['root.layers.Plan the launch', 'mind map'],
    ['root.layers.Plan the launch.layers.Onboarding', 'flow'],
    ['root.layers.Build and test', 'flow'],
  ]);
  expect(sites.shapeAction('root', 'step_2')).toEqual({ action: 'edit', board: 'root.layers.Plan the launch', kind: 'mind map' });
  expect(sites.shapeAction('root', 'step_1')).toEqual({ action: 'add' });
});
