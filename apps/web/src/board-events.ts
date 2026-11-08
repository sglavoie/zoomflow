import type { Viewer } from '@zoomflow/viewer';
import type { CanvasEdit, CanvasShape } from './canvas-model';
import type { setupCanvasConnections } from './canvas-connections';
import type { setupBoardSelection } from './board-selection';
import { isAdd, type BoardToolsOptions } from './board-tools-shared';
import { pageListeners } from './canvas-guidance';

type Selection = ReturnType<typeof setupBoardSelection>;
type Context = Pick<Selection, 'stopRename' | 'shapeAt' | 'placeBar' | 'refresh' | 'openMenu' | 'startRename' | 'toggleVisibility' | 'closeMenu'> & {
  viewer: Viewer;
  rename: HTMLInputElement;
  renaming: { shape: string } | undefined;
  pressed: string | null | undefined;
  editBoard: HTMLButtonElement;
  edit: (board: string, focus: HTMLElement) => void;
  ready: () => boolean;
  options: BoardToolsOptions;
  selected: string | undefined;
  shapeGroup: HTMLElement;
  shapeElement: (shape: string) => SVGElement | undefined;
  canvasTarget: (shape: string) => CanvasShape | undefined;
  boardId: () => string;
  connections: ReturnType<typeof setupCanvasConnections>;
  pending: { source: string } | undefined;
  applyCanvas: (shape: string, edits: CanvasEdit[]) => void;
  menu: HTMLElement;
  toggled: HTMLElement | undefined;
  menuTrigger: HTMLElement | undefined;
};

/** Keyboard, pointer and menu events for editing the current board. */
export function setupBoardEvents(ctx: Context) {
  ctx.rename.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (isAdd(event) && event.key === 'Enter') ctx.stopRename(true, { type: 'add' });
    // Tab applies the name and stays on the shape, so it never adds shapes by accident.
    else if (event.key === 'Enter' || event.key === 'Tab' && !event.shiftKey) ctx.stopRename(true);
    else if (event.key === 'Escape') ctx.stopRename(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  // Leaving the window keeps the rename open; the box has focus again on return.
  ctx.rename.addEventListener('blur', () => { if (document.hasFocus()) ctx.stopRename(true); });
  // A press on the diagram ends a rename before its click, which then finds the source changed.
  ctx.viewer.stage.addEventListener('pointerdown', event => {
    if (!ctx.renaming) return;
    const shape = ctx.shapeAt(event.target)?.id ?? null;
    if (shape !== ctx.renaming.shape) ctx.pressed = shape;
  }, { capture: true });
  // Panning and zooming move the shape; the bar follows.
  ctx.viewer.stage.addEventListener('zf-viewportchange', ctx.placeBar, { capture: true });
  ctx.viewer.stage.addEventListener('zf-layerchange', ctx.refresh);
  ctx.viewer.stage.addEventListener('zf-visibilitychange', ctx.refresh);
  ctx.editBoard.addEventListener('click', () => ctx.edit(ctx.editBoard.dataset.board!, ctx.editBoard));
  ctx.viewer.stage.addEventListener('contextmenu', event => {
    const shape = ctx.shapeAt(event.target);
    if (!shape || !ctx.ready()) return;
    // The menu acts on the shape it opened from, so that shape is the selected one.
    ctx.options.selectSource(shape.id, false);
    ctx.selected = shape.id;
    ctx.refresh();
    if (ctx.openMenu(shape.id, shape.focus, event.clientX, event.clientY)) event.preventDefault();
  });
  // A press focuses its shape, which shows the selection bar, and on a fitted diagram the bar can cover the shape.
  // Firefox then sends the press's contextmenu to the bar, so the bar opens its shape's menu too.
  ctx.shapeGroup.addEventListener('contextmenu', event => {
    const element = ctx.selected && ctx.ready() ? ctx.shapeElement(ctx.selected) : undefined;
    if (element && ctx.openMenu(ctx.selected!, element.closest('a') ?? element, event.clientX, event.clientY)) event.preventDefault();
  });
  // Double-click edits: renames a step or topic, or opens any other shape's source.
  ctx.viewer.stage.addEventListener('dblclick', event => {
    const shape = ctx.shapeAt(event.target);
    const canvas = shape && ctx.canvasTarget(shape.id);
    if (!shape || !ctx.ready() || shape.focus.localName === 'a' && !canvas) return;
    event.preventDefault();
    if (canvas) ctx.startRename(shape.id);
    else ctx.options.selectSource(shape.id, true);
  });
  // Selection follows keyboard focus, so the ring marks the shape that keys act on.
  ctx.viewer.stage.addEventListener('focusin', event => {
    const shape = ctx.shapeAt(event.target);
    if (shape && (!shape.board || shape.board === ctx.boardId()) && ctx.ready() && shape.id !== ctx.selected) {
      ctx.options.selectSource(shape.id, false);
      ctx.selected = shape.id;
      ctx.refresh();
    }
  });
  // Capture, so builder shortcuts on a focused shape run before the pane's Enter-to-select-source.
  ctx.viewer.stage.addEventListener('keydown', event => {
    if (event.target === ctx.rename || event.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y' && event.ctrlKey && !event.metaKey)) {
      event.preventDefault();
      ctx.connections.history(key === 'y' || event.shiftKey ? ctx.options.redo : ctx.options.undo);
      return;
    }
    const shape = ctx.shapeAt(event.target);
    if (!shape) return;
    if (!ctx.ready()) {
      // Until the preview shows an edit made on the diagram, the old shapes keep focus: swallow the keys that edit
      // them, or a second quick Backspace would reach the viewer and go up a board.
      if (ctx.pending?.source === ctx.options.source() && (isAdd(event) || ['F2', 'Enter', 'Delete', 'Backspace'].includes(event.key))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (key === 'h' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) ctx.toggleVisibility(shape.id);
      return;
    }
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      ctx.options.selectSource(shape.id, false);
      const box = shape.focus.getBoundingClientRect();
      if (ctx.openMenu(shape.id, shape.focus, box.left + box.width / 2, box.top + box.height / 2)) event.preventDefault();
      return;
    }
    const canvas = ctx.canvasTarget(shape.id);
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
    if (change === 'rename') ctx.startRename(shape.id);
    else ctx.applyCanvas(shape.id, [change]);
  }, { capture: true });
  ctx.menu.addEventListener('keydown', event => {
    const items = [...ctx.menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (move !== undefined) items[(move + items.length) % items.length].focus();
    else if (event.key === 'Escape') ctx.closeMenu();
    else if (event.key === 'Tab') ctx.closeMenu(false);
    // Backspace in the menu would otherwise reach the viewer and go up a board.
    else if (event.key !== 'Backspace') return;
    event.preventDefault();
    event.stopPropagation();
  });
  // So would Backspace on the selection bar's buttons; it removes a shape only while the shape has focus.
  ctx.shapeGroup.addEventListener('keydown', event => {
    if (event.key !== 'Backspace') return;
    event.preventDefault();
    event.stopPropagation();
  });
  pageListeners(ctx.viewer.stage, signal => document.addEventListener('pointerdown', event => {
    ctx.toggled = undefined;
    if (ctx.menu.contains(event.target as Node)) return;
    if (!ctx.menu.hidden && ctx.menuTrigger?.contains(event.target as Node)) ctx.toggled = ctx.menuTrigger;
    ctx.closeMenu(false);
  }, { capture: true, signal }));
  ctx.menu.addEventListener('focusout', event => { if (!ctx.menu.contains(event.relatedTarget as Node)) ctx.closeMenu(false); });

}
