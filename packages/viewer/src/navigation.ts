import type { ParentContext } from '@zoomflow/core';
export { normalizeRouteHash, resolveRouteHash } from '@zoomflow/core';

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

/** Call `restore` once per history step: traversals fire popstate then, only when the hash
 * changes, hashchange; editing the hash in the address bar fires hashchange alone. */
export function watchHistory(target: EventTarget, restore: () => void, options?: AddEventListenerOptions) {
  // The hash a popstate just restored; its own hashchange, if any, comes next. A step between entries with the
  // same hash has none, so forget it soon after: an address-bar edit to that hash later must still restore.
  let restored: string | undefined;
  let forget: ReturnType<typeof setTimeout> | undefined;
  target.addEventListener('popstate', () => {
    restored = location.hash;
    clearTimeout(forget);
    forget = setTimeout(() => { restored = undefined; }, 100);
    restore();
  }, options);
  target.addEventListener('hashchange', (event) => {
    // Compare the hash this step went to: restoring may already have replaced an unknown one.
    const { newURL } = event as HashChangeEvent;
    if ((newURL ? new URL(newURL).hash : location.hash) !== restored) restore();
    restored = undefined;
  }, options);
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
