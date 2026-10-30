import type { Viewer } from '@zoomflow/viewer';
import { pageListeners } from './canvas-guidance';
import { diagnosticLocation } from './diagnostics';
import type { PaneScope } from './pane-scope';
import { createProjectCheck, projectCheckStamp, type ProjectCheckHost, type ProjectCheckState } from './project-check';
import { isSaveKey } from './shortcuts';
import { plural, setText } from './text';

export function setupProjectCheck(host: HTMLElement, scope: PaneScope, viewer: Viewer, project: ProjectCheckHost) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'project-check-trigger';
  button.textContent = 'Check project';
  button.hidden = true;
  button.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-search project-check';
  dialog.id = scope.id('project-check-dialog');
  button.setAttribute('aria-controls', dialog.id);
  const title = document.createElement('h2');
  title.id = scope.id('project-check-title');
  title.textContent = 'Check project';
  dialog.setAttribute('aria-labelledby', title.id);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close project check');
  const heading = document.createElement('div');
  heading.className = 'diagram-search-heading';
  heading.append(title, closeButton);
  const hint = document.createElement('p');
  hint.textContent = 'Check every project file, including unsaved edits and unlinked diagrams. Choose an issue to open its source.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const summary = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'project-check-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel check';
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Check again';
  actions.append(cancel, again);
  const results = document.createElement('div');
  results.className = 'project-check-results';
  results.setAttribute('role', 'region');
  results.setAttribute('aria-label', 'Project check results');
  dialog.append(heading, hint, status, summary, actions, results);
  host.append(button);
  scope.root.append(dialog);
  let state: ProjectCheckState | undefined;
  let stamp: string | undefined;
  let restoreFocus = true;
  let renderedResults = '';
  const destinations = new WeakMap<HTMLElement, string>();
  const check = createProjectCheck(project.compile, next => {
    state = next;
    if (dialog.open) render();
  });

  function render() {
    if (!state) return;
    const items = state.results.flatMap(result => result.diagnostics);
    const errors = items.filter(item => item.severity === 'error').length;
    setText(status, state.running ? `Checking ${state.completed} of ${state.total} files${state.path ? `: ${state.path}` : ''}…`
      : state.stopped === 'changed' ? 'Sources or check options changed. Check again to see current results.'
      : state.stopped === 'cancelled' ? `Check cancelled after ${state.completed} of ${state.total} files. Results are incomplete.`
      : state.error ?? `Checked ${plural(state.total, 'file')}.`);
    setText(summary, state.stopped === 'changed' ? '' : `${plural(errors, 'error')}, ${plural(items.length - errors, 'warning')}${state.running || state.stopped || state.error ? ' so far' : ''}.`);
    const focusedAction = document.activeElement === cancel || document.activeElement === again;
    cancel.hidden = !state.running;
    again.hidden = state.running;
    // Keep result buttons stable while only progress changes, preserving keyboard focus.
    const serialized = JSON.stringify(state.results);
    if (renderedResults !== serialized) {
      renderedResults = serialized;
      const focused = document.activeElement instanceof HTMLElement ? destinations.get(document.activeElement) : undefined;
      let focus: HTMLButtonElement | undefined;
      const fs = project.read()?.fs ?? {};
      results.replaceChildren(...state.results.filter(result => result.diagnostics.length).map(result => {
        const section = document.createElement('section');
        const name = document.createElement('h3');
        name.textContent = result.path;
        const list = document.createElement('ul');
        list.setAttribute('aria-label', `Issues in ${result.path}`);
        for (const item of result.diagnostics) {
          const row = document.createElement('li');
          const open = document.createElement('button');
          open.type = 'button';
          const destination = JSON.stringify([result.path, item]);
          destinations.set(open, destination);
          if (destination === focused) focus = open;
          const message = document.createElement('span');
          message.textContent = `${item.severity === 'error' ? 'Error' : 'Warning'}: ${item.message}`;
          const location = document.createElement('small');
          location.textContent = item.line === undefined ? `${item.filename} · Open file · Source location unavailable`
            : diagnosticLocation(item, result.path);
          open.disabled = !item.filename || !Object.hasOwn(fs, item.filename);
          open.append(message, location);
          open.addEventListener('click', () => {
            refresh();
            if (state?.stopped === 'changed' || !dialog.open) return;
            close(false);
            void project.activate(item).catch(() => viewer.setMessage('Could not open the issue. Check the project again.', true));
          });
          row.append(open);
          list.append(row);
        }
        section.append(name, list);
        return section;
      }));
      if (focused) (focus ?? (state.running ? cancel : again)).focus({ preventScroll: true });
    }
    if (focusedAction) (state.running ? cancel : again).focus({ preventScroll: true });
  }
  function close(restore = true) {
    restoreFocus = restore;
    check.stop();
    dialog.close();
  }
  function refresh() {
    // Reading sources synchronizes the picker with the editors. During a document switch the picker may already
    // name the next file while the editor still holds the previous one, so only read while this modal is open.
    button.hidden = !project.available();
    if (!dialog.open) return;
    const snapshot = project.read();
    if (!snapshot) { close(false); return; }
    if (stamp !== projectCheckStamp(snapshot) && state?.stopped !== 'changed') check.stop('changed');
  }
  function start() {
    const snapshot = project.read();
    if (!snapshot) { close(); return; }
    stamp = projectCheckStamp(snapshot);
    check.start(snapshot);
  }
  button.addEventListener('click', () => {
    restoreFocus = true;
    dialog.showModal();
    start();
    closeButton.focus();
  });
  cancel.addEventListener('click', () => { check.stop('cancelled'); again.focus({ preventScroll: true }); });
  again.addEventListener('click', () => { start(); cancel.focus({ preventScroll: true }); });
  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (!dialog.open && restoreFocus && button.isConnected && !button.hidden) button.focus({ preventScroll: true });
  });
  pageListeners(viewer.stage, signal => window.addEventListener('keydown', event => {
    if (!dialog.open || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === 'Backspace' || (event.metaKey || event.ctrlKey) && (isSaveKey(event) || ['/', '?', 'f'].includes(event.key.toLowerCase()))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, signal }));
  for (const type of ['zf-suspend', 'zf-destroy']) viewer.stage.addEventListener(type, () => close(false));
  return { refresh, get empty() { return button.hidden; }, reset: () => close(false) };
}
