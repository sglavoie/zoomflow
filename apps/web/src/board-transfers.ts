import { boardBlocks, boardKey, idSegments, type Board, type SourceRange } from '@zoomflow/core';
import type { DocumentView } from '@zoomflow/viewer';
import { blockText, boardSites, isFileAttachment, joinBoard, splitBoard, type Attachment, type BoardParts } from './board-model';
import { flowSource, highestStepNumber, quote, readFlow, type Flow, type FlowStep } from './flow-model';
import { mindMapSource, placedTopics, readMindMap, uniqueBoardName, type MindMap, type MindTopic } from './mind-map-model';

type Unit = MindTopic | FlowStep | { id: string };
type Node = {
  id: string; parts: BoardParts; flow?: Flow; map?: MindMap; range?: SourceRange; statement?: SourceRange;
  parent?: { host: Node; attachment?: Attachment }; children: Node[]; links: Map<Attachment, Node>;
  raw: Map<string, Unit>; dirty?: boolean; extras: string[]; actual?: string;
};
type Place = { node: Node; unit: Unit; board: string; shape: string; trail: string[]; center: boolean; detail?: string; label: string; key: string };
export type ShapeMove = { board: string; shape: string };
export type BoardTransfer = { source: string; board: string; shape: string; remap: Map<string, ShapeMove>; boards: Map<string, string> };
const sameTrail = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((name, i) => name === b[i]);
const route = (id: string, trail: string[]) => id + trail.map(name => `.layers.${boardKey(name)}`).join('');
const positionKey = (board: string, shape: string) => JSON.stringify([board, shape]);
const transferKey = (place: Place) => `@board:${place.key}`;

/** A transaction owns fresh model objects: no source or builder changes until the entire transfer succeeds. */
function documentModel(source: string, boards: Map<string, Board>, graph: unknown) {
  const filename = /^(.+),\d+:\d+:\d+-/.exec((graph as { ast?: { range?: string } }).ast?.range ?? '')?.[1] ?? 'index';
  const statements = new Map<string, SourceRange>();
  const blocks = boardBlocks(graph, source, filename, statements);
  const sites = boardSites(source, blocks, boards);
  const nodes = new Map<string, Node>();
  for (const [id, range] of blocks) {
    const parts = splitBoard(blockText(source, range).text);
    nodes.set(id, { id, parts, flow: readFlow(parts.own), map: readMindMap(parts.own), range, statement: statements.get(id),
      children: [], links: new Map(), raw: new Map(), extras: [] });
  }
  // Physical children allow local builders in hand-written layer blocks as well as builder attachments.
  for (const node of nodes.values()) {
    let parent = boards.get(node.id)?.parent;
    while (parent && !nodes.has(parent)) parent = boards.get(parent)?.parent;
    if (parent) { node.parent = { host: nodes.get(parent)! }; nodes.get(parent)!.children.push(node); }
  }
  // A map owns attachment sections on its generated details too. Prefer that outer logical owner.
  for (const node of [...nodes.values()].sort((a, b) => a.id.length - b.id.length)) {
    for (const attachment of node.parts.attachments) {
      if (isFileAttachment(attachment)) continue;
      const child = nodes.get(route(node.id, [...attachment.trail ?? [], attachment.name]));
      if (!child) continue;
      node.links.set(attachment, child);
      if (!child.parent?.attachment) child.parent = { host: node, attachment };
    }
  }
  for (const node of nodes.values()) node.children = node.children.filter(child => child.parent?.host !== node || !child.parent.attachment);
  const places = (node: Node, actual = false): Place[] => {
    const id = actual ? node.actual : node.id;
    if (!id) return [];
    if (node.map) {
      const entries = placedTopics(node.map);
      const logical = new Map(entries.filter(item => !item.id.endsWith('@center')).map(item => [item.topic, item.id]));
      return entries.map(item => ({ node, unit: item.topic, board: route(id, item.trail), shape: item.shape, trail: item.trail,
        center: item.id.endsWith('@center'), detail: item.board, label: item.topic.label, key: positionKey(node.id, logical.get(item.topic)!) }));
    }
    if (node.flow) return node.flow.steps.map(step => ({ node, unit: step, board: id, shape: step.id, trail: [], center: false,
      label: step.label, key: positionKey(node.id, step.id) }));
    if (!node.raw.size) for (const shape of boards.get(node.id)?.diagram.shapes ?? []) node.raw.set(shape.id, { id: shape.id });
    return [...node.raw].map(([shape, unit]) => ({ node, unit, board: id, shape, trail: [], center: false,
      label: (boards.get(node.id)?.diagram.shapes.find(item => item.id === shape) as { label?: string } | undefined)?.label ?? shape,
      key: positionKey(node.id, shape) }));
  };
  const original: Place[] = [];
  for (const node of nodes.values()) {
    // Generated details are appearances of their map's topics, rather than independent raw boards.
    const owner = sites.canvas(node.id)?.owner;
    if (!owner || owner === node.id) original.push(...places(node));
  }
  const byPosition = new Map(original.map(place => [positionKey(place.board, place.shape), place]));
  const primary = new Map<string, Place>();
  for (const place of original) if (!primary.has(place.key) || !place.center) primary.set(place.key, place);

  function selected(origin: Place): Set<Unit> | undefined {
    const node = origin.node;
    if (node.map) {
      const units = new Set<Unit>();
      const visit = (topic: MindTopic) => { units.add(topic); topic.children.forEach(visit); };
      visit(origin.unit as MindTopic);
      return units;
    }
    if (node.flow) {
      const ids = new Set([origin.shape]);
      const queue = [origin.shape];
      while (queue.length) {
        const from = queue.pop()!;
        for (const edge of node.flow.connections) if (edge.from === from && !ids.has(edge.to)) { ids.add(edge.to); queue.push(edge.to); }
      }
      return new Set(node.flow.steps.filter(step => ids.has(step.id)));
    }
  }
  function whole(origin: Place, units: Set<Unit>) {
    return origin.node.map ? origin.unit === origin.node.map.root : units.size === origin.node.flow!.steps.length;
  }
  function descendant(origin: Place, units: Set<Unit>, target: Place) {
    if (origin.node === target.node) return units.has(target.unit);
    for (let child = target.node; child.parent; child = child.parent.host) {
      const { host, attachment } = child.parent;
      if (host !== origin.node) continue;
      if (whole(origin, units)) return true;
      const anchor = attachment && original.find(place => place.node === host && place.shape === attachment.shape && sameTrail(place.trail, attachment.trail));
      return Boolean(anchor && units.has(anchor.unit));
    }
    return false;
  }
  function destinations(origin: Place) {
    const units = selected(origin);
    if (!units || whole(origin, units) && !origin.node.parent) return [];
    const previous = whole(origin, units) ? origin.node.parent : undefined;
    return [...primary.values()].filter(target => {
      if (target.node === origin.node || descendant(origin, units, target)) return false;
      if (previous?.host === target.node && previous.attachment) {
        const anchor = original.find(place => place.node === previous.host && place.shape === previous.attachment!.shape && sameTrail(place.trail, previous.attachment!.trail));
        if (anchor?.unit === target.unit) return false;
      }
      return true;
    });
  }
  function detach(node: Node) {
    const parent = node.parent;
    if (!parent) throw new Error('The document root cannot move into one of its boards.');
    if (parent.attachment) {
      parent.host.parts.attachments = parent.host.parts.attachments.filter(item => item !== parent.attachment);
      parent.host.links.delete(parent.attachment);
    } else {
      if (!node.statement) throw new Error('This board does not have one local declaration to move.');
      for (const shape of boards.get(parent.host.id)?.diagram.shapes ?? []) if (shape.link === node.id) {
        parent.host.extras.push(`${idSegments(shape.id).map(quote).join('.')}.link: null`);
      }
    }
    node.parent = undefined;
  }
  const newNode = (parts: BoardParts, flow?: Flow, map?: MindMap): Node => {
    const node: Node = { id: `@new-${nodes.size}`, parts, flow, map, children: [], links: new Map(), raw: new Map(), extras: [] };
    nodes.set(node.id, node);
    return node;
  };
  const attachmentPlaces = (node: Node) => new Map(node.parts.attachments.map(item =>
    [item, places(node).find(place => place.shape === item.shape && sameTrail(place.trail, item.trail))]));
  function rescope(node: Node, previous: Map<Attachment, Place | undefined>) {
    const next = places(node);
    const names = new Map<string, Set<string>>();
    for (const place of next) if (place.detail) {
      const key = JSON.stringify(place.trail);
      if (!names.has(key)) names.set(key, new Set());
      names.get(key)!.add(place.detail.toLowerCase());
    }
    node.parts.attachments = node.parts.attachments.map(item => {
      const old = previous.get(item);
      if (!old) return item;
      const options = next.filter(place => place.unit === old.unit);
      let place = options.find(place => place.center === old.center) ?? options[0];
      if (!place) throw new Error(`The attached board on “${old.label}” could not follow its topic.`);
      // If the topic now opens a generated detail, attach on that detail's shared centre instead.
      if (place.detail) place = options.find(option => option.center && sameTrail(option.trail, [...place.trail, place.detail!]))!;
      const { trail: _, ...body } = item;
      const relocated: Attachment = { ...body, shape: place.shape, ...place.trail.length ? { trail: place.trail } : {} };
      if (!isFileAttachment(relocated)) {
        const key = JSON.stringify(place.trail);
        if (!names.has(key)) names.set(key, new Set());
        relocated.name = uniqueBoardName(relocated.name, names.get(key)!);
      }
      const child = node.links.get(item);
      if (child) { node.links.delete(item); node.links.set(relocated, child); child.parent = { host: node, attachment: relocated }; }
      return relocated;
    });
  }
  function cut(origin: Place): Node {
    const units = selected(origin)!;
    const node = origin.node;
    if (whole(origin, units)) {
      detach(node);
      if (node.flow && node.flow.steps[0] !== origin.unit) {
        node.flow.steps = [origin.unit as FlowStep, ...node.flow.steps.filter(step => step !== origin.unit)]; node.dirty = true;
      }
      return node;
    }
    const previous = attachmentPlaces(node);
    let branch: Node;
    if (node.map) {
      const topic = origin.unit as MindTopic;
      const parent = placedTopics(node.map).find(item => item.topic === topic && item.parent)?.parent;
      if (!parent) throw new Error('The document centre cannot be removed.');
      parent.children.splice(parent.children.indexOf(topic), 1);
      const map = { ...node.map, root: topic };
      branch = newNode({ own: '', attachments: [] }, undefined, map);
    } else {
      const flow = node.flow!;
      const moved = flow.steps.filter(step => units.has(step));
      const ids = new Set(moved.map(step => step.id));
      branch = newNode({ own: '', attachments: [] }, { ...flow, steps: [origin.unit as FlowStep, ...moved.filter(step => step !== origin.unit)],
        connections: flow.connections.filter(edge => ids.has(edge.from) && ids.has(edge.to)) });
      flow.steps = flow.steps.filter(step => !ids.has(step.id));
      flow.connections = flow.connections.filter(edge => !ids.has(edge.from) && !ids.has(edge.to));
    }
    for (const item of [...node.parts.attachments]) if (previous.get(item) && units.has(previous.get(item)!.unit)) {
      node.parts.attachments = node.parts.attachments.filter(other => other !== item);
      branch.parts.attachments.push(item);
      const child = node.links.get(item);
      if (child) { node.links.delete(item); branch.links.set(item, child); child.parent = { host: branch, attachment: item }; }
    }
    rescope(node, previous); rescope(branch, previous);
    node.dirty = branch.dirty = true;
    return branch;
  }
  function attach(node: Node, place: Place, branch: Node, label: string) {
    const taken = new Set<string>();
    for (const item of node.parts.attachments) if (!isFileAttachment(item) && sameTrail(item.trail, place.trail)) taken.add(item.name.toLowerCase());
    for (const entry of places(node)) if (entry.detail && sameTrail(entry.trail, place.trail)) taken.add(entry.detail.toLowerCase());
    for (const child of node.children) if (child.parent?.host === node && !child.parent.attachment) taken.add(boards.get(child.id)?.name.toLowerCase() ?? '');
    const name = uniqueBoardName(boards.get(branch.id)?.name ?? label, taken);
    const attachment: Attachment = { shape: place.shape, name, body: '', ...place.trail.length ? { trail: place.trail } : {} };
    node.parts.attachments.push(attachment); node.links.set(attachment, branch); branch.parent = { host: node, attachment };
  }
  function placeBranch(target: Place, branch: Node, label: string, sourcePlace: Place): Unit {
    const node = target.node;
    let place = places(node).find(item => item.unit === target.unit && item.center === target.center) ?? places(node).find(item => item.unit === target.unit)!;
    if (place.detail) place = places(node).find(item => item.unit === target.unit && item.center && sameTrail(item.trail, [...place.trail, place.detail!]))!;
    const occupied = node.parts.attachments.some(item => item.shape === place.shape && sameTrail(item.trail, place.trail));
    const linked = boards.get(target.board)?.diagram.shapes.find(item => item.id === target.shape)?.link;
    if (!occupied && place.label !== label && (!linked || Boolean(target.detail))) {
      attach(node, place, branch, label);
      return sourcePlace.unit;
    }
    // A shape has one board link. Keep an existing board, and add a sibling branch in its owner's model.
    let unit: Unit;
    if (node.flow) {
      const id = `step_${highestStepNumber(node.flow) + 1}`;
      unit = { id, label, shape: sourcePlace.node.flow ? (sourcePlace.unit as FlowStep).shape : 'rectangle' } as FlowStep;
      node.flow.steps.push(unit as FlowStep);
      node.flow.connections.push({ from: (target.unit as FlowStep).id, to: id, label: '' });
    } else if (node.map) {
      const before = attachmentPlaces(node);
      unit = { label, children: [] } as MindTopic;
      (target.unit as MindTopic).children.push(unit as MindTopic);
      rescope(node, before);
    } else {
      let n = 1;
      while (node.raw.has(`moved_${n}`)) n++;
      const id = `moved_${n}`;
      unit = { id }; node.raw.set(id, unit);
      const shape = sourcePlace.node.flow ? (sourcePlace.unit as FlowStep).shape : 'rectangle';
      node.extras.push(`${id}: ${quote(label)} {shape: ${shape}}\n${idSegments(target.shape).map(quote).join('.')} -> ${id}`);
    }
    node.dirty = true;
    place = places(node).find(item => item.unit === unit)!;
    attach(node, place, branch, label);
    return unit;
  }
  const active = new Set<Node>();
  function write(node: Node, id: string): string {
    if (active.has(node)) throw new Error('A branch cannot move inside itself.');
    active.add(node); node.actual = id;
    let own = node.parts.own;
    if (node.map && node.dirty) own = mindMapSource(node.map);
    else if (node.flow && node.dirty) own = flowSource(node.flow);
    else if (!node.map && !node.flow && node.range) {
      let body = source.slice(node.range.from, node.range.to);
      for (const child of [...node.children].sort((a, b) => b.range!.from - a.range!.from)) {
        if (child.parent?.host === node && !child.parent.attachment) {
          body = blockText(body, { from: child.range!.from - node.range.from, to: child.range!.to - node.range.from })
            .replace(write(child, id + child.id.slice(node.id.length)));
        } else {
          if (!child.statement) throw new Error('This board cannot be detached from its source.');
          const start = child.statement.from - node.range.from, end = child.statement.to - node.range.from;
          body = body.slice(0, start) + body.slice(end);
        }
      }
      const text = node.id === 'root' ? body : blockText(`{${body}}`, { from: 1, to: body.length + 1 }).text;
      own = splitBoard(text).own;
    }
    if (node.extras.length) own += '\n' + node.extras.join('\n') + '\n';
    const attachments = node.parts.attachments.map(item => {
      if (isFileAttachment(item)) return item;
      const child = node.links.get(item);
      return child ? { ...item, body: write(child, route(id, [...item.trail ?? [], item.name])) } : item;
    });
    active.delete(node);
    return joinBoard({ own, attachments });
  }
  function transfer(origin: Place, target: Place): BoardTransfer {
    if (!destinations(origin).some(item => item.key === target.key)) throw new Error('That parent is inside this branch or is already its parent.');
    const moved = cut(origin);
    const selectedUnit = placeBranch(target, moved, origin.label, origin);
    const result = write(nodes.get('root')!, 'root');
    const after = [...nodes.values()].flatMap(node => places(node, true));
    const location = after.find(place => place.unit === selectedUnit && !place.center)!;
    const remap = new Map<string, ShapeMove>();
    for (const old of original) {
      const options = after.filter(place => place.unit === old.unit);
      const next = old.unit === origin.unit ? location : options.find(place => place.center === old.center) ?? options[0];
      if (next) remap.set(positionKey(old.board, old.shape), { board: next.board, shape: next.shape });
    }
    const routes = new Map([...nodes.values()].filter(node => node.actual).map(node => [node.id, node.actual!]));
    for (const old of original) if (old.center) {
      const next = remap.get(positionKey(old.board, old.shape));
      if (next) routes.set(old.board, next.board);
    }
    return { source: result, board: location.board, shape: location.shape, remap, boards: routes };
  }
  return { byPosition, primary, destinations, transfer };
}

/** Cross-board moves preserve a branch's builder type by moving its editable board under the new parent. */
export function boardTransfers(source: string, boards: Map<string, Board>, graph: unknown) {
  const model = documentModel(source, boards, graph);
  const cache = new Map<string, ReturnType<typeof choices>>();
  function choices(board: string, shape: string) {
    const origin = model.byPosition.get(positionKey(board, shape));
    if (!origin) return [];
    return model.destinations(origin).map(place => ({ id: transferKey(place), board: place.board, owner: place.node.id,
      shape: place.shape, trail: place.trail, label: `${boards.get(place.board)?.name ?? 'Root'} › ${place.label}` }));
  }
  return {
    key(board: string, shape: string) { const place = model.byPosition.get(positionKey(board, shape)); return place && transferKey(place); },
    label(board: string, shape: string) { return model.byPosition.get(positionKey(board, shape))?.label; },
    choices(board: string, shape: string) {
      const key = positionKey(board, shape);
      if (!cache.has(key)) cache.set(key, choices(board, shape));
      return cache.get(key)!;
    },
    canMove(board: string, shape: string) {
      const place = model.byPosition.get(positionKey(board, shape));
      return Boolean(place && (place.node.flow || place.node.map) && (place.node.parent || place.unit !== place.node.map?.root));
    },
    move(board: string, shape: string, destination: string): BoardTransfer | undefined {
      if (!destination.startsWith('@board:')) return;
      const fresh = documentModel(source, boards, graph);
      const origin = fresh.byPosition.get(positionKey(board, shape));
      const target = fresh.primary.get(destination.slice(7));
      if (!origin || !target) return;
      return fresh.transfer(origin, target);
    },
  };
}
export type BoardTransfers = ReturnType<typeof boardTransfers>;

/** Visibility choices follow logical shapes when a mind-map cut renumbers its remaining topics. */
export function transferView(view: DocumentView, transfer: BoardTransfer): DocumentView {
  const routes = [...transfer.boards].sort(([a], [b]) => b.length - a.length);
  const boardId = (id: string) => {
    const match = routes.find(([before]) => id === before || id.startsWith(`${before}.`));
    return match ? match[1] + id.slice(match[0].length) : id;
  };
  const hidden = new Map<string, Set<string>>();
  for (const [board, shapes] of view.hidden ?? []) for (const shape of shapes) {
    const next = transfer.remap.get(positionKey(board, shape)) ?? { board: boardId(board), shape };
    if (!hidden.has(next.board)) hidden.set(next.board, new Set());
    hidden.get(next.board)!.add(next.shape);
  }
  return { hidden: [...hidden].map(([board, shapes]) => [board, [...shapes]]),
    layers: view.layers && { ...view.layers, root: view.layers.root && boardId(view.layers.root),
      expanded: [...new Set(view.layers.expanded.map(boardId))] } };
}
