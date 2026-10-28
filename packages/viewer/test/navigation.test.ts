// @vitest-environment happy-dom
import { shapeClass, type Diagram } from '@zoomflow/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFolderMessage, Viewer, type ViewerOptions } from '../src/index';
import { childToward, normalizeRouteHash, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from '../src/navigation';

const hashes = new Set(['#/', '#/checkout', '#/checkout/charge']);
const exists = (hash: string) => hashes.has(hash);

describe('resolveRouteHash', () => {
  it('keeps existing boards and defaults an empty hash to the root', () => {
    expect(resolveRouteHash('#/checkout/charge', exists)).toBe('#/checkout/charge');
    expect(resolveRouteHash('', exists)).toBe('#/');
    expect(resolveRouteHash('#/', exists)).toBe('#/');
  });

  it('walks up to the nearest existing ancestor', () => {
    expect(resolveRouteHash('#/checkout/missing', exists)).toBe('#/checkout');
    expect(resolveRouteHash('#/checkout/charge/a/b', exists)).toBe('#/checkout/charge');
    expect(resolveRouteHash('#/nope/deeper', exists)).toBe('#/');
    expect(resolveRouteHash('#nope', exists)).toBe('#/');
  });

  it('terminates at the root even when nothing exists', () => {
    expect(resolveRouteHash('#/a/b/c', () => false)).toBe('#/');
  });
});

describe('normalizeRouteHash', () => {
  it('spells segments the way board hashes are built', () => {
    expect(normalizeRouteHash('#/Q&A/a[b]')).toBe('#/Q%26A/a%5Bb%5D');
    expect(normalizeRouteHash('#/caf%c3%a9/My Board')).toBe('#/caf%C3%A9/My%20Board');
    expect(normalizeRouteHash('#/@file/x%2Fy.d2/bad%E0')).toBe('#/@file/x%2Fy.d2/bad%E0');
    // A lone `%` is the text a board name holds, and an empty segment names no board.
    expect(normalizeRouteHash('#/50%/a%2')).toBe('#/50%25/a%252');
    expect(normalizeRouteHash('#/A//B/')).toBe('#/A/B');
    expect(normalizeRouteHash('#//')).toBe('#/');
    expect(normalizeRouteHash('')).toBe('#/');
  });

  it('encodes a board named with a leading @ and keeps reserved segments raw', () => {
    expect(normalizeRouteHash('#/@home/x')).toBe('#/%40home/x');
    expect(normalizeRouteHash('#/a/@scenarios/b/@steps/c')).toBe('#/a/@scenarios/b/@steps/c');
  });

  it('drops a trailing slash so the route resolves without a fallback notice', () => {
    expect(normalizeRouteHash('#/A/')).toBe('#/A');
    expect(normalizeRouteHash('#/A//')).toBe('#/A');
    expect(normalizeRouteHash('#/')).toBe('#/');
    expect(normalizeRouteHash('#')).toBe('#/');
  });
});

describe('routeFallbackNotice', () => {
  it('is empty when the route resolved exactly', () => {
    expect(routeFallbackNotice('#/checkout', '#/checkout', 'checkout')).toBe('');
    expect(routeFallbackNotice('', '#/', 'Root')).toBe('');
  });

  it('names the missing path and the board shown instead', () => {
    expect(routeFallbackNotice('#/nope/deeper', '#/', 'Root')).toBe('Board "nope/deeper" not found; showing Root');
    expect(routeFallbackNotice('#/checkout/caf%C3%A9', '#/checkout', 'checkout')).toBe('Board "checkout/café" not found; showing checkout');
    expect(routeFallbackNotice('#/bad%E0', '#/', 'Root')).toBe('Board "bad%E0" not found; showing Root');
  });
});

describe('simplifyTrail', () => {
  it('collapses loops back to the earlier visit', () => {
    expect(simplifyTrail(['root', 'a', 'b', 'a'])).toEqual(['root', 'a']);
    expect(simplifyTrail(['root', 'a', 'a'])).toEqual(['root', 'a']);
    expect(simplifyTrail(['root', 'a', 'b'])).toEqual(['root', 'a', 'b']);
  });
});

describe('restoreTrail', () => {
  const boards = new Set(['root', 'root.layers.a', 'root.layers.b']);
  const has = (id: string) => boards.has(id);
  const fallback = () => ['root', 'root.layers.a'];

  it('keeps a saved trail that ends at the board and names existing boards', () => {
    expect(restoreTrail(['root', 'root.layers.b', 'root.layers.a'], 'root.layers.a', has, fallback))
      .toEqual(['root', 'root.layers.b', 'root.layers.a']);
  });

  it('falls back to ancestors for missing, stale, foreign or malformed trails', () => {
    for (const saved of [undefined, null, 'root', [], ['root'], ['root', 'root.layers.gone', 'root.layers.a'], ['root', 1, 'root.layers.a'], { at: () => 'root.layers.a' }])
      expect(restoreTrail(saved, 'root.layers.a', has, fallback)).toEqual(['root', 'root.layers.a']);
  });
});

describe('watchHistory', () => {
  it('restores once per traversal and once for a bare hash change', () => {
    const target = new EventTarget();
    const location = { hash: '#/' };
    vi.stubGlobal('location', location);
    let calls = 0;
    watchHistory(target, () => { calls++; });
    const go = (event: string, hash: string) => { location.hash = hash; target.dispatchEvent(new Event(event)); };
    go('popstate', '#/a');
    go('hashchange', '#/a');
    expect(calls).toBe(1);
    go('hashchange', '#/b');
    expect(calls).toBe(2);
    // Traversals between entries with the same hash fire no hashchange.
    go('popstate', '#/b');
    go('popstate', '#/b');
    expect(calls).toBe(4);
    // An address-bar edit after them still restores.
    go('hashchange', '#/c');
    expect(calls).toBe(5);
    vi.unstubAllGlobals();
  });

  it('restores an address-bar edit to the hash of an earlier same-hash traversal', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const location = { hash: '#/' };
    vi.stubGlobal('location', location);
    let calls = 0;
    watchHistory(target, () => { calls++; });
    location.hash = '#/b';
    // A traversal between entries with the same hash fires no hashchange.
    target.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(1000);
    // The app moves on without events, then the user types the earlier hash.
    location.hash = '#/c';
    location.hash = '#/b';
    target.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(2);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('skips the hashchange of a traversal whose restore already replaced the hash', () => {
    const target = new EventTarget();
    const location = { hash: '#/' };
    vi.stubGlobal('location', location);
    let calls = 0;
    // Restoring an unknown board replaces its hash with the root's before hashchange fires.
    watchHistory(target, () => { calls++; location.hash = '#/'; });
    location.hash = '#/nope';
    target.dispatchEvent(new Event('popstate'));
    target.dispatchEvent(Object.assign(new Event('hashchange'), { newURL: 'https://example.test/#/nope' }));
    expect(calls).toBe(1);
    vi.unstubAllGlobals();
  });

  it('stops listening when its signal aborts', () => {
    const target = new EventTarget();
    const controller = new AbortController();
    let calls = 0;
    watchHistory(target, () => { calls++; }, { signal: controller.signal });
    controller.abort();
    target.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(0);
  });
});

describe('childToward', () => {
  const parents = new Map([['a', 'root'], ['b', 'a'], ['c', 'b'], ['x', 'root']]);
  const parentOf = (id: string) => parents.get(id);

  it('finds the child of an ancestor on the way back down', () => {
    expect(childToward('c', 'root', parentOf)).toBe('a');
    expect(childToward('c', 'a', parentOf)).toBe('b');
    expect(childToward('b', 'a', parentOf)).toBe('b');
  });

  it('is undefined unless the target is a proper ancestor', () => {
    expect(childToward('a', 'a', parentOf)).toBeUndefined();
    expect(childToward('a', 'c', parentOf)).toBeUndefined();
    expect(childToward('c', 'x', parentOf)).toBeUndefined();
    expect(childToward('root', 'a', parentOf)).toBeUndefined();
  });

  it('terminates on a cyclic parent map', () => {
    const cyclic = new Map([['a', 'b'], ['b', 'a']]);
    expect(childToward('a', 'root', (id) => cyclic.get(id))).toBeUndefined();
  });
});

describe('Viewer file links and the root board', () => {
  // happy-dom does no SVG layout: measure every link as empty, so no badge is attached.
  (globalThis.SVGElement.prototype as unknown as { getBBox?: () => DOMRect }).getBBox ??= () => new DOMRect();
  const shape = (id: string, link = '') => ({ id, link }) as unknown as Diagram['shapes'][number];
  const diagram = { name: '', shapes: [shape('home', './health.d2#/Sleep'), shape('gone', './gone.d2'), shape('down', 'root.layers.L')], connections: [],
    layers: [{ name: 'L', shapes: [shape('x')], connections: [] }] } as unknown as Diagram;
  const anchor = (id: string, href: string) => `<a href="${href}"><g class="${shapeClass(id)}"><rect/></g></a>`;
  const svgs: Record<string, string> = {
    '': `<svg xmlns="http://www.w3.org/2000/svg">${anchor('home', './health.d2#/Sleep')}${anchor('gone', './gone.d2')}${anchor('down', 'root.layers.L')}</svg>`,
    'layers.L': `<svg xmlns="http://www.w3.org/2000/svg"><g class="${shapeClass('x')}"><rect/></g></svg>`,
  };
  let viewer: Viewer | undefined;
  afterEach(() => { viewer?.destroy(); viewer = undefined; document.body.replaceChildren(); });

  async function mount(options: ViewerOptions) {
    const host = document.createElement('div');
    document.body.append(host);
    viewer = new Viewer(host, { history: false, ...options });
    await viewer.setDocument(diagram, async (target) => svgs[target]);
    const link = (id: string) => viewer!.stage.querySelector(`.${CSS.escape(shapeClass(id))}`)!.closest('a')!;
    const alert = () => host.querySelector('[role="alert"]')!.textContent;
    return { host, link, alert };
  }
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it('opens existing files, reports missing ones and labels both', async () => {
    const open = vi.fn();
    const { link, alert } = await mount({ files: { exists: (path) => path === './health.d2', open, label: (path) => path.slice(2, -3).toUpperCase() } });
    expect([link('home').getAttribute('data-file'), link('home').getAttribute('aria-label'), link('home').dataset.linkKind]).toEqual(['./health.d2#/Sleep', 'Opens HEALTH at Sleep', 'file']);
    expect([link('gone').hasAttribute('data-missing'), link('gone').getAttribute('aria-label')]).toEqual([true, 'Missing file: GONE']);
    link('home').querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledWith('./health.d2', '#/Sleep');
    link('gone').querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(alert()).toBe('Missing file: GONE');
  });

  it('asks for the folder when it cannot open other files', async () => {
    const { link, alert } = await mount({});
    expect(link('home').hasAttribute('data-missing')).toBe(true);
    link('home').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(alert()).toBe(openFolderMessage);
  });

  it('hands Escape and Backspace on the root board to onTopLevelBack, and goes up from other boards', async () => {
    let handled = true;
    const onTopLevelBack = vi.fn(() => handled);
    await mount({ onTopLevelBack });
    expect(press('Escape').defaultPrevented).toBe(true);
    handled = false;
    expect(press('Escape').defaultPrevented).toBe(false);
    // Backspace goes up, so with nowhere to go it is still consumed, rather than becoming WebKit's history Back.
    expect(press('Backspace').defaultPrevented).toBe(true);
    expect(onTopLevelBack).toHaveBeenCalledTimes(3);
    await viewer!.navigate('root.layers.L');
    expect(press('Escape').defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(viewer!.currentBoard?.id).toBe('root'));
    expect(onTopLevelBack).toHaveBeenCalledTimes(3);
  });

  it('records the document in history entries and hands entries of another document to it', async () => {
    let key = 'one';
    const restore = vi.fn((state: { zoomflowFile: string }) => state.zoomflowFile === 'two');
    await mount({ history: true, document: { key: () => key, restore } });
    await viewer!.navigate('root.layers.L');
    expect([history.state.zoomflowFile, location.hash]).toEqual(['one', '#/L']);
    history.replaceState({ ...history.state, zoomflowFile: 'two' }, '', '#/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ zoomflowFile: 'two' }));
    expect(viewer!.currentBoard?.id).toBe('root.layers.L');
    // An entry of this document, or one the owner declines, opens its board here.
    key = 'two';
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(restore).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(viewer!.currentBoard?.id).toBe('root'));
    expect(history.state.zoomflowFile).toBe('two');
  });

  it('drops boards a new document lacks from a trail a breadcrumb drawn before it passes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    viewer = new Viewer(host, { history: false });
    const layer = (name: string) => ({ name, shapes: [shape('x')], connections: [] });
    const board = (...names: string[]) => ({ name: '', shapes: [shape('x')], connections: [], layers: names.map(layer) }) as unknown as Diagram;
    const render = async () => svgs['layers.L'];
    await viewer.setDocument(board('A', 'C'), render);
    await viewer.navigate('root.layers.A');
    await viewer.navigate('root.layers.C');
    const crumbs = () => [...host.querySelectorAll('nav button')];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = viewer.setDocument(board('C'), async () => { await gate; return render(); });
    // The C crumb still passes the trail through A, which the new document removes.
    (crumbs()[2] as HTMLButtonElement).click();
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('');
    expect(crumbs().map((button) => button.textContent)).not.toContain('A');
  });
});
