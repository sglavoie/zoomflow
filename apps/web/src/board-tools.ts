import { setupBoardEvents } from './board-events';
import { setupBoardSelection } from './board-selection';
import { setupBoardActions } from './board-actions';
import { boardKey, type Board, type DiagramSearchEntry } from '@zoomflow/core';
import type { DocumentView, Viewer } from '@zoomflow/viewer';
import { boardSites, type BoardSites } from './board-model';
import { branchChoices, moveBranch, type CanvasShape } from './canvas-model';
import { setupCanvasConnections } from './canvas-connections';
import { setupCanvasBranches } from './canvas-branches';
import { placedTopics, readMindMap } from './mind-map-model';
import { graphBranches, type GraphBranches } from './graph-branches';
import { boardTransfers, transferView, type BoardTransfers } from './board-transfers';
import { setupBoardOutline } from './board-outline';
import { setupDiagramSearch } from './diagram-search';
import type { PaneScope } from './pane-scope';
import { setupProjectCheck } from './project-check-dialog';
import { setupCanvasFeedback } from './canvas-feedback';
import { flowSource, flowTemplate } from './flow-model';
import { setupBoardAppearance } from './board-appearance';
import { setupWalkthrough } from '@zoomflow/viewer';

export type { FileLinkHost } from './board-tools-shared';
import { addKeys, undoHint, type BoardToolsOptions, type MoveState } from './board-tools-shared';

/** Builder actions for the board on view and for the selected shape: a toolbar above the diagram, a bar over it for
 * the selected shape, and the same actions in a context menu on each shape. Shapes on builder boards are also
 * renamed, added and removed on the diagram itself. Each board keeps its own builder, so flows and mind maps can
 * open from each other's shapes. */
export function setupBoardTools(scope: PaneScope, viewer: Viewer, options: BoardToolsOptions) {
  const feedback = setupCanvasFeedback(viewer, options);
  options = { ...options, status: feedback.status };
  // Lazy accessors share live state with the feature modules, including controls initialized below.
  const { startRename, stopRename, toggleVisibility, refresh, placeBar, closeMenu, openMenu, shapeAt, selectShape } = setupBoardSelection({
    get canvasTarget() { return canvasTarget; },
    get shapeElement() { return shapeElement; },
    get pressed() { return pressed; }, set pressed(value) { pressed = value; },
    get rename() { return rename; },
    get renaming() { return renaming; }, set renaming(value) { renaming = value; },
    get applyCanvas() { return applyCanvas; },
    get shapeGroup() { return shapeGroup; },
    get viewer() { return viewer; },
    get options() { return options; },
    get shapeLabel() { return shapeLabel; },
    get boardId() { return boardId; },
    get shapeAction() { return shapeAction; },
    get connections() { return connections; },
    get branchOwner() { return branchOwner; },
    get mapCanvas() { return mapCanvas; },
    get transfers() { return transfers; }, set transfers(value) { transfers = value; },
    get branches() { return branches; },
    get add() { return add; },
    get linkable() { return linkable; },
    get linkTo() { return linkTo; },
    get newLinked() { return newLinked; },
    get edit() { return edit; },
    get applyLink() { return applyLink; },
    get current() { return current; },
    get editGroup() { return editGroup; },
    get editBoard() { return editBoard; },
    get outline() { return outline; },
    get ready() { return ready; },
    get sites() { return sites; }, set sites(value) { sites = value; },
    get boards() { return boards; }, set boards(value) { boards = value; },
    get search() { return search; },
    get projectCheck() { return projectCheck; },
    get toolbar() { return toolbar; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get compiledSource() { return compiledSource; }, set compiledSource(value) { compiledSource = value; },
    get menu() { return menu; },
    get toggled() { return toggled; }, set toggled(value) { toggled = value; },
    get menuTrigger() { return menuTrigger; }, set menuTrigger(value) { menuTrigger = value; },
    get menuReturn() { return menuReturn; }, set menuReturn(value) { menuReturn = value; },
    get scope() { return scope; },
  });

  const { edit, add, shapeAction, applyLink, linkable, linkTo, newLinked, canvasTarget, applyCanvas, followHistory } = setupBoardActions({
    get current() { return current; },
    get options() { return options; },
    get ready() { return ready; },
    get viewer() { return viewer; },
    get shapeLabel() { return shapeLabel; },
    get pending() { return pending; }, set pending(value) { pending = value; },
    get sites() { return sites; }, set sites(value) { sites = value; },
    get boardId() { return boardId; },
    get shapeCache() { return shapeCache; }, set shapeCache(value) { shapeCache = value; },
    get pressed() { return pressed; }, set pressed(value) { pressed = value; },
    get boardMoves() { return boardMoves; }, set boardMoves(value) { boardMoves = value; },
  });

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
  const renameHelp = document.createElement('div');
  renameHelp.id = scope.id('rename-help');
  renameHelp.className = 'canvas-rename-help';
  renameHelp.hidden = true;
  rename.setAttribute('aria-describedby', renameHelp.id);
  rename.after(renameHelp);
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
  let pending: { source: string; board?: string; replace?: boolean; shape?: string; rename?: boolean; emphasize?: boolean; view?: DocumentView } | undefined;
  /** The shape, or the background as null, that a press on the diagram finishing a rename landed on. */
  let pressed: string | null | undefined;
  let menuReturn: HTMLElement | SVGElement | undefined;
  let renaming: { shape: string; element: SVGElement; frame: number } | undefined;
  let lastBoard: string | undefined;
  /** The recent edits on the diagram that moved the board on view, by the source and board before and after each,
   * so undoing or redoing several of them in turn follows each one. */

  let boardMoves: { before: MoveState; after: MoveState }[] = [];
  let shapeCache: { own: string; trail: string; find: (shape: string) => CanvasShape | undefined } | undefined;
  const branchLocations = new Map<string, Map<string, string>>();
  let graphMoves: GraphBranches | undefined;
  let transfers: BoardTransfers | undefined;
  const mapCanvas = (board: string) => {
    const canvas = ready() ? sites!.canvas(board) : undefined;
    return canvas && sites!.builder(canvas.owner)?.kind === 'mind map' ? canvas : undefined;
  };
  const branchOwner = (board: string) => ready() && !options.readOnly?.() && boards.has(board) ? mapCanvas(board)?.owner ?? board : undefined;

  const ready = () => Boolean(sites) && compiledSource === options.source();
  const current = () => {
    const source = options.source();
    if (sites && compiledSource === source) return sites;
    return boardSites(source, new Map([['root', { from: 0, to: source.length }]]), new Map());
  };
  const boardId = () => viewer.currentBoard?.id ?? 'root';
  const appearance = setupBoardAppearance(toolbar, viewer, scope.id('board-look'), () => ready() && !options.readOnly?.() ? sites : undefined, options.update);
  const walkthrough = setupWalkthrough(viewer.stage, toolbar, {
    boards: () => new Map([...boards.values()].map(board => [board.id, {
      id: board.id, name: board.name,
      shapes: board.diagram.shapes.filter(shape => !viewer.isShapeHidden(shape.id, board.id)).map(shape => ({ id: shape.id, label: 'label' in shape && shape.label || shape.id, link: shape.link })),
      connections: (board.diagram.connections ?? []).map(edge => ({ id: edge.id, from: edge.src, to: edge.dst, label: edge.label || '' })),
    }])),
    current: boardId,
    navigate: board => viewer.navigate(board),
  });
  const shapeLabel = (board: string, shape: string) => {
    const found = viewer.currentBoard?.id === board ? viewer.currentBoard.diagram.shapes.find(item => item.id === shape) : undefined;
    return (found && 'label' in found && found.label) || shape;
  };
  const shapeElement = (shape: string, board = boardId()) =>
    [...viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find(node => node.dataset.shapeId === shape &&
      (!node.dataset.shapeBoard || node.dataset.shapeBoard === board));

  const connections = setupCanvasConnections(viewer, {
    source: options.source,
    own(board) {
      if (!ready() || options.readOnly?.()) return;
      const canvas = sites!.canvas(board);
      return canvas && !canvas.trail.length ? canvas.own : undefined;
    },
    update(own) {
      const canvas = ready() && !options.readOnly?.() ? sites!.canvas(boardId()) : undefined;
      if (!canvas || canvas.trail.length) return;
      const updated = sites!.update(canvas.owner, own);
      if ('error' in updated) { options.status(updated.error, 'error'); return; }
      options.update(updated.source);
      return updated.source;
    },
    clearShapes() { selected = undefined; viewer.highlightShapes([]); refresh(); },
    selectShape,
    status: options.status,
  });
  const branches = setupCanvasBranches(viewer, {
    source: options.source,
    owner: branchOwner,
    topic(board, shape) {
      if (!branchOwner(board)) return;
      const transfer = transfers?.key(board, shape);
      const canvas = mapCanvas(board);
      if (!canvas) return graphMoves?.has(board, shape) || transfer ? { id: shape, owner: board, transfer } : undefined;
      if (!branchLocations.has(canvas.own)) {
        const map = readMindMap(canvas.own);
        branchLocations.set(canvas.own, new Map(map && placedTopics(map).map(item =>
          [JSON.stringify([...item.trail, item.shape]), item.id.replace(/@center$/, '')])));
      }
      const id = branchLocations.get(canvas.own)!.get(JSON.stringify([...canvas.trail, shape]));
      return id ? { id, owner: canvas.owner, transfer } : undefined;
    },
    branch(board, shape) {
      const owner = branchOwner(board);
      if (!owner) return;
      const canvas = mapCanvas(board);
      const choices = canvas ? branchChoices(canvas.own, canvas.trail, shape) : graphMoves?.branch(board, shape);
      const cross = transfers?.choices(board, shape) ?? [];
      if (!choices && !cross.length) return;
      return { from: choices?.from ?? shape, label: choices?.label ?? transfers?.label(board, shape) ?? shape,
        destinations: [...choices?.destinations ?? [], ...cross], board, shape, owner, source: options.source(),
        acrossBoards: Boolean(cross.length), parentKind: canvas ? 'topic' as const : 'node' as const };
    },
    canDrag(board, shape) {
      if (!branchOwner(board)) return false;
      const canvas = mapCanvas(board);
      return Boolean(transfers?.canMove(board, shape)) || (canvas ? shape !== 'n' || Boolean(canvas.trail.length) : Boolean(graphMoves?.has(board, shape)));
    },
    move(branch, destination) {
      if (branch.source !== options.source() || branchOwner(branch.board) !== branch.owner) return false;
      if (destination.startsWith('@board:')) {
        const result = transfers?.move(branch.board, branch.shape, destination);
        if (!result) return false;
        const beforeView = viewer.documentView;
        const view = transferView(beforeView, result);
        boardMoves = [...boardMoves.slice(-49), {
          before: { source: options.source(), board: branch.board, shape: branch.shape, view: beforeView },
          after: { source: result.source, board: result.board, shape: result.shape, view },
        }];
        pending = { source: result.source, board: result.board, shape: result.shape, replace: true, view, emphasize: true };
        options.update(result.source);
        viewer.stage.focus({ preventScroll: true });
        options.status(`Moved “${branch.label}”. ${undoHint}`);
        return true;
      }
      const canvas = mapCanvas(branch.board);
      if (!canvas) {
        const builder = sites!.canvas(branch.board);
        const result = graphMoves?.move(branch.board, branch.shape, destination, builder?.own);
        if (!result) return false;
        const updated = result.own !== undefined && builder ? sites!.update(builder.owner, result.own)
          : { source: result.additions ? sites!.append(branch.board, result.additions) : result.source };
        if ('error' in updated) { options.status(updated.error, 'error'); return false; }
        boardMoves = [...boardMoves.slice(-49), {
          before: { source: options.source(), board: branch.board, shape: branch.shape },
          after: { source: updated.source, board: branch.board, shape: branch.shape },
        }];
        pending = { source: updated.source, board: branch.board, replace: true, shape: branch.shape, emphasize: true };
        options.update(updated.source);
        viewer.stage.focus({ preventScroll: true });
        options.status(`Moved “${branch.label}”. ${undoHint}`);
        return true;
      }
      const result = moveBranch(canvas.own, canvas.trail, branch.shape, destination);
      if (!result) return false;
      const updated = sites!.update(canvas.owner, result.own, result.moved);
      if ('error' in updated) { options.status(updated.error, 'error'); return false; }
      const board = canvas.owner + result.trail!.map(name => `.layers.${boardKey(name)}`).join('');
      boardMoves = [...boardMoves.slice(-49), {
        before: { source: options.source(), board: branch.board, shape: branch.shape },
        after: { source: updated.source, board, shape: result.select },
      }];
      pending = { source: updated.source, board, replace: true, shape: result.select, emphasize: true };
      options.update(updated.source);
      viewer.stage.focus({ preventScroll: true });
      options.status(`Moved “${branch.label}”. ${undoHint}`);
      return true;
    },
    select: selectShape,
    clearShapes() { stopRename(false); connections.clear(); selected = undefined; viewer.highlightShapes([]); refresh(); },
    status: options.status,
  });
  setupBoardEvents({
    get rename() { return rename; },
    get stopRename() { return stopRename; },
    get viewer() { return viewer; },
    get renaming() { return renaming; },
    get shapeAt() { return shapeAt; },
    get pressed() { return pressed; }, set pressed(value) { pressed = value; },
    get placeBar() { return placeBar; },
    get refresh() { return refresh; },
    get editBoard() { return editBoard; },
    get edit() { return edit; },
    get ready() { return ready; },
    get options() { return options; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get openMenu() { return openMenu; },
    get shapeGroup() { return shapeGroup; },
    get shapeElement() { return shapeElement; },
    get canvasTarget() { return canvasTarget; },
    get startRename() { return startRename; },
    get boardId() { return boardId; },
    get connections() { return connections; },
    get pending() { return pending; },
    get toggleVisibility() { return toggleVisibility; },
    get applyCanvas() { return applyCanvas; },
    get menu() { return menu; },
    get closeMenu() { return closeMenu; },
    get toggled() { return toggled; }, set toggled(value) { toggled = value; },
    get menuTrigger() { return menuTrigger; },
  });

  return {
    refresh,
    startEmpty(kind: 'flow' | 'mind map', focus: HTMLElement) {
      const board = boardId();
      if (!ready() || options.readOnly?.() || !current().empty(board)) return false;
      if (kind === 'flow') {
        const flow = flowTemplate('simple');
        flow.steps = [{ id: 'step_1', label: 'First step', shape: 'rectangle' }];
        flow.connections = [];
        flow.look.filled = true;
        const result = current().update(board, flowSource(flow));
        if ('error' in result) return false;
        pending = { source: result.source, board, shape: 'step_1', rename: true };
        options.update(result.source);
        viewer.stage.focus({ preventScroll: true });
      } else {
        const before = options.source();
        options.builders[kind].open({ mode: 'board', name: 'My mind map', apply(own) {
          if (options.source() !== before || !current().empty(board)) return 'This board changed. Close and reopen the builder.';
          const result = current().update(board, own);
          if ('error' in result) return result.error;
          options.update(result.source);
        } }, focus, viewer.stage);
      }
      return true;
    },
    canStartEmpty: () => ready() && !options.readOnly?.() && current().empty(boardId()),
    refreshSearch() { search.refresh(); projectCheck?.refresh(); },
    revealSearchMatch,
    resetSearch() { ++searchRevision; search.reset(); projectCheck?.reset(); },
    /** Whether a shape on the board on view is edited on the diagram, so clicking it keeps focus there. */
    editsOnCanvas: (shape: string) => Boolean(canvasTarget(shape)),
    /** The diagram keys for the step or topic at `target`, for keyboard guidance. */
    canvasKeys(target: Element) {
      const edgeKeys = connections.keys(target);
      if (edgeKeys) return edgeKeys;
      const shape = shapeAt(target);
      const canvas = shape && canvasTarget(shape.id);
      if (!canvas) return shape ? `${options.inSource(shape.id) ? 'Enter selects source · ' : ''}H hides or unhides from export` : undefined;
      const keys = ['F2 renames', `${addKeys} ${canvas.add.replace('Add', 'adds')}`];
      // Enter on a topic that opens a board opens it instead.
      if (canvas.kind === 'mind map' && shape.focus.localName !== 'a') keys.push(`Enter adds ${canvas.sibling ? 'a sibling' : 'a branch'}`);
      if (canvas.remove) keys.push('Delete removes');
      keys.push('H hides or unhides from export');
      return keys.join(' · ');
    },
    /** The source changed: board actions wait for it to compile, except editing the root board. */
    invalidate() { closeMenu(false); stopRename(false); connections.invalidate(); branches.clear(); branchLocations.clear(); pressed = undefined; followHistory(); refresh(); appearance.refresh(); },
    /** The document compiled: index its boards. */
    compiled(source: string, next: BoardSites, nextBoards: Map<string, Board>, graph: unknown = {}) {
      sites = next;
      boards = nextBoards;
      compiledSource = source;
      graphMoves = graphBranches(source, boards.get('root')!.diagram, graph);
      transfers = boardTransfers(source, boards, graph);
      ++searchRevision;
      search.update(boards);
      refresh();
      appearance.refresh();
      walkthrough.refresh();
    },
    /** The preview shows the compiled document: open a board just added or renamed, then select a shape just made,
     * unless focus moved on meanwhile. Redrawing the diagram drops focus from the shape it was on, to the page. */
    async settled() {
      // An edit belongs to the source it made; another document or a later edit drops it.
      const show = pending?.source === compiledSource ? pending : undefined;
      pending = undefined;
      if (show?.view) {
        await viewer.restoreDocumentView(show.view, show.board);
        if (show.source !== options.source()) return;
      }
      if (show?.board && boards.has(show.board) && show.board !== boardId()) {
        // Focusing a visible layer activates it without narrowing the connected canvas to its subtree.
        const visible = show.shape && viewer.stage.dataset.layerRoot ? shapeElement(show.shape, show.board) : undefined;
        if (visible) (visible.closest<SVGElement>('a') ?? visible).focus({ preventScroll: true });
        else await viewer.navigate(show.board, show.replace ? 'replace' : 'push');
      }
      const focused = document.activeElement;
      const stayed = !focused || focused === document.body || viewer.stage.contains(focused) || shapeGroup.contains(focused);
      connections.settled();
      if (show?.shape && stayed) selectShape(show.shape, show.rename);
      if (show?.shape && show.emphasize) feedback.highlight(show.shape);
    },
    /** Another board is on view. Going up selects the shape that leads back down, with its actions. */
    boardChanged() {
      closeMenu(false);
      stopRename(false);
      connections.clear();
      branches.boardChanged();
      const board = boardId();
      const previous = lastBoard;
      lastBoard = board;
      let child = previous;
      while (child && boards.get(child)?.parent !== board) child = boards.get(child)?.parent;
      const shape = child && child !== board ? viewer.currentBoard?.diagram.shapes.find(item => item.link === child) : undefined;
      if (shape) options.selectSource(shape.id, false);
      refresh();
      appearance.refresh();
      walkthrough.refresh();
    },
    /** The shapes the source selection maps to on the board on view. */
    select(shapes: readonly string[]) {
      if (shapes.length) connections.selectShape();
      selected = shapes.length === 1 ? shapes[0] : undefined;
      refresh();
    },
  };
}
