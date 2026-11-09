import { boardKey, classifyHref, resolveFilePath } from '@zoomflow/core';
import type { DocumentView, Viewer } from '@zoomflow/viewer';
import type { BuilderTarget } from './builder-dialog';
import type { BoardSites, BuilderKind, ShapeAction } from './board-model';
import { canvasShapes, editOnCanvas, type CanvasEdit, type CanvasShape } from './canvas-model';
import { fileLinkDialog, newFileSource } from './file-link-dialog';
import { fileLink } from './project-files';
import { stale, compiling, undoHint, type FileLinkHost, type MoveState, type BoardToolsOptions } from './board-tools-shared';

interface Context {
  current: () => BoardSites;
  options: BoardToolsOptions;
  ready: () => boolean;
  viewer: Viewer;
  shapeLabel: (board: string, shape: string) => string;
  pending: { source: string; board?: string; replace?: boolean; shape?: string; rename?: boolean; emphasize?: boolean; view?: DocumentView; } | undefined;
  sites: BoardSites | undefined;
  boardId: () => string;
  shapeCache: { own: string; trail: string; find: (shape: string) => CanvasShape | undefined } | undefined;
  pressed: string | null | undefined;
  boardMoves: { before: MoveState; after: MoveState }[];
}

export function setupBoardActions(ctx: Context) {
  /** Each target applies to the latest document, as long as `fits` finds the board it was opened on unchanged. */
  function target(mode: BuilderTarget['mode'], name: string, apply: (site: BoardSites, source: string, name: string) => string | { source: string } | { error: string },
    fits: (site: BoardSites) => boolean, own?: string): BuilderTarget {
    let site = ctx.current();
    let opened = ctx.options.source();
    return { mode, name, source: own, apply(source, title) {
      if (ctx.options.source() !== opened) {
        // Edits elsewhere in the document, such as an AI change, keep the form; edits to its board do not.
        const latest = ctx.current();
        if (!fits(latest)) return ctx.ready() ? stale : compiling;
        site = latest;
        opened = ctx.options.source();
      }
      const result = apply(site, source, title);
      if (typeof result === 'object' && 'error' in result) return result.error;
      ctx.options.update(typeof result === 'string' ? result : result.source);
    } };
  }

  function edit(board: string, returnFocus: HTMLElement) {
    const builder = ctx.current().builder(board);
    if (!builder) return;
    // Editing hides the name, but the builders' name fields stay required.
    // Its button may be hidden by the time the builder closes, so the diagram takes focus instead.
    ctx.options.builders[builder.kind].open(target('edit', 'Board', (site, source) => site.update(board, source),
      site => site.builder(board)?.own === builder.own, builder.own), returnFocus, ctx.viewer.stage);
  }

  function add(kind: BuilderKind, board: string, shape: string, returnFocus: HTMLElement) {
    ctx.options.builders[kind].open(target('board', ctx.shapeLabel(board, shape), (site, source, name) => {
      const added = site.add(board, shape, source, name);
      ctx.pending = { source: added.source, board: `${board}.layers.${boardKey(added.name)}` };
      return added.source;
    }, site => site.shapeAction(board, shape).action === 'add'), returnFocus, ctx.viewer.stage);
  }

  function shapeAction(shape: string): ShapeAction {
    if (!ctx.ready()) return { action: 'none', reason: 'Wait for the preview to update.' };
    return ctx.sites!.shapeAction(ctx.boardId(), shape);
  }

  /** Write or, without `link`, remove the shape's file link, as long as the shape can still take one. */
  function applyLink(board: string, shape: string, link?: string) {
    if (!ctx.ready()) { ctx.options.status('Wait for the preview to update, then try again.', 'error'); return false; }
    const action = ctx.sites!.shapeAction(board, shape);
    if (!(action.action === 'file' && action.attached || link && action.action === 'add')) { ctx.options.status(stale, 'error'); return false; }
    const source = link ? ctx.sites!.linkFile(board, shape, link) : ctx.sites!.unlinkFile(board, shape);
    ctx.pending = { source, shape };
    ctx.options.update(source);
    ctx.options.status(`${link ? `“${ctx.shapeLabel(board, shape)}” opens ${link}` : 'Link removed'}. ${undoHint}`);
    return true;
  }

  const refocus = (element: HTMLElement) => { if (element.isConnected) element.focus({ preventScroll: true }); };

  // A link reads up to its first `#`, so a file named with one, as in `notes#1.d2`, cannot be linked.
  const linkable = (host: FileLinkHost) => host.files.filter((file) => classifyHref(fileLink(host.path, file)).kind === 'file');

  async function linkTo(board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement, current?: string) {
    const href = current ? classifyHref(current) : undefined;
    const path = href?.kind === 'file' ? resolveFilePath(host.path, href.path) : undefined;
    const files = linkable(host);
    const choice = await fileLinkDialog().link({ files, boards: host.boards, shape: ctx.shapeLabel(board, shape),
      ...path && href?.kind === 'file' ? { current: { path, hash: href.hash } } : {} });
    if (ctx.options.files?.()?.key !== host.key) return;
    refocus(returnFocus);
    // Without a file to choose, the dialog submits an empty path, which would link to the folder.
    if (choice?.path) applyLink(board, shape, fileLink(host.path, choice.path) + choice.hash);
  }

  async function newLinked(board: string, shape: string, host: FileLinkHost, returnFocus: HTMLElement) {
    const choice = await fileLinkDialog().create(ctx.shapeLabel(board, shape));
    if (ctx.options.files?.()?.key !== host.key) return;
    refocus(returnFocus);
    if (!choice) return;
    if (!ctx.ready() || ctx.sites!.shapeAction(board, shape).action !== 'add') { ctx.options.status(stale, 'error'); return; }
    const path = await host.create(choice.name, newFileSource(choice.kind, choice.name));
    if (!path || ctx.options.files?.()?.key !== host.key) return;
    const link = fileLink(host.path, path);
    if (applyLink(board, shape, link)) host.open(link);
  }

  /** The shape as a step or topic of the builder board that writes the board on view. */
  function canvasTarget(shape: string, board = ctx.boardId()): CanvasShape | undefined {
    const canvas = ctx.ready() ? ctx.sites!.canvas(board) : undefined;
    if (!canvas) return;
    // Every shape on the board is looked up on each refresh, so the board's text is read once.
    const trail = canvas.trail.join('\n');
    if (ctx.shapeCache?.own !== canvas.own || ctx.shapeCache.trail !== trail) ctx.shapeCache = { own: canvas.own, trail, find: canvasShapes(canvas.own, canvas.trail) };
    return ctx.shapeCache.find(shape);
  }

  /** Apply edits made on the diagram in one change, so one undo reverts them together. */
  function applyCanvas(shape: string, edits: CanvasEdit[]) {
    // Where a press that finished a rename landed matters only to this edit, even one that changes nothing.
    const landed = ctx.pressed;
    ctx.pressed = undefined;
    const canvas = ctx.ready() ? ctx.sites!.canvas(ctx.boardId()) : undefined;
    if (!canvas) return;
    const label = canvasTarget(shape)?.label ?? shape;
    let own = canvas.own;
    let trail = canvas.trail;
    let result: ReturnType<typeof editOnCanvas>;
    let moved: Map<string, string> | undefined;
    let renamed = false;
    for (const change of edits) {
      const next = editOnCanvas(own, trail, shape, change);
      if (!next) continue;
      result = next;
      renamed ||= change.type === 'rename';
      own = next.own;
      trail = next.trail ?? trail;
      // Chain each edit's moves, so attached boards follow their topics through all of them.
      if (next.moved) moved = moved ? new Map([...moved].filter(([, id]) => next.moved!.has(id)).map(([old, id]) => [old, next.moved!.get(id)!])) : next.moved;
    }
    if (!result) return;
    const updated = ctx.sites!.update(canvas.owner, own, moved);
    if ('error' in updated) { ctx.options.status(updated.error, 'error'); return; }
    const board = trail === canvas.trail ? ctx.boardId() : canvas.owner + trail.map(name => `.layers.${boardKey(name)}`).join('');
    const added = edits.some(change => change.type === 'add' || change.type === 'branch' || change.type === 'sibling');
    // A rename that renames the board, or a remove that removes it, replaces it in history, since the old board is gone.
    const moves = board !== ctx.boardId() ? { board, replace: true } : {};
    if (board !== ctx.boardId()) ctx.boardMoves = [...ctx.boardMoves.slice(-49), { before: { source: ctx.options.source(), board: ctx.boardId() }, after: { source: updated.source, board } }];
    // A press elsewhere on the diagram that finished a rename selects what it landed on instead.
    const shown = landed !== undefined ? landed ?? undefined : result.select;
    ctx.pending = { source: updated.source, ...moves, emphasize: added, ...shown ? { shape: shown, rename: added && shown === result.select && shown !== shape } : {} };
    ctx.options.update(updated.source);
    ctx.viewer.stage.dispatchEvent(new CustomEvent('zf-canvasedit', { detail: { added, renamed } }));
    if (edits.some(change => change.type === 'remove')) ctx.options.status(`Removed “${label}”. ${undoHint}`);
  }

  /** Undo and redo of an edit that moved the board on view move it back and forth too, since its board is gone. */
  function followHistory() {
    const source = ctx.options.source();
    if (ctx.pending?.source === source) return;
    // The latest move that leads from the board on view to this source.
    const move = [...ctx.boardMoves].reverse().map(({ before, after }) => source === before.source && (after.view || ctx.boardId() === after.board) ? before
      : source === after.source && (before.view || ctx.boardId() === before.board) ? after : undefined).find(Boolean);
    if (move) ctx.pending = { source, board: move.board, shape: move.shape, replace: true, view: move.view };
  }
  return { target, edit, add, shapeAction, applyLink, refocus, linkable, linkTo, newLinked, canvasTarget, applyCanvas, followHistory };
}
