/** Spell a route the way board hashes are built, as browsers leave `&`, `[` or a lone `%` raw in an address and
 * authors may write `#/My Board`, so `#/Q&A` finds `#/Q%26A` and `#/50%` finds `#/50%25`. Only the reserved `@file`,
 * `@scenarios` and `@steps` stay raw: a board named `@home` is `#/%40home`. Empty segments, which no board has, are
 * dropped, so `#/A/` finds `#/A` and `#/A//B` finds `#/A/B`. Self-contained for the offline runtime. */
export function normalizeRouteHash(hash: string): string {
  const route = (hash || '#/').split('/').filter((segment, index) => index === 0 || segment).map((segment, index) => {
    if (index === 0 || /^@(?:file|scenarios|steps)$/.test(segment)) return segment;
    try { return encodeURIComponent(decodeURIComponent(segment.replace(/%(?![\da-f]{2})/gi, '%25'))); } catch { return segment; }
  }).join('/');
  return route && route !== '#' ? route : '#/';
}

/** Resolve a route to the nearest existing board hash, walking up its path. Self-contained for the offline runtime. */
export function resolveRouteHash(hash: string, exists: (hash: string) => boolean): string {
  let current = hash || '#/';
  while (!exists(current) && current !== '#/') {
    current = current.slice(0, current.lastIndexOf('/')) || '#/';
    if (current === '#') current = '#/';
  }
  return current;
}
