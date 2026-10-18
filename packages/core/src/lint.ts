import type { CompileResponse } from '@d2lang/d2';
import { classifyHref, indexBoards, type Board } from './index';
import { boundaryNeighbours } from './context';

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
  /** Opt into explicit zf-in/zf-out contracts. Navigation never requires ports. */
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
function boardTarget(href: string, board: Board, boards: Map<string, Board>): string | undefined {
  const classified = classifyHref(href, board.id);
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

/** Lint a compiled document without following its cyclic navigation graph.
 * Shape identifiers, not display labels, are the boundary-port naming contract.
 */
export function lint(compiled: Pick<CompileResponse, 'diagram' | 'graph'>, options: LintOptions = {}): LintResult {
  const boards = indexBoards(compiled.diagram);
  const diagnostics: LintDiagnostic[] = [];
  const boundaries: BoundaryEvaluation[] = [];
  const incoming = new Set<string>();
  const linkKeys = new Set<string>();
  const boardRanges = new Map<string, string>();
  function checkLink(href: string, board: Board, shape?: string, range?: string) {
    const target = boardTarget(href, board, boards);
    if (!target) return;
    if (boards.has(target)) { if (target !== board.id) incoming.add(target); return; }
    const key = JSON.stringify([board.id, shape, target]);
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    let hint = '';
    const childPath = target.startsWith(`${board.id}.`) ? target.slice(board.id.length + 1) : '';
    // Suggest an ancestor only for a missing immediate child with the same name/kind.
    // Leave resolution unchanged, including when a child and ancestor share a name.
    for (let ancestor = board.parent && boards.get(board.parent), up = '_'; ancestor;
      ancestor = ancestor.parent && boards.get(ancestor.parent), up += '._') {
      if (childPath === `${ancestor.kind}.${ancestor.name}`) {
        hint = ` Did you mean the ${up === '_' ? 'parent' : 'ancestor'} board "${ancestor.name}"? Use link: ${up}.`;
        break;
      }
    }
    diagnostics.push({ rule: 'dangling-link', severity: 'error', board: board.id, shape, range, target,
      message: `Link targets missing board "${target}".${hint}` });
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
    const links = new Map<string, { href: string; range?: string }>();
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
            if (name && range) boardRanges.set(`${id}.${names[0]}.${name}`, range);
          }
          continue; // Each child has its own compiler-expanded graph AST.
        }
        const fullPath = [...scope, ...path.map(keySegment)];
        if (names.at(-1) === 'link') {
          const owner = fullPath.slice(0, -1).join('.');
          const value = stringValue(entry.value) !== undefined ? entry.value : entry.primary;
          links.set(owner, { href: stringValue(value) ?? '', range: scalarRange(value) ?? entry.range });
        } else if (entry.edges?.length) {
          // Connection links do not establish boundary ownership.
          for (const item of entry.value?.map?.nodes ?? []) {
            const key = item.map_key;
            if (stringValue(key?.key?.path?.[0]) === 'link') {
              const value = stringValue(key?.value) !== undefined ? key?.value : key?.primary;
              checkLink(stringValue(value) ?? '', board, undefined, scalarRange(value));
            }
          }
        } else visitMap(entry.value?.map, fullPath);
      }
    }
    visitMap(graph.ast);
    for (const [shape, link] of links) {
      // Skip templates and removed objects; a board-level link has no shape.
      if (!shape || board.diagram.shapes.some((item) => item.id === shape)) {
        checkLink(link.href, board, shape || undefined, link.range);
      }
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of graph[group] ?? []) visitGraph(child, `${id}.${group}.${child.name}`);
    }
  }
  visitGraph(compiled.graph as LintGraph, 'root');

  for (const board of boards.values()) {
    if (board.kind === 'layers' && !incoming.has(board.id)) diagnostics.push({
      rule: 'orphan-board', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: `Layer "${board.id}" has no incoming board link.`,
    });
    if (options.missingBacklink && board.parent && ![
      ...board.diagram.shapes, ...board.diagram.connections, board.diagram.root,
    ].some((item) => boardTarget(item.link, board, boards) === board.parent)) diagnostics.push({
      rule: 'missing-backlink', severity: 'warning', board: board.id, range: boardRanges.get(board.id),
      message: `Board "${board.id}" has no link to its parent "${board.parent}".`,
    });
    if (!options.boundaryPorts) continue;
    for (const shape of board.diagram.shapes) {
      const target = boardTarget(shape.link, board, boards);
      const child = target && boards.get(target);
      // Only immediate child layers represent a parent's drillable node.
      if (!child || child.kind !== 'layers' || child.parent !== board.id) continue;
      const required = boundaryNeighbours(board.diagram, shape.id);
      const evaluation: BoundaryEvaluation = { board: board.id, shape: shape.id, child: child.id,
        expected: required.in.size + required.out.size, evaluated: 0 };
      for (const direction of ['in', 'out'] as const) {
        const ports = child.diagram.shapes.filter((port) => port.classes?.includes(`zf-${direction}`));
        for (const neighbour of required[direction]) {
          const matches = ports.filter((port) => port.id === neighbour);
          if (matches.length) evaluation.evaluated++;
          else diagnostics.push({ rule: `boundary-${direction}`, severity: 'error', board: board.id, shape: shape.id,
            message: `"${shape.id}" needs a zf-${direction} port named "${neighbour}" in "${child.id}".` });
        }
        for (const port of ports) {
          if (!required[direction].has(port.id)) diagnostics.push({
            rule: `boundary-${direction}`, severity: 'error', board: child.id, shape: port.id,
            message: `zf-${direction} port "${port.id}" has no matching ${direction === 'in' ? 'incoming' : 'outgoing'} neighbour of "${shape.id}" in "${board.id}".`,
          });
        }
      }
      if (required.incident && evaluation.evaluated === 0) diagnostics.push({
        rule: required.out.size && !required.in.size ? 'boundary-out' : 'boundary-in',
        severity: 'error', board: board.id, shape: shape.id,
        message: `Zero boundary pairs evaluated for "${shape.id}" → "${child.id}" despite incident edges. Add matching zf-in/zf-out ports and directed edges.`,
      });
      boundaries.push(evaluation);
    }
  }
  return { diagnostics, boundaries, boundaryPairsEvaluated: boundaries.reduce((sum, item) => sum + item.evaluated, 0) };
}
