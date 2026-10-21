import { describe, expect, it } from 'vitest';
import { resolveRouteHash, routeFallbackNotice, simplifyTrail } from '../src/navigation';

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
