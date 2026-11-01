import type { Viewer } from '@zoomflow/viewer';
import { editConnection, flowConnectionIds, type ConnectionEdit } from './canvas-model';
import { readFlow } from './flow-model';

type ConnectionHost = {
  /** Only current, writable builder flow boards can be edited. */
  own: (board: string) => string | undefined;
  source: () => string;
  update: (own: string) => string | undefined;
  clearShapes: () => void;
  selectShape: (shape: string) => void;
  status: (text: string) => void;
};

/** Connection selection and an optional-label destination picker, kept outside the SVG so exports stay clean. */
export function setupCanvasConnections(viewer: Viewer, host: ConnectionHost) {
  const panel = document.createElement('form');
  panel.className = 'canvas-connections';
  panel.setAttribute('role', 'group');
  panel.hidden = true;
  viewer.stage.after(panel);
  const heading = document.createElement('strong');
  const help = document.createElement('p');
  const destination = document.createElement('select');
  destination.setAttribute('aria-label', 'Destination step');
  const label = document.createElement('input');
  label.type = 'text';
  label.maxLength = 200;
  label.setAttribute('aria-label', 'Connection label');
  const field = (name: string, control: HTMLElement) => {
    const field = document.createElement('label');
    field.append(name, control);
    return field;
  };
  const destinationField = field('To', destination);
  const labelField = field('Label (optional)', label);
  const apply = document.createElement('button');
  apply.type = 'submit';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Delete connection';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  const buttons = document.createElement('div');
  buttons.append(apply, remove, cancel);
  panel.append(heading, help, destinationField, labelField, buttons);

  type Selection = { board: string; source: string; index: number };
  let selected: Selection | undefined;
  let connecting: { board: string; source: string; from: string } | undefined;
  let pending: { board: string; source: string; index?: number; from: string } | undefined;
  let historySource: string | undefined;
  let restoring = false;
  const flows = new Map<string, { own: string; flow: ReturnType<typeof readFlow> }>();
  const boardId = () => viewer.currentBoard?.id ?? 'root';
  const flowAt = (board = boardId()) => {
    const own = host.own(board);
    if (own === undefined) return;
    if (flows.get(board)?.own !== own) flows.set(board, { own, flow: readFlow(own) });
    return flows.get(board)!.flow;
  };
  const connectionElement = (board: string, index: number) => [...viewer.stage.querySelectorAll<SVGElement>('[data-flow-connection]')]
    .find(element => element.dataset.connectionBoard === board && Number(element.dataset.flowConnection) === index);
  const shapeAt = (target: EventTarget | null) => target instanceof Element
    ? target.closest<SVGElement>('[data-shape-id]') ?? target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
  const edgeAt = (target: EventTarget | null) => target instanceof Element ? target.closest<SVGElement>('[data-flow-connection]') : null;
  const name = (board: string, id: string) => flowAt(board)?.steps.find(step => step.id === id)?.label ?? id;

  function markSelection() {
    for (const element of viewer.stage.querySelectorAll<SVGElement>('[data-flow-connection]')) {
      element.classList.toggle('zf-connection-selected', Boolean(selected && selected.board === element.dataset.connectionBoard && selected.index === Number(element.dataset.flowConnection)));
    }
    viewer.stage.classList.toggle('zf-connecting', Boolean(connecting));
  }
  function clear(restore = false) {
    const edge = selected && connectionElement(selected.board, selected.index);
    const from = connecting?.from;
    selected = connecting = undefined;
    panel.hidden = true;
    markSelection();
    if (restore) {
      if (edge?.isConnected) {
        restoring = true;
        edge.focus({ preventScroll: true });
        restoring = false;
      }
      else if (from) host.selectShape(from);
      else viewer.stage.focus({ preventScroll: true });
    }
  }
  function selectEdge(element: SVGElement, focusLabel = false) {
    const board = element.dataset.connectionBoard!;
    const index = Number(element.dataset.flowConnection);
    const flow = flowAt(board);
    const edge = flow?.connections[index];
    if (!edge || board !== boardId()) return;
    host.clearShapes();
    connecting = undefined;
    selected = { board, index, source: host.source() };
    heading.textContent = `${name(board, edge.from)} → ${name(board, edge.to)}`;
    panel.setAttribute('aria-label', `Selected connection: ${heading.textContent}`);
    help.textContent = 'Change its label, or delete this connection. Escape closes.';
    destinationField.hidden = true;
    label.value = edge.label;
    apply.textContent = 'Apply label';
    remove.hidden = false;
    cancel.textContent = 'Done';
    panel.hidden = false;
    markSelection();
    if (focusLabel) { label.focus(); label.select(); }
    else element.focus({ preventScroll: true });
  }
  function commit(edit: ConnectionEdit) {
    const state = connecting ?? selected;
    if (!state || state.source !== host.source() || state.board !== boardId()) { clear(); return; }
    const own = host.own(state.board);
    const result = own === undefined ? undefined : editConnection(own, edit);
    if (!result) { clear(true); return; }
    const source = host.update(result.own);
    if (!source) return;
    pending = { source, board: state.board, index: result.index, from: result.from };
    clear();
    viewer.stage.focus({ preventScroll: true });
    host.status(`${edit.type === 'add' ? 'Connection added' : edit.type === 'remove' ? 'Connection deleted' : 'Connection label changed'}. Undo with ⌘Z / Ctrl+Z.`);
  }
  function connect(to: string) {
    if (connecting) commit({ type: 'add', from: connecting.from, to, label: label.value });
  }
  panel.addEventListener('submit', event => {
    event.preventDefault();
    if (connecting) connect(destination.value);
    else if (selected) commit({ type: 'label', index: selected.index, label: label.value });
  });
  remove.addEventListener('click', () => { if (selected) commit({ type: 'remove', index: selected.index }); });
  cancel.addEventListener('click', () => clear(true));
  panel.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); clear(true); }
    // Keep diagram navigation out of this form while preserving native text editing and form submission.
    if (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement)) event.preventDefault();
    event.stopPropagation();
  });
  viewer.stage.addEventListener('click', event => {
    const shape = shapeAt(event.target);
    if (connecting && shape) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shape.dataset.shapeBoard === connecting.board) connect(shape.dataset.shapeId!);
      return;
    }
    const edge = edgeAt(event.target);
    if (edge) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectEdge(edge);
    } else if (!shape) clear();
  }, { capture: true });
  viewer.stage.addEventListener('focusin', event => {
    if (restoring) return;
    const edge = edgeAt(event.target);
    if (edge && (selected?.board !== edge.dataset.connectionBoard || selected?.index !== Number(edge.dataset.flowConnection))) selectEdge(edge);
  });
  viewer.stage.addEventListener('keydown', event => {
    if (event.isComposing) return;
    // A redraw drops editable attributes from the old SVG. Until it finishes, repeated editing keys must
    // still be consumed rather than reaching Backspace-to-parent navigation on a nested flow board.
    const oldEdge = event.target instanceof Element && event.target.closest('[data-connection-id]');
    if ((oldEdge || event.target === viewer.stage) && pending?.source === host.source() && !flowAt() && ['Enter', ' ', 'F2', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (event.key === 'Escape' && (connecting || selected)) {
      event.preventDefault(); event.stopImmediatePropagation(); clear(); viewer.stage.focus({ preventScroll: true }); return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const shape = shapeAt(event.target);
    if (connecting && shape && event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (shape.dataset.shapeBoard === connecting.board) connect(shape.dataset.shapeId!);
      return;
    }
    const edge = edgeAt(event.target);
    if (!edge || !['Enter', ' ', 'F2', 'Delete', 'Backspace'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!flowAt()) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      selected = { board: boardId(), index: Number(edge.dataset.flowConnection), source: host.source() };
      commit({ type: 'remove', index: selected.index });
    } else selectEdge(edge, event.key !== ' ');
  }, { capture: true });

  return {
    start(from: string) {
      const flow = flowAt();
      if (!flow?.steps.some(step => step.id === from)) return;
      host.clearShapes();
      selected = undefined;
      connecting = { board: boardId(), from, source: host.source() };
      heading.textContent = `Connect from ${name(boardId(), from)}`;
      panel.setAttribute('aria-label', heading.textContent);
      help.textContent = 'Choose a step on the diagram, or use the destination list. Escape cancels.';
      destination.replaceChildren(...flow.steps.map(step => new Option(step.label, step.id)));
      destination.value = flow.steps.find(step => step.id !== from)?.id ?? from;
      destinationField.hidden = false;
      label.value = '';
      apply.textContent = 'Add connection';
      remove.hidden = true;
      cancel.textContent = 'Cancel';
      panel.hidden = false;
      markSelection();
      destination.focus();
      host.status(`Choose a step to connect from “${name(boardId(), from)}”.`);
    },
    /** A shape selection replaces an arrow selection, but can still be choosing a destination. */
    selectShape() { if (selected) clear(); },
    clear,
    invalidate() { clear(); flows.clear(); if (pending?.source !== host.source()) pending = undefined; },
    history(run: () => void) {
      const before = host.source();
      run();
      // An undo may remove the focused arrow. Keep the diagram focused so the next redo reaches it too.
      historySource = before !== host.source() ? host.source() : undefined;
    },
    refresh() {
      if ((selected ?? connecting)?.source !== host.source() || (selected ?? connecting)?.board !== boardId()) clear();
      const ids = new Map<string, Map<string, number>>();
      for (const element of viewer.stage.querySelectorAll<SVGElement>('[data-connection-id]')) {
        const board = element.dataset.connectionBoard!;
        if (!ids.has(board)) {
          const flow = flowAt(board);
          ids.set(board, new Map(flow && flowConnectionIds(flow).map((id, index) => [id, index])));
        }
        const index = ids.get(board)!.get(element.dataset.connectionId!);
        if (index === undefined) {
          if (element.hasAttribute('data-flow-connection')) {
            delete element.dataset.flowConnection;
            for (const key of ['tabindex', 'role', 'aria-label']) element.removeAttribute(key);
            for (const hit of element.querySelectorAll('.zf-connection-hit')) hit.remove();
          }
          continue;
        }
        element.dataset.flowConnection = String(index);
        if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
        element.setAttribute('role', 'button');
        const edge = flowAt(board)!.connections[index];
        element.setAttribute('aria-label', `Connection ${index + 1}: ${name(board, edge.from)} to ${name(board, edge.to)}${edge.label ? `: ${edge.label}` : ''}`);
        // Give thin arrows an easy pointer target without changing the diagram or its exported SVG.
        if (!element.querySelector('.zf-connection-hit')) for (const path of element.querySelectorAll('path.connection')) {
          const hit = path.cloneNode(true) as SVGElement;
          for (const key of ['mask', 'marker-start', 'marker-end', 'style']) hit.removeAttribute(key);
          hit.setAttribute('class', 'zf-connection-hit');
          hit.setAttribute('aria-hidden', 'true');
          element.append(hit);
        }
      }
      markSelection();
    },
    settled() {
      this.refresh();
      const restoreHistory = historySource === host.source();
      historySource = undefined;
      const show = pending;
      pending = undefined;
      const focused = document.activeElement;
      if (focused && focused !== document.body && !viewer.stage.contains(focused)) return;
      if (restoreHistory) viewer.stage.focus({ preventScroll: true });
      if (!show || show.source !== host.source() || show.board !== boardId()) return;
      const edge = show.index === undefined ? undefined : connectionElement(show.board, show.index);
      if (edge) selectEdge(edge);
      else host.selectShape(show.from);
    },
    keys(target: Element) { return edgeAt(target) ? 'Enter or F2 edits the label · Delete removes the connection · Escape closes' : undefined; },
  };
}
