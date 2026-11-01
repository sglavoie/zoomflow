import type { Viewer } from '@zoomflow/viewer';
import type { branchChoices } from './canvas-model';
import { pageListeners } from './canvas-guidance';

type Branch = NonNullable<ReturnType<typeof branchChoices>> & { board: string; shape: string; owner: string; source: string };
type BranchHost = {
  branch: (board: string, shape: string) => Branch | undefined;
  topic: (board: string, shape: string) => { owner: string; id: string } | undefined;
  canDrag: (board: string, shape: string) => boolean;
  owner: (board: string) => string | undefined;
  source: () => string;
  move: (branch: Branch, destination: string) => boolean;
  select: (shape: string) => void;
  clearShapes: () => void;
  status: (text: string) => void;
};

/** The picker and pointer gestures share the same validated destinations and source transaction. */
export function setupCanvasBranches(viewer: Viewer, host: BranchHost) {
  const panel = document.createElement('form');
  panel.className = 'canvas-branches';
  panel.setAttribute('role', 'group');
  panel.hidden = true;
  const heading = document.createElement('strong');
  const help = document.createElement('p');
  help.textContent = 'Choose a new parent on the diagram or from the list. The whole branch moves with it. Escape cancels.';
  const field = document.createElement('label');
  field.append('New parent');
  const destination = document.createElement('select');
  destination.setAttribute('aria-label', 'New parent topic');
  field.append(destination);
  const buttons = document.createElement('div');
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.textContent = 'Move branch';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  buttons.append(apply, cancel);
  panel.append(heading, help, field, buttons);
  viewer.stage.after(panel);
  const hint = document.createElement('div');
  hint.className = 'branch-drag-hint';
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
  viewer.stage.after(hint);
  let choosing: Branch | undefined;
  let drag: { branch: Branch; pointer: number; x: number; y: number; active: boolean; touch: boolean; target?: string; timer?: ReturnType<typeof setTimeout> } | undefined;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const boardId = () => viewer.currentBoard?.id ?? 'root';
  const shapeAt = (target: EventTarget | null) => target instanceof Element
    ? target.closest<SVGElement>('[data-shape-id]') ?? target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') ?? null : null;
  const valid = (branch: Branch) => branch.source === host.source() && host.owner(branch.board) === branch.owner;
  function targetAt(branch: Branch, element: SVGElement | null) {
    if (!element) return;
    const board = element.dataset.shapeBoard ?? boardId();
    // The destination may be a repeated detail-board centre. Its global identity is the branch's origin.
    const topic = host.topic(board, element.dataset.shapeId!);
    return topic?.owner === branch.owner ? branch.destinations.find(item => item.id === topic.id)?.id : undefined;
  }
  function unmark() {
    for (const node of viewer.stage.querySelectorAll('.zf-branch-origin, .zf-branch-target')) node.classList.remove('zf-branch-origin', 'zf-branch-target');
  }
  function mark(branch: Branch, target?: string) {
    unmark();
    const dest = branch.destinations.find(item => item.id === target);
    for (const element of viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')) {
      const board = element.dataset.shapeBoard ?? boardId();
      if (board === branch.board && element.dataset.shapeId === branch.shape) element.classList.add('zf-branch-origin');
      if (dest) {
        const topic = host.topic(board, element.dataset.shapeId!);
        if (topic?.owner === branch.owner && topic.id === dest.id) element.classList.add('zf-branch-target');
      }
    }
  }
  function swallowClick() {
    suppressClick = true;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { suppressClick = false; }, 400);
  }
  function stopDrag() {
    const gesture = drag;
    drag = undefined;
    clearTimeout(gesture?.timer);
    if (gesture?.active) {
      swallowClick();
      if (viewer.stage.hasPointerCapture(gesture.pointer)) viewer.stage.releasePointerCapture(gesture.pointer);
    }
    hint.hidden = true;
    viewer.stage.classList.remove('zf-branch-dragging');
    unmark();
  }
  function clear(restore = false) {
    const from = choosing;
    choosing = undefined;
    panel.hidden = true;
    stopDrag();
    if (restore && from && valid(from) && boardId() === from.board) host.select(from.shape);
  }
  function commit(branch: Branch, target: string) {
    if (!valid(branch)) { clear(); return; }
    if (host.move(branch, target)) clear();
  }
  panel.addEventListener('submit', event => { event.preventDefault(); if (choosing) commit(choosing, destination.value); });
  cancel.addEventListener('click', () => clear(true));
  panel.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); clear(true); }
    if (event.key === 'Backspace') event.preventDefault();
    event.stopPropagation();
  });
  viewer.stage.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; return; }
    if (!choosing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = targetAt(choosing, shapeAt(event.target));
    if (target) commit(choosing, target);
    else host.status('Choose a different parent outside this branch.');
  }, { capture: true });
  viewer.stage.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && (choosing || drag?.active)) {
      event.preventDefault(); event.stopImmediatePropagation(); clear(true); return;
    }
    if (choosing && event.key === 'Enter' && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      const target = targetAt(choosing, shapeAt(event.target));
      if (target) commit(choosing, target);
    }
  }, { capture: true });
  function beginDrag() {
    if (!drag || !valid(drag.branch)) { stopDrag(); return; }
    clearTimeout(drag.timer);
    choosing = undefined;
    panel.hidden = true;
    // A held touch becomes a branch gesture; the viewport relinquishes its pending pan.
    viewer.stage.dispatchEvent(new Event('zf-cancelgesture'));
    drag.active = true;
    viewer.stage.setPointerCapture(drag.pointer);
    host.clearShapes();
    viewer.stage.classList.add('zf-branch-dragging');
    hint.hidden = false;
    hint.textContent = `Move “${drag.branch.label}” · Choose a new parent`;
    mark(drag.branch);
    host.status(`Moving “${drag.branch.label}”. Drop on a new parent; Escape cancels.`);
  }
  viewer.stage.addEventListener('pointerdown', event => {
    if (drag && event.pointerId !== drag.pointer) { stopDrag(); return; }
    if (choosing || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || viewer.stage.classList.contains('zf-pan-ready')) return;
    if (event.target instanceof Element && event.target.closest('.appendix-icon')) return;
    const element = shapeAt(event.target);
    const branch = element && host.branch(element.dataset.shapeBoard ?? boardId(), element.dataset.shapeId!);
    if (!branch || !branch.destinations.length) return;
    drag = { branch, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, touch: event.pointerType === 'touch' };
    if (drag.touch) drag.timer = setTimeout(beginDrag, 400);
  }, { capture: true });
  viewer.stage.addEventListener('contextmenu', event => {
    if (drag?.active) { event.preventDefault(); event.stopImmediatePropagation(); }
    else stopDrag();
  }, { capture: true });
  viewer.stage.addEventListener('dragstart', event => { if (drag) event.preventDefault(); }, { capture: true });
  pageListeners(viewer.stage, signal => {
    // A new press starts a new action. Only the click from the drag's own release is suppressed.
    window.addEventListener('pointerdown', () => { suppressClick = false; clearTimeout(clickTimer); }, { capture: true, signal });
    window.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      if (!valid(drag.branch)) { stopDrag(); return; }
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        // Touch dragging pans normally; hold still first to pick up a branch.
        if (drag.touch) { stopDrag(); return; }
        beginDrag();
      }
      if (!drag) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag.target = targetAt(drag.branch, shapeAt(document.elementFromPoint(event.clientX, event.clientY)));
      const name = drag.branch.destinations.find(item => item.id === drag!.target)?.label;
      hint.textContent = name ? `Move “${drag.branch.label}” under ${name}` : 'Drop on a new parent outside this branch';
      const bounds = viewer.stage.getBoundingClientRect();
      hint.style.left = `${Math.max(8, Math.min(event.clientX + 12, bounds.right - hint.offsetWidth - 8))}px`;
      hint.style.top = `${Math.max(8, Math.min(event.clientY + 16, bounds.bottom - hint.offsetHeight - 8))}px`;
      mark(drag.branch, drag.target);
    }, { capture: true, passive: false, signal });
    window.addEventListener('pointerup', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const gesture = drag;
      // Test the release location too, including a release outside the diagram.
      const target = gesture.active ? targetAt(gesture.branch, shapeAt(document.elementFromPoint(event.clientX, event.clientY))) : undefined;
      stopDrag();
      if (!gesture.active) return;
      event.preventDefault();
      if (target) commit(gesture.branch, target);
      else { host.status('Branch move cancelled. Drop on a new parent outside this branch.'); host.select(gesture.branch.shape); }
    }, { capture: true, signal });
    window.addEventListener('pointercancel', stopDrag, { signal });
    window.addEventListener('blur', () => clear(), { signal });
    // Suppress the release click even when it lands outside the stage, or compilation has replaced the SVG.
    window.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    }, { capture: true, signal });
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !drag?.active) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear(); viewer.stage.focus({ preventScroll: true });
    }, { capture: true, signal });
  });
  viewer.stage.addEventListener('lostpointercapture', event => { if (drag?.active && drag.pointer === event.pointerId) stopDrag(); });
  for (const type of ['zf-suspend', 'zf-destroy']) viewer.stage.addEventListener(type, () => clear());
  return {
    start(shape: string) {
      const branch = host.branch(boardId(), shape);
      if (!branch) return;
      if (!branch.destinations.length) { host.status('This branch has no other parent topic. Add another branch first.'); return; }
      clear();
      choosing = branch;
      host.clearShapes();
      heading.textContent = `Move “${branch.label}”`;
      panel.setAttribute('aria-label', heading.textContent);
      destination.replaceChildren(...branch.destinations.map(item => new Option(item.label, item.id)));
      panel.hidden = false;
      destination.focus();
      mark(branch);
    },
    clear,
    boardChanged() {
      const branch = choosing ?? drag?.branch;
      if (branch && (!valid(branch) || host.owner(boardId()) !== branch.owner)) clear();
    },
    refresh() {
      for (const element of viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')) {
        element.classList.toggle('zf-branch-draggable', host.canDrag(element.dataset.shapeBoard ?? boardId(), element.dataset.shapeId!));
      }
      if (choosing && !valid(choosing)) clear();
    },
  };
}
