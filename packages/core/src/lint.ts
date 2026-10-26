import type { CompileResponse } from '@d2lang/d2';
import { boardKey, classifyHref, indexBoards, type Board } from './index';
import { definedClasses } from './classes';
import { boundaryNeighbours } from './context';
import { shapeRanges } from './source';

export type LintRule = 'boundary-in' | 'boundary-out' | 'orphan-board' | 'dangling-link' | 'ignored-link' | 'missing-backlink'
  | 'undefined-class';
export interface LintDiagnostic {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  board: string;
  shape?: string;
  /** Compiled connection ID, such as `(a -> b)[0]`, for dangling connection links. */
  connection?: string;
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
interface AstKey {
  range?: string;
  key?: { path?: AstValue[] };
  edges?: { src?: { path?: AstValue[] }; src_arrow?: string; dst?: { path?: AstValue[] }; dst_arrow?: string }[];
  edge_index?: { int?: number; glob?: boolean };
  edge_key?: { path?: AstValue[] };
  primary?: AstValue;
  value?: AstValue;
}
interface AstMap { nodes?: { map_key?: AstKey }[] }
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
/** Quote a key segment as D2 does in compiled IDs, so `"a b"` is `a b` but `"a.b"` stays quoted. */
function keySegment(value: AstValue): string {
  return boardKey(stringValue(value) ?? '');
}
/** The scalar of an edge's last `link` assignment, from `(a -> b)[0].link: x` or `a -> b: {link: x}`. */
function edgeLink(entry: AstKey): AstValue | undefined {
  const value = (key: AstKey) => stringValue(key.value) !== undefined ? key.value : key.primary;
  if (entry.edge_key) {
    const path = entry.edge_key.path ?? [];
    return path.length === 1 && stringValue(path[0]) === 'link' ? value(entry) : undefined;
  }
  const link = (entry.value?.map?.nodes ?? []).map((node) => node.map_key)
    .filter((key) => key?.key?.path?.length === 1 && stringValue(key.key.path[0]) === 'link').at(-1);
  return link && value(link);
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
  // Missing segments keep D2's quoting (`layers."x.y"`); name them as authored.
  const names: string[] = [];
  let named = true;
  for (const [, quoted, plain] of rest.matchAll(/"((?:[^"\\]|\\.)*)"|([^."]+)/g)) {
    if (named && plain && ['layers', 'scenarios', 'steps'].includes(plain)) { named = false; continue; }
    const name = quoted?.replace(/\\(.)/g, '$1') ?? plain;
    if (named && names.length) names[names.length - 1] += `.${name}`;
    else names.push(name);
    named = true;
  }
  for (let item = board; item; item = item.parent ? boards.get(item.parent) : undefined) names.unshift(item.name);
  return names.join(' > ');
}

/** Classes each board can use. Child boards carry compiler-expanded ASTs with every inherited and
 * imported class; the root AST keeps its imports, so its files are read instead, when given. */
function boardClasses(compiled: LintInput): Map<string, Set<string> | undefined> {
  const classes = new Map<string, Set<string> | undefined>();
  classes.set('root', compiled.fs && compiled.inputPath ? definedClasses(compiled.fs, compiled.inputPath) : undefined);
  function visit(graph: LintGraph, id: string) {
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of graph[group] ?? []) {
        const childId = `${id}.${group}.${boardKey(child.name ?? '')}`;
        const names = new Set<string>();
        for (const node of child.ast?.nodes ?? []) {
          const path = node.map_key?.key?.path?.map((part) => stringValue(part) ?? '') ?? [];
          if (path[0] !== 'classes') continue;
          if (path.length > 1) names.add(path[1]);
          else for (const entry of node.map_key?.value?.map?.nodes ?? []) {
            const name = stringValue(entry.map_key?.key?.path?.[0]);
            if (name) names.add(name);
          }
        }
        classes.set(childId, names);
        visit(child, childId);
      }
    }
  }
  visit(compiled.graph as LintGraph, 'root');
  return classes;
}

type LintInput = Pick<CompileResponse, 'diagram' | 'graph'> & Partial<Pick<CompileResponse, 'fs' | 'inputPath'>>;

/** Lint a compiled document without following its cyclic navigation graph.
 * Shape identifiers, not display labels, are the boundary-port naming contract.
 * Pass the compiler's `fs` and `inputPath` too, so undefined classes on the root board are found.
 */
export function lint(compiled: LintInput, options: LintOptions = {}): LintResult {
  const boards = indexBoards(compiled.diagram);
  const diagnostics: LintDiagnostic[] = [];
  const boundaries: BoundaryEvaluation[] = [];
  const links = new Map<string, Set<string>>();
  const linkKeys = new Set<string>();
  const boardRanges = new Map<string, string>();
  const owners = new Map<string, { board: Board; shape: string; child: Board }[]>();
  const label = (id: string) => boardLabel(id, boards);
  let ranges: Map<string, string> | undefined;
  const shapeRange = (board: string, shape: string) =>
    (ranges ??= shapeRanges(compiled.diagram, compiled.graph)).get(JSON.stringify([board, shape]));
  function checkLink(href: string, board: Board, shape?: string, range?: string, connection?: string) {
    const target = boardTarget(href, board, boards);
    if (!target) {
      // The viewer drops anchors that are neither boards nor web links.
      const key = JSON.stringify([board.id, shape ?? connection, href]);
      if (!href || classifyHref(href).kind !== 'invalid' || linkKeys.has(key)) return;
      linkKeys.add(key);
      if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
      let depth = 0;
      for (let item = board; item.parent; item = boards.get(item.parent)!) depth++;
      // D2 may keep an unresolvable `_` after resolving the rest, as in `root._`.
      const above = /^root(?:\._)+(?:\.|$)/.test(href) || (/^(?:_(?:\.|$))+/.exec(href)?.[0].split('_').length ?? 1) - 1 > depth;
      diagnostics.push({ rule: 'ignored-link', severity: 'warning', board: board.id, shape, connection, range,
        message: above ? `Link "${href}" goes above the root board, so the viewer ignores it.`
          : `Link "${href}" is not a board or web address, so the viewer ignores it.` });
      return;
    }
    if (boards.has(target)) {
      if (!links.has(board.id)) links.set(board.id, new Set());
      links.get(board.id)!.add(target);
      return;
    }
    const key = JSON.stringify([board.id, shape ?? connection, target]);
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
    diagnostics.push({ rule: 'dangling-link', severity: 'error', board: board.id, shape, connection, range, target,
      message: `Link targets missing board "${label(target)}".${hint}` });
  }

  for (const board of boards.values()) {
    for (const shape of board.diagram.shapes) checkLink(shape.link, board, shape.id);
    for (const connection of board.diagram.connections) checkLink(connection.link, board, undefined, undefined, connection.id);
    checkLink(board.diagram.root.link, board);
  }

  // Root AST retains authored links; child ASTs contain expanded, resolved links.
  // Keep the last explicit assignment per shape (D2 permits property overrides).
  function visitGraph(graph: LintGraph, id: string) {
    const found = boards.get(id);
    if (!found) return;
    const board: Board = found;
    type Authored = { href: string; range?: string };
    const authored = new Map<string, Authored>();
    // Connection links per compiled edge ID without its index: declarations in source order,
    // and `(a -> b)[n]` references by index. D2 IDs are case-insensitive.
    const declared = new Map<string, (Authored | undefined)[]>();
    const referenced = new Map<string, Authored>();
    function visitMap(map: AstMap | undefined, scope: string[] = []) {
      const resolve = (path: AstValue[] = []) => {
        const full = [...scope];
        for (const name of path.map(keySegment)) if (name === '_') full.pop(); else full.push(name);
        return full;
      };
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
        const fullPath = resolve(path);
        if (entry.edges?.length) {
          // Connection links do not establish boundary ownership. The compiled pass reports
          // each connection; here only record where its link was authored.
          const value = edgeLink(entry);
          const link = value && { href: canonicalLink(stringValue(value) ?? ''), range: scalarRange(value) };
          const index = entry.edge_index;
          for (const edge of entry.edges) {
            const src = resolve(edge.src?.path), dst = resolve(edge.dst?.path);
            let shared = 0;
            while (shared < Math.min(src.length, dst.length) - 1 && src[shared].toLowerCase() === dst[shared].toLowerCase()) shared++;
            const arrow = `${edge.src_arrow === '<' ? '<' : ''}${edge.src_arrow === '<' || edge.dst_arrow === '>' ? '-' : '--'}${edge.dst_arrow === '>' ? '>' : ''}`;
            const prefix = src.slice(0, shared).join('.');
            const key = `${prefix && `${prefix}.`}(${src.slice(shared).join('.')} ${arrow} ${dst.slice(shared).join('.')})`.toLowerCase();
            if (!index) declared.set(key, [...declared.get(key) ?? [], link]);
            else if (link && !index.glob && index.int !== undefined) referenced.set(`${key}[${index.int}]`, link);
          }
        } else if (names.at(-1) === 'link') {
          const value = stringValue(entry.value) !== undefined ? entry.value : entry.primary;
          authored.set(fullPath.slice(0, -1).join('.').toLowerCase(),
            { href: stringValue(value) ?? '', range: scalarRange(value) ?? entry.range });
        } else visitMap(entry.value?.map, fullPath);
      }
    }
    visitMap(graph.ast);
    for (const [shape, link] of authored) {
      // Only recover links D2 dropped; a kept link was already checked in its compiled form.
      // Skip templates and removed objects; a board-level link has no shape.
      const compiled = shape ? board.diagram.shapes.find((item) => item.id.toLowerCase() === shape) : board.diagram.root;
      if (compiled && !compiled.link) checkLink(canonicalLink(link.href), board, shape ? compiled.id : undefined, link.range);
    }
    // Pair each connection with its authored link by edge identity. A declaration is paired by
    // its order only when every compiled edge of that identity was declared here; else omit the range.
    const counts = new Map<string, number>();
    const edges = board.diagram.connections.map((connection) => {
      const [, base, index] = /^(.*)\[(\d+)\]$/s.exec(connection.id) ?? ['', connection.id, ''];
      const key = base.toLowerCase();
      const ordinal = counts.get(key) ?? 0;
      counts.set(key, ordinal + 1);
      return { connection, key, index, ordinal };
    });
    for (const { connection, key, index, ordinal } of edges) {
      const diagnostic = diagnostics.find((item) => item.board === board.id && item.connection === connection.id);
      if (!diagnostic) continue;
      const declarations = declared.get(key);
      const wanted = diagnostic.target ?? connection.link;
      diagnostic.range = [referenced.get(`${key}[${index}]`), declarations?.length === counts.get(key) ? declarations?.[ordinal] : undefined]
        .find((link) => link?.range && !link.range.startsWith(',') && (boardTarget(link.href, board, boards) ?? link.href) === wanted)?.range;
    }
    for (const group of ['layers', 'scenarios', 'steps'] as const) {
      for (const child of graph[group] ?? []) visitGraph(child, `${id}.${group}.${boardKey(child.name ?? '')}`);
    }
  }
  visitGraph(compiled.graph as LintGraph, 'root');

  // D2 accepts a class nothing defines and changes nothing, which hides typos and a missing import.
  // Boundary port classes mark ports for lint whether or not the library styles them.
  const classes = boardClasses(compiled);
  for (const board of boards.values()) {
    const defined = classes.get(board.id);
    if (!defined) continue;
    const reported = new Set<string>();
    for (const item of [...board.diagram.shapes, ...board.diagram.connections]) {
      for (const name of item.classes ?? []) {
        if (defined.has(name) || reported.has(name) || name === 'zf-in' || name === 'zf-out') continue;
        reported.add(name);
        const connection = 'route' in item;
        diagnostics.push({ rule: 'undefined-class', severity: 'warning', board: board.id,
          ...connection ? { connection: item.id } : { shape: item.id, range: shapeRange(board.id, item.id) },
          message: `Class "${name}" is not defined, so it changes nothing.${name.startsWith('zf-')
            ? ' Check the spelling, and import the Zoomflow library with ...@zoomflow.' : ' Check the spelling, or define it under classes.'}` });
      }
    }
  }

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
    // Scenarios and steps are navigated without links, so only layers need a way back.
    if (options.missingBacklink && board.kind === 'layers' && board.parent && ![
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
      owners.set(child.id, [...owners.get(child.id) ?? [], { board, shape: shape.id, child }]);
    }
  }

  // Several parent nodes may drill into one layer; a port need only match one of them.
  for (const group of owners.values()) {
    const { board, child } = group[0];
    const ports = {
      in: child.diagram.shapes.filter((port) => port.classes?.includes('zf-in')),
      out: child.diagram.shapes.filter((port) => port.classes?.includes('zf-out')),
    };
    // Port-free layers use inferred parent connections; they have no explicit contract.
    if (!ports.in.length && !ports.out.length) continue;
    const requirements = group.map(({ shape }) => ({ shape, required: boundaryNeighbours(board.diagram, shape),
      evaluation: { board: board.id, shape, child: child.id, expected: 0, evaluated: 0 } as BoundaryEvaluation }));
    const names = requirements.map(({ shape }) => `"${shape}"`).join(' or ');
    for (const direction of ['in', 'out'] as const) {
      // Missing ports are per owner; a port is unmatched only if no owner needs it.
      for (const { shape, required, evaluation } of requirements) {
        evaluation.expected += required[direction].size;
        for (const neighbour of required[direction]) {
          const matches = ports[direction].filter((port) => port.id === neighbour);
          if (matches.length) evaluation.evaluated++;
          else diagnostics.push({ rule: `boundary-${direction}`, severity: 'error', board: board.id, shape,
            range: shapeRange(board.id, shape),
            message: `"${shape}" needs a zf-${direction} port named "${neighbour}" in "${label(child.id)}".` });
        }
      }
      for (const port of ports[direction]) {
        if (!requirements.some(({ required }) => required[direction].has(port.id))) diagnostics.push({
          rule: `boundary-${direction}`, severity: 'error', board: child.id, shape: port.id, range: shapeRange(child.id, port.id),
          message: `zf-${direction} port "${port.id}" has no matching ${direction === 'in' ? 'incoming' : 'outgoing'} neighbour of ${names} in "${label(board.id)}".`,
        });
      }
    }
    for (const { shape, required, evaluation } of requirements) {
      if (required.incident && evaluation.evaluated === 0) diagnostics.push({
        rule: required.out.size && !required.in.size ? 'boundary-out' : 'boundary-in',
        severity: 'error', board: board.id, shape, range: shapeRange(board.id, shape),
        message: `Zero boundary pairs evaluated for "${shape}" → "${label(child.id)}" despite incident edges. Add matching zf-in/zf-out ports and directed edges.`,
      });
      boundaries.push(evaluation);
    }
  }
  return { diagnostics, boundaries, boundaryPairsEvaluated: boundaries.reduce((sum, item) => sum + item.evaluated, 0) };
}
