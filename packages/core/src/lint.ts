import { boardKey, classifyHref, indexBoards, resolveFilePath, type Board } from './index';
import { definedClasses } from './classes';
import { lintNavigation } from './lint-navigation';
import { compareOrder, filterMatches, fileLinkRules, globMatches, idSegments, importedLinks, importPath, linkAfterKey, linkOrder, linkSources, shapeAttributes, shapeFiles, shapeRanges,
  type AuthoredLink, type GlobFilter, type GlobSegment } from './source';
import type { LintInput, LintOptions, LintResult, LintDiagnostic } from './lint-types';
import { boardLabel, boardTarget, nulled, type LintGraph, canonicalLink, type AstKey, stringValue, scalarRange, type AstImport, type AstValue, type AstMap, keySegment, keyword, edgeLink, boardClasses } from './lint-ast';

/** Lint a compiled document without following its cyclic navigation graph.
 * Shape identifiers, not display labels, are the boundary-port naming contract.
 * Pass the compiler's `fs` and `inputPath` too, so undefined classes on the root board are found.
 */
export function lint(compiled: LintInput, options: LintOptions = {}): LintResult {
  const boards = indexBoards(compiled.diagram);
  const diagnostics: LintDiagnostic[] = [];
  const links = new Map<string, Set<string>>();
  const linkKeys = new Set<string>();
  const boardRanges = new Map<string, string>();
  const label = (id: string) => boardLabel(id, boards);
  let ranges: Map<string, string> | undefined, sources: Map<string, string> | undefined;
  let imported: ReturnType<typeof importedLinks> | undefined;
  let attributesOf: ReturnType<typeof shapeAttributes> | undefined;
  let filesOf: ReturnType<typeof shapeFiles> | undefined;
  let orderOf: ReturnType<typeof linkOrder> | undefined;
  const rootFile = /^(.*),/.exec((compiled.graph as { ast?: { range?: string } }).ast?.range ?? '')?.[1];
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
      // Compare routes segment by segment, as the viewer's normalizeRouteHash does, so `#/My Board` and
      // `#/My%20Board` agree, a lone `%` reads as `%25`, and empty segments drop, as in `#/A/`.
      const route = (value: string) => value.split('/').filter((segment, index) => index === 0 || segment).map((segment) => {
        try { return encodeURIComponent(decodeURIComponent(segment.replace(/%(?![\da-f]{2})/gi, '%25'))); } catch { return segment; }
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
      const [file, fragment] = /^([^#]*\.d2)(#.*)?$/si.exec(href)?.slice(1) ?? [];
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
      // D2 keeps a leading `./` or `../` apart from the rest of the path.
      const name = stringValue(imported.path?.[0]);
      const path = name && `${imported.pre ?? ''}${name}`;
      const file = compiled.fs && entryFile !== undefined && path ? importPath(compiled.fs, entryFile, path) : undefined;
      if (!file) return;
      const rules = fileLinkRules(compiled.fs!, file);
      const prefix = idSegments(scope.join('.')).map((text) => ({ text, glob: false }));
      // Globs on its own boards reach the compiler-expanded child ASTs instead.
      for (const glob of rules.globs) if (!glob.board) globs.push({ ...glob, path: [...prefix, ...glob.path] });
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
        if (keyword(path[0]) === 'classes' && !scope.length) {
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
            value: stringValue(key!.value) ?? key!.value?.number?.raw ?? String(key!.value?.boolean?.value ?? ''), glob: Boolean(key!.value?.unquoted_string && stringValue(key!.value)?.includes('*')), negate: Boolean(key!.not_ampersand) }));
          if (link) globs.push({ path: named ? pattern.slice(0, -1) : pattern, link: authoredLink(link), filters });
          continue;
        }
        const first = keyword(path[0]) ?? '';
        if (['classes', 'vars', 'style', 'source-arrowhead', 'target-arrowhead'].includes(first)) continue;
        if (['layers', 'scenarios', 'steps'].includes(first)) {
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
      // Of a shape's own, imported and glob links, D2 applies the last; where a place is unknown, as in child boards'
      // expanded ASTs, its own link outranks an imported one, and either outranks a glob's.
      const place = (link: Authored) => (orderOf ??= linkOrder(compiled.fs && rootFile !== undefined ? fileLinkRules(compiled.fs, rootFile).regions : []))(
        link.range, board.id, shape.id);
      const after = (link: Authored, current: Authored) => {
        const [a, b] = [place(link), place(current)];
        return Boolean(a && b && compareOrder(a, b) > 0);
      };
      const link = (imported ??= importedLinks(compiled)).get(JSON.stringify([board.id, shape.id]));
      const key = shape.id.toLowerCase();
      const own = authored.get(key);
      const written = own?.range?.match(/^[^,]/);
      if (link && (!written || after(link, own!))) authored.set(key, written ? link : prefer(own, link)!);
      const attributes = (attributesOf ??= shapeAttributes(compiled.diagram, compiled.graph)).get(JSON.stringify([board.id, shape.id]));
      const glob = globs.filter((item) => globMatches(item.path, idSegments(shape.id))
        && (item.file === undefined || (filesOf ??= shapeFiles(compiled)).get(JSON.stringify([board.id, shape.id]))?.has(item.file))
        && (!item.filters.length || attributes && item.filters.every((filter) => filterMatches(filter, board, shape, attributes))))
        .reduce<typeof globs[number] | undefined>((last, item) => {
          const [a, b] = [place(item.link), last && place(last.link)];
          return !last || !a || !b || compareOrder(a, b) >= 0 ? item : last;
        }, undefined);
      const current = authored.get(key);
      if (glob && (!current || after(glob.link, current))) authored.set(key, glob.link);
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

  const boundaries = lintNavigation(boards, links, boardRanges, options, diagnostics, shapeRange);
  return { diagnostics, boundaries, boundaryPairsEvaluated: boundaries.reduce((sum, item) => sum + item.evaluated, 0) };
}

export type { LintRule, LintDiagnostic, LintOptions, BoundaryEvaluation, LintResult } from './lint-types';
export { boardLabel } from './lint-ast';
