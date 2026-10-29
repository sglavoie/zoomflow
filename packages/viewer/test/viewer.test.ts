// @vitest-environment happy-dom
import type { Diagram } from '@zoomflow/core';
import { afterEach, expect, it } from 'vitest';
import { Viewer } from '../src/index';

const diagram = { name: '', shapes: [{ id: 'a' }], connections: [] } as unknown as Diagram;
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Good preview</text></svg>';
const viewers: Viewer[] = [];
function mount(history = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const viewer = new Viewer(host, { history });
  viewers.push(viewer);
  return { viewer, host };
}
afterEach(() => { for (const viewer of viewers.splice(0)) viewer.destroy(); document.body.replaceChildren(); history.replaceState(null, '', '#/'); });

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

it('leaves modified and middle clicks on valid board routes to the browser', async () => {
  const { viewer } = mount(true);
  await viewer.setDocument({ ...diagram, layers: [{ ...diagram, name: 'Child' }] }, async () => svg);
  // Prepared anchors; happy-dom has no SVG geometry for decorateLinks.
  viewer.stage.querySelector('svg')!.innerHTML = '<a href="#/Child" data-board="root.layers.Child"><text>Child</text></a><a href="root.layers.Gone" data-board="root.layers.Gone"><text>Missing</text></a>';
  const [valid, missing] = [...viewer.stage.querySelectorAll('a')];
  expect(valid.getAttribute('href')).toBe('#/Child');
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    const type = 'button' in options ? 'auxclick' : 'click';
    expect(valid.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...options }))).toBe(true);
    expect(missing.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...options }))).toBe(false);
  }
  expect(viewer.currentBoard?.id).toBe('root');
  expect(location.hash).toBe('#/');
});

it('handles modified clicks inside a viewer whose document has no URL route', async () => {
  const { viewer } = mount();
  await viewer.setDocument({ ...diagram, layers: [{ ...diagram, name: 'Child' }] }, async () => svg);
  viewer.stage.querySelector('svg')!.innerHTML = '<a href="#/Child" data-board="root.layers.Child"><text>Child</text></a>';
  const link = viewer.stage.querySelector('a')!;
  expect(link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
  expect(link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(viewer.currentBoard?.id).toBe('root.layers.Child');
});
