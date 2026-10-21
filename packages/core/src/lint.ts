import type { CompileResponse } from '@d2lang/d2';
import { boardKey, classifyHref, indexBoards, type Board } from './index';
import { boundaryNeighbours } from './context';
import { shapeRanges } from './source';

export type LintRule = 'boundary-in' | 'boundary-out' | 'orphan-board' | 'dangling-link' | 'missing-backlink';
export interface LintDiagnostic {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  board: string;
  shape?: string;
  /** Resolved missing board ID for dangling-link diagnostics. */
  target?: string;
  /** Original D2 range, possibly in an imported file. Never assume it is index. */
  range?: string;
}
export interface LintOptions {
  missingBacklink?: boolean;
  /** Validate zf-in/zf-out contracts where a child layer declares ports. */
  boundaryPorts?: boolean;
}
export interface BoundaryEvaluation {
  board: string;
  shape: string;
  child: string;
  /** Distinct directed neighbour requirements, independent of labels/parallel edges. */
  expected: number;
  /** Requirements for which at least one correctly named classed port exists. */
  evaluated: number;
}
export interface LintResult {
  diagnostics: LintDiagnostic[];
  boundaryPairsEvaluated: number;
  boundaries: BoundaryEvaluation[];
}

// Only the compiler AST fields needed to recover links D2 removes from shapes.
interface AstString { range?: string; value?: string | { string?: string }[] }
interface AstValue {
  unquoted_string?: AstString;
  double_quoted_string?: AstString;
  single_quoted_string?: AstString;
  map?: AstMap;
}
interface AstMap { nodes?: { map_key?: {
  range?: string;
  key?: { path?: AstValue[] };
  edges?: unknown[];
  primary?: AstValue;
  value?: AstValue;
} }[] }
interface LintGraph {
  name?: string;
  ast?: AstMap;
  layers?: LintGraph[];
  scenarios?: LintGraph[];
  steps?: LintGraph[];
}
function stringValue(value?: AstValue): string | undefined {
  const scalar = value?.unquoted_string ?? value?.double_quoted_string ?? value?.single_quoted_string;
  return typeof scalar?.value === 'string' ? scalar.value
    : scalar?.value?.map((part) => part.string ?? '').join('');
}
function scalarRange(value?: AstValue): string | undefined {
  return (value?.unquoted_string ?? value?.double_quoted_string ?? value?.single_quoted_string)?.range;
}
function keySegment(value: AstValue): string {
  const text = stringValue(value) ?? '';
  // Preserve quoted literal dots so they cannot alias a container path.
  return value.unquoted_string ? text : JSON.stringify(text);
}
/** Re-quote an authored board path the way D2 quotes compiled links (`layers."a b"` is `layers.a b`). */
function canonicalLink(href: string): string {
  const segments: string[] = [];
  const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^."']*[^."'\s]|))\s*(\.|$)/y;
  for (let match = pattern.exec(href); match; match = pattern.exec(href)) {
    segments.push(match[1]?.replace(/\\(.)/g, '$1') ?? match[2] ?? match[3]);
    if (match[4]) continue;
    // URLs and other non-board text keep their authored form.
    if (pattern.lastIndex !== href.length || !['_', 'root', 'layers', 'scenarios', 'steps'].includes(segments[0])) break;
    return segments.map(boardKey).join('.');
  }
  return href;
}
function boardTarget(href: string, board: Board, boards: Map<string, Board>): string | undefined {
  const classified = classifyHref(href);
  if ('target' in classified) return classified.target;
  if (classified.kind === 'external') return;
  let base = board;
  let path = href;
  while (path === '_' || path.startsWith('_.')) {
    if (!base.parent) return;
    base = boards.get(base.parent)!;
    path = path === '_' ? '' : path.slice(2);
  }
  return path === '' ? base.id : /^(layers|scenarios|steps)\./.test(path) ? `${base.id}.${path}` : undefined;
}

/** Name a board, or a missing board below an existing one, by its breadcrumb trail. */
export function boardLabel(id: string, boards: Map<string, Board>): string {
  let board = boards.get(id), rest = '';
  if (!board) {
    const ancestor = [...boards.keys()].filter((key) => id.startsWith(`${key}.`)).sort((a, b) => b.length - a.length)[0];
    if (!ancestor) return id;
    board = boards.get(ancestor);
    rest = id.slice(ancestor.length + 1);
  }
  const names = rest.split(/(?:^|\.)(?:layers|scenarios|steps)\./).filter(Boolean);
  for (let item = board; item; item = item.parent ? boards.get(item.parent) : undefined) names.unshift(item.name);
  return names.join(' > ');
}

/** Lint a compiled document without following its cyclic navigation graph.
 * Shape identifiers, not display labels, are the boundary-port naming contract.
 */
export function lint(compiled: Pick<CompileResponse, 'diagram' | 'graph'>, options: LintOptions = {}): LintResult {
  const boards = indexBoards(compiled.diagram);
  const diagnostics: LintDiagnostic[] = [];
  const boundaries: BoundaryEvaluation[] = [];
  const links = new Map<string, Set<string>>();
  const linkKeys = new Set<string>();
  const boardRanges = new Map<string, string>();
  const label = (id: string) => boardLabel(id, boards);
  let ranges: Map<string, string> | undefined;
  const shapeRange = (board: string, shape: string) =>
    (ranges ??= shapeRanges(compiled.diagram, compiled.graph)).get(JSON.stringify([board, shape]));
  function checkLink(href: string, board: Board, shape?: string, range?: string) {
    const target = boardTarget(href, board, boards);
    if (!target) return;
    if (boards.has(target)) {
      if (!links.has(board.id)) links.set(board.id, new Set());
      links.get(board.id)!.add(target);
      return;
    }
    const key = JSON.stringify([board.id, shape, target]);
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    // Compiler-expanded child ASTs carry placeholder ranges without a file.
    if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
    let hint = '';
    const childPath = target.startsWith(`${board.id}.`) ? target.slice(board.id.length + 1) : '';
    // Suggest an ancestor only for a missing immediate child with the same name/kind.
    // Leave resolution unchanged, including when a child and ancestor share a name.
    for (let ancestor = board.parent && boards.get(board.parent), up = '_'; ancestor;
      ancestor = ancestor.parent && boards.get(ancestor.parent), up += '._') {
      if (childPath === `${ancestor.kind}.${boardKey(ancestor.name)}`) {
        hint = ` Did you mean the ${up === '_' ? 'parent' : 'ancestor'} board "${ancestor.name}"? Use link: ${up}.`;
        break;
      }
    }
    diagnostics.push({ rule: 'dangling-link', severity: 'error', board: board.id, shape, range, target,
      message: `Link targets missing board "${label(target)}".${hint}` });
  }

  for (const board of boards.values()) {
    for (const shape of board.diagram.shapes) checkLink(shape.link, board, shape.id);
    for (const connection of board.diagram.connections) checkLink(connection.link, board);
    checkLink(board.diagram.root.link, board);
  }

  // Root AST retains authored links; child ASTs contain expanded, resolved links.
  // Keep the last explicit assignment per shape (D2 permits property overrides).
  function visitGraph(graph: LintGraph, id: string) {
    const found = boards.get(id);
    if (!found) return;
    const board: Board = found;
    const authored = new Map<string, { href: string; range?: string }>();
    function visitMap(map: AstMap | undefined, scope: string[] = []) {
      for (const node of map?.nodes ?? []) {
        const entry = node.map_key;
        if (!entry) continue;
        const path = entry.key?.path ?? [];
        const names = path.map((part) => stringValue(part) ?? '');
        if (['classes', 'vars', 'style', 'source-arrowhead', 'target-arrowhead'].includes(names[0])) continue;
        if (['layers', 'scenarios', 'steps'].includes(names[0])) {
          for (const child of entry.value?.map?.nodes ?? []) {
            const key = child.map_key;
            const name = stringValue(key?.key?.path?.[0]);
            const range = scalarRange(key?.key?.path?.[0]);
            if (name && range) boardRanges.set(`${id}.${names[0]}.${boardKey(name)}`, range);
          }
          continue; // Each child has its own compiler-expanded graph AST.
        }
        const fullPath = [...scope, ...path.map(keySegment)];
        if (names.at(-1) === 'link') {
          const owner = fullPath.slice(0, -1).join('.');
          const value = stringValue(entry.value) !== undefined ? entry.value : entry.primary;
          authored.set(owner, { href: stringValue(value) ?? '', range: scalarRange(value) ?? entry.range });
        } else if (entry.edges?.length) {
          // Connection links do not establish boundary ownership.
          for (const item of entry.value?.map?.nodes ?? []) {
            const key = item.map_key;
            if (stringValue(key?.key?.path?.[0]) === 'link') {
              const value = stringValue(key?.value) !== undefined ? key?.value : key?.primary;
              checkLink(canonicalLink(stringValue(value) ?? ''), board, undefined, scalarRange(value));
            }
          }
        } else visitMap(entry.value?.map, fullPath);
      }
    }
    visitMap(graph.ast);
    for (const [shape, link] of authored) {
      // Only recover links D2 dropped; a kept link was already checked in its compiled form.
      // Skip templates and removed objects; a board-level link has no shape.
      const compiled = shape ? board.diagram.shapes.find((item) => item.id === shape) : board.diagram.root;
      if (compiled && !compiled.link) checkLink(canonicalLink(link.href), board, shape || undefined, link.range);
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of graph[group] ?? []) visitGraph(child, `${id}.${group}.${boardKey(child.name ?? '')}`);
    }
  }
  visitGraph(compiled.graph as LintGraph, 'root');

  // Layers are reachable only by following links from root; like D2's own viewer,
  // a reachable board's scenarios and steps are reachable without a link.
  const reachable = new Set(['root']);
  for (const id of reachable) {
    const next = [...links.get(id) ?? []];
    for (const board of boards.values()) if (board.parent === id && board.kind !== 'layers') next.push(board.id);
    for (const target of next) reachable.add(target);
  }
  const linked = new Set([...links].flatMap(([source, targets]) => [...targets].filter((target) => target !== source)));
  for (const board of boards.values()) {
    if (board.kind === 'layers' && !reachable.has(board.id)) diagnostics.push({
      rule: 'orphan-board', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: linked.has(board.id) ? `Layer "${label(board.id)}" is linked only from boards unreachable from the root.`
        : `Layer "${label(board.id)}" has no incoming board link.`,
    });
    if (options.missingBacklink && board.parent && ![
      ...board.diagram.shapes, ...board.diagram.connections, board.diagram.root,
    ].some((item) => boardTarget(item.link, board, boards) === board.parent)) diagnostics.push({
      rule: 'missing-backlink', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: `Board "${label(board.id)}" has no link to its parent "${label(board.parent)}".`,
    });
    if (!options.boundaryPorts) continue;
    for (const shape of board.diagram.shapes) {
      const target = boardTarget(shape.link, board, boards);
      const child = target && boards.get(target);
      // Only immediate child layers represent a parent's drillable node.
      if (!child || child.kind !== 'layers' || child.parent !== board.id) continue;
      const ports = {
        in: child.diagram.shapes.filter((port) => port.classes?.includes('zf-in')),
        out: child.diagram.shapes.filter((port) => port.classes?.includes('zf-out')),
      };
      // Port-free layers use inferred parent connections; they have no explicit contract.
      if (!ports.in.length && !ports.out.length) continue;
      const required = boundaryNeighbours(board.diagram, shape.id);
      const evaluation: BoundaryEvaluation = { board: board.id, shape: shape.id, child: child.id,
        expected: required.in.size + required.out.size, evaluated: 0 };
      for (const direction of ['in', 'out'] as const) {
        for (const neighbour of required[direction]) {
          const matches = ports[direction].filter((port) => port.id === neighbour);
          if (matches.length) evaluation.evaluated++;
          else diagnostics.push({ rule: `boundary-${direction}`, severity: 'error', board: board.id, shape: shape.id,
            range: shapeRange(board.id, shape.id),
            message: `"${shape.id}" needs a zf-${direction} port named "${neighbour}" in "${label(child.id)}".` });
        }
        for (const port of ports[direction]) {
          if (!required[direction].has(port.id)) diagnostics.push({
            rule: `boundary-${direction}`, severity: 'error', board: child.id, shape: port.id, range: shapeRange(child.id, port.id),
            message: `zf-${direction} port "${port.id}" has no matching ${direction === 'in' ? 'incoming' : 'outgoing'} neighbour of "${shape.id}" in "${label(board.id)}".`,
          });
        }
      }
      if (required.incident && evaluation.evaluated === 0) diagnostics.push({
        rule: required.out.size && !required.in.size ? 'boundary-out' : 'boundary-in',
        severity: 'error', board: board.id, shape: shape.id, range: shapeRange(board.id, shape.id),
        message: `Zero boundary pairs evaluated for "${shape.id}" → "${label(child.id)}" despite incident edges. Add matching zf-in/zf-out ports and directed edges.`,
      });
      boundaries.push(evaluation);
    }
  }
  return { diagnostics, boundaries, boundaryPairsEvaluated: boundaries.reduce((sum, item) => sum + item.evaluated, 0) };
}
