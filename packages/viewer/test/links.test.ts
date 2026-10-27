// @vitest-environment happy-dom
import { classifyHref } from '@zoomflow/core';
import { describe, expect, it } from 'vitest';
import { followLink, linkTo, prepareLinks, resolveLink } from '../src/links';

const svgNs = 'http://www.w3.org/2000/svg';
const boards = new Set(['root', 'root.layers.checkout']);
const exists = (id: string) => boards.has(id);

function svg(markup: string) {
  return new DOMParser().parseFromString(`<svg xmlns="${svgNs}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, 'image/svg+xml').documentElement;
}

/** Evaluate a function's source with no surrounding module scope, as the offline HTML does. */
function isolated<T>(fn: T): T {
  return new Function(`return (${String(fn)})`)() as T;
}

describe('resolveLink', () => {
  it('classifies board, missing, external and invalid links', () => {
    for (const resolve of [resolveLink, isolated(resolveLink)]) {
      expect(resolve('root.layers.checkout', exists, classifyHref)).toEqual({ kind: 'board', target: 'root.layers.checkout' });
      expect(resolve('root.layers.gone', exists, classifyHref)).toEqual({ kind: 'missing', target: 'root.layers.gone' });
      expect(resolve('https://example.com', exists, classifyHref)).toEqual({ kind: 'external' });
      expect(resolve('mailto:a@b.c', exists, classifyHref)).toEqual({ kind: 'external' });
      expect(resolve('javascript:alert(1)', exists, classifyHref)).toEqual({ kind: 'invalid' });
      expect(resolve('checkout', exists, classifyHref)).toEqual({ kind: 'invalid' });
    }
  });

  it('resolves file links against the files that exist, and treats every one as missing without them', () => {
    const files = (path: string) => path === './health.d2';
    for (const resolve of [resolveLink, isolated(resolveLink)]) {
      // The serialized classifier must agree with the module one.
      for (const classify of [classifyHref, isolated(classifyHref)]) {
        expect(resolve('./health.d2#/Sleep', exists, classify, files)).toEqual({ kind: 'file', path: './health.d2', hash: '#/Sleep' });
        expect(resolve('./health.d2', exists, classify, files)).toEqual({ kind: 'file', path: './health.d2', hash: '' });
        expect(resolve('../other.d2', exists, classify, files)).toEqual({ kind: 'missing-file', path: '../other.d2' });
        expect(resolve('./health.d2', exists, classify)).toEqual({ kind: 'missing-file', path: './health.d2' });
        expect(resolve('health.d2', exists, classify, files)).toEqual({ kind: 'invalid' });
      }
    }
  });
});

describe('prepareLinks', () => {
  it('makes links focusable, opens external ones safely, marks missing boards and unwraps invalid ones', () => {
    const root = svg('<a id="board" href="root.layers.checkout"><rect/></a><a id="missing" xlink:href="root.layers.gone"/>' +
      '<a id="external" href="https://example.com"/><a id="invalid" href="checkout"><rect id="kept"/></a>');
    isolated(prepareLinks)(root, (href) => resolveLink(href, exists, classifyHref));
    const board = root.querySelector('#board')!;
    expect([board.getAttribute('tabindex'), board.getAttribute('role'), board.hasAttribute('data-missing')]).toEqual(['0', 'link', false]);
    expect(root.querySelector('#missing')!.hasAttribute('data-missing')).toBe(true);
    const external = root.querySelector('#external')!;
    expect([external.getAttribute('target'), external.getAttribute('rel')]).toEqual(['_blank', 'noopener noreferrer']);
    expect(root.querySelector('#invalid')).toBeNull();
    expect(root.querySelector('#kept')!.parentElement).toBe(root);
  });

  it('points board links at their routes, so a new tab or a copied address opens the board', () => {
    const root = svg('<a id="board" xlink:href="root.layers.checkout"/><a id="missing" href="root.layers.gone"/><a id="external" href="https://example.com"/>');
    isolated(prepareLinks)(root, (href) => resolveLink(href, exists, classifyHref), (id) => id === 'root.layers.checkout' ? '#/checkout' : undefined);
    const board = root.querySelector('#board')!;
    expect([board.getAttribute('href'), board.hasAttribute('xlink:href'), board.getAttribute('data-board')]).toEqual(['#/checkout', false, 'root.layers.checkout']);
    const missing = root.querySelector('#missing')!;
    expect([missing.getAttribute('href'), missing.getAttribute('data-board')]).toEqual(['root.layers.gone', 'root.layers.gone']);
    expect(root.querySelector('#external')!.hasAttribute('data-board')).toBe(false);
    // Following and finding the link still use its board.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'target', { value: board });
    expect(isolated(followLink)(click, (href) => resolveLink(href, exists, classifyHref))).toEqual({ kind: 'board', target: 'root.layers.checkout' });
    expect(isolated(linkTo)(root, 'root.layers.checkout')).toBe(board);
  });
});

describe('prepareLinks with file links', () => {
  const resolve = (href: string) => resolveLink(href, exists, classifyHref, (path) => path === './health.d2');

  it('marks file links, flags missing files and points href at a copyable address', () => {
    const root = svg('<a id="file" xlink:href="./health.d2#/Sleep"/><a id="missing" href="./gone.d2"/><a id="bare" href="./health.d2"/>');
    isolated(prepareLinks)(root, resolve, () => undefined, (path, hash) => path === './health.d2' && hash ? `#/@file/health.d2${hash.slice(1)}` : undefined);
    const file = root.querySelector('#file')!;
    expect([file.getAttribute('data-file'), file.getAttribute('href'), file.hasAttribute('xlink:href'), file.hasAttribute('data-missing'), file.getAttribute('role')])
      .toEqual(['./health.d2#/Sleep', '#/@file/health.d2/Sleep', false, false, 'link']);
    const missing = root.querySelector('#missing')!;
    expect([missing.getAttribute('data-file'), missing.getAttribute('href'), missing.hasAttribute('data-missing')]).toEqual(['./gone.d2', './gone.d2', true]);
    // Without an address for it, a file link keeps its authored href.
    expect(root.querySelector('#bare')!.getAttribute('href')).toBe('./health.d2');
    expect(root.querySelector('#bare')!.hasAttribute('data-board')).toBe(false);
  });

  it('follows a file link from its authored href and prevents the default', () => {
    const root = svg('<a href="./health.d2#/Sleep"><rect id="a"/></a><a href="./gone.d2"><rect id="b"/></a>');
    isolated(prepareLinks)(root, resolve, () => undefined, () => '#/elsewhere');
    for (const [id, expected] of [['a', { kind: 'file', path: './health.d2', hash: '#/Sleep' }], ['b', { kind: 'missing-file', path: './gone.d2' }]] as const) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: root.querySelector(`#${id}`) });
      expect(isolated(followLink)(event, resolve)).toEqual(expected);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});

describe('followLink', () => {
  const resolve = (href: string) => resolveLink(href, exists, classifyHref);
  function click(target: Element) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  }

  it('resolves the closest link and prevents navigation for internal links only', () => {
    const root = svg('<a href="root.layers.checkout"><rect id="a"/></a><a href="https://example.com"><rect id="b"/></a>' +
      '<a href="root.layers.gone"><rect id="c"/></a><rect id="d"/>');
    const board = click(root.querySelector('#a')!);
    expect(isolated(followLink)(board, resolve)).toEqual({ kind: 'board', target: 'root.layers.checkout' });
    expect(board.defaultPrevented).toBe(true);
    const external = click(root.querySelector('#b')!);
    expect(followLink(external, resolve)).toEqual({ kind: 'external' });
    expect(external.defaultPrevented).toBe(false);
    const missing = click(root.querySelector('#c')!);
    expect(followLink(missing, resolve)).toEqual({ kind: 'missing', target: 'root.layers.gone' });
    expect(missing.defaultPrevented).toBe(true);
    const none = click(root.querySelector('#d')!);
    expect(followLink(none, resolve)).toBeUndefined();
    expect(none.defaultPrevented).toBe(false);
  });
});

describe('linkTo', () => {
  it('finds the first link to a board by href or xlink:href', () => {
    const root = svg('<a id="x" xlink:href="root.layers.checkout"/><a id="y" href="root.layers.checkout"/><a id="z" href="root"/>');
    expect(isolated(linkTo)(root, 'root.layers.checkout')?.id).toBe('x');
    expect(linkTo(root, 'root')?.id).toBe('z');
    expect(linkTo(root, 'root.layers.gone')).toBeUndefined();
  });
});
