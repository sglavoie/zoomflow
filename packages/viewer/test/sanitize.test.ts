// @vitest-environment happy-dom
import { boardLabel, classifyHref, indexBoards, shapeClass, type Diagram } from '@zoomflow/core';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/sanitize';
import { offlineViewerScript } from '../src/export';

const svgNs = 'http://www.w3.org/2000/svg';

function svg(markup: string) {
  return new DOMParser().parseFromString(`<svg xmlns="${svgNs}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, 'image/svg+xml').documentElement;
}

/** Evaluate a function's source with no surrounding module scope, as the offline HTML does. */
function isolated<T>(fn: T): T {
  return new Function(`return (${String(fn)})`)() as T;
}

describe('sanitizeSvg', () => {
  it('removes scripts, foreign HTML and SMIL animation', () => {
    const root = svg('<script>alert(1)</script><foreignObject><div/></foreignObject><a href="https://example.com"><set attributeName="href" to="javascript:alert(1)"/>' +
      '<animate attributeName="href" values="javascript:alert(1)"/><animateMotion/><animateTransform attributeName="transform"/><rect/></a>');
    sanitizeSvg(root);
    expect(root.querySelectorAll('*').length).toBe(2);
    expect(root.querySelector('a rect')).not.toBeNull();
  });

  it('removes event handlers and script URLs, including ones hidden by whitespace or control characters', () => {
    const root = svg('<rect onclick="alert(1)" onLoad="alert(1)"/>' +
      '<a id="tab" href="java\tscript:alert(1)"/><a id="nul" href="\u0001 javascript:alert(1)"/><a id="vb" xlink:href="VBScript:x"/>' +
      '<a id="data" href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"/><a id="ok" href="https://example.com/a b"/>');
    sanitizeSvg(root);
    expect(root.querySelector('rect')!.attributes.length).toBe(0);
    for (const id of ['tab', 'nul', 'vb', 'data']) {
      const link = root.querySelector(`#${id}`)!;
      expect(link.hasAttribute('href') || link.hasAttribute('xlink:href')).toBe(false);
    }
    expect(root.querySelector('#ok')!.getAttribute('href')).toBe('https://example.com/a b');
  });

  it('keeps embedded and remote images', () => {
    const root = svg('<image id="a" href="data:image/png;base64,AAAA"/><image id="b" xlink:href="https://example.com/icon.svg"/>');
    sanitizeSvg(root);
    expect(root.querySelector('#a')!.getAttribute('href')).toBe('data:image/png;base64,AAAA');
    expect(root.querySelector('#b')!.getAttribute('xlink:href')).toBe('https://example.com/icon.svg');
  });

  it('works without its module scope', () => {
    const root = svg('<a href=" javascript:alert(1)"/><set/>');
    isolated(sanitizeSvg)(root);
    expect(root.innerHTML).toBe('<a></a>');
  });
});

describe('offline viewer runtime', () => {
  it('serializes the core shape-class encoding, including quoted and escaped IDs', () => {
    for (const id of ['a', 'Checkout', 'a.b', '"a.b"', "it's", 'x<y>&z', 'naïve 日本', 'a."b c".d']) {
      expect(isolated(shapeClass)(id)).toBe(shapeClass(id));
    }
  });

  it('serializes self-contained link classification and board labels', () => {
    const classify = isolated(classifyHref);
    for (const href of ['root', 'root.layers."a.b"', 'root.scenarios.x', 'https://example.com', 'mailto:a@b.c', 'javascript:alert(1)', 'checkout', ''])
      expect(classify(href)).toEqual(classifyHref(href));
    const boards = indexBoards({ name: '', shapes: [], layers: [{ name: 'Checkout', shapes: [] }] } as unknown as Diagram);
    expect(isolated(boardLabel)('root.layers.Checkout.layers.missing', boards)).toBe('Root > Checkout > missing');
  });

  it('produces a script that parses', () => {
    expect(() => new Function(offlineViewerScript())).not.toThrow();
  });
});
