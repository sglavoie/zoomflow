import type { classifyHref } from '@zoomflow/core';

// Shared by the live viewer and the serialized offline runtime: keep each function
// self-contained (no calls to module-level helpers) and pass collaborators in.

export type ResolvedLink = { kind: 'external' } | { kind: 'invalid' } | { kind: 'missing' | 'board'; target: string };

/** Classify a diagram href against the boards that exist. */
export function resolveLink(href: string, exists: (id: string) => boolean, classify: typeof classifyHref): ResolvedLink {
  const action = classify(href);
  if (action.kind === 'external' || action.kind === 'invalid') return { kind: action.kind };
  // Links to other diagram files are not followed yet.
  if (action.kind === 'file') return { kind: 'invalid' };
  return { kind: exists(action.target) ? 'board' : 'missing', target: action.target };
}

/** Make links keyboard reachable, open external links safely and mark missing boards.
 * A board link keeps its board in `data-board` and points `href` at the board's route, given by `hashOf`,
 * so opening it in a new tab or copying its address leads somewhere. */
export function prepareLinks(svg: Element, resolve: (href: string) => ResolvedLink, hashOf: (id: string) => string | undefined = () => undefined) {
  for (const link of [...svg.querySelectorAll('a')]) {
    const action = resolve(link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '');
    // An unusable link is not a control: keep its shape, drop the anchor.
    if (action.kind === 'invalid') { link.replaceWith(...link.childNodes); continue; }
    link.setAttribute('tabindex', '0');
    link.setAttribute('role', 'link');
    if (action.kind === 'external') {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      continue;
    }
    if (action.kind === 'missing') link.setAttribute('data-missing', '');
    link.setAttribute('data-board', action.target);
    const hash = action.kind === 'board' ? hashOf(action.target) : undefined;
    if (hash) { link.setAttribute('href', hash); link.removeAttribute('xlink:href'); }
  }
}

/** Resolve a click or Enter on a diagram link. Leaves external links to the browser;
 * prevents the default for every other link. Undefined when the event missed a link. */
export function followLink(event: Event, resolve: (href: string) => ResolvedLink): ResolvedLink | undefined {
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link) return undefined;
  const action = resolve(link.getAttribute('data-board') ?? link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '');
  if (action.kind !== 'external') event.preventDefault();
  return action;
}

/** The first link in `root` that targets `target`. */
export function linkTo(root: ParentNode, target: string): SVGAElement | undefined {
  return [...root.querySelectorAll<SVGAElement>('a')]
    .find((link) => (link.getAttribute('data-board') ?? link.getAttribute('href') ?? link.getAttribute('xlink:href')) === target);
}
