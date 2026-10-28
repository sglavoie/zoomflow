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

/** Spell a route the way board hashes are built, as browsers leave `&`, `[` or a lone `%` raw in an address and
 * authors may write `#/My Board`, so `#/Q&A` finds `#/Q%26A` and `#/50%` finds `#/50%25`. Only the reserved `@file`,
 * `@scenarios` and `@steps` stay raw: a board named `@home` is `#/%40home`. Empty segments, which no board has, are
 * dropped, so `#/A/` finds `#/A` and `#/A//B` finds `#/A/B`. */
export function normalizeRouteHash(hash: string): string {
  const route = (hash || '#/').split('/').filter((segment, index) => index === 0 || segment).map((segment, index) => {
    if (index === 0 || /^@(?:file|scenarios|steps)$/.test(segment)) return segment;
    try { return encodeURIComponent(decodeURIComponent(segment.replace(/%(?![\da-f]{2})/gi, '%25'))); } catch { return segment; }
  }).join('/');
  return route && route !== '#' ? route : '#/';
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
