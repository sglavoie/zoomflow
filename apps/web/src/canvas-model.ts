import { cleanLabel, flowSource, highestStepNumber, readFlow, type Flow } from './flow-model';
import { boardTopics, mindMapSource, placedTopics, readMindMap, type BoardTopic, type MindMap } from './mind-map-model';

/** Edits made on the diagram of a builder board: rename a shape, add the next step or a subtopic,
 * add a sibling topic, or remove a shape. */
export type CanvasEdit = { type: 'rename'; label: string } | { type: 'add' } | { type: 'branch' } | { type: 'sibling' } | { type: 'remove' };
/** What a shape on a builder board offers on the diagram. */
export type CanvasShape = { kind: 'flow' | 'mind map'; label: string; add: string; sibling: boolean; remove: boolean };
/** The builder's new text, the shape to select once it is drawn, the board's trail when a rename renames the board
 * or a remove removes it, and for a mind map, each topic's new outline identifier by its old one, so attached
 * boards follow their topics. */
export type CanvasResult = { own: string; select?: string; trail?: string[]; moved?: Map<string, string> };

/** The pinned compiler numbers parallel arrows independently for each directed pair. */
export function flowConnectionIds(flow: Flow): string[] {
  const counts = new Map<string, number>();
  return flow.connections.map(edge => {
    const pair = `(${edge.from} -> ${edge.to})`;
    const ordinal = counts.get(pair) ?? 0;
    counts.set(pair, ordinal + 1);
    return `${pair}[${ordinal}]`;
  });
}

export type ConnectionEdit = { type: 'add'; from: string; to: string; label: string }
  | { type: 'label'; index: number; label: string } | { type: 'remove'; index: number } | { type: 'insert'; index: number };

/** Connection edits use the same lossless builder subset as step edits, including loops and parallel arrows. */
export function editConnection(own: string, edit: ConnectionEdit): { own: string; index?: number; from: string; inserted?: string } | undefined {
  const flow = readFlow(own);
  if (!flow) return;
  const label = 'label' in edit ? cleanLabel(edit.label).replace(/\s+/g, ' ').trim() : '';
  if (edit.type === 'add') {
    if (![edit.from, edit.to].every(id => flow.steps.some(step => step.id === id))) return;
    flow.connections.push({ from: edit.from, to: edit.to, label });
    return { own: flowSource(flow), index: flow.connections.length - 1, from: edit.from };
  }
  const edge = flow.connections[edit.index];
  if (!Number.isInteger(edit.index) || !edge) return;
  if (edit.type === 'insert') {
    const id = `step_${highestStepNumber(flow) + 1}`;
    flow.steps.splice(flow.steps.findIndex(step => step.id === edge.from) + 1, 0, { id, label: 'New step', shape: 'rectangle' });
    flow.connections.splice(edit.index, 1, { ...edge, to: id }, { from: id, to: edge.to, label: '' });
    return { own: flowSource(flow), from: edge.from, inserted: id };
  }
  if (edit.type === 'remove') flow.connections.splice(edit.index, 1);
  else {
    if (label === edge.label || edit.label === edge.label) return;
    edge.label = label;
  }
  return { own: flowSource(flow), ...edit.type === 'label' ? { index: edit.index } : {}, from: edge.from };
}

/** The topics on the board that `trail`, a list of detail board names from the main board, leads to. */
function mapBoard(map: MindMap, trail: string[]): BoardTopic[] | undefined {
  let topics = boardTopics(map);
  for (const name of trail) {
    const detail = topics.find(topic => topic.board === name);
    if (!detail) return;
    topics = boardTopics(map, detail.topic);
  }
  return topics;
}

/** Each shape's offer on one board, reading the builder text once. `own` is a builder board's text; `trail` names
 * the detail boards from it down to the shape's board. */
export function canvasShapes(own: string, trail: string[]): (shape: string) => CanvasShape | undefined {
  const flow = !trail.length ? readFlow(own) : undefined;
  if (flow) return shape => {
    const step = flow.steps.find(item => item.id === shape);
    return step && { kind: 'flow', label: step.label, add: flow.connections.filter(edge => edge.from === shape).length > 1 ? 'Add branch' : 'Add next step', sibling: false, remove: flow.steps.length > 1 };
  };
  const map = readMindMap(own);
  const topics = map && mapBoard(map, trail);
  return shape => {
    const topic = topics?.find(item => item.id === shape);
    if (!topic) return;
    // A detail board's centre is the topic on the board above, which adds its siblings and removes it.
    const outer = Boolean(topic.parent);
    return { kind: 'mind map', label: topic.topic.label, add: 'Add subtopic', sibling: outer, remove: outer };
  };
}
export const canvasShape = (own: string, trail: string[], shape: string) => canvasShapes(own, trail)(shape);

/** Logical topics have one destination even when a detail board repeats its centre. */
export function branchChoices(own: string, trail: string[], shape: string) {
  const map = readMindMap(own);
  if (!map) return;
  const topics = placedTopics(map);
  const from = topics.find(item => item.shape === shape && item.trail.length === trail.length && item.trail.every((name, i) => name === trail[i]));
  if (!from || from.topic === map.root) return;
  const logical = topics.filter(item => !item.id.endsWith('@center'));
  const origin = logical.find(item => item.topic === from.topic)!;
  // Whole-outline identifiers describe ancestry independently of labels, including duplicate labels.
  const choices = logical.filter(item => item.topic !== origin.parent && item.id !== origin.id && !item.id.startsWith(`${origin.id}_`));
  const labels = new Map<string, number>();
  return { from: origin.id, label: origin.topic.label, destinations: choices.map(item => {
    const path = item.path.join(' › ');
    const count = (labels.get(path) ?? 0) + 1;
    labels.set(path, count);
    return { id: item.id, label: path + (count > 1 ? ` (${count})` : ''), shape: item.shape, trail: item.trail };
  }) };
}

/** Move a complete subtree, returning exact topic identities for attachment remapping and its new selection. */
export function moveBranch(own: string, trail: string[], shape: string, destination: string): CanvasResult | undefined {
  const choices = branchChoices(own, trail, shape);
  if (!choices?.destinations.some(item => item.id === destination)) return;
  const map = readMindMap(own)!;
  const before = placedTopics(map);
  const from = before.find(item => item.id === choices.from)!;
  const to = before.find(item => item.id === destination)!;
  from.parent!.children.splice(from.parent!.children.indexOf(from.topic), 1);
  to.topic.children.push(from.topic);
  const after = placedTopics(map);
  const location = after.find(item => item.topic === from.topic && !item.id.endsWith('@center'))!;
  const moved = topicMoves(before, after);
  return { own: mindMapSource(map), select: location.shape, trail: location.trail, moved };
}

function topicMoves(before: ReturnType<typeof placedTopics>, after: ReturnType<typeof placedTopics>) {
  const shapes = new Map(after.filter(item => !item.id.endsWith('@center')).map(item => [item.topic, item.id]));
  const centers = new Map(after.filter(item => item.id.endsWith('@center')).map(item => [item.topic, item.id]));
  return new Map(before.flatMap(item => {
    // When a move changes detail-board boundaries, a former centre follows its topic's ordinary appearance.
    const next = (item.id.endsWith('@center') ? centers.get(item.topic) : undefined) ?? shapes.get(item.topic);
    return next ? [[item.id, next] as const] : [];
  }));
}

export function editOnCanvas(own: string, trail: string[], shape: string, edit: CanvasEdit): CanvasResult | undefined {
  const target = canvasShape(own, trail, shape);
  if (!target || edit.type === 'branch' && target.kind !== 'flow' || edit.type === 'sibling' && !target.sibling || edit.type === 'remove' && !target.remove) return;
  const label = edit.type === 'rename' ? cleanLabel(edit.label).replace(/\s+/g, ' ').trim() : '';
  // The rename box starts with the label as written, which may hold doubled spaces: committing it untouched is no edit.
  if (edit.type === 'rename' && (!label || label === target.label || edit.label === target.label)) return;
  if (target.kind === 'flow') {
    const flow = readFlow(own)!;
    const step = flow.steps.find(item => item.id === shape)!;
    if (edit.type === 'rename') step.label = label;
    else if (edit.type === 'remove') {
      // The step that led to the removed one keeps the selection, else the step before it.
      const index = flow.steps.indexOf(step);
      const from = flow.connections.find(item => item.to === shape && item.from !== shape)?.from;
      const select = from ?? (flow.steps[index - 1] ?? flow.steps[index + 1]).id;
      flow.steps.splice(index, 1);
      flow.connections = flow.connections.filter(item => item.from !== shape && item.to !== shape);
      return { own: flowSource(flow), select };
    } else {
      const id = `step_${highestStepNumber(flow) + 1}`;
      flow.steps.splice(flow.steps.indexOf(step) + 1, 0, { id, label: 'New step', shape: 'rectangle' });
      const outgoing = flow.connections.filter(edge => edge.from === shape);
      if (edit.type === 'add' && outgoing.length === 1) {
        // Continue a linear path without creating a second outcome. Keep its label on the first half.
        const edge = outgoing[0];
        flow.connections.push({ from: id, to: edge.to, label: '' });
        edge.to = id;
      } else flow.connections.push({ from: shape, to: id, label: '' });
      return { own: flowSource(flow), select: id };
    }
    return { own: flowSource(flow), select: shape };
  }
  const map = readMindMap(own)!;
  const before = placedTopics(map);
  const board = mapBoard(map, trail)!;
  const center = board[0].topic;
  const { topic, parent } = board.find(item => item.id === shape)!;
  let selected = topic;
  if (edit.type === 'rename') topic.label = label;
  else if (edit.type === 'remove') {
    const siblings = parent!.children;
    const index = siblings.indexOf(topic);
    siblings.splice(index, 1);
    selected = siblings[Math.min(index, siblings.length - 1)] ?? parent!;
  } else {
    selected = { label: 'New topic', children: [] };
    if (edit.type === 'add') topic.children.push(selected);
    else parent!.children.splice(parent!.children.indexOf(topic) + 1, 0, selected);
  }
  // Renaming a detail board's centre renames the board, so the board on view moves with it.
  let nextTrail: string[] | undefined;
  if (edit.type === 'rename' && trail.length && !parent) {
    nextTrail = [...trail];
    nextTrail[nextTrail.length - 1] = mapBoard(map, trail.slice(0, -1))!.find(item => item.topic === topic)!.board!;
  }
  // Removing a detail board's last subtopic removes the board, so the board above shows its centre, selected.
  if (edit.type === 'remove' && trail.length && parent === center && !center.children.length) nextTrail = trail.slice(0, -1);
  // A subtopic added past the detail level opens on a new detail board, so its parent stays selected.
  const topics = mapBoard(map, nextTrail ?? trail);
  const select = (topics?.find(item => item.topic === selected) ?? topics?.find(item => item.topic === topic))?.id;
  // Topics are kept as objects, so each surviving topic is found again whatever its new label or place.
  const after = placedTopics(map);
  const moved = topicMoves(before, after);
  return { own: mindMapSource(map), ...select ? { select } : {}, ...nextTrail ? { trail: nextTrail } : {}, moved };
}
