import type { DiagramSearchEntry, searchDiagram } from '@zoomflow/core';

export type OfflineSearchEntry = DiagramSearchEntry & { file: string };

/** Self-contained: serialized into exported HTML with its matcher injected. */
export function setupOfflineSearch(host: HTMLElement, entries: OfflineSearchEntry[], atlas: boolean,
  match: typeof searchDiagram, activate: (entry: OfflineSearchEntry) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'zf-search-trigger';
  button.textContent = atlas ? 'Find in atlas' : 'Find in diagram';
  button.title = 'Find a board or shape (⌘⇧F / Ctrl+Shift+F)';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-keyshortcuts', 'Meta+Shift+F Control+Shift+F');
  const dialog = document.createElement('dialog');
  dialog.id = 'zf-search';
  dialog.className = 'zf-search';
  dialog.setAttribute('aria-labelledby', 'zf-search-title');
  button.setAttribute('aria-controls', dialog.id);
  const heading = document.createElement('div');
  heading.className = 'zf-search-heading';
  const title = document.createElement('h2');
  title.id = 'zf-search-title';
  title.textContent = button.textContent;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close diagram search');
  heading.append(title, closeButton);
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Find a step, topic, or board…';
  input.setAttribute('aria-label', 'Search board names and shape labels');
  input.setAttribute('aria-describedby', 'zf-search-hint');
  const hint = document.createElement('p');
  hint.id = 'zf-search-hint';
  hint.textContent = `${atlas ? 'Search every file in this atlas.' : 'Search every board in this diagram.'} ↓ and ↑ move through matches; Enter opens one.`;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const results = document.createElement('ul');
  results.setAttribute('aria-label', 'Search results');
  dialog.append(heading, input, hint, status, results);
  host.append(button);
  document.body.append(dialog);
  let restoreFocus = true;
  function close(restore = true) {
    restoreFocus = restore;
    dialog.close();
  }
  function render() {
    const matches = match(entries, input.value);
    status.textContent = !input.value.trim() ? 'Type to find a board or shape.'
      : matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : 'No matches.';
    results.replaceChildren(...matches.map(entry => {
      const item = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      const label = document.createElement('strong');
      label.textContent = entry.label;
      const location = document.createElement('small');
      location.textContent = `${entry.shape === undefined ? 'Board' : 'Shape'} · ${entry.breadcrumb}`;
      open.append(label, location);
      open.addEventListener('click', () => { close(false); activate(entry); });
      item.append(open);
      return item;
    }));
  }
  function open() {
    if (dialog.open || document.querySelector('dialog[open]')) return;
    restoreFocus = true;
    render();
    dialog.showModal();
    input.focus();
    input.select();
  }
  button.addEventListener('click', open);
  input.addEventListener('input', render);
  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && restoreFocus) button.focus({ preventScroll: true }); });
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
  window.addEventListener('keydown', event => {
    if (event.isComposing || !dialog.isConnected) return;
    if (dialog.open) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      else if (event.key === 'Backspace' && event.target !== input) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      open();
    }
  }, { capture: true });
}
