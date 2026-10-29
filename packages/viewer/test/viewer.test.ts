// @vitest-environment happy-dom
import type { Diagram } from '@zoomflow/core';
import { afterEach, expect, it } from 'vitest';
import { Viewer } from '../src/index';

const diagram = { name: '', shapes: [{ id: 'a' }], connections: [] } as unknown as Diagram;
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Good preview</text></svg>';
const viewers: Viewer[] = [];
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const viewer = new Viewer(host, { history: false });
  viewers.push(viewer);
  return { viewer, host };
}
afterEach(() => { for (const viewer of viewers.splice(0)) viewer.destroy(); document.body.replaceChildren(); });

it('rejects a document whose render fails, preserving the previous diagram', async () => {
  const { viewer, host } = mount();
  await viewer.setDocument({ ...diagram, layers: [{ ...diagram, name: 'Child' }] }, async () => svg);
  const failure = new Error('Render failed');
  await expect(viewer.setDocument(diagram, async () => { throw failure; })).rejects.toMatchObject({ cause: failure });
  expect(viewer.stage.textContent).toBe('Good preview');
  expect(host.getAttribute('aria-busy')).toBe('false');
  // The retained diagram keeps its own board index and renderer, too.
  await viewer.navigate('root.layers.Child');
  expect(viewer.currentBoard?.id).toBe('root.layers.Child');
});

it('rejects malformed rendered SVG rather than accepting the document as displayed', async () => {
  const { viewer } = mount();
  await expect(viewer.setDocument(diagram, async () => '<html/>')).rejects.toThrow();
  expect(viewer.stage.querySelector('html')).toBeNull();
});

it('reports a failed board navigation without rejecting its event caller, and lets it retry', async () => {
  const { viewer, host } = mount();
  let fail = true;
  await viewer.setDocument({ ...diagram, layers: [{ ...diagram, name: 'Child' }] }, async target => {
    if (target && fail) throw new Error('Render failed');
    return svg;
  });
  await expect(viewer.navigate('root.layers.Child')).resolves.toBeUndefined();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Render failed');
  expect(viewer.currentBoard?.id).toBe('root');
  fail = false;
  await viewer.navigate('root.layers.Child');
  expect(viewer.currentBoard?.id).toBe('root.layers.Child');
});

it('ignores an obsolete render failure after a newer document has appeared', async () => {
  const { viewer, host } = mount();
  let reject!: (error: Error) => void;
  const pending = viewer.setDocument(diagram, () => new Promise((_resolve, fail) => { reject = fail; }));
  await viewer.setDocument(diagram, async () => svg);
  reject(new Error('Obsolete render failed'));
  await expect(pending).resolves.toBeUndefined();
  expect(viewer.stage.textContent).toBe('Good preview');
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('');
});
