import { boardKey, type Board } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BuilderTarget } from './builder-dialog';
import { boardSites, type BoardSites, type BuilderKind, type ShapeAction } from './board-model';
import type { PaneScope } from './pane-scope';
import { setText } from './text';

type Builder = { open: (target: BuilderTarget, returnFocus: HTMLElement) => void };
type BoardToolsOptions = {
  builders: Record<BuilderKind, Builder>;
  source: () => string;
  /** Replace the document's source with a builder's result. */
  update: (source: string) => void;
  /** Select a shape's source, as Alt+click does. */
  selectSource: (shape: string) => void;
};

const stale = 'This diagram changed while the builder was open. Close and reopen the builder to use the latest version.';

/** Builder actions for the board on view and for the selected shape: a toolbar above the diagram, and the same
 * actions in a context menu on each shape. Each board keeps its own builder, so flows and mind maps can open from
 * each other's shapes. */
export function setupBoardTools(scope: PaneScope, viewer: Viewer, options: BoardToolsOptions) {
  const toolbar = document.createElement('div');
  toolbar.className = 'flow-builder-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button"></button><span></span>';
  scope.part('viewer').prepend(toolbar);
  const editBoard = toolbar.querySelector('button')!;
  // The selected shape's actions float over the diagram, so selecting a shape never moves it.
  const shapeGroup = document.createElement('div');
  shapeGroup.className = 'board-selection';
  shapeGroup.setAttribute('role', 'group');
  shapeGroup.hidden = true;
  shapeGroup.innerHTML = '<span></span>';
  viewer.stage.after(shapeGroup);
  const menu = document.createElement('div');
  menu.className = 'board-menu';
  menu.id = scope.id('board-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  scope.root.append(menu);

  /** The compiled document's boards, or only the root board's text until the current source compiles. */
  let sites: BoardSites | undefined;
  let compiledSource: string | undefined;
  let selected: string | undefined;
  /** A board just added: show it once the document compiles with it. */
  let pending: string | undefined;
  let menuReturn: HTMLElement | SVGElement | undefined;

  const current = () => {
    const source = options.source();
    if (sites && compiledSource === source) return sites;
    return boardSites(source, new Map([['root', { from: 0, to: source.length }]]), new Map());
  };
  const boardId = () => viewer.currentBoard?.id ?? 'root';
  const shapeLabel = (board: string, shape: string) => {
    const found = viewer.currentBoard?.id === board ? viewer.currentBoard.diagram.shapes.find(item => item.id === shape) : undefined;
    return (found && 'label' in found && found.label) || shape;
  };

  /** Each target checks that the document is still the one it was opened on. */
  function target(mode: BuilderTarget['mode'], name: string, apply: (site: BoardSites, source: string, name: string) => string | { source: string } | { error: string },
    own?: string): BuilderTarget {
    const site = current();
    const opened = options.source();
    return { mode, name, source: own, apply(source, title) {
      if (options.source() !== opened) return stale;
      const result = apply(site, source, title);
      if (typeof result === 'object' && 'error' in result) return result.error;
      options.update(typeof result === 'string' ? result : result.source);
    } };
  }
  function edit(board: string, returnFocus: HTMLElement) {
    const builder = current().builder(board);
    if (!builder) return;
    // Editing hides the name, but the builders' name fields stay required.
    options.builders[builder.kind].open(target('edit', 'Board', (site, source) => site.update(board, source), builder.own), returnFocus);
  }
  function add(kind: BuilderKind, board: string, shape: string, returnFocus: HTMLElement) {
    options.builders[kind].open(target('board', shapeLabel(board, shape), (site, source, name) => {
      const added = site.add(board, shape, source, name);
      pending = `${board}.layers.${boardKey(added.name)}`;
      return added.source;
    }), returnFocus);
  }
  function shapeAction(shape: string): ShapeAction {
    if (!sites || compiledSource !== options.source()) return { action: 'none', reason: 'Wait for the preview to update.' };
    return sites.shapeAction(boardId(), shape);
  }
  type Item = (label: string, run: (returnFocus: HTMLElement) => void, relinks: boolean) => HTMLButtonElement;
  /** The actions for a shape, as buttons for the toolbar or menu items. Adding a board relinks the shape,
   * which redraws it and these buttons. */
  function actions(shape: string, item: Item) {
    const action = shapeAction(shape);
    const board = boardId();
    if (action.action === 'add') {
      return (['flow', 'mind map'] as const).map(kind => item(`Add ${kind} board`, focus => add(kind, board, shape, focus), true));
    }
    if (action.action === 'edit') return [item(`Edit ${action.kind} board`, focus => edit(action.board, focus), false)];
    return [];
  }

  function refresh() {
    const source = options.source();
    const owner = current().owner(boardId());
    const kind = owner && current().builder(owner)?.kind;
    toolbar.hidden = !kind;
    if (kind) {
      editBoard.textContent = `Edit ${kind}`;
      editBoard.dataset.board = owner;
      setText(toolbar.querySelector('span')!, kind === 'flow' ? 'Change steps and connections without writing code.'
        : 'Change topics as an outline, without writing code.');
    }
    const shape = selected && compiledSource === source ? selected : undefined;
    const buttons = shape ? actions(shape, (label, run, relinks) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      // A button that relinks the shape is gone when the builder closes, so focus returns to the diagram.
      button.addEventListener('click', () => run(relinks ? viewer.stage : button));
      return button;
    }) : [];
    shapeGroup.hidden = !buttons.length;
    if (shape && buttons.length) {
      const label = `Selected: ${shapeLabel(boardId(), shape)}`;
      shapeGroup.setAttribute('aria-label', label);
      setText(shapeGroup.querySelector('span')!, label);
      shapeGroup.replaceChildren(shapeGroup.querySelector('span')!, ...buttons);
    }
  }
  editBoard.addEventListener('click', () => edit(editBoard.dataset.board!, editBoard));

  function closeMenu(restore = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restore && menuReturn?.isConnected) menuReturn.focus({ preventScroll: true });
    menuReturn = undefined;
  }
  function openMenu(shape: string, element: HTMLElement | SVGElement, x: number, y: number) {
    const item = (label: string, run: (returnFocus: HTMLElement) => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.textContent = label;
      button.addEventListener('click', () => {
        closeMenu();
        // The menu is gone when the builder closes, so focus returns to the diagram.
        run(viewer.stage);
      });
      return button;
    };
    const items = actions(shape, (label, run) => item(`${label}…`, run));
    const action = shapeAction(shape);
    const heading = document.createElement('p');
    heading.textContent = shapeLabel(boardId(), shape);
    const parts: HTMLElement[] = [heading, ...items];
    if (action.action === 'none') {
      const note = document.createElement('p');
      note.className = 'board-menu-note';
      note.textContent = action.reason;
      parts.push(note);
    }
    parts.push(item('Select in source', () => options.selectSource(shape)));
    menu.replaceChildren(...parts);
    menu.setAttribute('aria-label', `Actions for ${heading.textContent}`);
    menuReturn = element;
    menu.hidden = false;
    // Keep the menu on screen beside the pointer or shape.
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')!.focus({ preventScroll: true });
  }
  function shapeAt(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<SVGElement>('[data-shape-id]')
      ?? target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    return element && { id: element.dataset.shapeId!, focus: (element.closest('a') ?? element) as SVGElement };
  }
  viewer.stage.addEventListener('contextmenu', event => {
    const shape = shapeAt(event.target);
    if (!shape || !sites || compiledSource !== options.source()) return;
    event.preventDefault();
    openMenu(shape.id, shape.focus, event.clientX, event.clientY);
  });
  viewer.stage.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const shape = shapeAt(event.target);
    if (!shape || !sites || compiledSource !== options.source()) return;
    event.preventDefault();
    const box = shape.focus.getBoundingClientRect();
    openMenu(shape.id, shape.focus, box.left + box.width / 2, box.top + box.height / 2);
  });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (move !== undefined) items[(move + items.length) % items.length].focus();
    else if (event.key === 'Escape') closeMenu();
    else if (event.key === 'Tab') closeMenu(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node)) closeMenu(false); }, true);
  menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget as Node)) closeMenu(false); });

  return {
    refresh,
    /** The source changed: board actions wait for it to compile, except editing the root board. */
    invalidate() { closeMenu(false); refresh(); },
    /** The document compiled: index its boards, and show a board just added. */
    compiled(source: string, next: BoardSites, boards: Map<string, Board>) {
      sites = next;
      compiledSource = source;
      refresh();
      const show = pending;
      pending = undefined;
      return show && boards.has(show) ? show : undefined;
    },
    /** The shapes the source selection maps to on the board on view. */
    select(shapes: readonly string[]) {
      selected = shapes.length === 1 ? shapes[0] : undefined;
      refresh();
    },
  };
}
