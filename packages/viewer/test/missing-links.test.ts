// @vitest-environment happy-dom
import { type LintDiagnostic, shapeClass } from '@zoomflow/core';
import { describe, expect, it } from 'vitest';
import { restoreMissingLinks } from '../src/missing-links';

const svgNs = 'http://www.w3.org/2000/svg';

/** D2 tags each shape group with its HTML-escaped ID as URL-safe Base64; core's tests pin this to real renders. */
const d2Class = shapeClass;

function svg(markup: string) {
  const root = new DOMParser().parseFromString(`<svg xmlns="${svgNs}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, 'image/svg+xml').documentElement;
  document.body.replaceChildren(root);
  return root;
}

const shape = (id: string, body = '<rect/>') => `<g class="${d2Class(id)}">${body}</g>`;

function dangling(shapeId: string, target: string, extra: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return { rule: 'dangling-link', severity: 'error', board: 'root', shape: shapeId, target, message: `Missing ${target}`, ...extra } as LintDiagnostic;
}

const anchorOf = (root: Element, id: string) => {
  const group = [...root.querySelectorAll('g')].find((node) => node.classList.contains(d2Class(id)))!;
  return group.parentElement!;
};

describe('restoreMissingLinks', () => {
  it('wraps a shape whose link D2 dropped in an anchor marked as missing', () => {
    const root = svg(shape('Checkout') + shape('Receipt'));
    restoreMissingLinks(root, [dangling('Checkout', 'root.layers.checkout')]);
    const link = anchorOf(root, 'Checkout');
    expect(link.localName).toBe('a');
    expect(link.namespaceURI).toBe(svgNs);
    expect(link.getAttribute('href')).toBe('root.layers.checkout');
    expect(link.hasAttribute('data-missing')).toBe(true);
    expect(link.querySelector('rect')).not.toBeNull();
    // Shapes without a diagnostic stay as they were, in their original order.
    expect(anchorOf(root, 'Receipt')).toBe(root);
    expect([...root.children].map((node) => node.localName)).toEqual(['a', 'g']);
  });

  it('reuses an existing anchor and replaces its legacy xlink:href', () => {
    const root = svg(`<a xlink:href="old">${shape('Parent', shape('Child'))}</a>`);
    restoreMissingLinks(root, [dangling('Parent', 'root.layers.parent')]);
    expect(root.querySelectorAll('a')).toHaveLength(1);
    const link = root.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('root.layers.parent');
    expect(link.hasAttribute('xlink:href')).toBe(false);
    expect(link.hasAttribute('data-missing')).toBe(true);
  });

  it('finds shapes whose IDs encode to URL-safe characters or contain Unicode', () => {
    // "???" encodes to Base64 containing "/"; ">>>" is HTML-escaped first.
    const ids = ['>>>', '???', 'Café ☕', 'a.b'];
    const root = svg(ids.map((id) => shape(id)).join(''));
    restoreMissingLinks(root, ids.map((id, index) => dangling(id, `root.layers.l${index}`)));
    ids.forEach((id, index) => {
      const link = anchorOf(root, id);
      expect(link.localName).toBe('a');
      expect(link.getAttribute('href')).toBe(`root.layers.l${index}`);
    });
  });

  it('matches a whole class name rather than a prefix', () => {
    const root = svg(`<g class="${d2Class('Checkout')}extra">${'<rect/>'}</g>`);
    restoreMissingLinks(root, [dangling('Checkout', 'root.layers.checkout')]);
    expect(root.querySelector('a')).toBeNull();
  });

  it('ignores other rules, incomplete diagnostics and shapes that are not rendered', () => {
    const root = svg(shape('Checkout'));
    const before = root.outerHTML;
    restoreMissingLinks(root, [
      dangling('Checkout', 'root.layers.checkout', { rule: 'orphan-board' }),
      dangling('Checkout', 'root.layers.checkout', { target: undefined }),
      dangling('Checkout', 'root.layers.checkout', { shape: undefined }),
      dangling('Elsewhere', 'root.layers.elsewhere'),
    ]);
    expect(root.outerHTML).toBe(before);
  });

  it('can run again without nesting anchors', () => {
    const root = svg(shape('Checkout'));
    restoreMissingLinks(root, [dangling('Checkout', 'root.layers.first')]);
    restoreMissingLinks(root, [dangling('Checkout', 'root.layers.second')]);
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(anchorOf(root, 'Checkout').getAttribute('href')).toBe('root.layers.second');
  });
});
