// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAtlasHtml } from '@zoomflow/core';
import { offlineViewerScript, prepareExportSvg, rasterSize } from '../src/export';

const root = (attributes: string) =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`, 'image/svg+xml').documentElement;

describe('rasterSize', () => {
  it('keeps the native viewBox size, rounded up, within canvas limits', () => {
    expect(rasterSize(root('viewBox="-10 -10 800.4 600"'))).toMatchObject({ width: 801, height: 600 });
    expect(rasterSize(root('width="120" height="80"'))).toMatchObject({ width: 120, height: 80, native: [120, 80] });
  });

  it('scales a side beyond 16384 pixels down, keeping the aspect ratio', () => {
    expect(rasterSize(root('viewBox="0 0 40000 1000"'))).toMatchObject({ width: 16384, height: 409 });
    expect(rasterSize(root('viewBox="0 0 500 32768"'))).toMatchObject({ width: 250, height: 16384 });
  });

  it('scales a large area down to 64 megapixels', () => {
    const { width, height } = rasterSize(root('viewBox="0 0 16000 16000"'));
    expect(width).toBe(height);
    expect(width * height).toBeLessThanOrEqual(64_000_000);
    expect(width).toBe(8000);
  });

  it('names a missing or invalid viewBox instead of a size limit', () => {
    for (const attributes of ['', 'viewBox="0 0 0 10"', 'viewBox="0 0 abc 10"', 'viewBox="0 0"', 'width="100%" height="auto"']) {
      expect(() => rasterSize(root(attributes))).toThrow('Diagram has no valid size: its SVG viewBox is missing or invalid.');
    }
  });
});

describe('prepareExportSvg', () => {
  it('rewrites each CSS url once, keeping `$` patterns and escaping quotes', async () => {
    const inner = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
    const { svg } = await prepareExportSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.a{fill:url('${inner}')} .b{fill:url(data:image/png;base64,QUJD$&amp;)} .c{fill:url(#g)} .d{fill:url(#g)}</style></svg>`);
    const style = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('style')!.textContent;
    expect(style).toBe(`.a{fill:url("${inner.replaceAll('"', '\\"')}")} .b{fill:url("data:image/png;base64,QUJD$&")} .c{fill:url("#g")} .d{fill:url("#g")}`);
  });
});

describe('offline atlas runtime', () => {
  const shape = (label: string, href = '') => `<g class="${btoa(label)}">${href ? `<a href="${href}">` : ''}<rect width="10" height="10"/><text>${label}</text>${href ? '</a>' : ''}</g>`;
  const svg = (...shapes: [string, string?][]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${shapes.map(([label, href]) => shape(label, href)).join('')}</svg>`;
  const board = (id: string, name: string, hash: string, content: string, parent?: string) =>
    ({ id, name, hash, parent, path: `${id}.svg`, empty: false, svg: content });
  const documents = () => [
    { path: 'index.d2', name: 'index', boards: [board('root', 'Root', '#/', svg(['Health', './health.d2'], ['Lost', './lost.d2']))] },
    { path: 'health.d2', name: 'health', boards: [board('root', 'Root', '#/', svg(['Sleep', 'root.layers.Sleep'])),
      board('root.layers.Sleep', 'Sleep', '#/Sleep', svg(['Plan', './work/plan.d2#/Q 1']), 'root')] },
    { path: 'work/plan.d2', name: 'work/plan', boards: [board('root', 'Root', '#/', svg(['Up', '../health.d2'])),
      board('root.layers.Q 1', 'Q 1', '#/Q%201', svg(['Goal']), 'root')] },
  ];
  const stage = () => document.querySelector<HTMLElement>('.zf-stage')!;
  const crumbs = () => [...document.querySelectorAll('.zf-breadcrumbs button')].map((button) => button.textContent);
  const link = (file: string) => stage().querySelector<SVGAElement>(`a[data-file="${file}"]`)!;
  const pressEscape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  beforeEach(() => {
    // happy-dom measures detached SVGs; without client rects, links get no badges to lay out.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  });

  function load(hash = '') {
    history.replaceState(null, '', `/${hash}`);
    const html = exportAtlasHtml(documents(), { title: 'Life', script: offlineViewerScript(), style: '' });
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    const script = body.querySelector('script:not([type])')!;
    script.remove();
    document.body.replaceWith(document.importNode(body, true));
    new Function(script.textContent!)();
  }

  it('follows file links between embedded files with breadcrumbs across them', () => {
    load();
    expect(stage().dataset.file).toBe('index.d2');
    expect(link('./health.d2').getAttribute('href')).toBe('#/@file/health.d2');
    // A file the atlas does not hold stays, marked missing.
    expect(link('./lost.d2').hasAttribute('data-missing')).toBe(true);
    link('./lost.d2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Missing file: lost');

    link('./health.d2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect([stage().dataset.file, stage().dataset.board, location.hash]).toEqual(['health.d2', 'root', '#/@file/health.d2']);
    expect(crumbs()).toEqual(['index', 'Root']);
    stage().querySelector('a[data-board="root.layers.Sleep"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // The fragment names its board as written.
    expect(link('./work/plan.d2#/Q 1').getAttribute('href')).toBe('#/@file/work%2Fplan.d2/Q%201');
    link('./work/plan.d2#/Q 1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect([stage().dataset.file, stage().dataset.board]).toEqual(['work/plan.d2', 'root.layers.Q 1']);
    // More than three crumbs fold the middle ones into a menu, as in the live viewer.
    expect(crumbs()).toEqual(['index', '…', 'health', 'Root', 'Q 1']);

    // Escape climbs this file's boards, then returns to the file and board that opened it.
    pressEscape();
    expect([stage().dataset.file, stage().dataset.board]).toEqual(['work/plan.d2', 'root']);
    pressEscape();
    expect([stage().dataset.file, stage().dataset.board]).toEqual(['health.d2', 'root.layers.Sleep']);
    expect(crumbs()).toEqual(['index', 'Root', 'Sleep']);
    (document.querySelector('.zf-breadcrumbs button') as HTMLButtonElement).click();
    expect([stage().dataset.file, location.hash]).toEqual(['index.d2', '#/']);
    expect(crumbs()).toEqual(['Root']);
  });

  it('opens a file route directly, falling back to the nearest board and leading home', () => {
    load('#/@file/work%2Fplan.d2/Q%201/Gone');
    expect([stage().dataset.file, stage().dataset.board]).toEqual(['work/plan.d2', 'root.layers.Q 1']);
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Board "Q 1/Gone" not found; showing Q 1');
    expect(crumbs()).toEqual(['index', 'Root', 'Q 1']);
    pressEscape();
    pressEscape();
    expect(stage().dataset.file).toBe('index.d2');

    load('#/@file/nowhere.d2');
    expect([stage().dataset.file, stage().dataset.board]).toEqual(['index.d2', 'root']);
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Missing file: nowhere.d2; showing Root');
  });
});
