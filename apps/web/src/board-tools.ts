import { boardKey, type Board } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BuilderTarget } from './builder-dialog';
import { boardSites, type BoardSites, type BuilderKind, type ShapeAction } from './board-model';
import { canvasShape, editOnCanvas, type CanvasEdit, type CanvasShape } from './canvas-model';
import { setupBoardOutline } from './board-outline';
import type { PaneScope } from './pane-scope';
import { setText } from './text';

type Builder = { open: (target: BuilderTarget, returnFocus: HTMLElement) => void };
type BoardToolsOptions = {
  builders: Record<BuilderKind, Builder>;
  source: () => string;
  /** Replace the document's source with a builder's result. */
  update: (source: string) => void;
  /** Select a shape's source; `focusEditor` moves to the source editor, as Alt+click does. */
  selectSource: (shape: string, focusEditor: boolean) => void;
  status: (message: string, kind?: 'info' | 'error') => void;
  undo: () => void;
  redo: () => void;
};
type Item = (label: string, run: (returnFocus: HTMLElement) => void, options?: { relinks?: boolean; keys?: string }) => HTMLButtonElement;

const stale = 'This diagram changed while the builder was open. Close and reopen the builder to use the latest version.';
const undoHint = 'Undo with ⌘Z / Ctrl+Z.';

/** Builder actions for the board on view and for the selected shape: a toolbar above the diagram, a bar over it for
 * the selected shape, and the same actions in a context menu on each shape. Shapes on builder boards are also
 * renamed, added and removed on the diagram itself. Each board keeps its own builder, so flows and mind maps can
 * open from each other's shapes. */
export function setupBoardTools(scope: PaneScope, viewer: Viewer, options: BoardToolsOptions) {
  const toolbar = document.createElement('div');
  toolbar.className = 'flow-builder-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<div data-group="edit"><button type="button"></button><span></span></div>';
  scope.part('viewer').prepend(toolbar);
  const editGroup = toolbar.querySelector<HTMLElement>('[data-group="edit"]')!;
  const editBoard = editGroup.querySelector('button')!;
  // The selected shape's actions float over the diagram, so selecting a shape never moves it.
  const shapeGroup = document.createElement('div');
  shapeGroup.className = 'board-selection';
  shapeGroup.setAttribute('role', 'group');
  shapeGroup.hidden = true;
  viewer.stage.after(shapeGroup);
  const rename = document.createElement('input');
  rename.className = 'canvas-rename';
  rename.hidden = true;
  rename.maxLength = 200;
  shapeGroup.after(rename);
  const menu = document.createElement('div');
  menu.className = 'board-menu';
  menu.id = scope.id('board-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  scope.root.append(menu);
  const outline = setupBoardOutline(toolbar, viewer, (board, focus) => edit(board, focus));

  /** The compiled document's boards, or only the root board's text until the current source compiles. */
  let sites: BoardSites | undefined;
  let boards = new Map<string, Board>();
  let compiledSource: string | undefined;
  let selected: string | undefined;
  /** What to show once the document compiles: a board just added or renamed, and a shape to select or rename. */
  let pending: { board?: string; shape?: string; rename?: boolean } | undefined;
  let menuReturn: HTMLElement | SVGElement | undefined;
  let renaming: { shape: string; element: SVGElement; frame: number } | undefined;
  let lastBoard: string | undefined;

  const ready = () => Boolean(sites) && compiledSource === options.source();
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
  const shapeElement = (shape: string) =>
    [...viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find(node => node.dataset.shapeId === shape);

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
      pending = { board: `${board}.layers.${boardKey(added.name)}` };
      return added.source;
    }), returnFocus);
  }
  function shapeAction(shape: string): ShapeAction {
    if (!ready()) return { action: 'none', reason: 'Wait for the preview to update.' };
    return sites!.shapeAction(boardId(), shape);
  }
  /** The shape as a step or topic of the builder board that writes the board on view. */
  function canvasTarget(shape: string): CanvasShape | undefined {
    const canvas = ready() ? sites!.canvas(boardId()) : undefined;
    return canvas && canvasShape(canvas.own, canvas.trail, shape);
  }

  /** Apply edits made on the diagram in one change, so one undo reverts them together. */
  function applyCanvas(shape: string, edits: CanvasEdit[]) {
    const canvas = ready() ? sites!.canvas(boardId()) : undefined;
    if (!canvas) return;
    const label = canvasShape(canvas.own, canvas.trail, shape)?.label ?? shape;
    let own = canvas.own;
    let trail = canvas.trail;
    let result: ReturnType<typeof editOnCanvas>;
    for (const change of edits) {
      const next = editOnCanvas(own, trail, shape, change);
      if (!next) continue;
      result = next;
      own = next.own;
      trail = next.trail ?? trail;
    }
    if (!result) return;
    const updated = sites!.update(canvas.owner, own);
    if ('error' in updated) { options.status(updated.error, 'error'); return; }
    const board = trail === canvas.trail ? boardId() : canvas.owner + trail.map(name => `.layers.${boardKey(name)}`).join('');
    const added = edits.some(change => change.type === 'add' || change.type === 'sibling');
    pending = { ...board !== boardId() ? { board } : {}, ...result.select ? { shape: result.select, rename: added && result.select !== shape } : {} };
    options.update(updated.source);
    if (edits.some(change => change.type === 'remove')) options.status(`Removed “${label}”. ${undoHint}`);
  }

  function startRename(shape: string) {
    const target = canvasTarget(shape);
    const element = shapeElement(shape);
    if (!target || !element) return;
    stopRename(false);
    rename.value = target.label;
    rename.setAttribute('aria-label', `Rename ${target.label}`);
    rename.title = `Enter renames. ${target.add} with Tab. Escape cancels.`;
    rename.hidden = false;
    // Follow the shape while the diagram pans or zooms.
    const place = () => {
      const box = element.getBoundingClientRect();
      const area = rename.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const width = Math.max(box.width, 140);
      rename.style.left = `${box.left - area.left + (box.width - width) / 2}px`;
      rename.style.top = `${box.top - area.top + box.height / 2 - rename.offsetHeight / 2}px`;
      rename.style.width = `${width}px`;
      if (renaming) renaming.frame = requestAnimationFrame(place);
    };
    renaming = { shape, element, frame: 0 };
    place();
    rename.focus();
    rename.select();
  }
  /** Finish renaming, applying the new label with any edit that follows it. */
  function stopRename(commit: boolean, then?: CanvasEdit) {
    if (!renaming) return;
    const { shape, element, frame } = renaming;
    renaming = undefined;
    cancelAnimationFrame(frame);
    rename.hidden = true;
    const edits: CanvasEdit[] = commit ? [{ type: 'rename', label: rename.value }] : [];
    if (then) edits.push(then);
    if (element.isConnected) (element.closest<SVGElement>('a') ?? element).focus({ preventScroll: true });
    if (edits.length) applyCanvas(shape, edits);
  }
  rename.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) stopRename(true);
    else if (event.key === 'Escape') stopRename(false);
    else if (event.key === 'Tab' && !event.shiftKey) stopRename(true, { type: 'add' });
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  rename.addEventListener('blur', () => stopRename(true));

  /** The actions for a shape, as buttons for the selection bar or items in the menu. */
  function actions(shape: string, item: Item, boardsOnly = false) {
    const items: HTMLButtonElement[] = [];
    const canvas = boardsOnly ? undefined : canvasTarget(shape);
    if (canvas) {
      items.push(item('Rename', () => startRename(shape), { keys: 'F2' }),
        item(canvas.add, () => applyCanvas(shape, [{ type: 'add' }]), { keys: 'Tab' }));
      if (canvas.sibling) items.push(item('Add sibling topic', () => applyCanvas(shape, [{ type: 'sibling' }]), { keys: 'Enter' }));
      if (canvas.remove) items.push(item('Delete', () => applyCanvas(shape, [{ type: 'remove' }]), { keys: 'Delete' }));
    }
    const action = shapeAction(shape);
    const board = boardId();
    if (action.action === 'add') {
      items.push(...(['flow', 'mind map'] as const).map(kind => item(`Add ${kind} board…`, focus => add(kind, board, shape, focus), { relinks: true })));
    } else if (action.action === 'edit') items.push(item(`Edit ${action.kind} board…`, focus => edit(action.board, focus)));
    return items;
  }

  function refresh() {
    const source = options.source();
    const owner = current().owner(boardId());
    const kind = owner && current().builder(owner)?.kind;
    editGroup.hidden = !kind;
    if (kind) {
      editBoard.textContent = `Edit ${kind}`;
      editBoard.dataset.board = owner;
      setText(editGroup.querySelector('span')!, kind === 'flow' ? 'Change steps and connections without writing code.'
        : 'Change topics as an outline, without writing code.');
    }
    outline.render(ready() ? sites : undefined, boards, boardId());
    toolbar.hidden = editGroup.hidden && outline.hidden;
    const shape = selected && compiledSource === source ? selected : undefined;
    const button: Item = (label, run, { relinks, keys } = {}) => {
      const element = document.createElement('button');
      element.type = 'button';
      // Keyboard users reach these through shortcuts and Shift+F10, so Tab still leaves the diagram.
      element.tabIndex = -1;
      element.textContent = label.replace(/^((Add|Edit) (flow|mind map) board)…$/, '$1');
      if (keys) { element.setAttribute('aria-keyshortcuts', keys); element.title = `${label} (${keys === 'F2' ? 'F2 or double-click' : keys})`; }
      // A button that relinks the shape is gone when the builder closes, so focus returns to the diagram.
      element.addEventListener('click', () => run(relinks ? viewer.stage : element));
      return element;
    };
    let buttons = shape ? actions(shape, button) : [];
    // With canvas actions too, the board actions move behind one button that opens them as a menu.
    if (shape && canvasTarget(shape) && shapeAction(shape).action === 'add') {
      const boardsButton = button('Add board…', () => {});
      boardsButton.setAttribute('aria-haspopup', 'menu');
      boardsButton.addEventListener('click', () => {
        const box = boardsButton.getBoundingClientRect();
        openMenu(shape, boardsButton, box.left, box.bottom + 4, true);
      });
      buttons = [...buttons.filter(item => !/^Add (flow|mind map) board$/.test(item.textContent!)), boardsButton];
    }
    shapeGroup.hidden = !buttons.length;
    if (shape && buttons.length) {
      const label = `Selected: ${shapeLabel(boardId(), shape)}`;
      shapeGroup.setAttribute('aria-label', label);
      const caption = document.createElement('span');
      caption.append('Selected: ', Object.assign(document.createElement('strong'), { textContent: shapeLabel(boardId(), shape) }));
      shapeGroup.replaceChildren(caption, ...buttons);
    }
    drawSelection(shape);
    markLinks();
  }
  /** Links on steps and topics open from their arrow badge only, leaving the shape to select and rename. */
  function markLinks() {
    for (const link of viewer.stage.querySelectorAll<SVGAElement>('a[data-link-kind]')) {
      const id = link.querySelector<SVGElement>('[data-shape-id]')?.dataset.shapeId;
      if (id && link.querySelector('.appendix-icon') && canvasTarget(id)) link.dataset.follow = 'badge';
      else delete link.dataset.follow;
    }
  }
  /** Mark the selected shape with a ring and halo around its bounds, drawn in the diagram so they pan and zoom
   * with it. The ring keeps its width at any zoom. */
  function drawSelection(shape: string | undefined) {
    for (const node of viewer.stage.querySelectorAll('.zf-selection')) node.remove();
    for (const node of viewer.stage.querySelectorAll('.zf-canvas-selected')) node.classList.remove('zf-canvas-selected');
    const element = shape && shapeElement(shape);
    if (!(element instanceof SVGGraphicsElement)) return;
    const box = element.getBBox();
    const pad = 7;
    // Pills, ovals and circles get a pill-shaped ring that follows them.
    const corner = Number(element.querySelector('rect')?.getAttribute('rx') ?? 0);
    const round = Boolean(element.querySelector('ellipse, circle')) || corner >= box.height / 2 - 1;
    const [halo, ring] = ['halo', 'ring'].map(part => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', `zf-selection zf-selection-${part}`);
      for (const [name, value] of Object.entries({ x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad,
        height: box.height + 2 * pad, rx: round ? box.height / 2 + pad : 10 })) rect.setAttribute(name, String(value));
      rect.setAttribute('aria-hidden', 'true');
      return rect;
    });
    // The halo sits behind the shape and the ring in front of it, under a link's arrow badge.
    const outer = element.closest('a') ?? element;
    outer.before(halo);
    const badge = outer.querySelector(':scope > .appendix-icon');
    if (badge) badge.before(ring);
    else outer.after(ring);
    element.classList.add('zf-canvas-selected');
    placeBar();
  }
  /** Keep the selection bar beside the selected shape: below it, or above when there is no room below,
   * and within the diagram's area. */
  function placeBar() {
    const ring = viewer.stage.querySelector('.zf-selection-ring');
    const area = shapeGroup.offsetParent;
    if (shapeGroup.hidden || !ring || !area) return;
    const box = ring.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    const stage = viewer.stage.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = shapeGroup;
    const gap = 8;
    const below = box.bottom + gap + height <= stage.bottom || box.top - gap - height < stage.top;
    const top = below ? Math.min(box.bottom + gap, stage.bottom - height - gap) : box.top - gap - height;
    const left = Math.max(stage.left + gap, Math.min(box.left + box.width / 2 - width / 2, stage.right - width - gap));
    shapeGroup.style.left = `${left - bounds.left}px`;
    shapeGroup.style.top = `${Math.max(stage.top + gap, top) - bounds.top}px`;
  }
  // Panning and zooming move the shape; the bar follows.
  viewer.stage.addEventListener('zf-viewportchange', placeBar, { capture: true });
  editBoard.addEventListener('click', () => edit(editBoard.dataset.board!, editBoard));

  function closeMenu(restore = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restore && menuReturn?.isConnected) menuReturn.focus({ preventScroll: true });
    menuReturn = undefined;
  }
  function openMenu(shape: string, element: HTMLElement | SVGElement, x: number, y: number, boardsOnly = false) {
    const item: Item = (label, run) => {
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
    const items = actions(shape, item, boardsOnly);
    const action = shapeAction(shape);
    const heading = document.createElement('p');
    heading.textContent = shapeLabel(boardId(), shape);
    const parts: HTMLElement[] = [heading, ...items];
    if (action.action === 'none' && !canvasTarget(shape)) {
      const note = document.createElement('p');
      note.className = 'board-menu-note';
      note.textContent = action.reason;
      parts.push(note);
    }
    if (!boardsOnly) parts.push(item('Select in source', () => options.selectSource(shape, true)));
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
    if (!shape || !ready()) return;
    event.preventDefault();
    // The menu acts on the shape it opened from, so that shape is the selected one.
    options.selectSource(shape.id, false);
    openMenu(shape.id, shape.focus, event.clientX, event.clientY);
  });
  // Double-click edits: renames a step or topic, or opens any other shape's source.
  viewer.stage.addEventListener('dblclick', event => {
    const shape = shapeAt(event.target);
    const canvas = shape && canvasTarget(shape.id);
    if (!shape || !ready() || shape.focus.localName === 'a' && !canvas) return;
    event.preventDefault();
    if (canvas) startRename(shape.id);
    else options.selectSource(shape.id, true);
  });
  // Selection follows keyboard focus, so the ring marks the shape that keys act on.
  viewer.stage.addEventListener('focusin', event => {
    const shape = shapeAt(event.target);
    if (shape && ready() && shape.id !== selected) options.selectSource(shape.id, false);
  });
  // Capture, so builder shortcuts on a focused shape run before the pane's Enter-to-select-source.
  viewer.stage.addEventListener('keydown', event => {
    if (event.target === rename || event.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y' && event.ctrlKey && !event.metaKey)) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) options.redo(); else options.undo();
      return;
    }
    const shape = shapeAt(event.target);
    if (!shape || !ready()) return;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      options.selectSource(shape.id, false);
      const box = shape.focus.getBoundingClientRect();
      openMenu(shape.id, shape.focus, box.left + box.width / 2, box.top + box.height / 2);
      return;
    }
    const canvas = canvasTarget(shape.id);
    if (!canvas || event.altKey) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey;
    const change: CanvasEdit | 'rename' | undefined = event.key === 'F2' && plain ? 'rename'
      : event.key === 'Tab' && plain ? { type: 'add' }
        // In a mind map, Enter adds a sibling; the centre has none, so it adds a main branch. Enter on a topic
        // that opens a board opens it, as on any link.
        : event.key === 'Enter' && plain && canvas.kind === 'mind map' && shape.focus.localName !== 'a'
          ? { type: canvas.sibling ? 'sibling' : 'add' }
          : (event.key === 'Delete' && plain || event.key === 'Backspace' && (event.metaKey || event.ctrlKey)) && canvas.remove ? { type: 'remove' }
            : undefined;
    if (!change) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (change === 'rename') startRename(shape.id);
    else applyCanvas(shape.id, [change]);
  }, { capture: true });
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

  /** Select a shape on the board on view, keeping focus on the diagram. */
  function selectShape(shape: string, startRenaming = false) {
    const element = shapeElement(shape);
    if (!element) return;
    (element.closest<SVGElement>('a') ?? element).focus({ preventScroll: true });
    options.selectSource(shape, false);
    if (startRenaming) startRename(shape);
  }

  return {
    refresh,
    /** Whether a shape on the board on view is edited on the diagram, so clicking it keeps focus there. */
    editsOnCanvas: (shape: string) => Boolean(canvasTarget(shape)),
    /** The source changed: board actions wait for it to compile, except editing the root board. */
    invalidate() { closeMenu(false); stopRename(false); refresh(); },
    /** The document compiled: index its boards. */
    compiled(source: string, next: BoardSites, nextBoards: Map<string, Board>) {
      sites = next;
      boards = nextBoards;
      compiledSource = source;
      refresh();
    },
    /** The preview shows the compiled document: open a board just added or renamed, then select a shape just made. */
    async settled() {
      const show = pending;
      pending = undefined;
      if (show?.board && boards.has(show.board) && show.board !== boardId()) await viewer.navigate(show.board);
      if (show?.shape) selectShape(show.shape, show.rename);
    },
    /** Another board is on view. Going up selects the shape that leads back down, with its actions. */
    boardChanged() {
      closeMenu(false);
      stopRename(false);
      const board = boardId();
      const previous = lastBoard;
      lastBoard = board;
      let child = previous;
      while (child && boards.get(child)?.parent !== board) child = boards.get(child)?.parent;
      const shape = child && child !== board ? viewer.currentBoard?.diagram.shapes.find(item => item.link === child) : undefined;
      if (shape) options.selectSource(shape.id, false);
      refresh();
    },
    /** The shapes the source selection maps to on the board on view. */
    select(shapes: readonly string[]) {
      selected = shapes.length === 1 ? shapes[0] : undefined;
      refresh();
    },
  };
}
