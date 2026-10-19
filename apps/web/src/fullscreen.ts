/** Expand the preview without rebuilding the diagram or surrounding panels. */
export function setupFullscreen(stage: HTMLElement) {
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
    if (!value) workspace.scrollTop = workspaceScroll;
    button.textContent = value ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(value));
    button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => setFullscreen(!fullscreen));
  window.addEventListener('keydown', (event) => {
    if (!fullscreen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFullscreen(false);
    } else if ((event.metaKey || event.ctrlKey) && (event.key === '/' || event.key === '?' || event.code === 'Slash')) {
      // Keep the hidden reference panel and its focus unchanged.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
  return area;
}
