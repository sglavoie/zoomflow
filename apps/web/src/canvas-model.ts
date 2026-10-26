import { flowSource, readFlow } from './flow-model';
import { boardTopics, mindMapSource, readMindMap, type BoardTopic, type MindMap } from './mind-map-model';

/** Edits made on the diagram of a builder board: rename a shape, add the next step or a subtopic,
 * add a sibling topic, or remove a shape. */
export type CanvasEdit = { type: 'rename'; label: string } | { type: 'add' } | { type: 'sibling' } | { type: 'remove' };
/** What a shape on a builder board offers on the diagram. */
export type CanvasShape = { kind: 'flow' | 'mind map'; label: string; add: string; sibling: boolean; remove: boolean };
/** The builder's new text, the shape to select once it is drawn, the board's trail when a rename renames the board,
 * and for a mind map, each main board topic's new identifier by its old one, so attached boards follow their topics. */
export type CanvasResult = { own: string; select?: string; trail?: string[]; moved?: Map<string, string> };

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
    return step && { kind: 'flow', label: step.label, add: 'Add next step', sibling: false, remove: flow.steps.length > 1 };
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

export function editOnCanvas(own: string, trail: string[], shape: string, edit: CanvasEdit): CanvasResult | undefined {
  const target = canvasShape(own, trail, shape);
  if (!target || edit.type === 'sibling' && !target.sibling || edit.type === 'remove' && !target.remove) return;
  const label = edit.type === 'rename' ? edit.label.replace(/\s+/g, ' ').trim() : '';
  if (edit.type === 'rename' && (!label || label === target.label)) return;
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
      const id = `step_${Math.max(...flow.steps.map(item => Number(item.id.slice(5)))) + 1}`;
      flow.steps.push({ id, label: 'New step', shape: 'rectangle' });
      flow.connections.push({ from: shape, to: id, label: '' });
      return { own: flowSource(flow), select: id };
    }
    return { own: flowSource(flow), select: shape };
  }
  const map = readMindMap(own)!;
  const before = boardTopics(map);
  const { topic, parent } = mapBoard(map, trail)!.find(item => item.id === shape)!;
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
  // A subtopic added past the detail level opens on a new detail board, so its parent stays selected.
  const topics = mapBoard(map, nextTrail ?? trail);
  const select = (topics?.find(item => item.topic === selected) ?? topics?.find(item => item.topic === topic))?.id;
  // Topics are kept as objects, so each surviving main board topic is found again whatever its new label or place.
  const after = new Map(boardTopics(map).map(item => [item.topic, item.id]));
  const moved = new Map(before.filter(item => after.has(item.topic)).map(item => [item.id, after.get(item.topic)!]));
  return { own: mindMapSource(map), ...select ? { select } : {}, ...nextTrail ? { trail: nextTrail } : {}, moved };
}
