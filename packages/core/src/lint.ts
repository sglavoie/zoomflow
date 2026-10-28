import type { CompileResponse } from '@d2lang/d2';
import { boardKey, classifyHref, indexBoards, resolveFilePath, type Board } from './index';
import { definedClasses } from './classes';
import { boundaryNeighbours } from './context';
import { filterMatches, fileLinkRules, globMatches, idSegments, importedLinks, importPath, linkAfterKey, linkSources, shapeAttributes, shapeFiles, shapeRanges,
  type AuthoredLink, type GlobFilter, type GlobSegment } from './source';

export type LintRule = 'boundary-in' | 'boundary-out' | 'orphan-board' | 'dangling-link' | 'ignored-link' | 'missing-backlink'
  | 'undefined-class' | 'unsupported-label' | 'dangling-file-link' | 'missing-file-board' | 'bare-file-link';
export interface LintDiagnostic {
  rule: LintRule;
  severity: 'error' | 'warning';
  message: string;
  board: string;
  shape?: string;
  /** Compiled connection ID, such as `(a -> b)[0]`, for dangling connection links. */
  connection?: string;
  /** Resolved missing board ID for dangling-link diagnostics; the authored href for dangling-file-link ones. */
  target?: string;
  /** Original D2 range, possibly in an imported file. Never assume it is index. */
  range?: string;
}
export interface LintOptions {
  missingBacklink?: boolean;
  /** Validate zf-in/zf-out contracts where a child layer declares ports. */
  boundaryPorts?: boolean;
  /** The project around the linted file, so links to other `.d2` files can be checked.
   * Without it, file links are not reported: a single file cannot know its neighbours. */
  files?: {
    /** Project path of the linted file. File links resolve from the file that wrote them, this one or an import. */
    inputPath: string;
    /** Whether links may not open hidden or build folders, which the web app's project scan leaves out (default true). */
    scanned?: boolean;
    /** Whether a project path names a `.d2` file in the project. */
    exists(path: string): boolean;
    /** Board hashes (as `indexBoards` gives them) of a project file, when known. */
    boards?(path: string): ReadonlySet<string> | undefined;
  };
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
interface AstString { range?: string; value?: string | { string?: string }[]; pattern?: string[] }
interface AstValue {
  unquoted_string?: AstString;
  double_quoted_string?: AstString;
  single_quoted_string?: AstString;
  block_string?: { range?: string; value?: string };
  boolean?: { value?: boolean };
  number?: { raw?: string };
  import?: AstImport;
  map?: AstMap;
}
interface AstImport { spread?: boolean; path?: AstValue[] }
interface AstKey {
  range?: string;
  key?: { path?: AstValue[] };
  edges?: { src?: { path?: AstValue[] }; src_arrow?: string; dst?: { path?: AstValue[] }; dst_arrow?: string }[];
  edge_index?: { int?: number; glob?: boolean };
  edge_key?: { path?: AstValue[] };
  primary?: AstValue;
  value?: AstValue;
  ampersand?: boolean;
  not_ampersand?: boolean;
}
interface AstMap { range?: string; nodes?: { map_key?: AstKey; import?: AstImport }[] }
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
/** Quote a key segment as D2 does in compiled shape IDs, so `"a b"` is `a b` but `"a.b"` stays quoted. Unlike link
 * targets, shape IDs leave `$` bare and spell `null` in any case as `'null'`. */
function keySegment(value: AstValue): string {
  const name = stringValue(value) ?? '';
  if (name.toLowerCase() === 'null') return "'null'";
  const plain = name.replaceAll('$', '_');
  return boardKey(plain) === plain ? name : boardKey(name);
}
/** D2 rewrites a connection's link to a board named `null` in any case, such as `NULL`, as `'null'`. */
const nulled = (id: string) => id.replace(/(^|\.)(?:'null'|null)(?=\.|$)/gi, "$1'null'");
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
  for (const [, quoted, single, plain] of rest.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^."']+)/g)) {
    if (named && plain && ['layers', 'scenarios', 'steps'].includes(plain)) { named = false; continue; }
    const name = quoted?.replace(/\\(.)/g, '$1') ?? single ?? plain;
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
  let ranges: Map<string, string> | undefined, sources: Map<string, string> | undefined;
  let imported: ReturnType<typeof importedLinks> | undefined;
  let attributesOf: ReturnType<typeof shapeAttributes> | undefined;
  let filesOf: ReturnType<typeof shapeFiles> | undefined;
  // Each board's class links, for the place an inherited class was written; and the classes files imported under a
  // key define, with the import, since D2 applies none of those.
  const classLinksOf = new Map<string, Map<string, { href: string; range?: string }>>();
  const keyedClasses = new Map<string, string>();
  const shapeRange = (board: string, shape: string) =>
    (ranges ??= shapeRanges(compiled.diagram, compiled.graph)).get(JSON.stringify([board, shape]));
  function checkFileLink(href: string, path: string, hash: string, board: Board, shape?: string, range?: string, connection?: string) {
    const { files } = options;
    if (!files) return;
    const key = JSON.stringify([board.id, shape ?? connection, href]);
    if (linkKeys.has(key)) return;
    // `inputPath` names the compiled entry file in the project, whatever the compiler called it.
    const source = (sources ??= linkSources(compiled)).get(JSON.stringify([board.id, shape ?? connection]));
    const from = source !== undefined && source !== (compiled.inputPath ?? files.inputPath) ? source : files.inputPath;
    const resolved = resolveFilePath(from, path, files.scanned);
    let diagnostic: Pick<LintDiagnostic, 'rule' | 'severity' | 'message'> | undefined;
    if (!resolved) diagnostic = { rule: 'dangling-file-link', severity: 'error',
      message: files.scanned !== false && resolveFilePath(from, path, false)
        ? `Link "${href}" opens a hidden or build folder, which the project leaves out.`
        : `Link "${href}" points outside the project folder or at a file that cannot be a diagram.` };
    else if (!files.exists(resolved)) diagnostic = { rule: 'dangling-file-link', severity: 'error',
      message: `Link targets missing file "${resolved}".` };
    else if (hash && hash !== '#/') {
      // Compare routes segment by segment, so `#/My Board` and `#/My%20Board` agree.
      const route = (value: string) => value.split('/').map((segment) => {
        try { return encodeURIComponent(decodeURIComponent(segment)); } catch { return segment; }
      }).join('/');
      const known = files.boards?.(resolved);
      if (known && ![...known].some((item) => route(item) === route(hash))) {
        let name = hash.slice(2);
        try { name = decodeURIComponent(name); } catch { /* Keep the authored route. */ }
        diagnostic = { rule: 'missing-file-board', severity: 'warning',
          message: `Link targets missing board "${name}" in "${resolved}", so the viewer opens its nearest existing board.` };
      }
    }
    if (!diagnostic) return;
    linkKeys.add(key);
    if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
    diagnostics.push({ ...diagnostic, board: board.id, shape, connection, range,
      ...(diagnostic.rule === 'dangling-file-link' ? { target: href } : {}) });
  }
  /** Report a link D2 removed for how it is written, not where it points. */
  function dropped(board: Board, shape: string | undefined, link: AuthoredLink | { href: string; range?: string }, message: string) {
    const key = JSON.stringify([board.id, shape, link.href]);
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    const range = link.range && !link.range.startsWith(',') ? link.range : shape ? shapeRange(board.id, shape) : undefined;
    diagnostics.push({ rule: 'ignored-link', severity: 'warning', board: board.id, shape, range, message });
  }
  /** `dropped` marks an authored link that D2 removed from the compiled shape. */
  function checkLink(href: string, board: Board, shape?: string, range?: string, connection?: string, dropped = false) {
    const classified = classifyHref(href);
    if (classified.kind === 'file') return checkFileLink(href, classified.path, classified.hash, board, shape, range, connection);
    const target = boardTarget(href, board, boards);
    if (!target) {
      // The viewer drops anchors that are neither boards nor web links.
      const key = JSON.stringify([board.id, shape ?? connection, href]);
      if (!href || classified.kind !== 'invalid' || linkKeys.has(key)) return;
      linkKeys.add(key);
      if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
      // D2 drops `x.d2` and `folder/x.d2`, reading them as board paths; only `./` paths link to files. It keeps
      // some others, such as `/x.d2` or `.\x.d2`, which the viewer still ignores. Suggest forward slashes either way.
      const [file, fragment] = /^([^#]*\.d2)(#.*)?$/s.exec(href)?.slice(1) ?? [];
      if (file && !/^\.\.?\//.test(file)) {
        const path = file.replace(/\\/g, '/');
        const suggestion = /^\.\.?\//.test(path) ? path : `./${path.replace(/^\/+/, '')}`;
        diagnostics.push({ rule: 'bare-file-link', severity: 'warning', board: board.id, shape, connection, range,
          message: `Link "${href}" ${dropped ? 'is read as a board path, so D2 drops it' : 'is not a ./ or ../ path, so the viewer ignores it'}. ` +
            `To open the file, write link: "${suggestion}${fragment ?? ''}".` });
        return;
      }
      let depth = 0;
      for (let item = board; item.parent; item = boards.get(item.parent)!) depth++;
      // D2 may keep an unresolvable `_` after resolving the rest, as in `root._`.
      const above = /^root(?:\._)+(?:\.|$)/.test(href) || (/^(?:_(?:\.|$))+/.exec(href)?.[0].split('_').length ?? 1) - 1 > depth;
      diagnostics.push({ rule: 'ignored-link', severity: 'warning', board: board.id, shape, connection, range,
        message: above ? `Link "${href}" goes above the root board, so the viewer ignores it.`
          : `Link "${href}" is not a board or web address, so the viewer ignores it.` });
      return;
    }
    if (boards.has(target) && dropped && target !== board.id) {
      // D2 drops links to a link's own board, harmlessly, but also to some board names, such as `NULL`.
      const key = JSON.stringify([board.id, shape, target]);
      if (linkKeys.has(key)) return;
      linkKeys.add(key);
      if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
      diagnostics.push({ rule: 'ignored-link', severity: 'warning', board: board.id, shape, range,
        message: `D2 drops the link to board "${label(target)}", so the viewer ignores it. Rename the board to link to it.` });
      return;
    }
    const renamed = boards.has(target) ? undefined : [...boards.keys()].find((item) => nulled(item) === nulled(target));
    if (renamed) {
      const key = JSON.stringify([board.id, shape ?? connection, target]);
      if (linkKeys.has(key)) return;
      linkKeys.add(key);
      if (!range || range.startsWith(',')) range = shape ? shapeRange(board.id, shape) : undefined;
      diagnostics.push({ rule: 'ignored-link', severity: 'warning', board: board.id, shape, connection, range,
        message: `D2 reads the link to board "${label(renamed)}" as one to "null", so the viewer ignores it. Rename the board to link to it.` });
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
    // D2 drops `\` and `"` from link targets, so a board named with them is unreachable.
    const plain = (id: string) => id.replace(/["\\]/g, '');
    const meant = hint ? undefined : [...boards.values()].find((item) => /["\\]/.test(item.name) && plain(item.id) === plain(target));
    if (meant) hint = ` Did you mean "${label(meant.id)}"? Board names with backslashes or quotes cannot be link targets, so rename it.`;
    // Unquoted, `layers.x.y` means board `y` inside `x`, not a board named `x.y`.
    const dotted = hint ? undefined : [...boards.values()].find((item) => item.name.includes('.') && plain(item.id) === target);
    if (dotted) hint = ` A board named "${dotted.name}" exists; quote names with dots to link to it, as in ${dotted.kind}."${dotted.name}".`;
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
    // An imported file's globs carry it: D2 applies them only to the shapes that file writes.
    const globs: { path: GlobSegment[]; link: Authored; filters: GlobFilter[]; file?: string }[] = [];
    // The link each class sets; a later definition replaces an earlier one.
    const classLinks = new Map<string, Authored>();
    // Class links no shape takes: from files imported under a key, whose classes D2 never applies.
    const inertClassLinks: Authored[] = [];
    const entryFile = /^(.*),/.exec(graph.ast?.range ?? '')?.[1];
    /** Child boards hold D2's resolved links. A layer's own were all written for it, but scenarios and steps inherit
     * their parent's, relative to the board that wrote them, so there the text replaces one only to show what
     * resolving hides: a substitution, which D2 drops, or a bare `.d2` path. */
    const prefer = (resolved: Authored | undefined, text: Authored | undefined, inherited = id !== 'root' && board.kind !== 'layers') => {
      if (!text || !resolved) return text ?? resolved;
      if (!inherited || /\$\{|\.d2(?:#|$)/i.test(text.href)) return text;
      // Borrow the text's place only when it wrote this link: a key can keep the place of an earlier definition.
      const same = resolved.href === text.href || resolved.href.endsWith(`.${canonicalLink(text.href)}`);
      return resolved.range?.match(/^[^,]/) || !same ? resolved : { ...resolved, range: text.range };
    };
    /** A link as written, read from its file where it can be: D2 substitutes `${x}` and resolves child boards' paths. */
    function authoredLink(entry: AstKey, inherited?: boolean): Authored {
      const block = entry.value?.block_string;
      if (block) return { href: block.value?.trim() ?? '', range: block.range };
      const value = stringValue(entry.value) !== undefined ? entry.value : entry.primary;
      return prefer({ href: stringValue(value) ?? '', range: scalarRange(value) ?? entry.range },
        linkAfterKey(scalarRange(entry.key?.path?.at(-1)), compiled.fs), inherited)!;
    }
    /** Globs an imported file sets, under the key it is imported into, and the classes a whole spread file defines. */
    function importRules(imported: AstImport, scope: string[]) {
      const path = stringValue(imported.path?.[0]);
      const file = compiled.fs && entryFile !== undefined && path ? importPath(compiled.fs, entryFile, path) : undefined;
      if (!file) return;
      const rules = fileLinkRules(compiled.fs!, file);
      const prefix = idSegments(scope.join('.')).map((text) => ({ text, glob: false }));
      for (const glob of rules.globs) globs.push({ ...glob, path: [...prefix, ...glob.path] });
      if (imported.spread && !scope.length) for (const [name, link] of rules.classes) classLinks.set(name, link);
      else {
        for (const name of definedClasses(compiled.fs!, file) ?? []) if (!keyedClasses.has(name)) keyedClasses.set(name, path!);
        inertClassLinks.push(...rules.classes.values());
      }
    }
    /** Record a class's link, from `classes.x.link: y` or `x: {link: y}` in `classes`. D2 resolves it from the board
     * that defines the class, so a child board's inherited class keeps the compiler's value. */
    function defineClass(path: AstValue[], entry: AstKey) {
      const names = path.map((part) => stringValue(part) ?? '');
      const link = names.length === 2 && names[1] === 'link' ? entry : names.length === 1
        ? (entry.value?.map?.nodes ?? []).map((node) => node.map_key)
          .filter((key) => key?.key?.path?.length === 1 && stringValue(key.key.path[0]) === 'link').at(-1) : undefined;
      if (!link) return;
      const found = authoredLink(link, id !== 'root');
      // A child board's AST places an inherited class at its first definition; take the place from the board that
      // wrote the link it resolves to.
      for (let ancestor = board.parent; (!found.range || found.range.startsWith(',')) && ancestor; ancestor = boards.get(ancestor)?.parent) {
        const written = classLinksOf.get(ancestor)?.get(names[0]);
        if (written && boardTarget(canonicalLink(written.href), boards.get(ancestor)!, boards) === found.href) found.range = written.range;
      }
      classLinks.set(names[0], found);
    }
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
        if (node.import?.spread) importRules(node.import, scope);
        const entry = node.map_key;
        if (!entry) continue;
        const path = entry.key?.path ?? [];
        const names = path.map((part) => stringValue(part) ?? '');
        if (entry.value?.import) { importRules(entry.value.import, resolve(path)); continue; }
        if (names[0] === 'classes' && !scope.length) {
          if (path.length > 1) defineClass(path.slice(1), entry);
          else for (const child of entry.value?.map?.nodes ?? []) if (child.map_key?.key?.path) defineClass(child.map_key.key.path, child.map_key);
          continue;
        }
        if (!entry.edges?.length && path.some((part) => part.unquoted_string?.pattern)) {
          // A glob sets the link of every shape it names that passes its filters, as in `*.link: x` or `**: {&shape: circle; link: x}`.
          const pattern = [...idSegments(scope.join('.')).map((text) => ({ text, glob: false })),
            ...path.map((part) => ({ text: stringValue(part) ?? '', glob: Boolean(part.unquoted_string?.pattern) }))];
          const keys = (entry.value?.map?.nodes ?? []).map((child) => child.map_key);
          const named = names.at(-1) === 'link' && !path.at(-1)!.unquoted_string?.pattern;
          const link = named ? entry : keys.filter((key) => !key?.ampersand && !key?.not_ampersand && key?.key?.path?.length === 1
            && stringValue(key.key.path[0]) === 'link').at(-1);
          const filters = keys.filter((key) => key?.ampersand || key?.not_ampersand).map((key) => ({
            key: (key!.key?.path ?? []).map((part) => stringValue(part) ?? '').join('.'),
            value: stringValue(key!.value) ?? key!.value?.number?.raw ?? String(key!.value?.boolean?.value ?? ''), glob: Boolean(key!.value?.unquoted_string), negate: Boolean(key!.not_ampersand) }));
          if (link) globs.push({ path: named ? pattern.slice(0, -1) : pattern, link: authoredLink(link), filters });
          continue;
        }
        if (['classes', 'vars', 'style', 'source-arrowhead', 'target-arrowhead'].includes(names[0])) continue;
        if (['layers', 'scenarios', 'steps'].includes(names[0])) {
          // `layers.x: ...` names its board in the key; bare `layers: {x: ...}` in each child key.
          const children = path.length > 1 ? [path[1]] : (entry.value?.map?.nodes ?? []).map((child) => child.map_key?.key?.path?.[0]);
          for (const part of children) {
            const name = stringValue(part);
            const range = scalarRange(part);
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
          authored.set(fullPath.slice(0, -1).join('.').toLowerCase(), authoredLink(entry));
        } else visitMap(entry.value?.map, fullPath);
      }
    }
    visitMap(graph.ast);
    classLinksOf.set(id, classLinks);
    // Links written in imported files: the root AST lacks them and child ASTs hold D2's resolved values.
    for (const shape of board.diagram.shapes) {
      const link = (imported ??= importedLinks(compiled)).get(JSON.stringify([board.id, shape.id]));
      const key = shape.id.toLowerCase();
      const own = authored.get(key);
      if (link && !own?.range?.match(/^[^,]/)) authored.set(key, prefer(own, link)!);
      // A shape's own link outranks a glob's; of several globs, the last wins.
      const attributes = (attributesOf ??= shapeAttributes(compiled.diagram, compiled.graph)).get(JSON.stringify([board.id, shape.id]));
      const glob = authored.has(key) ? undefined : [...globs].reverse().find((item) => globMatches(item.path, idSegments(shape.id))
        && (item.file === undefined || (filesOf ??= shapeFiles(compiled)).get(JSON.stringify([board.id, shape.id]))?.has(item.file))
        && (!item.filters.length || attributes && item.filters.every((filter) => filterMatches(filter, board, shape, attributes))));
      if (glob) authored.set(key, glob.link);
      // Then its classes: the last that sets a link wins.
      const classLink = authored.has(key) ? undefined : (shape.classes ?? []).map((name) => classLinks.get(name)).filter(Boolean).at(-1);
      if (classLink) authored.set(key, classLink);
    }
    for (const [shape, link] of authored) {
      // Only recover links D2 dropped; a kept link was already checked in its compiled form.
      // Skip templates and removed objects; a board-level link has no shape.
      const compiled = shape ? board.diagram.shapes.find((item) => item.id.toLowerCase() === shape) : board.diagram.root;
      if (!compiled || compiled.link || !link.href) continue;
      const id = shape ? compiled.id : undefined;
      if (link.href.includes('${')) dropped(board, id, link,
        `Link "${link.href}" uses a substitution, which D2 drops from board links, so the viewer ignores it. Write the board path itself.`);
      else checkLink(canonicalLink(link.href), board, id, link.range, undefined, true);
    }
    // A class's link is checked on the shapes that take it; one no shape takes, or that D2 never applies, is checked
    // where it is written, once, so a class that would break every shape it styles is caught before any uses it.
    // Its valid targets are not incoming links, as nothing opens them.
    const used = new Set(board.diagram.shapes.flatMap((shape) => shape.classes ?? []));
    const inherited = (name: string, link: Authored) => {
      for (let ancestor = board.parent; ancestor; ancestor = boards.get(ancestor)?.parent) {
        if (classLinksOf.get(ancestor)?.get(name)?.range === link.range) return true;
      }
      return false;
    };
    for (const link of [...[...classLinks].filter(([name, item]) => !used.has(name) && !inherited(name, item)).map(([, item]) => item), ...inertClassLinks]) {
      const href = canonicalLink(link.href);
      const target = boardTarget(href, board, boards);
      if (!link.href || target && boards.has(target)) continue;
      if (link.href.includes('${')) dropped(board, undefined, link,
        `Link "${link.href}" uses a substitution, which D2 drops from board links, so the viewer would ignore it. Write the board path itself.`);
      else checkLink(href, board, undefined, link.range);
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
        .find((link) => link?.range && !link.range.startsWith(',') && nulled(boardTarget(link.href, board, boards) ?? link.href) === nulled(wanted))?.range;
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
          message: keyedClasses.has(name) ? `Class "${name}" is defined only in "${keyedClasses.get(name)}", which is imported under a key, ` +
            `and D2 applies no classes from such a file, so it changes nothing. Spread the file at the top, as in ...@${keyedClasses.get(name)}, to use its classes.`
            : `Class "${name}" is not defined, so it changes nothing.${name.startsWith('zf-')
            ? ' Check the spelling, and import the Zoomflow library with ...@zoomflow.' : ' Check the spelling, or define it under classes.'}` });
      }
    }
  }

  // D2 draws Markdown as SVG text and silently drops its images; it rejects other HTML when compiling.
  for (const board of boards.values()) {
    for (const item of [...board.diagram.shapes, ...board.diagram.connections]) {
      // Class and table shapes have neither field.
      const { language, label } = item as { language?: string; label?: string };
      if (language !== 'markdown' || !/!\[[^\]]*\]\(/.test(label ?? '')) continue;
      const connection = 'route' in item;
      diagnostics.push({ rule: 'unsupported-label', severity: 'warning', board: board.id,
        ...connection ? { connection: item.id } : { shape: item.id, range: shapeRange(board.id, item.id) },
        message: 'Markdown images are not rendered, so this label shows without them. Use an icon or an image shape instead.' });
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
          // D2 IDs are case-insensitive within a board, so `API` and `api` name the same port.
          const matches = ports[direction].filter((port) => port.id.toLowerCase() === neighbour.toLowerCase());
          if (matches.length) evaluation.evaluated++;
          else diagnostics.push({ rule: `boundary-${direction}`, severity: 'error', board: board.id, shape,
            range: shapeRange(board.id, shape),
            message: `"${shape}" needs a zf-${direction} port named "${neighbour}" in "${label(child.id)}".` });
        }
      }
      for (const port of ports[direction]) {
        if (!requirements.some(({ required }) => [...required[direction]].some((id) => id.toLowerCase() === port.id.toLowerCase()))) diagnostics.push({
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
