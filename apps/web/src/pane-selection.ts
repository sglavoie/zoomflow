import type { ShapeSource, SourceRange } from '@zoomflow/core';
import type { Viewer, setupViewport } from '@zoomflow/viewer';
import type { SourceEditor } from './editor';
import type { setupBoardTools } from './board-tools';
import type { PaneContext } from './document-pane-shared';

interface Context {
  mappedSource: string | undefined;
  editor: SourceEditor;
  viewer: Viewer;
  blocks: Map<string, SourceRange>;
  selectionCleared: { from: number; to: number; } | undefined;
  sourceMap: ShapeSource[];
  revealButton: HTMLButtonElement;
  boardTools: ReturnType<typeof setupBoardTools>;
  documentRevision: number;
  showView: (view: 'preview' | 'source') => void;
  viewport: ReturnType<typeof setupViewport>;
  touchDown: { shape: SVGElement; at: number; } | undefined;
  shared: PaneContext;
}

export function setupPaneSelection(ctx: Context) {
  /** Dim the source outside the board on view; `opened` scrolls to it unless someone is typing there. */
  function showBoardSource(opened: boolean) {
    if (ctx.mappedSource !== ctx.editor.source) return;
    const board = ctx.viewer.currentBoard?.id ?? 'root';
    ctx.editor.showBoard(board === 'root' ? undefined : ctx.blocks.get(board), opened && !ctx.editor.view.hasFocus);
  }

  async function highlightSelection(navigate: boolean) {
    if (ctx.mappedSource !== ctx.editor.source) return;
    const { from, to, empty } = ctx.editor.selection;
    if (ctx.selectionCleared?.from !== from || ctx.selectionCleared.to !== to) ctx.selectionCleared = undefined;
    const matches = ctx.sourceMap.filter((entry) => empty
      ? from >= entry.from && from < entry.to : from < entry.to && to > entry.from);
    const current = ctx.viewer.currentBoard?.id;
    const target = matches.find((entry) => entry.board === current) ?? matches[0];
    ctx.revealButton.disabled = !target;
    // A shared layer root is represented by its parent shape in the connected view. Reveal its own board
    // when its source is requested, so it can still be selected and edited as a standalone centre.
    const shown = target && [...ctx.viewer.stage.querySelectorAll<SVGElement>('[data-shape-id]')]
      .some(shape => shape.dataset.shapeBoard === target.board && shape.dataset.shapeId === target.shape);
    if (navigate && target && (target.board !== current || !shown)) await ctx.viewer.navigate(target.board);
    const shapes = ctx.selectionCleared ? [] : matches.filter((entry) => entry.board === ctx.viewer.currentBoard?.id).map((entry) => entry.shape);
    ctx.viewer.highlightShapes(shapes);
    ctx.boardTools.select([...new Set(shapes)]);
  }

  async function focusSourceBoard(position: number) {
    if (ctx.mappedSource !== ctx.editor.source) return;
    const line = ctx.editor.view.state.doc.lineAt(position);
    // The opening and closing lines belong to the board too. Choose the smallest
    // enclosing block so nested boards take precedence over their ancestors.
    let target = 'root';
    let size = ctx.editor.source.length;
    for (const [board, block] of ctx.blocks) {
      if (line.to >= block.from - 1 && line.from <= block.to + 1 && block.to - block.from < size) {
        target = board;
        size = block.to - block.from;
      }
    }
    if (target !== ctx.viewer.currentBoard?.id) await ctx.viewer.navigate(target);
  }

  async function revealSelection() {
    if (ctx.revealButton.disabled) return;
    const revision = ctx.documentRevision;
    await highlightSelection(true);
    if (revision !== ctx.documentRevision) return;
    ctx.showView('preview');
    ctx.viewport.reveal([...ctx.viewer.stage.querySelectorAll<SVGGraphicsElement>('.zf-source-selected')]);
    ctx.viewer.stage.focus({ preventScroll: true });
  }

  function selectShape(event: MouseEvent | KeyboardEvent) {
    const shape = event.target instanceof Element ? event.target.closest<SVGElement>('[data-shape-id]')
      ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]') : null;
    const touch = ctx.touchDown;
    const touchClick = event instanceof MouseEvent && touch !== undefined && shape === touch.shape && event.timeStamp - touch.at < 1000;
    ctx.touchDown = undefined;
    // A click on the background clears the selection on the diagram, even before it updates; the source cursor
    // stays where it is.
    if (!shape && event instanceof MouseEvent) {
      const { from, to } = ctx.editor.selection;
      ctx.selectionCleared = { from, to };
      ctx.viewer.highlightShapes([]);
      ctx.boardTools.select([]);
      return;
    }
    if (ctx.mappedSource !== ctx.editor.source) return;
    const entry = shape && ctx.sourceMap.find((item) => item.board === ctx.viewer.currentBoard?.id && item.shape === shape.dataset.shapeId);
    if (!entry) return;
    const anchor = shape.closest('a');
    // A click on a step or topic that opens a board selects it; only its arrow badge opens the board.
    const linked = Boolean(anchor) && !(anchor!.dataset.follow === 'badge' && event instanceof MouseEvent &&
      !(event.target instanceof Element && event.target.closest('.appendix-icon')));
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ' || linked && !event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (linked && event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); }
    // Steps and topics of a builder board are edited on the diagram, so selecting one keeps focus there.
    const onCanvas = !linked && !event.altKey && (ctx.boardTools.editsOnCanvas(entry.shape) ||
      // A touch tap keeps a draggable branch on the diagram so its branch controls remain available.
      // Mouse clicks still reveal an ordinary shape's source, including at a narrow viewport.
      ctx.shared.tabbed() && touchClick &&
      shape.classList.contains('zf-branch-draggable'));
    if (onCanvas) shape.focus({ preventScroll: true });
    else if (!linked || event.altKey) ctx.showView('source');
    ctx.selectionCleared = undefined;
    ctx.editor.select(entry, !onCanvas && (!linked || event.altKey));
    void highlightSelection(false);
  }
  return { showBoardSource, highlightSelection, focusSourceBoard, revealSelection, selectShape };
}
