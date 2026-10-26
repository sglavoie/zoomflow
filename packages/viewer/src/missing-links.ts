import { shapeClass, type LintDiagnostic } from '@zoomflow/core';

/** Restore shape anchors removed by D2. Keep self-contained for offline HTML, which
 * passes its own serialized `classOf`: the default is never evaluated there. */
export function restoreMissingLinks(svg: Element, diagnostics: readonly LintDiagnostic[], classOf: (id: string) => string = shapeClass) {
  // The first group in document order carrying each class, indexed once when needed.
  let groups: Map<string, Element> | undefined;
  for (const item of diagnostics) {
    if (item.rule !== 'dangling-link' || !item.shape || !item.target) continue;
    if (!groups) {
      groups = new Map();
      for (const node of svg.querySelectorAll('g')) for (const name of node.classList) if (!groups.has(name)) groups.set(name, node);
    }
    const group = groups.get(classOf(item.shape));
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
