import { indexDiagramSearch, searchDiagram, type Board, type DiagramSearchEntry } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import { pageListeners } from './canvas-guidance';
import type { PaneScope } from './pane-scope';
import { isSaveKey } from './shortcuts';
import { plural, setText } from './text';

/** Find a board or shape in this pane's last successfully previewed document. */
export function setupDiagramSearch(host: HTMLElement, scope: PaneScope, viewer: Viewer,
  activate: (entry: DiagramSearchEntry) => Promise<void>) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'diagram-search-trigger';
  button.textContent = 'Find in diagram';
  button.disabled = true;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-keyshortcuts', 'Meta+Shift+F Control+Shift+F');
  button.title = 'Find a board or shape (⌘⇧F / Ctrl+Shift+F)';
  const dialog = document.createElement('dialog');
  dialog.id = scope.id('diagram-find-dialog');
  dialog.className = 'diagram-search';
  button.setAttribute('aria-controls', dialog.id);
  const title = document.createElement('h2');
  title.id = scope.id('diagram-search-title');
  title.textContent = 'Find in diagram';
  dialog.setAttribute('aria-labelledby', title.id);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close diagram search');
  const heading = document.createElement('div');
  heading.className = 'diagram-search-heading';
  heading.append(title, closeButton);
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Find a step, topic, or board…';
  input.setAttribute('aria-label', 'Search board names and shape labels');
  const hint = document.createElement('p');
  hint.id = scope.id('diagram-search-hint');
  hint.textContent = 'Search this diagram’s latest preview. ↓ and ↑ move through matches; Enter opens one.';
  input.setAttribute('aria-describedby', hint.id);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const results = document.createElement('ul');
  results.setAttribute('aria-label', 'Search results');
  dialog.append(heading, input, hint, status, results);
  host.append(button);
  scope.root.append(dialog);
  let entries: DiagramSearchEntry[] = [];
  let restoreFocus = true;

  function close(restore = true) {
    restoreFocus = restore;
    dialog.close();
  }
  function render() {
    const matches = searchDiagram(entries, input.value);
    setText(status, !input.value.trim() ? 'Type to find a board or shape.' : matches.length ? plural(matches.length, 'match', 'matches') : 'No matches.');
    results.replaceChildren(...matches.map(entry => {
      const item = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      const label = document.createElement('strong');
      label.textContent = entry.label;
      const location = document.createElement('small');
      location.textContent = `${entry.shape === undefined ? 'Board' : 'Shape'} · ${entry.breadcrumb}`;
      open.append(label, location);
      open.addEventListener('click', () => {
        close(false);
        void activate(entry);
      });
      item.append(open);
      return item;
    }));
  }
  function open() {
    if (button.disabled) return;
    restoreFocus = true;
    render();
    dialog.showModal();
    input.focus();
    input.select();
  }
  button.addEventListener('click', open);
  closeButton.addEventListener('click', () => close());
  input.addEventListener('input', render);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (!dialog.open && restoreFocus && button.isConnected && !button.disabled) button.focus({ preventScroll: true });
  });
  dialog.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const buttons = [...results.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') (buttons[index + 1] ?? buttons[0])?.focus();
    else if (event.key === 'ArrowUp') {
      if (index === 0) input.focus();
      else (buttons[index - 1] ?? buttons.at(-1))?.focus();
    } else if (event.key === 'Enter' && event.target === input) buttons[0]?.click();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  pageListeners(viewer.stage, signal => window.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (dialog.open) {
      // Keep Escape, browser Backspace and workspace shortcuts inside the modal.
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      else if ((event.metaKey || event.ctrlKey) && (isSaveKey(event) || ['/', '?', 'f'].includes(event.key.toLowerCase()))
        || event.key === 'Backspace' && event.target !== input) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    } else if (scope.root.hasAttribute('data-active') && !document.querySelector('dialog[open]') &&
      (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f' && !button.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      open();
    }
  }, { capture: true, signal }));
  for (const type of ['zf-suspend', 'zf-destroy']) viewer.stage.addEventListener(type, () => close(false));
  return {
    get empty() { return button.disabled; },
    update(boards: ReadonlyMap<string, Board>) {
      entries = indexDiagramSearch(boards);
      button.disabled = entries.length === 0;
      if (dialog.open) render();
    },
    reset() { close(false); input.value = ''; entries = []; button.disabled = true; results.replaceChildren(); },
  };
}
