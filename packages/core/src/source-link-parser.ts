import { boardKey } from './index';
import { idSegments } from './source-graph';

/** A link as written: its text and where. */
export interface AuthoredLink { href: string; range: string }

export type Scalar = { value: string; from: number; to: number };

export const spaces = /[ \t]*/y;

export const doubleQuoted = /"((?:[^"\\\n]|\\.)*)"/y;

export const singleQuoted = /'((?:[^'\n]|'')*)'/y;

export const unquoted = /(?:\$\{[^}\n]*\}|[^;{}\n#\\]|\\.)*/y;

export const pipes = /\|+`*/y;

export const sticky = (pattern: RegExp, text: string, index: number) => { pattern.lastIndex = index; return pattern.exec(text); };

/** A string starting at `from`, after spaces, or undefined for anything else, such as an array or an import.
 * Unquoted text ends at a `;`, a brace, a line break or a `#`, which starts a comment even mid-word, as D2 reads
 * `./x.d2#/A` as `./x.d2`. Substitutions such as `${x}` are kept as written. */
export function scalarAt(text: string, from: number): Scalar | undefined {
  const start = from + sticky(spaces, text, from)![0].length;
  const quoted = text[start] === '"' ? sticky(doubleQuoted, text, start) : text[start] === "'" ? sticky(singleQuoted, text, start) : null;
  if (quoted) return { value: text[start] === '"' ? quoted[1].replace(/\\(.)/g, '$1') : quoted[1].replaceAll("''", "'"), from: start, to: start + quoted[0].length };
  if (text[start] === '|') {
    // Block strings close with the reverse of the pipes and backticks that opened them, as `|`md` with `` `| ``.
    const open = sticky(pipes, text, start)![0];
    const close = text.indexOf([...open].reverse().join(''), start + open.length);
    if (close < 0) return;
    const value = text.slice(start + open.length, close).replace(/^\w*[ \t\n]/, '').trim();
    return { value, from: start, to: close + open.length };
  }
  const plain = sticky(unquoted, text, start)![0].trimEnd();
  if (!plain || /^[`[@'"]/.test(plain)) return;
  return { value: plain.replace(/\\(.)/g, '$1'), from: start, to: start + plain.length };
}

/** The offset of each statement of the map body starting at `from`, up to its closing brace, or of a whole file
 * (`file`), skipping strings, block strings, comments and nested maps; undefined when the text does not balance. */
export function statements(text: string, from: number, file = false): number[] | undefined {
  return scanMap(text, from, file)?.starts;
}

/** As `statements`, with the offset of the closing brace, or the file's length. */
export function scanMap(text: string, from: number, file = false): { starts: number[]; end: number } | undefined {
  const starts = [from];
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === '\n' || char === ';') { if (depth === 0) starts.push(i + 1); }
    else if (char === '\\') i++;
    else if (char === '#') {
      i = text.indexOf('\n', i) - 1;
      if (i < 0) break;
    } else if (char === '{') depth++;
    else if (char === '}' && depth-- === 0) return file ? undefined : { starts, end: i };
    else if (text.startsWith('"""', i)) {
      // A block comment, which may hold anything.
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 2;
    }
    // Only a token opens a string: the quote in `Don't` or the pipe in `x: in | out` is label text; `c."k#1"`,
    // `a ->"k}"` and `("k}" -> a)` quote keys.
    else if ((char === '"' || char === "'") && /[\s:;.,{[@(<>&!-]/.test(text[i - 1] ?? '\n') || char === '|' && /:[ \t]*$/.test(text.slice(Math.max(from, i - 40), i))) {
      const string = scalarAt(text, i);
      if (string) i = string.to - 1;
    }
  }
  return file && depth === 0 ? { starts, end: text.length } : undefined;
}

/** A glob filter, as `&shape: circle` or `!&label: A*`; `glob` marks an unquoted value, where `*` matches any text. */
export type GlobFilter = { key: string; value: string; glob: boolean; negate: boolean };

export const linkKey = /\s*(?:link|"link"|'link')[ \t]*:/y;

export const filterKey = /\s*(!?)&([^:;{}\n#]+?)[ \t]*:/y;

/** The last `link` value among the statements of the map opening after the colon at or after `from`, as in
 * `: label {link: x}`, and the glob filters the map holds. */
export function mapLink(text: string, from: number): { link?: Scalar; filters: GlobFilter[] } | undefined {
  const colon = /[ \t]*:/y;
  if (!sticky(colon, text, from)) return;
  let i = colon.lastIndex;
  if (!/^[ \t]*\{/.test(text.slice(i, i + 80))) {
    const label = scalarAt(text, i);
    if (!label) return;
    i = label.to;
  }
  const brace = sticky(/[ \t]*\{/y, text, i);
  if (!brace) return;
  let link: Scalar | undefined;
  const filters: GlobFilter[] = [];
  for (const start of statements(text, i + brace[0].length) ?? []) {
    const filter = sticky(filterKey, text, start);
    const value = filter && scalarAt(text, filterKey.lastIndex);
    if (filter) {
      if (!value) return { filters: [] };
      filters.push({ key: filter[2].trim(), value: value.value, glob: !/["']/.test(text[value.from]) && value.value.includes('*'), negate: filter[1] === '!' });
    } else if (sticky(linkKey, text, start)) link = scalarAt(text, linkKey.lastIndex) ?? link;
  }
  return { link, filters };
}

/** A D2 range for `from` to `to` in `file`, as `file,line:column:offset-line:column:offset`. */
export function textRange(file: string, text: string, from: number, to: number): string {
  const position = (offset: number) => {
    const line = text.lastIndexOf('\n', offset - 1) + 1;
    let lines = 0;
    for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) lines++;
    return `${lines}:${offset - line}:${offset}`;
  };
  return `${file},${position(from)}-${position(to)}`;
}

/** An unquoted `null`, in any case, removes the link, so it reads as none. */
export const authored = (file: string, text: string, scalar: Scalar): AuthoredLink =>
  ({ href: /^null$/i.test(scalar.value) && !/["'|]/.test(text[scalar.from]) ? '' : scalar.value, range: textRange(file, text, scalar.from, scalar.to) });

/** The link written after the key ending at `range`'s end, in `a.link: x` form, read from the file's text; the
 * compiler's own value can be substituted or resolved, as in child boards. */
export function linkAfterKey(range: string | undefined, fs: Record<string, string> | undefined): AuthoredLink | undefined {
  const match = /^(.+),\d+:\d+:\d+-\d+:\d+:(\d+)$/.exec(range ?? '');
  const text = match ? fs?.[match[1]] : undefined;
  if (text === undefined) return;
  const colon = sticky(/[ \t]*:/y, text, Number(match![2]));
  const scalar = colon && scalarAt(text, Number(match![2]) + colon[0].length);
  return scalar ? authored(match![1], text, scalar) : undefined;
}

/** A glob key path segment: its text, and whether it is an unquoted pattern such as `*` or `a*`; `quoted` marks a
 * quoted key, such as `"layers"`, which D2 reads as an ordinary shape, never a keyword. */
export type GlobSegment = { text: string; glob: boolean; quoted?: boolean };

export const segmentOf = (part: RegExpExecArray): GlobSegment => ({ text: part[1]?.replace(/\\(.)/g, '$1') ?? part[2]?.replaceAll("''", "'") ?? part[3],
  glob: part[3]?.includes('*') ?? false, quoted: part[3] === undefined });

/** An unquoted board keyword, in any case, as D2 merges `LAYERS` into `layers`. */
export const boardGroup = (segment: GlobSegment | undefined) =>
  segment && !segment.quoted && !segment.glob && boardGroups.has(segment.text.toLowerCase()) ? segment.text.toLowerCase() : undefined;

export const isClasses = (segment: GlobSegment) => !segment.quoted && segment.text === 'classes';

export const keyPart = /\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\n]|'')*)'|([^.:;{}\n#"'&]*[^.:;{}\n#"'\s&]))\s*(\.|(?=:))/y;

export const importTarget = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[^\s;#}]+`;

// Trailing whitespace takes the `\r` of CRLF line endings.
export const importLine = new RegExp(String.raw`\s*(?:\.\.\.@(${importTarget})|((?:[^:;{}\n#]+?))\s*:\s*@(${importTarget}))[ \t\r]*(?=[;\n#}]|$)`, 'y');

/** An import's path as written, quoted or not, without its quotes. */
export const importText = (path: string) => path[0] === '"' ? path.slice(1, -1).replace(/\\(.)/g, '$1')
  : path[0] === "'" ? path.slice(1, -1).replaceAll("''", "'") : path;

/** A glob that sets links: its key path, the link, and the filters that limit it. */
export type GlobLink = { path: GlobSegment[]; link: AuthoredLink; filters: GlobFilter[]; /** The file that wrote it. */ file: string;
  /** The board it is written on, after `root`, as `.layers.x`; empty for the root board. */ board: string };

/** Where a stretch of a file's text sits in D2's evaluation: the board it writes, after `root` as in `GlobLink`, the
 * key path it is imported under, and the offsets of the import statements that reach it, outermost first. */
export type LinkRegion = { file: string; from: number; to: number; board: string; depth: number; scope: string[]; chain: number[] };

export const boardGroups = new Set(['layers', 'scenarios', 'steps']);

// Keys whose maps hold attributes or definitions, not shapes.
export const attributeKeys = new Set(['classes', 'vars', 'style', 'source-arrowhead', 'target-arrowhead', 'label', 'icon', 'tooltip', 'near']);

/** The links a file sets for more than one shape: each glob statement, as in `*.link: x` or
 * `a.*: {&shape: circle; link: x}`, with its key path, file and board, including those in nested maps and board
 * blocks, and each class it defines at its top, as in `classes: {x: {link: y}}`; a later class definition replaces
 * an earlier one. Its imports are followed wherever they are: globs under their keys, and classes only from whole
 * files spread at the top, as D2 adds them. `regions` places every stretch of text read, for `linkOrder`. */
export function fileLinkRules(fs: Record<string, string>, file: string, seen = new Set<string>()):
  { globs: GlobLink[]; classes: Map<string, AuthoredLink>; regions: LinkRegion[] } {
  const globs: GlobLink[] = [];
  const classes = new Map<string, AuthoredLink>();
  const regions: LinkRegion[] = [];
  type Place = { board: string; depth: number; scope: GlobSegment[]; chain: number[] };
  function readFile(file: string, place: Place, classy: boolean) {
    const text = fs[file];
    const scan = text === undefined || seen.has(file) ? undefined : scanMap(text, 0, true);
    if (!scan) return;
    seen.add(file);
    readMap(file, text!, scan, place, classy);
    // `seen` guards only the import chain, so a file imported at two places adds its rules at both.
    seen.delete(file);
  }
  function readMap(file: string, text: string, scan: { starts: number[]; end: number }, place: Place, classy: boolean) {
    const { board, depth, scope, chain } = place;
    regions.push({ file, from: scan.starts[0], to: scan.end, board, depth, scope: scope.map((segment) => segment.text), chain });
    /** The key path at `start`, and the offset of the colon after it, or undefined without one. */
    const keyAt = (start: number) => {
      const path: GlobSegment[] = [];
      let at = start;
      for (let part = sticky(keyPart, text, at); part; part = sticky(keyPart, text, at)) {
        path.push(segmentOf(part));
        at = keyPart.lastIndex;
        if (part[4] !== '.') break;
      }
      return path.length && text[at] === ':' ? { path, at } : undefined;
    };
    /** The link a key path ending in `link`, or a map after it, sets. */
    const linkOf = (path: GlobSegment[], start: number, at: number) => {
      const last = path.at(-1)!;
      if (!last.glob && last.text === 'link') return { link: linkAfterKey(textRange(file, text, start, at), fs), named: true, filters: [] };
      const map = mapLink(text, at);
      return { link: map?.link && authored(file, text, map.link), named: false, filters: map?.filters ?? [] };
    };
    const defineClass = (path: GlobSegment[], start: number, at: number) => {
      if (path.length > 2 || path.length === 2 && path[1].text !== 'link') return;
      const { link } = linkOf(path, start, at);
      if (link) classes.set(path[0].text, link);
    };
    /** The statements of the map after the colon at `at`, as in `: {` or `: label {`. */
    const mapAfter = (at: number) => {
      let i = at + 1;
      if (!/^[ \t]*\{/.test(text.slice(i, i + 80))) {
        const label = scalarAt(text, i);
        if (!label) return;
        i = label.to;
      }
      const brace = sticky(/[ \t]*\{/y, text, i);
      return brace ? scanMap(text, i + brace[0].length) : undefined;
    };
    /** Follow the import `imported` at `start`, under `prefix` and its own key; a key naming a board, as in
     * `layers.x: @f` or `layers: {x: @f}`, imports the file as that board. */
    const readImport = (imported: RegExpExecArray, start: number, place: Place, prefix: GlobSegment[], classy: boolean) => {
      const target = importPath(fs, file, importText(imported[1] ?? imported[3]));
      const key = imported[2] ? keyPath(imported[2]) : [];
      if (!target || !key) return;
      let path = [...prefix, ...key];
      let { board, depth } = place;
      for (let group = boardGroup(path[0]); !place.scope.length && group && path.length > 1 && !path[1].glob; group = boardGroup(path[0])) {
        board = `${board}.${group}.${boardKey(path[1].text)}`;
        depth++;
        path = path.slice(2);
      }
      readFile(target, { board, depth, scope: [...place.scope, ...path], chain: [...place.chain, start] }, classy);
    };
    /** A statement with key path `path` ending at the colon `at`, read on `place`. */
    const statement = (path: GlobSegment[], start: number, at: number, end: number, place: Place, classy: boolean) => {
      const { scope } = place;
      // `layers.x: {…}` and `scenarios.s.a.link: y` write board `x` or `s`; `layers: {x: …}` names each board in its map.
      const group = scope.length ? undefined : boardGroup(path[0]);
      if (group) {
        if (path.length === 1) {
          const inner = mapAfter(at);
          for (const child of inner?.starts ?? []) {
            const imported = sticky(importLine, text, child);
            if (imported) { readImport(imported, child, place, [path[0]], false); continue; }
            const key = keyAt(child);
            if (key) statement([path[0], ...key.path], child, key.at, end, place, false);
          }
          return;
        }
        if (path[1].glob) return;
        const child = { ...place, board: `${place.board}.${group}.${boardKey(path[1].text)}`, depth: place.depth + 1 };
        const rest = path.slice(2);
        if (!rest.length) {
          const inner = mapAfter(at);
          if (inner) readMap(file, text, inner, child, false);
        } else {
          // The statement writes the board from within its parent's text.
          regions.push({ file, from: start, to: end, board: child.board, depth: child.depth, scope: [], chain: place.chain });
          statement(rest, start, at, end, child, false);
        }
        return;
      }
      if (isClasses(path[0])) {
        if (!classy) return;
        if (path.length > 1) defineClass(path.slice(1), start, at);
        else {
          // `classes: {x: {link: y}; z.link: w}` defines each class in its map.
          const brace = sticky(/[ \t]*:[ \t]*\{/y, text, at);
          for (const inner of brace ? statements(text, brace.index + brace[0].length) ?? [] : []) {
            const entry = keyAt(inner);
            if (entry) defineClass(entry.path, inner, entry.at);
          }
        }
        return;
      }
      if (path.some((segment) => segment.glob)) {
        const { link, named, filters } = linkOf(path, start, at);
        if (link) globs.push({ path: [...scope, ...(named ? path.slice(0, -1) : path)], link, filters, file, board: place.board });
        return;
      }
      // A shape's map, as `g: {…}`, holds globs and imports under its key; edges and attributes hold none.
      if (path.some((segment) => attributeKeys.has(segment.text) || segment.text === 'link' || /<-|->|--/.test(segment.text))) return;
      const inner = mapAfter(at);
      if (inner) readMap(file, text, inner, { ...place, scope: [...scope, ...path] }, false);
    };
    for (const [index, start] of scan.starts.entries()) {
      const end = scan.starts[index + 1] ?? scan.end;
      const imported = sticky(importLine, text, start);
      if (imported) {
        readImport(imported, start, place, [], classy && !imported[2]);
        continue;
      }
      const key = keyAt(start);
      if (key) statement(key.path, start, key.at, end, place, classy);
    }
  }
  readFile(file, { board: '', depth: 0, scope: [], chain: [] }, true);
  return { globs, classes, regions };
}

/** Where a link written at `range` falls in D2's evaluation of shape `shape` on board `board`, for comparing which
 * of two assignments D2 applies last: a later statement wins, and one written on a child board wins over those it
 * inherits. Undefined when the text is not in `regions`, as for compiler placeholders. */
export function linkOrder(regions: LinkRegion[]): (range: string | undefined, board: string, shape: string) => number[] | undefined {
  return (range, board, shape) => {
    const match = /^(.+),\d+:\d+:(\d+)-\d+:\d+:\d+$/.exec(range ?? '');
    if (!match) return;
    const offset = Number(match[2]);
    const segments = idSegments(shape).map((segment) => segment.toLowerCase());
    let found: LinkRegion | undefined;
    for (const region of regions) {
      const full = `root${region.board}`;
      const applies = board === full || board.startsWith(`${full}.`) && !/\.layers\./.test(`${board.slice(full.length)}.`);
      if (region.file !== match[1] || offset < region.from || offset >= region.to || !applies) continue;
      if (!region.scope.every((segment, index) => segment.toLowerCase() === segments[index])) continue;
      // The innermost board, then the last place the file is imported.
      if (!found || region.depth > found.depth || region.depth === found.depth && compareOrder(region.chain, found.chain) >= 0) found = region;
    }
    return found && [found.depth, ...found.chain, offset];
  };
}

/** Compare two `linkOrder` places: negative when `a` comes first. */
export function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Split an unquoted or quoted key path, such as `a."b.c"`; undefined for one this does not read. */
export function keyPath(key: string): GlobSegment[] | undefined {
  const path: GlobSegment[] = [];
  const text = `${key}:`;
  let at = 0;
  for (let part = sticky(keyPart, text, at); part; part = sticky(keyPart, text, at)) {
    path.push(segmentOf(part));
    at = keyPart.lastIndex;
    if (part[4] !== '.') return at === key.length ? path : undefined;
  }
}

/** The `fs` key of the file `@path` imports from `file`, relative to its folder. */
export function importPath(fs: Record<string, string>, file: string, path: string): string | undefined {
  const parts: string[] = [];
  for (const part of [...file.split('/').slice(0, -1), ...path.split('/')]) {
    if (part === '..') parts.pop(); else if (part !== '.' && part) parts.push(part);
  }
  const joined = parts.join('/');
  return [`${joined}.d2`, joined].find((key) => key in fs);
}
