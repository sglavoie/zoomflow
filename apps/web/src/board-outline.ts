import type { Board } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BoardSites } from './board-model';

const kinds: Record<Board['kind'], string> = { root: 'Board', layers: 'Board', scenarios: 'Scenario', steps: 'Step' };

/** Every board of the document as a tree, marked with the builder that writes it. Choosing a board opens it,
 * and a board a builder wrote also offers that builder. */
export function setupBoardOutline(host: HTMLElement, viewer: Viewer, edit: (board: string, returnFocus: HTMLElement) => void) {
  const details = document.createElement('details');
  details.className = 'board-outline';
  details.hidden = true;
  details.innerHTML = '<summary></summary><nav aria-label="Boards"></nav>';
  host.prepend(details);
  const summary = details.querySelector('summary')!;
  const nav = details.querySelector('nav')!;
  let shown: unknown[] = [];

  function kind(sites: BoardSites | undefined, board: Board) {
    const owner = sites?.owner(board.id);
    const builder = owner && sites!.builder(owner);
    if (builder && owner === board.id) return { label: builder.kind === 'flow' ? 'Flow' : 'Mind map', editable: true };
    if (builder) return { label: `Part of ${builder.kind}`, editable: false };
    return { label: kinds[board.kind], editable: false };
  }
  function render(sites: BoardSites | undefined, boards: Map<string, Board>, current: string) {
    // Edits redraw the toolbar on every keystroke; the outline changes only with the compiled boards.
    if (shown[0] === sites && shown[1] === boards && shown[2] === current) return;
    shown = [sites, boards, current];
    details.hidden = boards.size < 2;
    summary.textContent = `Boards (${boards.size})`;
    const list = (parent?: string): HTMLUListElement | undefined => {
      const children = [...boards.values()].filter(board => board.parent === parent);
      if (!children.length) return;
      const ul = document.createElement('ul');
      for (const board of children) {
        const li = document.createElement('li');
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
  }
  details.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !details.open) return;
    event.preventDefault();
    event.stopPropagation();
    details.open = false;
    summary.focus();
  });
  document.addEventListener('pointerdown', event => { if (details.open && !details.contains(event.target as Node)) details.open = false; }, true);
  return {
    render,
    get hidden() { return details.hidden; },
  };
}
