import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { indexBoards, lint } from '@zoomflow/core';
import { examples } from '../src/examples';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

it.each(examples)('compiles and renders every board of $name without imports', async (example) => {
  const compiled = await d2.compile(example.source, { layout: 'elk', themeID: 0, darkThemeID: 200 });
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
