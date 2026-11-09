import type { Viewer } from '@zoomflow/viewer';
import type { BoardToolsOptions } from './board-tools-shared';
import { undoHint } from './board-tools-shared';

/** Feedback belongs to the exact edit and document, never to a later undo history entry. */
export function setupCanvasFeedback(viewer: Viewer, options: BoardToolsOptions) {
  const toast = document.createElement('div');
  toast.className = 'canvas-feedback';
  toast.hidden = true;
  toast.innerHTML = '<span role="status"></span><button type="button">Undo</button><button type="button" aria-label="Dismiss edit confirmation">×</button>';
  viewer.stage.after(toast);
  const message = toast.querySelector('span')!;
  const [undo, dismiss] = [...toast.querySelectorAll('button')];
  let edit: { source: string; document?: string } | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  const current = () => edit && edit.source === options.source() && edit.document === options.document?.();
  function clear() { toast.hidden = true; edit = undefined; }
  dismiss.addEventListener('click', () => { clear(); viewer.stage.focus({ preventScroll: true }); });
  undo.addEventListener('click', () => {
    const valid = current();
    clear();
    if (valid) options.undo();
    viewer.stage.focus({ preventScroll: true });
  });
  viewer.stage.addEventListener('zf-sourcechange', () => { if (!current()) clear(); });
  viewer.stage.addEventListener('zf-destroy', () => { clearTimeout(highlightTimer); toast.remove(); });
  return {
    status(text: string, kind?: 'info' | 'error') {
      options.status(text, kind);
      if (kind === 'error' || !text.endsWith(undoHint)) return;
      edit = { source: options.source(), document: options.document?.() };
      message.textContent = text.slice(0, -undoHint.length).trim();
      toast.hidden = false;
    },
    highlight(shape: string) {
      clearTimeout(highlightTimer);
      for (const element of viewer.stage.querySelectorAll('.zf-edit-highlight')) element.classList.remove('zf-edit-highlight');
      const board = viewer.currentBoard;
      const edges = new Set(board?.diagram.connections.filter(edge => edge.dst === shape).map(edge => edge.id));
      const elements = [...viewer.stage.querySelectorAll<SVGElement>('[data-shape-id], [data-connection-id]')].filter(element =>
        element.dataset.shapeBoard === board?.id && element.dataset.shapeId === shape ||
        element.dataset.connectionBoard === board?.id && edges.has(element.dataset.connectionId!));
      for (const element of elements) {
        element.classList.add('zf-edit-highlight');
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (const path of element.querySelectorAll<SVGPathElement>('path.connection')) {
          const length = path.getTotalLength();
          const animation = path.animate([{ strokeDasharray: `${length}`, strokeDashoffset: length }, { strokeDasharray: `${length}`, strokeDashoffset: 0 }],
            { duration: 300, easing: 'ease-out' });
          const cancel = () => animation.cancel();
          viewer.stage.addEventListener('zf-sourcechange', cancel, { once: true });
          void animation.finished.catch(() => {}).finally(() => viewer.stage.removeEventListener('zf-sourcechange', cancel));
        }
      }
      highlightTimer = setTimeout(() => { for (const element of elements) element.classList.remove('zf-edit-highlight'); }, 1000);
    },
  };
}
