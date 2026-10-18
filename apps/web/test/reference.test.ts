import { D2 } from '@d2lang/d2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { lint } from '@zoomflow/core';
import { referenceTopics } from '../src/reference-data';

let d2: D2;
beforeAll(() => { d2 = new D2(); });
afterAll(async () => { await d2?.dispose(); });

it.each(referenceTopics)('compiles and renders the $title reference example', async (topic) => {
  const compiled = await d2.compile(topic.source, { layout: 'elk' });
  expect(compiled.diagram.shapes.length).toBeGreaterThan(0);
  expect(lint(compiled).diagnostics).toEqual([]);
  expect(await d2.render(compiled.diagram, compiled.renderOptions)).toContain('<svg');
  for (const layer of compiled.diagram.layers ?? []) {
    if (!layer) continue;
    expect(await d2.render(compiled.diagram, { ...compiled.renderOptions, target: `layers.${layer.name}` })).toContain('<svg');
  }
});
