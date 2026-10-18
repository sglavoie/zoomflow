import type { LintDiagnostic } from '@zoomflow/core';

/** Restore shape anchors removed by D2. Keep self-contained for offline HTML. */
export function restoreMissingLinks(svg: Element, diagnostics: readonly LintDiagnostic[]) {
  for (const item of diagnostics) {
    if (item.rule !== 'dangling-link' || !item.shape || !item.target) continue;
    const encoded = btoa(Array.from(new TextEncoder().encode(item.shape), (byte) => String.fromCharCode(byte)).join(''))
      .replace(/\+/g, '-').replace(/\//g, '_');
    const group = [...svg.querySelectorAll('g')].find((node) => node.classList.contains(encoded));
    if (!group) continue;
    // A linked container can surround an independently linked child shape.
    let link: Element | undefined = group.parentElement?.localName === 'a' ? group.parentElement : undefined;
    if (!link) {
      link = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'a');
      group.replaceWith(link);
      link.append(group);
    }
    link.setAttribute('href', item.target);
    link.removeAttribute('xlink:href');
    link.setAttribute('data-missing', '');
  }
}
