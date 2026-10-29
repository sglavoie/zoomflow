import { classifyHref, type Board, type SourceRange } from '@zoomflow/core';
import { quote, readFlow, unquote } from './flow-model';
import { boardTopics, keywords, readMindMap, uniqueBoardName, type BoardTopic, type MindTopic } from './mind-map-model';

export type BuilderKind = 'flow' | 'mind map';
/** A board that opens from a shape, kept in a section at the end of the board it opens from. */
export type BoardAttachment = { shape: string; name: string; body: string };
/** A link from a shape to another file of the project, as authored (`./health.d2#/Sleep`), kept in the same section. */
export type FileAttachment = { shape: string; file: string };
export type Attachment = BoardAttachment | FileAttachment;
export const isFileAttachment = (item: Attachment): item is FileAttachment => 'file' in item;
/** A board's own text and the boards that open from its shapes. Builders rewrite only the own text. */
export type BoardParts = { own: string; attachments: Attachment[] };

const heading = '# Boards that open from shapes on this board.';
const quoted = '"(?:[^"\\\\]|\\\\.)*"';
const linkLine = new RegExp(`^(.+)\\.link: layers\\.(${quoted})$`);
const fileLine = new RegExp(`^(.+)\\.link: (${quoted})$`);

/** The attached boards are read only in the exact form `joinBoard` writes; anything else stays own text. Of several
 * sections, the last is read: a hand-edited one stays own text, and `joinBoard` writes a new one after it. */
export function splitBoard(text: string): BoardParts {
  const normalized = text.replaceAll('\r\n', '\n');
  const later = normalized.lastIndexOf(`\n${heading}\n`) + 1;
  const at = later || (normalized.startsWith(`${heading}\n`) ? 0 : -1);
  const whole = { own: text, attachments: [] };
  if (at < 0) return whole;
  const lines = normalized.slice(at + heading.length + 1).split('\n');
  const attachments: Attachment[] = [];
  try {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const link = linkLine.exec(lines[i]);
      const file = !link && fileLine.exec(lines[i]);
      if (file) {
        const href = unquote(file[2]);
        if (classifyHref(href).kind !== 'file') return whole;
        attachments.push({ shape: file[1], file: href });
        continue;
      }
      if (!link || lines[i + 1] !== `layers.${link[2]}: {`) return whole;
      // Attached boards indent their text, so the first unindented brace closes the block.
      const end = lines.indexOf('}', i + 2);
      const body = lines.slice(i + 2, end);
      if (end < 0 || body.some(line => line && !line.startsWith('  '))) return whole;
      attachments.push({ shape: link[1], name: unquote(link[2]), body: body.map(line => line.slice(2)).join('\n') });
      i = end;
    }
  } catch { return whole; }
  return { own: normalized.slice(0, at), attachments };
}

/** A shape's identifier as D2 reports it, with single-quoted parts like `'null'` double-quoted: D2's own parser
 * accepts both, but board indexing reads only double-quoted keys. D2 reports a shape keyed `"label"` as `label`,
 * so bare parts that read as keywords are quoted too, or `label.link` would set no link. */
function shapeKey(id: string): string {
  return id.replace(/"(?:[^"\\]|\\.)*"|'((?:[^']|'')*)'|[^."']+/g, (part, text?: string) =>
    text !== undefined ? quote(text.replaceAll("''", "'"))
      : !part.startsWith('"') && (part === '_' || keywords.has(part.toLowerCase())) ? quote(part) : part);
}

export function joinBoard({ own, attachments }: BoardParts): string {
  if (!attachments.length) return own;
  const section = attachments.map(item => isFileAttachment(item) ? `${shapeKey(item.shape)}.link: ${quote(item.file)}`
    : [`${shapeKey(item.shape)}.link: layers.${quote(item.name)}`, `layers.${quote(item.name)}: {`,
      ...item.body.trim().split('\n').map(line => line && `  ${line}`), '}'].join('\n'));
  return `${own.trimEnd()}\n\n${heading}\n${section.join('\n\n')}\n`;
}

/** A board's block as text without its indentation, and the document with that text in its place.
 * The root board's block is the whole document. */
export function blockText(source: string, block: SourceRange) {
  if (block.from === 0 && block.to === source.length) return { text: source, replace: (text: string) => text };
  const inner = source.slice(block.from, block.to);
  const lineStart = source.lastIndexOf('\n', block.from - 1) + 1;
  const outer = /^[ \t]*/.exec(source.slice(lineStart))![0];
  const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];
  let text = inner.trim();
  let indent = `${outer}  `;
  if (inner.includes('\n')) {
    const lines = inner.split('\n');
    if (!lines[0].trim()) lines.shift();
    if (!lines.at(-1)!.trim()) lines.pop();
    const indents = lines.filter(line => line.trim()).map(indentOf);
    if (indents.length) indent = indents.reduce((shortest, next) => next.length < shortest.length ? next : shortest);
    text = lines.map(line => line.slice(Math.min(indent.length, indentOf(line).length))).join('\n');
  }
  return {
    text,
    replace(next: string) {
      const body = next.trimEnd().replace(/^\n+/, '');
      const replaced = body ? `\n${body.split('\n').map(line => line && indent + line).join('\n')}\n${outer}` : '';
      return source.slice(0, block.from) + replaced + source.slice(block.to);
    },
  };
}

export function builderKind(own: string): BuilderKind | undefined {
  return readFlow(own) ? 'flow' : readMindMap(own) ? 'mind map' : undefined;
}

/** Keep each attached board on the same step or topic after a builder rewrites the own text, or explain why it cannot.
 * Flow steps keep their identifiers. Mind map topics follow `moved`, each topic's new identifier by its old one, when
 * the edit knows it; otherwise they are found again by their labels, or in place when only labels changed.
 * The central topic is always itself. A link to another file goes with a removed step or topic, since the file stays. */
export function reattach(before: string, after: string, attachments: Attachment[], moved?: Map<string, string>): Attachment[] | string {
  if (!attachments.length) return attachments;
  const flows = [readFlow(before), readFlow(after)];
  if (flows[0] && flows[1]) {
    const ids = new Set(flows[1].steps.map(step => step.id));
    const gone = (item: Attachment) => !ids.has(item.shape) && flows[0]!.steps.some(step => step.id === item.shape);
    const removed = attachments.find(item => !isFileAttachment(item) && gone(item)) as BoardAttachment | undefined;
    if (!removed) return attachments.some(gone) ? attachments.filter(item => !gone(item)) : attachments;
    const label = flows[0].steps.find(step => step.id === removed.shape)!.label;
    return `The step “${label}” opens the board “${removed.name}”. Keep the step, or delete its board in the source first.`;
  }
  const maps = [readMindMap(before), readMindMap(after)];
  if (!maps[0] || !maps[1]) return 'This board changed type. Delete its attached boards in the source first.';
  const [old, next] = maps.map(map => boardTopics(map!));
  const taken = new Map(next.filter(topic => topic.board).map(topic => [topic.board!.toLowerCase(), topic]));
  const sameShape = old.length === next.length && old.every((topic, i) => topic.id === next[i].id);
  // Topics of the whole outline, detail boards included, to tell a topic that left this board from a removed one.
  const outline = new Set<string>();
  const collect = (topic: MindTopic) => { outline.add(topic.label); topic.children.forEach(collect); };
  collect(maps[1].root);
  const kept: Attachment[] = [];
  for (const item of attachments) {
    const from = old.find(topic => topic.id === item.shape);
    if (!from) { kept.push(item); continue; }
    const label = from.path.at(-1)!;
    const path = (topic: BoardTopic) => topic.path.join('\n');
    // A topic with the labels of another topic that was already there is that topic, whatever its new identifier.
    const another = (topic: BoardTopic) => old.some(other => other !== from && path(other) === path(topic));
    // A topic moved elsewhere is found by its label when that is unique, and not on a topic that was already there.
    const sameLabel = next.filter(topic => topic.path.at(-1) === label);
    const elsewhere = sameLabel.length === 1 && !another(sameLabel[0]);
    const inPlace = next.find(topic => topic.id === from.id);
    // Topics with the same labels from the centre down are told apart by their place.
    const samePath = next.filter(topic => path(topic) === path(from));
    const to = from.id === 'n' ? next[0] : moved ? next.find(topic => topic.id === moved.get(from.id))
      : (inPlace && path(inPlace) === path(from) ? inPlace : samePath.length === 1 ? samePath[0] : undefined) ?? (elsewhere ? sameLabel[0]
        // A renamed ancestor keeps the topic in place; so does a renamed topic when no topic was added or removed.
        : inPlace && !another(inPlace) && (inPlace.path.at(-1) === label || sameShape) ? inPlace : undefined);
    if (isFileAttachment(item)) {
      if (!to && !sameLabel.length && outline.has(label)) return `The topic “${label}” opens the file “${item.file}” and would move to a detail board. Keep it on this board, or remove its link first.`;
      if (!to) continue;
      if (to.board) return `The topic “${label}” would open a detail board and the file “${item.file}”. Choose fewer detail boards, or remove its link first.`;
      if (kept.some(other => other.shape === to.id)) return `Two topics named “${label}” open boards or files. Rename one of them first.`;
      kept.push({ ...item, shape: to.id });
      continue;
    }
    if (!to) return `The topic “${label}” opens the board “${item.name}”. Keep the topic, or delete its board in the source first.`;
    if (to.board) return `The topic “${label}” would open a detail board and the board “${item.name}”. Choose fewer detail boards, or delete its board in the source first.`;
    if (taken.has(item.name.toLowerCase())) return `The board “${item.name}” that opens from “${label}” has the same name as a detail board. Rename the topic “${taken.get(item.name.toLowerCase())!.path.at(-1)}”.`;
    if (kept.some(other => other.shape === to.id)) return `Two topics named “${label}” open boards. Rename one of them first.`;
    kept.push({ ...item, shape: to.id });
  }
  return kept;
}

export type ShapeAction =
  | { action: 'add' }
  /** The shape opens another file; `attached` when its link is in the board's attachment section, so it can change. */
  | { action: 'file'; link: string; attached: boolean }
  | { action: 'edit'; board: string; kind: BuilderKind }
  | { action: 'none'; reason: string };

/** What the builders can do with each board of one compiled document. `blocks` come from `boardBlocks`. */
export function boardSites(source: string, blocks: Map<string, SourceRange>, boards: Map<string, Board>) {
  const sites = new Map<string, ReturnType<typeof read>>();
  function read(id: string) {
    const block = blocks.get(id);
    if (!block) return;
    const { text, replace } = blockText(source, block);
    const parts = splitBoard(text);
    return { parts, kind: builderKind(parts.own), replace };
  }
  function site(id: string) {
    if (!sites.has(id)) sites.set(id, read(id));
    return sites.get(id);
  }
  /** The builder board whose own text writes this board: the board itself, or the nearest ancestor that
   * generates it, like a mind map's detail boards. Attached boards are not generated by their parent. */
  function owner(id: string): string | undefined {
    if (site(id)?.kind) return id;
    for (let child = id, parent = boards.get(id)?.parent; parent; child = parent, parent = boards.get(parent)?.parent) {
      const name = boards.get(child)!.name;
      if (site(parent)?.kind && !site(parent)!.parts.attachments.some(item => !isFileAttachment(item) && item.name === name)) return parent;
    }
  }
  return {
    owner,
    /** The builder board that writes `board`, its own text, and the detail board names from it down to `board`. */
    canvas(board: string) {
      const id = owner(board);
      if (!id) return;
      const trail: string[] = [];
      for (let child = board; child !== id; child = boards.get(child)!.parent!) trail.unshift(boards.get(child)!.name);
      return { owner: id, own: site(id)!.parts.own, trail };
    },
    /** The builder and own text of a board that `owner` returned. */
    builder(id: string) {
      const current = site(id);
      return current?.kind && { kind: current.kind, own: current.parts.own };
    },
    shapeAction(board: string, shape: string): ShapeAction {
      const found = boards.get(board)?.diagram.shapes.find(item => item.id === shape);
      if (!found) return { action: 'none', reason: 'This shape is not on the board.' };
      const ownerId = owner(board);
      if (found.link && classifyHref(found.link).kind === 'file') {
        const attached = ownerId === board || !ownerId
          ? Boolean(site(board)?.parts.attachments.some(item => isFileAttachment(item) && shapeKey(item.shape) === shapeKey(shape))) : false;
        return { action: 'file', link: found.link, attached };
      }
      if (found.link) {
        const target = boards.get(found.link);
        const kind = target?.parent === board && target.kind === 'layers' && owner(target.id) === target.id ? site(target.id)!.kind : undefined;
        return kind ? { action: 'edit', board: target!.id, kind } : { action: 'none', reason: 'This shape already opens another board or link.' };
      }
      if (ownerId && ownerId !== board) {
        return { action: 'none', reason: `This board is part of the ${site(ownerId)!.kind} on “${boards.get(ownerId)!.name}”. Add boards from its main board.` };
      }
      if (!site(board)) return { action: 'none', reason: 'Boards can be added only to boards written once in this file, not to imported boards, scenarios or steps.' };
      return { action: 'add' };
    },
    /** The document with a new board, written by a builder, that opens from `shape`. */
    add(board: string, shape: string, own: string, label: string) {
      const current = site(board)!;
      const taken = new Set([...boards.values()].filter(item => item.parent === board).map(item => item.name.toLowerCase()));
      for (const item of current.parts.attachments) if (!isFileAttachment(item)) taken.add(item.name.toLowerCase());
      const name = uniqueBoardName(label, taken);
      return { name, source: current.replace(joinBoard({ own: current.parts.own,
        attachments: [...current.parts.attachments, { shape, name, body: own }] })) };
    },
    /** The document with `shape` opening another file by `file`, a link as authored; it replaces the shape's earlier file link. */
    linkFile(board: string, shape: string, file: string) {
      const current = site(board)!;
      const attachments = [...current.parts.attachments];
      const index = attachments.findIndex(item => isFileAttachment(item) && shapeKey(item.shape) === shapeKey(shape));
      if (index >= 0) attachments[index] = { shape: attachments[index].shape, file };
      else attachments.push({ shape, file });
      return current.replace(joinBoard({ own: current.parts.own, attachments }));
    },
    /** The document without the file link `linkFile` wrote for `shape`. */
    unlinkFile(board: string, shape: string) {
      const current = site(board)!;
      const attachments = current.parts.attachments.filter(item => !(isFileAttachment(item) && shapeKey(item.shape) === shapeKey(shape)));
      return current.replace(attachments.length ? joinBoard({ own: current.parts.own, attachments }) : `${current.parts.own.trimEnd()}\n`);
    },
    /** The document with a builder board's own text replaced, or why its attached boards prevent that. */
    update(board: string, own: string, moved?: Map<string, string>): { source: string } | { error: string } {
      const current = site(board)!;
      const attachments = reattach(current.parts.own, own, current.parts.attachments, moved);
      if (typeof attachments === 'string') return { error: attachments };
      return { source: current.replace(joinBoard({ own, attachments })) };
    },
  };
}
export type BoardSites = ReturnType<typeof boardSites>;
