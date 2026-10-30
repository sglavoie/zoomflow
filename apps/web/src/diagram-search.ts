import { indexDiagramSearch, searchDiagram, type Board, type DiagramSearchEntry } from '@zoomflow/core';
import type { Viewer } from '@zoomflow/viewer';
import { pageListeners } from './canvas-guidance';
import type { PaneScope } from './pane-scope';
import { createProjectSearch, type ProjectSearchEntry, type ProjectSearchHost, type ProjectSearchState } from './project-search';
import { isSaveKey } from './shortcuts';
import { plural, setText } from './text';

/** Find a board or shape in the last good preview, or index every file of the open project on demand. */
export function setupDiagramSearch(host: HTMLElement, scope: PaneScope, viewer: Viewer,
  activate: (entry: DiagramSearchEntry) => Promise<void>, project?: ProjectSearchHost) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'diagram-search-trigger';
  button.textContent = 'Find in diagram';
  button.disabled = true;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-keyshortcuts', 'Meta+Shift+F Control+Shift+F');
  button.title = 'Find a board or shape (⌘⇧F / Ctrl+Shift+F)';
  const projectButton = document.createElement('button');
  projectButton.type = 'button';
  projectButton.className = 'project-search-trigger';
  projectButton.textContent = 'Find in project';
  projectButton.hidden = true;
  projectButton.setAttribute('aria-haspopup', 'dialog');
  projectButton.title = 'Find a board or shape in any project file (⌘⇧F / Ctrl+Shift+F)';
  const dialog = document.createElement('dialog');
  dialog.id = scope.id('diagram-find-dialog');
  dialog.className = 'diagram-search';
  button.setAttribute('aria-controls', dialog.id);
  projectButton.setAttribute('aria-controls', dialog.id);
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
  const progress = document.createElement('p');
  progress.setAttribute('role', 'status');
  progress.hidden = true;
  const failures = document.createElement('p');
  failures.hidden = true;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry search';
  retry.hidden = true;
  const results = document.createElement('ul');
  results.setAttribute('aria-label', 'Search results');
  dialog.append(heading, input, hint, progress, failures, retry, status, results);
  host.append(button, projectButton);
  scope.root.append(dialog);
  let entries: DiagramSearchEntry[] = [];
  let restoreFocus = true;
  let projectMode = false;
  let projectState: ProjectSearchState | undefined;
  const destinations = new WeakMap<HTMLElement, DiagramSearchEntry>();
  const projectSearch = project && createProjectSearch(project.compile, state => {
    projectState = state;
    if (dialog.open && projectMode) render();
  });

  function close(restore = true) {
    restoreFocus = restore;
    projectSearch?.stop();
    dialog.close();
  }
  function render() {
    const focused = document.activeElement instanceof HTMLElement && results.contains(document.activeElement)
      ? destinations.get(document.activeElement) : undefined;
    const matches = searchDiagram(projectMode ? projectState?.entries ?? [] : entries, input.value);
    setText(status, !input.value.trim() ? 'Type to find a board or shape.' : matches.length ? plural(matches.length, 'match', 'matches')
      : projectMode && projectState?.indexing ? 'No matches yet.' : 'No matches.');
    progress.hidden = !projectMode;
    const state = projectState;
    if (projectMode && state) setText(progress, state.indexing
      ? `Indexing ${state.completed} of ${state.total} files${state.path ? `: ${state.path}` : ''}…`
      : state.error ?? `Searched ${state.total} ${state.total === 1 ? 'file' : 'files'}.`);
    failures.hidden = !projectMode || !state?.failures.length;
    setText(failures, projectMode && state?.failures.length
      ? `Could not search ${state.failures.map(item => `${item.path}: ${item.message}`).join('; ')}` : '');
    retry.hidden = !projectMode || !state || state.indexing || !state.error && !state.failures.length;
    let focus: HTMLButtonElement | undefined;
    results.replaceChildren(...matches.map(entry => {
      const item = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      destinations.set(open, entry);
      if (entry === focused) focus = open;
      const label = document.createElement('strong');
      label.textContent = entry.label;
      const location = document.createElement('small');
      location.textContent = `${entry.shape === undefined ? 'Board' : 'Shape'} · ${'file' in entry ? `${entry.file} · ` : ''}${entry.breadcrumb}`;
      open.append(label, location);
      open.addEventListener('click', () => {
        close(false);
        const action = 'file' in entry ? project!.activate(entry as ProjectSearchEntry) : activate(entry);
        void action.catch(() => viewer.setMessage('Could not open the search result. Search again after the preview updates.', true));
      });
      item.append(open);
      return item;
    }));
    if (focused) (focus ?? input).focus({ preventScroll: true });
  }
  function refresh() {
    projectButton.hidden = !project?.available();
    const shortcut = projectButton.hidden ? button : projectButton;
    const other = projectButton.hidden ? projectButton : button;
    shortcut.setAttribute('aria-keyshortcuts', 'Meta+Shift+F Control+Shift+F');
    other.removeAttribute('aria-keyshortcuts');
    button.title = projectButton.hidden ? 'Find a board or shape (⌘⇧F / Ctrl+Shift+F)' : 'Find a board or shape in this diagram';
    if (dialog.open && projectMode) {
      const snapshot = project?.read();
      if (snapshot) projectSearch!.start(snapshot);
      else close();
    }
  }
  function open(allFiles = false) {
    refresh();
    if (dialog.open || (allFiles ? projectButton.hidden : button.disabled)) return;
    projectMode = allFiles;
    title.textContent = allFiles ? 'Find in project' : 'Find in diagram';
    closeButton.setAttribute('aria-label', allFiles ? 'Close project search' : 'Close diagram search');
    hint.textContent = allFiles
      ? 'Search every project file, including unsaved edits and unlinked diagrams. ↓ and ↑ move through matches; Enter opens one.'
      : 'Search this diagram’s latest preview. ↓ and ↑ move through matches; Enter opens one.';
    restoreFocus = true;
    dialog.showModal();
    if (allFiles) {
      projectState = undefined;
      const snapshot = project?.read();
      if (snapshot) projectSearch!.start(snapshot);
    }
    render();
    input.focus();
    input.select();
  }
  button.addEventListener('click', () => open());
  projectButton.addEventListener('click', () => open(true));
  retry.addEventListener('click', () => {
    const snapshot = project?.read();
    if (snapshot) projectSearch!.start(snapshot, true);
  });
  closeButton.addEventListener('click', () => close());
  input.addEventListener('input', render);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    const trigger = projectMode ? projectButton : button;
    if (!dialog.open && restoreFocus && trigger.isConnected && !trigger.hidden && !trigger.disabled) trigger.focus({ preventScroll: true });
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
      (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f' && (!button.disabled || project?.available())) {
      event.preventDefault();
      event.stopImmediatePropagation();
      open(Boolean(project?.available()));
    }
  }, { capture: true, signal }));
  for (const type of ['zf-suspend', 'zf-destroy']) viewer.stage.addEventListener(type, () => close(false));
  return {
    get empty() { return button.disabled && projectButton.hidden; },
    refresh,
    update(boards: ReadonlyMap<string, Board>) {
      entries = indexDiagramSearch(boards);
      button.disabled = entries.length === 0;
      refresh();
      if (dialog.open) render();
    },
    reset() { close(false); input.value = ''; entries = []; button.disabled = true; results.replaceChildren(); },
  };
}
