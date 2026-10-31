import { downloadProjectSources } from './download';
import { createProjectSave, type ProjectSaveHost, type ProjectSaveState } from './project-save';
import { isSaveKey } from './shortcuts';
import { describeError, plural, setText } from './text';

export function setupProjectSave(host: ProjectSaveHost) {
  const dialog = document.createElement('dialog');
  dialog.id = 'project-save-dialog';
  dialog.className = 'diagram-search project-save-dialog';
  dialog.setAttribute('aria-labelledby', 'project-save-title');
  dialog.innerHTML = '<div class="diagram-search-heading"><h2 id="project-save-title"></h2><button type="button">Close</button></div><p>Save changed project files to their existing destinations. Recovered copies stay separate.</p><p class="project-save-status" role="status"></p><ul class="project-save-results"></ul><p class="project-save-hint">Files without write access stay unsaved. Download the project ZIP to keep every source and its folder path.</p><div class="project-check-actions"><button type="button" class="project-save-cancel">Cancel saving</button><button type="button" class="project-save-again">Save remaining files</button><button type="button" class="project-save-download">Download project ZIP</button></div><p class="project-save-download-status" role="status"></p>';
  document.body.append(dialog);
  const title = dialog.querySelector('h2')!;
  const close = dialog.querySelector('button')!;
  const status = dialog.querySelector<HTMLElement>('.project-save-status')!;
  const results = dialog.querySelector('ul')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('.project-save-cancel')!;
  const again = dialog.querySelector<HTMLButtonElement>('.project-save-again')!;
  const zip = dialog.querySelector<HTMLButtonElement>('.project-save-download')!;
  const downloadStatus = dialog.querySelector<HTMLElement>('.project-save-download-status')!;
  let state: ProjectSaveState | undefined;
  let returnFocus: HTMLElement | undefined;
  let rendered = 0;
  const saver = createProjectSave(host, next => {
    state = next;
    const saved = next.results.filter(result => result.status === 'saved').length;
    const failed = next.results.filter(result => result.status === 'failed').length;
    const skipped = next.results.length - saved - failed;
    setText(status, next.running
      ? next.cancelled ? 'Stopping after the current file…' : `Saving ${Math.min(next.results.length + 1, next.project.files.length)} of ${next.project.files.length} files${next.path ? `: ${next.path}` : ''}…`
      : `${next.cancelled ? 'Save cancelled. ' : ''}${plural(saved, 'file')} saved, ${skipped} skipped, ${failed} failed.`);
    // Append rows as files finish; progress updates must not replace focused controls.
    for (const result of next.results.slice(rendered)) {
      const row = document.createElement('li');
      row.dataset.status = result.status;
      row.textContent = `${result.path} — ${result.status === 'saved' ? 'Saved.' : `${result.status === 'failed' ? 'Failed' : 'Skipped'}: ${result.message}`}`;
      results.append(row);
    }
    rendered = next.results.length;
    const focused = document.activeElement === cancel || document.activeElement === again;
    cancel.hidden = !next.running;
    cancel.disabled = next.cancelled;
    again.hidden = next.running;
    zip.disabled = next.running;
    if (focused && !next.running && dialog.open) again.focus({ preventScroll: true });
  });
  function start(projectId: string) {
    const snapshot = host.picker().projectSaveSnapshot(projectId);
    if (!snapshot) { setText(status, 'This project is no longer available.'); return; }
    rendered = 0;
    results.replaceChildren();
    setText(downloadStatus, '');
    setText(title, `Save ${snapshot.name} project`);
    void saver.start(snapshot).catch(error => {
      setText(status, `Could not save project: ${describeError(error)}`);
    });
  }
  function dismiss() { saver.cancel(); dialog.close(); }
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
  cancel.addEventListener('click', () => { saver.cancel(); close.focus({ preventScroll: true }); });
  again.addEventListener('click', () => { if (state) { start(state.project.id); close.focus({ preventScroll: true }); } });
  zip.addEventListener('click', () => {
    if (!state || !host.picker().hasProject(state.project.id)) { setText(downloadStatus, 'This project is no longer available.'); return; }
    try {
      const { fs } = host.picker().projectSources(state.project.id);
      const filename = downloadProjectSources(fs, state.project.name);
      setText(downloadStatus, `Project source download started: ${filename}. Downloading does not clear unsaved changes.`);
    } catch (error) { setText(downloadStatus, `Project source download failed: ${describeError(error)}`); }
  });
  window.addEventListener('keydown', event => {
    if (!dialog.open || document.querySelector<HTMLDialogElement>('#document-action')?.open) return;
    // Preserve native Tab/Enter behavior, while keeping workspace commands out of this modal.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    else if (event.key === 'Backspace' || (event.metaKey || event.ctrlKey) && (isSaveKey(event) || ['/', '?', 'f'].includes(event.key.toLowerCase()))) event.preventDefault();
  }, { capture: true });
  return {
    open(projectId: string) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      if (!dialog.open) dialog.showModal();
      close.focus();
      if (!state?.running) start(projectId);
    },
  };
}
