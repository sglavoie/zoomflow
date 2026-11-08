import type { Board } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BoardSites } from './board-model';
import { pageListeners } from './canvas-guidance';

const kinds: Record<Board['kind'], string> = { root: 'Board', layers: 'Board', scenarios: 'Scenario', steps: 'Step' };

/** Every board of the document as a tree, marked with the builder that writes it. Choosing a board opens it,
 * and a board a builder wrote also offers that builder. */
export function setupBoardOutline(host: HTMLElement, viewer: Viewer, edit: (board: string, returnFocus: HTMLElement) => void) {
  const details = document.createElement('details');
  details.className = 'board-outline';
  details.hidden = true;
  details.innerHTML = '<summary></summary><div class="board-outline-panel"><nav aria-label="Boards"></nav><div class="board-layer-settings"></div></div>';
  const settings = details.querySelector('.board-layer-settings')!;
  host.prepend(details);
  const showAll = document.createElement('label');
  showAll.className = 'layer-visibility-all';
  showAll.hidden = true;
  showAll.innerHTML = '<input type="checkbox" /> Show all layers';
  const allLayers = showAll.querySelector('input')!;
  settings.append(showAll);
  allLayers.addEventListener('change', () => void viewer.setAllLayers(allLayers.checked));
  const depthControls = document.createElement('div');
  depthControls.className = 'layer-depth-controls';
  depthControls.setAttribute('role', 'group');
  depthControls.setAttribute('aria-label', 'Layer depth controls');
  depthControls.hidden = true;
  depthControls.innerHTML = '<label>Depth <input type="number" min="0" step="1" inputmode="numeric" aria-label="Layer depth" placeholder="Custom" /></label><button type="button" aria-label="Decrease layer depth">−</button><button type="button" aria-label="Increase layer depth">+</button>';
  settings.append(depthControls);
  const focusBoard = document.createElement('button');
  focusBoard.type = 'button';
  focusBoard.textContent = 'Focus this board';
  focusBoard.hidden = true;
  settings.append(focusBoard);
  focusBoard.addEventListener('click', () => {
    const id = viewer.currentBoard?.id;
    if (!id || !viewer.layerState.root || viewer.layerState.root === id) return;
    details.open = false;
    // Navigation redraws the canvas and hides this button. Keep keyboard focus in the diagram.
    viewer.stage.focus({ preventScroll: true });
    void viewer.navigate(id);
  });
  const depthInput = depthControls.querySelector('input')!;
  const [decreaseDepth, increaseDepth] = [...depthControls.querySelectorAll('button')];
  let depthEdited = false;
  depthInput.addEventListener('input', () => { depthEdited = true; });
  const applyDepth = () => {
    // Enter already commits the number. Its later blur/change must not redraw the SVG during a diagram click.
    if (!depthEdited) return;
    depthEdited = false;
    const value = depthInput.valueAsNumber;
    if (!Number.isSafeInteger(value) || value < 0) { syncLayers(); return; }
    void viewer.setLayerDepth(Math.min(value, viewer.layerState.maxDepth));
  };
  depthInput.addEventListener('change', applyDepth);
  depthInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyDepth(); }
  });
  for (const [button, step] of [[decreaseDepth, -1], [increaseDepth, 1]] as const) button.addEventListener('click', () => {
    const state = viewer.layerState;
    void viewer.setLayerDepth(Math.max(0, Math.min(state.maxDepth, (state.depth ?? state.visibleDepth) + step)));
  });
  const summary = details.querySelector('summary')!;
  const nav = details.querySelector('nav')!;
  let shown: unknown[] = [];
  const switches = new Map<string, { input: HTMLInputElement; parent?: string }>();

  function syncLayers() {
    const state = viewer.layerState;
    if (!state) return;
    allLayers.checked = state.all;
    allLayers.indeterminate = state.enabled && state.visible.size > 1 && !state.all;
    allLayers.title = `Show all layers below ${viewer.currentBoard?.name ?? 'this board'}.`;
    const root = state.root ?? viewer.currentBoard?.id;
    focusBoard.hidden = !state.enabled || root === viewer.currentBoard?.id;
    focusBoard.title = `Open ${viewer.currentBoard?.name ?? 'this board'} and its visible descendants as the starting point of the view.`;
    const rootName = viewer.currentBoard?.id === root ? viewer.currentBoard?.name : undefined;
    depthInput.max = String(state.maxDepth);
    if (!depthEdited) depthInput.value = state.depth === null ? '' : String(state.depth);
    depthInput.title = `Levels below ${rootName ?? 'the starting board'}. 0 shows only that board.`;
    decreaseDepth.disabled = state.depth === 0;
    increaseDepth.disabled = state.depth !== null && state.depth >= state.maxDepth;
    const focused = [decreaseDepth, increaseDepth].find(button => button === document.activeElement);
    if (focused?.disabled) ([decreaseDepth, increaseDepth].find(button => !button.disabled) ?? depthInput).focus({ preventScroll: true });
    for (const [id, { input, parent }] of switches) {
      input.checked = id === root || state.enabled && state.available.has(id) && state.expanded.has(id);
      input.disabled = id === root || !state.available.has(id) || state.enabled && !state.visible.has(parent!);
      input.title = id === root ? 'This board is the starting point of the view.'
        : !state.available.has(id) ? 'Open this board to show its layers.'
          : input.disabled ? 'Show the parent layer first.' : 'Show or hide this layer and its descendants.';
    }
  }

  function kind(sites: BoardSites | undefined, board: Board) {
    const owner = sites?.owner(board.id);
    const builder = owner && sites!.builder(owner);
    if (builder && owner === board.id) return { label: builder.kind === 'flow' ? 'Flow' : 'Mind map', editable: true };
    if (builder) return { label: `Part of ${builder.kind}`, editable: false };
    return { label: kinds[board.kind], editable: false };
  }
  function render(sites: BoardSites | undefined, boards: Map<string, Board>, current: string) {
    // Edits redraw the toolbar on every keystroke; the outline changes only with the compiled boards.
    if (shown[0] === sites && shown[1] === boards && shown[2] === current) { syncLayers(); return; }
    shown = [sites, boards, current];
    const focused = nav.contains(document.activeElement) && (document.activeElement as HTMLInputElement)?.dataset.layerToggle;
    switches.clear();
    details.hidden = boards.size < 2;
    showAll.hidden = ![...boards.values()].some(board => board.kind === 'layers');
    depthControls.hidden = showAll.hidden;
    summary.textContent = `Boards (${boards.size})`;
    const list = (parent?: string): HTMLUListElement | undefined => {
      const children = [...boards.values()].filter(board => board.parent === parent);
      if (!children.length) return;
      const ul = document.createElement('ul');
      for (const board of children) {
        const li = document.createElement('li');
        if (board.kind === 'layers') {
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.dataset.layerToggle = board.id;
          toggle.setAttribute('aria-label', `Show ${board.name} layer`);
          toggle.addEventListener('change', () => void viewer.setLayerVisible(board.id, toggle.checked));
          switches.set(board.id, { input: toggle, parent: board.parent });
          const label = document.createElement('label');
          label.className = 'board-layer-toggle';
          label.append(toggle);
          li.append(label);
        }
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'board-outline-open';
        const { label, editable } = kind(sites, board);
        open.innerHTML = '<span></span><small></small>';
        open.firstElementChild!.textContent = board.name;
        open.lastElementChild!.textContent = label;
        if (board.id === current) open.setAttribute('aria-current', 'page');
        open.addEventListener('click', () => {
          details.open = false;
          // Breadcrumbs follow the board tree, not the boards visited before.
          const trail = [board.id];
          while (boards.get(trail[0])?.parent) trail.unshift(boards.get(trail[0])!.parent!);
          void viewer.navigate(board.id, 'push', trail);
          viewer.stage.focus({ preventScroll: true });
        });
        li.append(open);
        if (editable) {
          const change = document.createElement('button');
          change.type = 'button';
          change.textContent = 'Edit';
          change.setAttribute('aria-label', `Edit ${label.toLowerCase()} ${board.name}`);
          change.addEventListener('click', () => { details.open = false; edit(board.id, summary); });
          li.append(change);
        }
        const nested = list(board.id);
        if (nested) li.append(nested);
        ul.append(li);
      }
      return ul;
    };
    nav.replaceChildren(list() ?? '');
    syncLayers();
    if (focused) switches.get(focused)?.input.focus({ preventScroll: true });
  }
  pageListeners(viewer.stage, signal => {
    document.addEventListener('pointerdown', event => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    }, { capture: true, signal });
    // Safari does not always focus a checkbox when it is clicked. Dismiss the open outline
    // before Escape can reach the viewer and navigate to the parent board.
    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.key !== 'Escape' || !details.open ||
        event.target instanceof Element && event.target.closest('dialog, [role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      summary.focus();
    }, { capture: true, signal });
  });
  return {
    render,
    get hidden() { return details.hidden; },
  };
}
