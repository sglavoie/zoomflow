import { cleanLabel, lookClasses, quote, readLook, unquote, type Look } from './flow-model';

export type MindTopic = { label: string; children: MindTopic[] };
/** `split` is the level whose topics open their subtopics on a detail board; 0 keeps one board. */
export type MindMap = { direction: 'right' | 'down'; split: number; look: Look; root: MindTopic };

const heading = '# Created with the Zoomflow mind map builder.';
const splitNote = (split: number) => split
  ? `# Level ${split} topics with subtopics open as detail boards.` : '# All topics stay on one board.';
/** Import on every board: a map attached inside another board cannot pass its classes to its details. */
const library = '...@zoomflow';
const accents = 6;
const quoted = '"(?:[^"\\\\]|\\\\.)*"';
/** D2 ignores links to boards named like a keyword in any case but lowercase. */
export const keywords = new Set(('label shape icon width height constraint tooltip link near direction top left grid-rows ' +
  'grid-columns grid-gap vertical-gap horizontal-gap class classes vars layers scenarios steps style source-arrowhead ' +
  'target-arrowhead opacity stroke fill fill-pattern stroke-width stroke-dash border-radius shadow 3d multiple ' +
  'double-border font font-size font-color animated bold italic underline filled text-transform').split(' '));

export const mindMapExample = `Product launch
  Audience
    Early adopters
    Small teams
  Marketing
    Social media
      Short videos
      Community posts
    Newsletter
  Product
    Pricing
    Onboarding
  Risks`;

/** Board names appear in breadcrumbs and links, so keep them readable but within what D2 links accept. */
export function detailBoardName(label: string): string {
  // D2 reads `$` in a link as the start of a variable, so the link would miss its board.
  const name = label.replace(/["\\#{}[\];$]/g, character =>
    ({ '"': "'", '\\': '/', '{': '(', '[': '(', '}': ')', ']': ')', ';': ',' })[character] ?? ' ')
    .replace(/\s+/g, ' ').trim();
  if (!name || name === '_') return 'Topic';
  // Boards named after the board containers cannot be linked to in any case, nor can `null`, which D2 quotes in links.
  if (/^(?:layers|scenarios|steps|null)$/i.test(name)) return `${name} topic`;
  return keywords.has(name.toLowerCase()) ? name.toLowerCase() : name;
}

/** A board name for `label` that differs from `taken` in any case, as D2 board names must; it joins `taken`. */
export function uniqueBoardName(label: string, taken: Set<string>): string {
  let name = detailBoardName(label);
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${detailBoardName(label)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

export type BoardTopic = { id: string; path: string[]; topic: MindTopic; parent?: MindTopic; board?: string };
/** The topics on the board centred on `center` (the main board by default), with the identifiers `mindMapSource`
 * gives them, their labels from the centre down, and the detail board each detail topic opens. */
export function boardTopics(map: MindMap, center = map.root): BoardTopic[] {
  const topics: BoardTopic[] = [];
  const names = new Set<string>();
  const visit = (topic: MindTopic, id: string, path: string[], parent?: MindTopic) => {
    const detail = path.length > 1 && path.length - 1 === map.split && topic.children.length > 0;
    topics.push({ id, path, topic, ...parent ? { parent } : {}, ...detail ? { board: uniqueBoardName(topic.label, names) } : {} });
    if (!detail) topic.children.forEach((child, i) => visit(child, `${id}_${i + 1}`, [...path, child.label], topic));
  };
  visit(center, 'n', [center.label]);
  return topics;
}

/** An indented outline: the first line is the central topic and each deeper line belongs to the line above it.
 * Bullets (-, *, +) and Markdown heading marks are optional. */
export function parseOutline(text: string): MindTopic | undefined {
  let root: MindTopic | undefined;
  const open: { indent: number; topic: MindTopic }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const label = cleanLabel(line).trim().replace(/^(?:[-*+]|#{1,6})\s+/, '').trim();
    if (!label) continue;
    const topic: MindTopic = { label, children: [] };
    if (!root) { root = topic; continue; }
    const indent = /^\s*/.exec(line.replaceAll('\t', '  '))![0].length;
    while (open.length && open.at(-1)!.indent >= indent) open.pop();
    (open.at(-1)?.topic ?? root).children.push(topic);
    open.push({ indent, topic });
  }
  return root;
}

/** The outline `parseOutline` reads back as the same topics. */
export function outlineText(root: MindTopic): string {
  const lines: string[] = [];
  const visit = (topic: MindTopic, depth: number) => {
    // A label that starts like a bullet keeps it behind a bullet of its own.
    const marker = /^(?:[-*+]|#{1,6})\s/.test(topic.label) ? '- ' : '';
    lines.push(`${'  '.repeat(depth)}${marker}${topic.label}`);
    for (const child of topic.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines.join('\n');
}

export function countTopics(map: MindMap) {
  let topics = 0;
  let boards = 0;
  const visit = (topic: MindTopic, depth: number) => {
    topics++;
    if (map.split && depth === map.split && topic.children.length) { boards++; depth = 0; }
    for (const child of topic.children) visit(child, depth + 1);
  };
  visit(map.root, 0);
  return { topics, boards };
}

/** One board: its central topic, the topics within `split` levels, and detail boards for deeper ones.
 * `rootOnly` writes the earlier form with one import, so existing maps still reopen. */
function boardSource(center: MindTopic, map: MindMap, rootOnly: boolean, accent?: number): string[] {
  const shapes: string[] = [];
  const edges: string[] = [];
  const details: string[] = [];
  const names = new Set<string>();
  const visit = (topic: MindTopic, id: string, depth: number, tone?: number) => {
    const role = depth === 0 ? 'zf-topic' : depth === 1 ? 'zf-branch' : 'zf-leaf';
    const detail = depth > 0 && depth === map.split && topic.children.length > 0;
    let link = '';
    if (detail) {
      const name = uniqueBoardName(topic.label, names);
      link = `; link: layers.${quote(name)}`;
      details.push(`${quote(name)}: {`, ...boardSource(topic, map, rootOnly, tone).map(line => line && `  ${line}`), '}');
    }
    shapes.push(`${id}: ${quote(topic.label)} {class: ${lookClasses(tone ? [role, `zf-accent-${tone}`] : [role], map.look)}${link}}`);
    if (detail) return;
    topic.children.forEach((child, i) => {
      // Each main branch keeps one colour on every board it reaches.
      const branchTone = tone ?? i % accents + 1;
      edges.push(`${id} -- ${id}_${i + 1}: {class: zf-accent-${branchTone}}`);
      visit(child, `${id}_${i + 1}`, depth + 1, branchTone);
    });
  };
  visit(center, 'n', 0, accent);
  const root = accent === undefined;
  return [...!rootOnly || root ? [library] : [], `direction: ${map.direction}`, '', ...shapes, '', ...edges,
    ...details.length ? ['', 'layers: {', ...details.map(line => line && `  ${line}`), '}'] : []];
}

/** Fixed identifiers keep labels, punctuation and duplicate names out of D2 syntax. */
export function mindMapSource(map: MindMap, rootOnly = false): string {
  return [heading, splitNote(map.split), ...boardSource(map.root, map, rootOnly), ''].join('\n');
}

/** Only reopen the builder's complete, losslessly understood subset of D2, like `readFlow`. */
export function readMindMap(source: string): MindMap | undefined {
  const normalized = source.replaceAll('\r\n', '\n').trim();
  if (!normalized.startsWith(`${heading}\n`)) return;
  const lines = normalized.split('\n');
  const split = /^# Level (\d) topics/.exec(lines[1])?.[1] ?? (lines[1] === splitNote(0) ? '0' : undefined);
  const direction = lines[3]?.match(/^direction: (right|down)$/)?.[1] as MindMap['direction'] | undefined;
  if (!split || !direction) return;
  type Board = { topics: Map<string, MindTopic>; links: Map<string, MindTopic> };
  const boards: (Board | undefined)[] = [{ topics: new Map(), links: new Map() }];
  const topicLine = new RegExp(`^(n(?:_\\d+)*): (${quoted}) \\{class: (\\[[^\\]]*\\]|[\\w-]+)(?:; link: layers\\.(${quoted}))?\\}$`);
  let look: Look | undefined;
  const layerLine = new RegExp(`^(${quoted}): \\{$`);
  try {
    for (const line of lines.slice(2).map(line => line.trim())) {
      const board = boards.filter(Boolean).at(-1)!;
      const topic = topicLine.exec(line);
      const layer = layerLine.exec(line);
      if (topic) {
        const [, id, label, classes, link] = topic;
        look ??= readLook(classes)?.look;
        let node = board.topics.get(id);
        if (node && id !== 'n') return;
        if (!node) {
          node = { label: unquote(label), children: [] };
          const parent = id === 'n' ? undefined : board.topics.get(id.slice(0, id.lastIndexOf('_')));
          if (id !== 'n' && !parent) return;
          parent?.children.push(node);
          board.topics.set(id, node);
        }
        if (link) board.links.set(unquote(link), node);
      } else if (layer) {
        const anchor = board.links.get(unquote(layer[1]));
        if (!anchor) return;
        boards.push({ topics: new Map([['n', anchor]]), links: new Map() });
      } else if (line === 'layers: {') boards.push(undefined);
      else if (line === '}') boards.pop();
    }
  } catch { return; }
  const root = boards[0]?.topics.get('n');
  if (!root) return;
  const labels: string[] = [];
  const collect = (topic: MindTopic) => { labels.push(topic.label); topic.children.forEach(collect); };
  collect(root);
  // The outline has one trimmed topic per line.
  if (labels.some(label => !label || label !== label.trim() || /[\r\n]/.test(label))) return;
  if (!look) return;
  const map: MindMap = { direction, split: Number(split), look, root };
  return [mindMapSource(map), mindMapSource(map, true)].some(text => text.trim() === normalized) ? map : undefined;
}
