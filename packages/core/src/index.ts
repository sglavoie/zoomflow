import type { Diagram } from '@d2lang/d2';
export type { Diagram, CompileResponse, RenderOptions } from '@d2lang/d2';

export interface Board {
  id: string;
  name: string;
  target: string;
  hash: string;
  parent?: string;
  kind: 'root' | 'layers' | 'scenarios' | 'steps';
  diagram: Diagram;
}

/** Enumerate the board tree, never the potentially cyclic graph of links. */
export function indexBoards(diagram: Diagram): Map<string, Board> {
  const boards = new Map<string, Board>();
  function visit(node: Diagram, id: string, target: string, hash: string,
    kind: Board['kind'], parent?: string) {
    boards.set(id, { id, name: node.name || 'Root', target, hash, kind, parent, diagram: node });
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of node[group] ?? []) {
        if (!child) continue;
        const segment = `${group}.${child.name}`;
        const route = group === 'layers' ? '' : `@${group}/`;
        visit(child, `${id}.${segment}`, target ? `${target}.${segment}` : segment,
          `${hash === '#/' ? '#' : hash}/${route}${encodeURIComponent(child.name)}`, group, id);
      }
    }
  }
  visit(diagram, 'root', '', '#/', 'root');
  return boards;
}

export type ClassifiedHref =
  | { kind: 'drill' | 'switch' | 'up'; target: string }
  | { kind: 'external'; url: string }
  | { kind: 'invalid'; href: string };

/** D2 emits absolute board IDs; ancestor links include `_` after compilation. */
export function classifyHref(href: string, current = 'root'): ClassifiedHref {
  if (href === 'root' || /^root\.(layers|scenarios|steps)\..+/.test(href)) {
    const kind = current !== href && current.startsWith(`${href}.`) ? 'up'
      : /\.(scenarios|steps)\./.test(href) ? 'switch' : 'drill';
    return { kind, target: href };
  }
  try {
    const url = new URL(href);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return { kind: 'external', url: href };
  } catch { /* Relative and executable URLs are not navigation targets. */ }
  return { kind: 'invalid', href };
}
