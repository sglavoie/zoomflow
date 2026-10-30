import { boardKey, classifyHref, resolveFilePath, type Board, type DiagramSearchEntry } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import type { BuilderTarget } from './builder-dialog';
import { boardSites, type BoardSites, type BuilderKind, type ShapeAction } from './board-model';
import { canvasShapes, editOnCanvas, type CanvasEdit, type CanvasShape } from './canvas-model';
import { pageListeners } from './canvas-guidance';
import { setupBoardOutline } from './board-outline';
import { setupDiagramSearch } from './diagram-search';
import { fileLinkDialog, newFileSource, type FileBoard } from './file-link-dialog';
import { fileLink } from './project-files';
import type { PaneScope } from './pane-scope';
import type { ProjectSearchHost } from './project-search';
import { setupProjectCheck } from './project-check-dialog';
import type { ProjectCheckHost } from './project-check';
import { setText } from './text';

/** What a folder project offers for linking its files: this document's project path, the other files, a file's
 * boards, and opening or creating a file. `create` resolves the new file's project path, or undefined when it failed. */
export type FileLinkHost = {
  /** The draft requesting the link; a delayed file write must not change another document. */
  key: string;
  path: string;
  files: string[];
  boards: (path: string) => Promise<FileBoard[]>;
  open: (link: string) => void;
  create: (name: string, source: string) => Promise<string | undefined>;
};
type Builder = { open: (target: BuilderTarget, returnFocus: HTMLElement, fallback?: HTMLElement) => void };
type BoardToolsOptions = {
  builders: Record<BuilderKind, Builder>;
  source: () => string;
  /** Replace the document's source with a builder's result. */
  update: (source: string) => void;
  /** Select a shape's source; `focusEditor` moves to the source editor, as Alt+click does. */
  selectSource: (shape: string, focusEditor: boolean) => void;
  /** Show a search destination in the preview, framing and selecting its shape when present. */
  revealMatch: (shape?: string) => void;
  projectSearch?: ProjectSearchHost;
  projectCheck?: ProjectCheckHost;
  /** Whether the shape's source is in this document, rather than an imported file. */
  inSource: (shape: string) => boolean;
  status: (message: string, kind?: 'info' | 'error') => void;
  undo: () => void;
  redo: () => void;
  /** Links to other files, only in folder projects. */
  files?: () => FileLinkHost | undefined;
  /** The document is generated and read-only: shapes only open the files they link to. */
  readOnly?: () => boolean;
};
type Item = (label: string, run: (returnFocus: HTMLElement) => void, options?: { relinks?: boolean; keys?: string }) => HTMLButtonElement;

const stale = 'This board changed while the builder was open. Close and reopen the builder to use the latest version.';
const compiling = 'This diagram changed while the builder was open. Wait for the preview to update, then apply again.';
const undoHint = 'Undo with ⌘Z / Ctrl+Z.';
/** Adds the next step or a subtopic; Tab stays free to leave the diagram. */
const addKeys = '⌘/Ctrl+Enter';
const isAdd = (event: KeyboardEvent) => event.key === 'Insert' && !event.metaKey && !event.ctrlKey && !event.shiftKey
  || event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey;

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
  let menuTrigger: HTMLElement | undefined;
  /** The menu's button when a press on it closed the menu, so the click that follows does not reopen it. */
  let toggled: HTMLElement | undefined;
  scope.root.append(menu);
  const outline = setupBoardOutline(toolbar, viewer, (board, focus) => edit(board, focus));
  let searchRevision = 0;
  const search = setupDiagramSearch(toolbar, scope, viewer, revealSearchMatch, options.projectSearch);
  const projectCheck = options.projectCheck && setupProjectCheck(toolbar, scope, viewer, options.projectCheck);
  async function revealSearchMatch(entry: DiagramSearchEntry, mode: 'push' | 'replace' = 'push') {
    const revision = ++searchRevision;
    const indexed = boards;
    const board = indexed.get(entry.board);
    if (!board) return;
    await viewer.navigate(entry.board, mode, entry.trail);
    // A delayed render must not select a shape after a different document or route opened.
    if (revision === searchRevision && boards === indexed && viewer.currentBoard?.id === board.id &&
      viewer.currentBoard.diagram === board.diagram) options.revealMatch(entry.shape);
  }

  /** The compiled document's boards, or only the root board's text until the current source compiles. */
  let sites: BoardSites | undefined;
  let boards = new Map<string, Board>();
  let compiledSource: string | undefined;
  let selected: string | undefined;
  /** What to show once `source` compiles: a board just added or renamed, and a shape to select or rename. */
  let pending: { source: string; board?: string; replace?: boolean; shape?: string; rename?: boolean } | undefined;
  /** The shape, or the background as null, that a press on the diagram finishing a rename landed on. */
  let pressed: string | null | undefined;
  let menuReturn: HTMLElement | SVGElement | undefined;
  let renaming: { shape: string; element: SVGElement; frame: number } | undefined;
  let lastBoard: string | undefined;
  /** The recent edits on the diagram that moved the board on view, by the source and board before and after each,
   * so undoing or redoing several of them in turn follows each one. */
  let boardMoves: { before: { source: string; board: string }; after: { source: string; board: string } }[] = [];
  let shapeCache: { own: string; trail: string; find: (shape: string) => CanvasShape | undefined } | undefined;

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

  /** Each target applies to the latest document, as long as `fits` finds the board it was opened on unchanged. */
  function target(mode: BuilderTarget['mode'], name: string, apply: (site: BoardSites, source: string, name: string) => string | { source: string } | { error: string },
    fits: (site: BoardSites) => boolean, own?: string): BuilderTarget {
    let site = current();
    let opened = options.source();
    return { mode, name, source: own, apply(source, title) {
      if (options.source() !== opened) {
        // Edits elsewhere in the document, such as an AI change, keep the form; edits to its board do not.
        const latest = current();
        if (!fits(latest)) return ready() ? stale : compiling;
        site = latest;
        opened = options.source();
      }
      const result = apply(site, source, title);
      if (typeof result === 'object' && 'error' in result) return result.error;
      options.update(typeof result === 'string' ? result : result.source);
    } };
  }
  function edit(board: string, returnFocus: HTMLElement) {
    const builder = current().builder(board);
    if (!builder) return;
    // Editing hides the name, but the builders' name fields stay required.
    // Its button may be hidden by the time the builder closes, so the diagram takes focus instead.
    options.builders[builder.kind].open(target('edit', 'Board', (site, source) => site.update(board, source),
      site => site.builder(board)?.own === builder.own, builder.own), returnFocus, viewer.stage);
  }
  function add(kind: BuilderKind, board: string, shape: string, returnFocus: HTMLElement) {
    options.builders[kind].open(target('board', shapeLabel(board, shape), (site, source, name) => {
      const added = site.add(board, shape, source, name);
      pending = { source: added.source, board: `${board}.layers.${boardKey(added.name)}` };
      return added.source;
    }, site => site.shapeAction(board, shape).action === 'add'), returnFocus, viewer.stage);
  }
  function shapeAction(shape: string): ShapeAction {
    if (!ready()) return { action: 'none', reason: 'Wait for the preview to update.' };
    return sites!.shapeAction(boardId(), shape);
  }
  /** Write or, without `link`, remove the shape's file link, as long as the shape can still take one. */
  function applyLink(board: string, shape: string, link?: string) {
    if (!ready()) { options.status('Wait for the preview to update, then try again.', 'error'); return false; }
    const action = sites!.shapeAction(board, shape);
    if (!(action.action === 'file' && action.attached || link && action.action === 'add')) { options.status(stale, 'error'); return false; }
    const source = link ? sites!.linkFile(board, shape, link) : sites!.unlinkFile(board, shape);
    pending = { source, shape };
    options.update(source);
    options.status(`${link ? `“${shapeLabel(board, shape)}” opens ${link}` : 'Link removed'}. ${undoHint}`);
    return true;
  }
  const refocus = (element: HTMLElement) => { if (element.isConnected) element.focus({ preventScroll: true }); };
  // A link reads up to its first `#`, so a file named with one, as in `notes#1.d2`, cannot be linked.
  const linkable = (host: FileLinkHost) => host.files.filter((file) => classifyHref(fileLink(host.path, file)).kind === 'file');
  async function linkTo(board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement, current?: string) {
    const href = current ? classifyHref(current) : undefined;
    const path = href?.kind === 'file' ? resolveFilePath(host.path, href.path) : undefined;
    const files = linkable(host);
    const choice = await fileLinkDialog().link({ files, boards: host.boards, shape: shapeLabel(board, shape),
      ...path && href?.kind === 'file' ? { current: { path, hash: href.hash } } : {} });
    if (options.files?.()?.key !== host.key) return;
    refocus(returnFocus);
    // Without a file to choose, the dialog submits an empty path, which would link to the folder.
    if (choice?.path) applyLink(board, shape, fileLink(host.path, choice.path) + choice.hash);
  }
  async function newLinked(board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement) {
    const choice = await fileLinkDialog().create(shapeLabel(board, shape));
    if (options.files?.()?.key !== host.key) return;
    refocus(returnFocus);
    if (!choice) return;
    if (!ready() || sites!.shapeAction(board, shape).action !== 'add') { options.status(stale, 'error'); return; }
    const path = await host.create(choice.name, newFileSource(choice.kind, choice.name));
    if (!path || options.files?.()?.key !== host.key) return;
    const link = fileLink(host.path, path);
    if (applyLink(board, shape, link)) host.open(link);
  }

  /** The shape as a step or topic of the builder board that writes the board on view. */
  function canvasTarget(shape: string): CanvasShape | undefined {
    const canvas = ready() ? sites!.canvas(boardId()) : undefined;
    if (!canvas) return;
    // Every shape on the board is looked up on each refresh, so the board's text is read once.
    const trail = canvas.trail.join('\n');
    if (shapeCache?.own !== canvas.own || shapeCache.trail !== trail) shapeCache = { own: canvas.own, trail, find: canvasShapes(canvas.own, canvas.trail) };
    return shapeCache.find(shape);
  }

  /** Apply edits made on the diagram in one change, so one undo reverts them together. */
  function applyCanvas(shape: string, edits: CanvasEdit[]) {
    // Where a press that finished a rename landed matters only to this edit, even one that changes nothing.
    const landed = pressed;
    pressed = undefined;
    const canvas = ready() ? sites!.canvas(boardId()) : undefined;
    if (!canvas) return;
    const label = canvasTarget(shape)?.label ?? shape;
    let own = canvas.own;
    let trail = canvas.trail;
    let result: ReturnType<typeof editOnCanvas>;
    let moved: Map<string, string> | undefined;
    for (const change of edits) {
      const next = editOnCanvas(own, trail, shape, change);
      if (!next) continue;
      result = next;
      own = next.own;
      trail = next.trail ?? trail;
      // Chain each edit's moves, so attached boards follow their topics through all of them.
      if (next.moved) moved = moved ? new Map([...moved].filter(([, id]) => next.moved!.has(id)).map(([old, id]) => [old, next.moved!.get(id)!])) : next.moved;
    }
    if (!result) return;
    const updated = sites!.update(canvas.owner, own, moved);
    if ('error' in updated) { options.status(updated.error, 'error'); return; }
    const board = trail === canvas.trail ? boardId() : canvas.owner + trail.map(name => `.layers.${boardKey(name)}`).join('');
    const added = edits.some(change => change.type === 'add' || change.type === 'sibling');
    // A rename that renames the board, or a remove that removes it, replaces it in history, since the old board is gone.
    const moves = board !== boardId() ? { board, replace: true } : {};
    if (board !== boardId()) boardMoves = [...boardMoves.slice(-49), { before: { source: options.source(), board: boardId() }, after: { source: updated.source, board } }];
    // A press elsewhere on the diagram that finished a rename selects what it landed on instead.
    const shown = landed !== undefined ? landed ?? undefined : result.select;
    pending = { source: updated.source, ...moves, ...shown ? { shape: shown, rename: added && shown === result.select && shown !== shape } : {} };
    options.update(updated.source);
    if (edits.some(change => change.type === 'remove')) options.status(`Removed “${label}”. ${undoHint}`);
  }
  /** Undo and redo of an edit that moved the board on view move it back and forth too, since its board is gone. */
  function followHistory() {
    const source = options.source();
    if (pending?.source === source) return;
    // The latest move that leads from the board on view to this source.
    const board = [...boardMoves].reverse().map(({ before, after }) => source === before.source && boardId() === after.board ? before.board
      : source === after.source && boardId() === before.board ? after.board : undefined).find(Boolean);
    if (board) pending = { source, board, replace: true };
  }

  function startRename(shape: string) {
    const target = canvasTarget(shape);
    const element = shapeElement(shape);
    if (!target || !element) return;
    stopRename(false);
    pressed = undefined;
    rename.value = target.label;
    rename.setAttribute('aria-label', `Rename ${target.label}`);
    rename.title = `Enter renames. ${target.add} with ${addKeys}. Escape cancels.`;
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
    else pressed = undefined;
  }
  rename.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (isAdd(event) && event.key === 'Enter') stopRename(true, { type: 'add' });
    // Tab applies the name and stays on the shape, so it never adds shapes by accident.
    else if (event.key === 'Enter' || event.key === 'Tab' && !event.shiftKey) stopRename(true);
    else if (event.key === 'Escape') stopRename(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  // Leaving the window keeps the rename open; the box has focus again on return.
  rename.addEventListener('blur', () => { if (document.hasFocus()) stopRename(true); });
  // A press on the diagram ends a rename before its click, which then finds the source changed.
  viewer.stage.addEventListener('pointerdown', event => {
    if (!renaming) return;
    const shape = shapeAt(event.target)?.id ?? null;
    if (shape !== renaming.shape) pressed = shape;
  }, { capture: true });

  /** The actions for a shape, as buttons for the selection bar or items in the menu. */
  function actions(shape: string, item: Item, boardsOnly = false) {
    const items: HTMLButtonElement[] = [];
    if (options.readOnly?.()) {
      const action = shapeAction(shape);
      const files = options.files?.();
      return action.action === 'file' && files ? [item('Open diagram', () => files.open(action.link))] : [];
    }
    const canvas = boardsOnly ? undefined : canvasTarget(shape);
    if (canvas) {
      items.push(item('Rename', () => startRename(shape), { keys: 'F2' }),
        item(canvas.add, () => applyCanvas(shape, [{ type: 'add' }]), { keys: 'Control+Enter Meta+Enter Insert' }));
      if (canvas.sibling) items.push(item('Add sibling topic', () => applyCanvas(shape, [{ type: 'sibling' }]), { keys: 'Enter' }));
      if (canvas.remove) items.push(item('Delete', () => applyCanvas(shape, [{ type: 'remove' }]), { keys: 'Delete Backspace' }));
    }
    const action = shapeAction(shape);
    const board = boardId();
    const files = options.files?.();
    if (action.action === 'add') {
      items.push(...(['flow', 'mind map'] as const).map(kind => item(`Add ${kind} board…`, focus => add(kind, board, shape, focus), { relinks: true })));
      if (files) {
        if (linkable(files).length) items.push(item('Link to diagram…', focus => void linkTo(board, shape, files, focus), { relinks: true }));
        items.push(item('New linked diagram…', focus => void newLinked(board, shape, files, focus), { relinks: true }));
      }
    } else if (action.action === 'edit') items.push(item(`Edit ${action.kind} board…`, focus => edit(action.board, focus)));
    else if (action.action === 'file' && files) {
      items.push(item('Open diagram', () => files.open(action.link)));
      if (action.attached) {
        items.push(item('Change linked diagram…', focus => void linkTo(board, shape, files, focus, action.link), { relinks: true }),
          item('Remove link', () => applyLink(board, shape), { relinks: true }));
      }
    }
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
    search.refresh();
    projectCheck?.refresh();
    toolbar.hidden = editGroup.hidden && outline.hidden && search.empty && (!projectCheck || projectCheck.empty);
    const shape = selected && compiledSource === source ? selected : undefined;
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
      element.addEventListener('click', () => run(relinks ? viewer.stage : element));
      return element;
    };
    let buttons = shape ? actions(shape, button) : [];
    // With canvas actions too, the board actions move behind one button that opens them as a menu.
    if (shape && canvasTarget(shape) && shapeAction(shape).action === 'add') {
      const boardsButton = button('Add board…', () => {});
      boardsButton.setAttribute('aria-haspopup', 'menu');
      boardsButton.setAttribute('aria-controls', menu.id);
      boardsButton.setAttribute('aria-expanded', 'false');
      boardsButton.addEventListener('click', () => {
        // A click on the button while its menu is open closes the menu.
        if (toggled === boardsButton) { toggled = undefined; return; }
        const box = boardsButton.getBoundingClientRect();
        openMenu(shape, boardsButton, box.left, box.bottom + 4, true);
      });
      buttons = [...buttons.filter(item => !/^(Add (flow|mind map) board|Link to diagram…|New linked diagram…)$/.test(item.textContent!)), boardsButton];
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
    // A shape panned out of view takes its bar with it, rather than leaving the bar at the edge.
    shapeGroup.style.visibility = box.right < stage.left || box.left > stage.right || box.bottom < stage.top || box.top > stage.bottom ? 'hidden' : '';
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
    delete shapeGroup.dataset.behindMenu;
    menuTrigger?.setAttribute('aria-expanded', 'false');
    menuTrigger = undefined;
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
    // A menu holds only its items: the heading repeats its name, and the note is its description.
    const text = (content: string, className?: string) => Object.assign(document.createElement('p'),
      { textContent: content, ...className ? { className, id: scope.id('board-menu-note') } : {} });
    const heading = text(shapeLabel(boardId(), shape));
    const parts: HTMLElement[] = [heading, ...items];
    const note = action.action === 'none' && !canvasTarget(shape) ? text(action.reason, 'board-menu-note') : undefined;
    if (note) parts.push(note);
    for (const part of [heading, note]) { part?.setAttribute('role', 'none'); part?.setAttribute('aria-hidden', 'true'); }
    if (!boardsOnly && options.inSource(shape)) parts.push(item('Select in source', () => options.selectSource(shape, true)));
    // A shape with no actions, such as a link from an imported file, opens no menu.
    if (!parts.some(part => part.getAttribute('role') === 'menuitem')) return false;
    menu.replaceChildren(...parts);
    menu.setAttribute('aria-label', `Actions for ${heading.textContent}`);
    if (note) menu.setAttribute('aria-describedby', note.id); else menu.removeAttribute('aria-describedby');
    menuReturn = element;
    if (element instanceof HTMLElement && element.hasAttribute('aria-expanded')) {
      menuTrigger = element;
      element.setAttribute('aria-expanded', 'true');
    }
    menu.hidden = false;
    // A shape's menu repeats the bar's actions, so the bar steps aside; the bar's own Add board… menu keeps it.
    if (boardsOnly) delete shapeGroup.dataset.behindMenu; else shapeGroup.dataset.behindMenu = '';
    // Keep the menu on screen beside the pointer or shape.
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return true;
  }
  function shapeAt(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<SVGElement>('[data-shape-id]')
      ?? target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    return element && { id: element.dataset.shapeId!, focus: (element.closest('a') ?? element) as SVGElement };
  }
  viewer.stage.addEventListener('contextmenu', event => {
    const shape = shapeAt(event.target);
    if (!shape || !ready()) return;
    // The menu acts on the shape it opened from, so that shape is the selected one.
    options.selectSource(shape.id, false);
    if (openMenu(shape.id, shape.focus, event.clientX, event.clientY)) event.preventDefault();
  });
  // A press focuses its shape, which shows the selection bar, and on a fitted diagram the bar can cover the shape.
  // Firefox then sends the press's contextmenu to the bar, so the bar opens its shape's menu too.
  shapeGroup.addEventListener('contextmenu', event => {
    const element = selected && ready() ? shapeElement(selected) : undefined;
    if (element && openMenu(selected!, element.closest('a') ?? element, event.clientX, event.clientY)) event.preventDefault();
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
    if (!shape) return;
    if (!ready()) {
      // Until the preview shows an edit made on the diagram, the old shapes keep focus: swallow the keys that edit
      // them, or a second quick Backspace would reach the viewer and go up a board.
      if (pending?.source === options.source() && (isAdd(event) || ['F2', 'Enter', 'Delete', 'Backspace'].includes(event.key))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      options.selectSource(shape.id, false);
      const box = shape.focus.getBoundingClientRect();
      if (openMenu(shape.id, shape.focus, box.left + box.width / 2, box.top + box.height / 2)) event.preventDefault();
      return;
    }
    const canvas = canvasTarget(shape.id);
    if (!canvas || event.altKey) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey;
    const change: CanvasEdit | 'rename' | undefined = event.key === 'F2' && plain ? 'rename'
      : isAdd(event) ? { type: 'add' }
        // In a mind map, Enter adds a sibling; the centre has none, so it adds a main branch. Enter on a topic
        // that opens a board opens it, as on any link.
        : event.key === 'Enter' && plain && canvas.kind === 'mind map' && shape.focus.localName !== 'a'
          ? { type: canvas.sibling ? 'sibling' : 'add' }
          // Backspace is the Mac delete key; on shapes that cannot be removed it still goes up a board.
          : (event.key === 'Delete' || event.key === 'Backspace') && (plain || event.metaKey || event.ctrlKey) && !event.shiftKey && canvas.remove ? { type: 'remove' }
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
    // Backspace in the menu would otherwise reach the viewer and go up a board.
    else if (event.key !== 'Backspace') return;
    event.preventDefault();
    event.stopPropagation();
  });
  // So would Backspace on the selection bar's buttons; it removes a shape only while the shape has focus.
  shapeGroup.addEventListener('keydown', event => {
    if (event.key !== 'Backspace') return;
    event.preventDefault();
    event.stopPropagation();
  });
  pageListeners(viewer.stage, signal => document.addEventListener('pointerdown', event => {
    toggled = undefined;
    if (menu.contains(event.target as Node)) return;
    if (!menu.hidden && menuTrigger?.contains(event.target as Node)) toggled = menuTrigger;
    closeMenu(false);
  }, { capture: true, signal }));
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
    refreshSearch() { search.refresh(); projectCheck?.refresh(); },
    revealSearchMatch,
    resetSearch() { ++searchRevision; search.reset(); projectCheck?.reset(); },
    /** Whether a shape on the board on view is edited on the diagram, so clicking it keeps focus there. */
    editsOnCanvas: (shape: string) => Boolean(canvasTarget(shape)),
    /** The diagram keys for the step or topic at `target`, for keyboard guidance. */
    canvasKeys(target: Element) {
      const shape = shapeAt(target);
      const canvas = shape && canvasTarget(shape.id);
      if (!canvas) return;
      const keys = ['F2 renames', `${addKeys} ${canvas.add.replace('Add', 'adds')}`];
      // Enter on a topic that opens a board opens it instead.
      if (canvas.kind === 'mind map' && shape.focus.localName !== 'a') keys.push(`Enter adds ${canvas.sibling ? 'a sibling' : 'a branch'}`);
      if (canvas.remove) keys.push('Delete removes');
      return keys.join(' · ');
    },
    /** The source changed: board actions wait for it to compile, except editing the root board. */
    invalidate() { closeMenu(false); stopRename(false); pressed = undefined; followHistory(); refresh(); },
    /** The document compiled: index its boards. */
    compiled(source: string, next: BoardSites, nextBoards: Map<string, Board>) {
      sites = next;
      boards = nextBoards;
      compiledSource = source;
      ++searchRevision;
      search.update(boards);
      refresh();
    },
    /** The preview shows the compiled document: open a board just added or renamed, then select a shape just made,
     * unless focus moved on meanwhile. Redrawing the diagram drops focus from the shape it was on, to the page. */
    async settled() {
      // An edit belongs to the source it made; another document or a later edit drops it.
      const show = pending?.source === compiledSource ? pending : undefined;
      pending = undefined;
      if (show?.board && boards.has(show.board) && show.board !== boardId()) await viewer.navigate(show.board, show.replace ? 'replace' : 'push');
      const focused = document.activeElement;
      const stayed = !focused || focused === document.body || viewer.stage.contains(focused) || shapeGroup.contains(focused);
      if (show?.shape && stayed) selectShape(show.shape, show.rename);
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
