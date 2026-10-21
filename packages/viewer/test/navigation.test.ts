import { describe, expect, it } from 'vitest';
import { childToward, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from '../src/navigation';

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
    let calls = 0;
    watchHistory(target, () => { calls++; });
    target.dispatchEvent(new Event('popstate'));
    target.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(1);
    target.dispatchEvent(new Event('hashchange'));
    expect(calls).toBe(2);
    target.dispatchEvent(new Event('popstate'));
    target.dispatchEvent(new Event('popstate'));
    expect(calls).toBe(4);
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
