import type { classifyHref } from '@zoomflow/core';

// Shared by the live viewer and the serialized offline runtime: keep each function
// self-contained (no calls to module-level helpers) and pass collaborators in.

export type ResolvedLink = { kind: 'external' } | { kind: 'invalid' } | { kind: 'missing' | 'board'; target: string };

/** Classify a diagram href against the boards that exist. */
export function resolveLink(href: string, exists: (id: string) => boolean, classify: typeof classifyHref): ResolvedLink {
  const action = classify(href);
  if (action.kind === 'external' || action.kind === 'invalid') return { kind: action.kind };
  return { kind: exists(action.target) ? 'board' : 'missing', target: action.target };
}

/** Make links keyboard reachable, open external links safely and mark missing boards. */
export function prepareLinks(svg: Element, resolve: (href: string) => ResolvedLink) {
  for (const link of [...svg.querySelectorAll('a')]) {
    const action = resolve(link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '');
    // An unusable link is not a control: keep its shape, drop the anchor.
    if (action.kind === 'invalid') { link.replaceWith(...link.childNodes); continue; }
    link.setAttribute('tabindex', '0');
    link.setAttribute('role', 'link');
    if (action.kind === 'external') {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    } else if (action.kind === 'missing') link.setAttribute('data-missing', '');
  }
}

/** Resolve a click or Enter on a diagram link. Leaves external links to the browser;
 * prevents the default for every other link. Undefined when the event missed a link. */
export function followLink(event: Event, resolve: (href: string) => ResolvedLink): ResolvedLink | undefined {
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link) return undefined;
  const action = resolve(link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '');
  if (action.kind !== 'external') event.preventDefault();
  return action;
}

/** The first link in `root` that targets `target`. */
export function linkTo(root: ParentNode, target: string): SVGAElement | undefined {
  return [...root.querySelectorAll<SVGAElement>('a')]
    .find((link) => (link.getAttribute('href') ?? link.getAttribute('xlink:href')) === target);
}
