import { indexBoards } from '@zoomflow/core';
import type { DocumentPane } from './document-pane';
import { displayTitle } from './text';

export type ExportPresentation = { title: string; subtitle: string; opening: string; mode: 'explore' | 'walkthrough' | 'presentation'; frame: boolean };

/** Presentation preferences belong to the document, separate from its source and filename. */
export function setupExportPresentation(active: () => DocumentPane | undefined, changed: () => void) {
  const title = document.querySelector<HTMLInputElement>('#export-title')!;
  const subtitle = document.querySelector<HTMLInputElement>('#export-subtitle')!;
  const opening = document.querySelector<HTMLSelectElement>('#export-opening-board')!;
  const mode = document.querySelector<HTMLSelectElement>('#export-start-mode')!;
  const frame = document.querySelector<HTMLInputElement>('#export-frame')!;
  let key: string | undefined;
  let choices = '';
  let preferredOpening = 'root';
  const read = (): ExportPresentation => ({ title: title.value.trim(), subtitle: subtitle.value.trim(), opening: opening.value || 'root',
    mode: mode.value as ExportPresentation['mode'], frame: frame.checked });
  for (const input of [title, subtitle, opening, mode, frame]) input.addEventListener(input === title || input === subtitle ? 'input' : 'change', () => {
    const value = read(); preferredOpening = value.opening;
    if (key) try { localStorage.setItem(`zoomflow.presentation:${key}`, JSON.stringify(value)); } catch { /* Optional preference. */ }
    changed();
  });
  function refresh(format: string) {
    const pane = active();
    if (key !== pane?.key) {
      key = pane?.key; choices = '';
      let saved: Partial<ExportPresentation> = {};
      try { saved = JSON.parse(localStorage.getItem(`zoomflow.presentation:${key}`) ?? '{}') ?? {}; } catch { /* Ignore invalid preferences. */ }
      title.value = typeof saved.title === 'string' ? saved.title.slice(0, 160) : '';
      subtitle.value = typeof saved.subtitle === 'string' ? saved.subtitle.slice(0, 300) : '';
      mode.value = ['explore', 'walkthrough', 'presentation'].includes(saved.mode ?? '') ? saved.mode! : 'explore';
      frame.checked = saved.frame === true;
      preferredOpening = typeof saved.opening === 'string' ? saved.opening : 'root';
    }
    title.placeholder = pane ? displayTitle(pane.name) : 'Diagram title';
    const loaded = pane?.documentExport;
    const boards = pane && loaded ? [...indexBoards(pane.viewer.exportView(loaded.diagram, loaded.render).diagram).values()] : [];
    const next = JSON.stringify(boards.map(board => [board.id, board.name, board.diagram.shapes.length]));
    if (next !== choices) {
      choices = next; opening.replaceChildren();
      for (const board of boards.filter(board => board.id === 'root' || board.diagram.shapes.length)) {
        const option = document.createElement('option'); option.value = board.id;
        option.textContent = board.id === 'root' ? 'Main board' : board.id.split('.layers.').slice(1).join(' › ') || board.name;
        opening.append(option);
      }
      opening.value = [...opening.options].some(option => option.value === preferredOpening) ? preferredOpening : 'root';
    }
    const interactive = format === 'html' || format === 'atlas';
    document.querySelector<HTMLElement>('#export-interactive-options')!.hidden = !interactive;
    document.querySelector<HTMLElement>('#export-frame-option')!.hidden = interactive;
    title.disabled = subtitle.disabled = !interactive && !frame.checked;
    document.querySelector('#export-presentation-hint')!.textContent = interactive ? 'The opening view is used when no board is specified in the link.'
      : frame.checked ? 'The same frame is used in your preview, downloads and clipboard image.' : 'Turn on the frame to include a title and subtitle in images.';
  }
  return { read, refresh };
}
