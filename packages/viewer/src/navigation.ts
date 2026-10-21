import type { ParentContext } from '@zoomflow/core';

/** Shared with the standalone HTML runtime; render authored labels as plain text. */
export function renderParentContext(element: HTMLElement, contexts: readonly ParentContext[]) {
  element.replaceChildren();
  element.hidden = contexts.length === 0;
  for (const context of contexts) {
    const row = document.createElement('div');
    row.textContent = [context.label,
      context.incoming.length ? `From ${context.incoming.join(', ')}` : '',
      context.outgoing.length ? `To ${context.outgoing.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    element.append(row);
  }
}

/** Keep the visited path, removing each loop when it returns to an earlier board. */
export function simplifyTrail(visits: readonly string[]): string[] {
  const trail: string[] = [];
  for (const id of visits) {
    const previous = trail.indexOf(id);
    if (previous === -1) trail.push(id);
    else trail.length = previous + 1;
  }
  return trail;
}

/** Resolve a route to the nearest existing board hash, walking up its path. */
export function resolveRouteHash(hash: string, exists: (hash: string) => boolean): string {
  let current = hash || '#/';
  while (!exists(current) && current !== '#/') {
    current = current.slice(0, current.lastIndexOf('/')) || '#/';
    if (current === '#') current = '#/';
  }
  return current;
}

/** Describe a deep link that fell back to an ancestor board; empty when it resolved exactly. */
export function routeFallbackNotice(requested: string, resolved: string, name: string): string {
  if ((requested || '#/') === resolved) return '';
  let path = requested.replace(/^#\/?/, '');
  try { path = decodeURIComponent(path); } catch { /* Keep the raw path. */ }
  return `Board "${path}" not found; showing ${name}`;
}

/** Reuse a saved visit trail when it still ends at `board` and names only existing boards;
 * otherwise fall back to the board's ancestors. */
export function restoreTrail(saved: unknown, board: string, exists: (id: string) => boolean,
  ancestors: () => string[]): string[] {
  return Array.isArray(saved) && saved.length > 0 && saved.at(-1) === board &&
    saved.every((id) => typeof id === 'string' && exists(id)) ? saved as string[] : ancestors();
}

/** Call `restore` once per history step: traversals fire popstate then hashchange,
 * while editing the hash in the address bar fires hashchange alone. */
export function watchHistory(target: EventTarget, restore: () => void, options?: AddEventListenerOptions) {
  let popped = false;
  target.addEventListener('popstate', () => { popped = true; restore(); }, options);
  target.addEventListener('hashchange', () => { if (!popped) restore(); popped = false; }, options);
}

/** When `ancestor` is a proper ancestor of `descendant`, the child of `ancestor` on the way back down. */
export function childToward(descendant: string, ancestor: string, parentOf: (id: string) => string | undefined): string | undefined {
  const seen = new Set<string>();
  for (let id: string | undefined = descendant; id && !seen.has(id); id = parentOf(id)) {
    if (parentOf(id) === ancestor) return id;
    seen.add(id);
  }
  return undefined;
}
