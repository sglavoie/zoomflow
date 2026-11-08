import type { BoardTransfers } from './board-transfers';
import type { Board } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BoardSites, BuilderKind, ShapeAction } from './board-model';
import type { CanvasEdit, CanvasShape } from './canvas-model';
import type { setupCanvasConnections } from './canvas-connections';
import type { setupCanvasBranches } from './canvas-branches';
import type { setupBoardOutline } from './board-outline';
import type { setupDiagramSearch } from './diagram-search';
import type { PaneScope } from './pane-scope';
import type { setupProjectCheck } from './project-check-dialog';
import { setText } from './text';
import { addKeys, type Item, type FileLinkHost, type BoardToolsOptions } from './board-tools-shared';

interface Context {
  canvasTarget: (shape: string, board?: string) => CanvasShape | undefined;
  shapeElement: (shape: string, board?: string) => SVGElement | undefined;
  pressed: string | null | undefined;
  rename: HTMLInputElement;
  renaming: { shape: string; element: SVGElement; frame: number; } | undefined;
  applyCanvas: (shape: string, edits: CanvasEdit[]) => void;
  shapeGroup: HTMLDivElement;
  viewer: Viewer;
  options: BoardToolsOptions;
  shapeLabel: (board: string, shape: string) => string;
  boardId: () => string;
  shapeAction: (shape: string) => ShapeAction;
  connections: ReturnType<typeof setupCanvasConnections>;
  branchOwner: (board: string) => string | undefined;
  mapCanvas: (board: string) => ReturnType<BoardSites['canvas']>;
  transfers: BoardTransfers | undefined;
  branches: ReturnType<typeof setupCanvasBranches>;
  add: (kind: BuilderKind, board: string, shape: string, returnFocus: HTMLElement) => void;
  linkable: (host: FileLinkHost) => string[];
  linkTo: (board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement, current?: string) => Promise<void>;
  newLinked: (board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement) => Promise<void>;
  edit: (board: string, returnFocus: HTMLElement) => void;
  applyLink: (board: string, shape: string, link?: string) => boolean;
  current: () => BoardSites;
  editGroup: HTMLElement;
  editBoard: HTMLButtonElement;
  outline: ReturnType<typeof setupBoardOutline>;
  ready: () => boolean;
  sites: BoardSites | undefined;
  boards: Map<string, Board>;
  search: ReturnType<typeof setupDiagramSearch>;
  projectCheck: ReturnType<typeof setupProjectCheck> | undefined;
  toolbar: HTMLDivElement;
  selected: string | undefined;
  compiledSource: string | undefined;
  menu: HTMLDivElement;
  toggled: HTMLElement | undefined;
  menuTrigger: HTMLElement | undefined;
  menuReturn: HTMLElement | SVGElement | undefined;
  scope: PaneScope;
}

export function setupBoardSelection(ctx: Context) {
  function startRename(shape: string) {
    const target = ctx.canvasTarget(shape);
    const element = ctx.shapeElement(shape);
    if (!target || !element) return;
    stopRename(false);
    ctx.pressed = undefined;
    ctx.rename.value = target.label;
    ctx.rename.setAttribute('aria-label', `Rename ${target.label}`);
    ctx.rename.title = `Enter renames. ${target.add} with ${addKeys}. Escape cancels.`;
    ctx.rename.hidden = false;
    // Follow the shape while the diagram pans or zooms.
    const place = () => {
      const box = element.getBoundingClientRect();
      const area = ctx.rename.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const width = Math.max(box.width, 140);
      ctx.rename.style.left = `${box.left - area.left + (box.width - width) / 2}px`;
      ctx.rename.style.top = `${box.top - area.top + box.height / 2 - ctx.rename.offsetHeight / 2}px`;
      ctx.rename.style.width = `${width}px`;
      if (ctx.renaming) ctx.renaming.frame = requestAnimationFrame(place);
    };
    ctx.renaming = { shape, element, frame: 0 };
    place();
    ctx.rename.focus();
    ctx.rename.select();
  }

  /** Finish renaming, applying the new label with any edit that follows it. */
  function stopRename(commit: boolean, then?: CanvasEdit) {
    if (!ctx.renaming) return;
    const { shape, element, frame } = ctx.renaming;
    ctx.renaming = undefined;
    cancelAnimationFrame(frame);
    ctx.rename.hidden = true;
    const edits: CanvasEdit[] = commit ? [{ type: 'rename', label: ctx.rename.value }] : [];
    if (then) edits.push(then);
    if (element.isConnected) (element.closest<SVGElement>('a') ?? element).focus({ preventScroll: true });
    if (edits.length) ctx.applyCanvas(shape, edits);
    else ctx.pressed = undefined;
  }

  function toggleVisibility(shape: string) {
    const refocusShape = ctx.shapeGroup.contains(document.activeElement);
    ctx.viewer.toggleShapeHidden(shape);
    ctx.options.status(`“${ctx.shapeLabel(ctx.boardId(), shape)}” ${ctx.viewer.isShapeHidden(shape) ? 'hidden from' : 'included in'} exports.`);
    if (refocusShape) {
      const element = ctx.shapeElement(shape);
      (element?.closest<SVGElement>('a') ?? element)?.focus({ preventScroll: true });
    }
  }

  /** The actions for a shape, as buttons for the selection bar or items in the menu. */
  function actions(shape: string, item: Item, boardsOnly = false) {
    const items: HTMLButtonElement[] = [];
    const visibility = boardsOnly ? [] : [item(ctx.viewer.isShapeHidden(shape) ? 'Unhide from export' : 'Hide from export', () => toggleVisibility(shape), { keys: 'H' })];
    if (ctx.options.readOnly?.()) {
      const action = ctx.shapeAction(shape);
      const files = ctx.options.files?.();
      if (action.action === 'file' && files) items.push(item('Open diagram', () => files.open(action.link)));
      return [...items, ...visibility];
    }
    const canvas = boardsOnly ? undefined : ctx.canvasTarget(shape);
    if (canvas) {
      items.push(item('Rename', () => startRename(shape), { keys: 'F2' }),
        item(canvas.add, () => ctx.applyCanvas(shape, [{ type: 'add' }]), { keys: 'Control+Enter Meta+Enter Insert' }));
      if (canvas.sibling) items.push(item('Add sibling topic', () => ctx.applyCanvas(shape, [{ type: 'sibling' }]), { keys: 'Enter' }));
      if (canvas.kind === 'flow') items.push(item('Connect to…', () => ctx.connections.start(shape)));
    }
    if (!boardsOnly && ctx.branchOwner(ctx.boardId()) && (!ctx.mapCanvas(ctx.boardId()) || shape !== 'n' || ctx.mapCanvas(ctx.boardId())!.trail.length || ctx.transfers?.canMove(ctx.boardId(), shape))) {
      items.push(item('Move branch…', () => ctx.branches.start(shape)));
    }
    if (canvas?.remove) items.push(item('Delete', () => ctx.applyCanvas(shape, [{ type: 'remove' }]), { keys: 'Delete Backspace' }));
    const action = ctx.shapeAction(shape);
    const board = ctx.boardId();
    const files = ctx.options.files?.();
    if (action.action === 'add') {
      items.push(...(['flow', 'mind map'] as const).map(kind => item(`Add ${kind} board…`, focus => ctx.add(kind, board, shape, focus), { relinks: true })));
      if (files) {
        if (ctx.linkable(files).length) items.push(item('Link to diagram…', focus => void ctx.linkTo(board, shape, files, focus), { relinks: true }));
        items.push(item('New linked diagram…', focus => void ctx.newLinked(board, shape, files, focus), { relinks: true }));
      }
    } else if (action.action === 'edit') items.push(item(`Edit ${action.kind} board…`, focus => ctx.edit(action.board, focus)));
    else if (action.action === 'file' && files) {
      items.push(item('Open diagram', () => files.open(action.link)));
      if (action.attached) {
        items.push(item('Change linked diagram…', focus => void ctx.linkTo(board, shape, files, focus, action.link), { relinks: true }),
          item('Remove link', () => ctx.applyLink(board, shape), { relinks: true }));
      }
    }
    return [...items, ...visibility];
  }

  function refresh() {
    const source = ctx.options.source();
    const owner = ctx.current().owner(ctx.boardId());
    const kind = owner && ctx.current().builder(owner)?.kind;
    ctx.editGroup.hidden = !kind;
    if (kind) {
      ctx.editBoard.textContent = `Edit ${kind}`;
      ctx.editBoard.dataset.board = owner;
      setText(ctx.editGroup.querySelector('span')!, kind === 'flow' ? 'Change steps and connections without writing code.'
        : 'Change topics as an outline, without writing code.');
    }
    ctx.outline.render(ctx.ready() ? ctx.sites : undefined, ctx.boards, ctx.boardId());
    ctx.search.refresh();
    ctx.projectCheck?.refresh();
    ctx.toolbar.hidden = ctx.editGroup.hidden && ctx.outline.hidden && ctx.search.empty && (!ctx.projectCheck || ctx.projectCheck.empty);
    const shape = ctx.selected && ctx.compiledSource === source ? ctx.selected : undefined;
    const button: Item = (label, run, { relinks, keys } = {}) => {
      const element = document.createElement('button');
      element.type = 'button';
      // Keyboard users reach these through shortcuts and Shift+F10, so Tab still leaves the diagram.
      element.tabIndex = -1;
      element.textContent = label.replace(/^((Add|Edit) (flow|mind map) board)…$/, '$1');
      if (keys) {
        element.setAttribute('aria-keyshortcuts', keys);
        element.title = `${label} (${keys === 'F2' ? 'F2 or double-click' : keys.includes('Insert') ? `${addKeys} or Insert` : keys.replace(' ', ' or ')})`;
      }
      // A button that relinks the shape is gone when the builder closes, so focus returns to the diagram.
      element.addEventListener('click', () => run(relinks ? ctx.viewer.stage : element));
      return element;
    };
    const all = shape ? actions(shape, button) : [];
    const canvas = shape && ctx.canvasTarget(shape);
    const primary = canvas ? [canvas.add, canvas.kind === 'flow' ? 'Connect to…' : 'Add sibling topic'] : ['Open diagram'];
    const buttons = all.filter(item => primary.includes(item.textContent!));
    if (shape && all.length) {
      // Keep the frequent actions beside the shape. The full list also remains available on right-click.
      const more = button('More', () => {});
      more.setAttribute('aria-label', 'More shape actions');
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-controls', ctx.menu.id);
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        // A click on the button while its menu is open closes the menu.
        if (ctx.toggled === more) { ctx.toggled = undefined; return; }
        const box = more.getBoundingClientRect();
        openMenu(shape, more, box.left, box.bottom + 4);
      });
      buttons.push(more);
    }
    ctx.shapeGroup.hidden = !buttons.length;
    if (shape && buttons.length) {
      const label = `Selected: ${ctx.shapeLabel(ctx.boardId(), shape)}`;
      ctx.shapeGroup.setAttribute('aria-label', label);
      if (ctx.viewer.isShapeHidden(shape)) {
        ctx.shapeGroup.setAttribute('aria-label', `${label} · Hidden from export`);
      }
      ctx.shapeGroup.replaceChildren(...buttons);
    }
    drawSelection(shape);
    markLinks();
    ctx.connections.refresh();
    ctx.branches.refresh();
  }

  /** Links on steps and topics open from their arrow badge only, leaving the shape to select and rename. */
  function markLinks() {
    for (const link of ctx.viewer.stage.querySelectorAll<SVGAElement>('a[data-link-kind]')) {
      const shape = link.querySelector<SVGElement>('[data-shape-id]');
      const id = shape?.dataset.shapeId;
      if (id && link.querySelector('.appendix-icon') && ctx.canvasTarget(id, shape?.dataset.shapeBoard)) link.dataset.follow = 'badge';
      else delete link.dataset.follow;
    }
  }

  /** Mark the selected shape with a ring around its bounds, drawn in the diagram so it pans and zooms
   * with it. The ring keeps its width at any zoom. */
  function drawSelection(shape: string | undefined) {
    for (const node of ctx.viewer.stage.querySelectorAll('.zf-selection')) node.remove();
    for (const node of ctx.viewer.stage.querySelectorAll('.zf-canvas-selected')) node.classList.remove('zf-canvas-selected');
    const element = shape && ctx.shapeElement(shape);
    if (!(element instanceof SVGGraphicsElement)) { ctx.shapeGroup.hidden = true; return; }
    const box = element.getBBox();
    const pad = 7;
    // Pills, ovals and circles get a pill-shaped ring that follows them.
    const corner = Number(element.querySelector('rect')?.getAttribute('rx') ?? 0);
    const round = Boolean(element.querySelector('ellipse, circle')) || corner >= box.height / 2 - 1;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ring.setAttribute('class', 'zf-selection zf-selection-ring');
    for (const [name, value] of Object.entries({ x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad,
      height: box.height + 2 * pad, rx: round ? box.height / 2 + pad : 10 })) ring.setAttribute(name, String(value));
    ring.setAttribute('aria-hidden', 'true');
    // The ring sits under a link's arrow badge.
    const outer = element.closest('a') ?? element;
    const badge = outer.querySelector(':scope > .appendix-icon');
    if (badge) badge.before(ring);
    else outer.after(ring);
    element.classList.add('zf-canvas-selected');
    placeBar();
  }

  /** Keep the selection bar beside the selected shape: below it, or above when there is no room below,
   * and within the diagram's area. */
  function placeBar() {
    const ring = ctx.viewer.stage.querySelector('.zf-selection-ring');
    const area = ctx.shapeGroup.offsetParent;
    if (ctx.shapeGroup.hidden || !ring || !area) return;
    const box = ring.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    const stage = ctx.viewer.stage.getBoundingClientRect();
    // A shape panned out of view takes its bar with it, rather than leaving the bar at the edge.
    ctx.shapeGroup.style.visibility = box.right < stage.left || box.left > stage.right || box.bottom < stage.top || box.top > stage.bottom ? 'hidden' : '';
    const { offsetWidth: width, offsetHeight: height } = ctx.shapeGroup;
    const gap = 8;
    const below = box.bottom + gap + height <= stage.bottom || box.top - gap - height < stage.top;
    const top = below ? Math.min(box.bottom + gap, stage.bottom - height - gap) : box.top - gap - height;
    const left = Math.max(stage.left + gap, Math.min(box.left + box.width / 2 - width / 2, stage.right - width - gap));
    ctx.shapeGroup.style.left = `${left - bounds.left}px`;
    ctx.shapeGroup.style.top = `${Math.max(stage.top + gap, top) - bounds.top}px`;
  }

  function closeMenu(restore = true) {
    if (ctx.menu.hidden) return;
    ctx.menu.hidden = true;
    delete ctx.shapeGroup.dataset.behindMenu;
    ctx.menuTrigger?.setAttribute('aria-expanded', 'false');
    ctx.menuTrigger = undefined;
    if (restore && ctx.menuReturn?.isConnected) ctx.menuReturn.focus({ preventScroll: true });
    ctx.menuReturn = undefined;
  }

  function openMenu(shape: string, element: HTMLElement | SVGElement, x: number, y: number, boardsOnly = false) {
    const item: Item = (label, run, { keys } = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.textContent = label;
      if (keys) button.setAttribute('aria-keyshortcuts', keys);
      button.addEventListener('click', () => {
        closeMenu();
        // The menu is gone when the builder closes, so focus returns to the diagram.
        run(ctx.viewer.stage);
      });
      return button;
    };
    const items = actions(shape, item, boardsOnly);
    const action = ctx.shapeAction(shape);
    // A menu holds only its items: the heading repeats its name, and the note is its description.
    const text = (content: string, className?: string) => Object.assign(document.createElement('p'),
      { textContent: content, ...className ? { className, id: ctx.scope.id('board-menu-note') } : {} });
    const heading = text(`${ctx.shapeLabel(ctx.boardId(), shape)}${ctx.viewer.isShapeHidden(shape) ? ' · Hidden from export' : ''}`);
    const parts: HTMLElement[] = [heading, ...items];
    const note = action.action === 'none' && !ctx.canvasTarget(shape) ? text(action.reason, 'board-menu-note') : undefined;
    if (note) parts.push(note);
    for (const part of [heading, note]) { part?.setAttribute('role', 'none'); part?.setAttribute('aria-hidden', 'true'); }
    if (!boardsOnly && ctx.options.inSource(shape)) parts.push(item('Select in source', () => ctx.options.selectSource(shape, true)));
    // A shape with no actions, such as a link from an imported file, opens no menu.
    if (!parts.some(part => part.getAttribute('role') === 'menuitem')) return false;
    ctx.menu.replaceChildren(...parts);
    ctx.menu.setAttribute('aria-label', `Actions for ${heading.textContent}`);
    if (note) ctx.menu.setAttribute('aria-describedby', note.id); else ctx.menu.removeAttribute('aria-describedby');
    ctx.menuReturn = element;
    if (element instanceof HTMLElement && element.hasAttribute('aria-expanded')) {
      ctx.menuTrigger = element;
      element.setAttribute('aria-expanded', 'true');
    }
    ctx.menu.hidden = false;
    // A shape's context menu replaces the bar; More keeps its trigger visible.
    if (boardsOnly || ctx.shapeGroup.contains(element)) delete ctx.shapeGroup.dataset.behindMenu; else ctx.shapeGroup.dataset.behindMenu = '';
    // Keep the menu on screen beside the pointer or shape.
    const { width, height } = ctx.menu.getBoundingClientRect();
    if (ctx.shapeGroup.contains(element) && y + height > innerHeight - 8) {
      y = element.getBoundingClientRect().top - height - 4;
    }
    ctx.menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    ctx.menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
    ctx.menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return true;
  }

  function shapeAt(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<SVGElement>('[data-shape-id]')
      ?? target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    return element && { id: element.dataset.shapeId!, board: element.dataset.shapeBoard, focus: (element.closest('a') ?? element) as SVGElement };
  }

  /** Select a shape on the board on view, keeping focus on the diagram. */
  function selectShape(shape: string, startRenaming = false) {
    const element = ctx.shapeElement(shape);
    if (!element) return;
    (element.closest<SVGElement>('a') ?? element).focus({ preventScroll: true });
    ctx.options.selectSource(shape, false);
    if (startRenaming) startRename(shape);
  }
  return { startRename, stopRename, toggleVisibility, actions, refresh, markLinks, drawSelection, placeBar, closeMenu, openMenu, shapeAt, selectShape };
}
