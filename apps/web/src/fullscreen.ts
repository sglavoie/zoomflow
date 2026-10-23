/** Expand the preview without rebuilding the diagram or surrounding panels. */
export function setupFullscreen(stage: HTMLElement, pane: HTMLElement) {
  const area = document.createElement('div');
  area.className = 'zf-stage-area';
  stage.before(area);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'zf-fullscreen-toggle';
  button.textContent = 'Fullscreen';
  button.setAttribute('aria-pressed', 'false');
  area.append(stage, button);

  let fullscreen = false;
  const workspace = document.querySelector<HTMLElement>('#workspace')!;
  let workspaceScroll = 0;
  function setFullscreen(value: boolean) {
    if (value && !fullscreen) workspaceScroll = workspace.scrollTop;
    fullscreen = value;
    document.body.classList.toggle('diagram-fullscreen', value);
    pane.toggleAttribute('data-fullscreen', value);
    if (!value) workspace.scrollTop = workspaceScroll;
    button.textContent = value ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(value));
    button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => setFullscreen(!fullscreen));
  function onKey(event: KeyboardEvent) {
    // An open dialog, such as a confirmation, handles its own keys first.
    if (!fullscreen || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFullscreen(false);
    } else if (event.shiftKey && (event.metaKey || event.ctrlKey) && (event.key === '/' || event.key === '?' || event.code === 'Slash')) {
      // Keep the hidden reference panel and its focus unchanged.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  // A hidden pane (closed split view) stops listening to the page until the viewer resumes.
  let listening: AbortController | undefined;
  const listen = () => {
    listening?.abort();
    listening = new AbortController();
    window.addEventListener('keydown', onKey, { capture: true, signal: listening.signal });
  };
  listen();
  stage.addEventListener('zf-resume', listen);
  for (const type of ['zf-suspend', 'zf-destroy']) stage.addEventListener(type, () => listening?.abort());
  return area;
}
