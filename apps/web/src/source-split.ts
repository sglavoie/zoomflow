/** Resizable split between the preview and the D2 source editor. */
export function setupSourceSplit() {
  const workspace = document.querySelector<HTMLElement>('#workspace')!;
  const divider = document.querySelector<HTMLElement>('#source-divider')!;
  const storageKey = 'zoomflow.source.preview-share';
  const defaultShare = 62;
  let requestedShare = defaultShare;
  let previewShare = requestedShare;
  let drag: { pointer: number; offset: number } | undefined;
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 25 && stored <= 75) requestedShare = stored;
  } catch { /* The split works when storage is unavailable. */ }

  function setShare(value: number) {
    requestedShare = Math.max(25, Math.min(75, value));
    const available = workspace.clientWidth - divider.offsetWidth;
    const minimum = available >= 720 ? Math.max(25, 360 / available * 100) : 25;
    const maximum = available >= 720 ? Math.min(75, (available - 360) / available * 100) : 75;
    previewShare = Math.max(minimum, Math.min(maximum, requestedShare));
    workspace.style.setProperty('--preview-share', `${previewShare}fr`);
    workspace.style.setProperty('--source-share', `${100 - previewShare}fr`);
    divider.setAttribute('aria-valuemin', String(Math.round(minimum)));
    divider.setAttribute('aria-valuemax', String(Math.round(maximum)));
    divider.setAttribute('aria-valuenow', String(Math.round(previewShare)));
    divider.setAttribute('aria-valuetext', `Diagram ${Math.round(previewShare)}%, D2 source ${Math.round(100 - previewShare)}%`);
  }
  function saveShare() {
    try { localStorage.setItem(storageKey, String(requestedShare)); }
    catch { /* Resizing does not depend on storage. */ }
  }
  setShare(requestedShare);
  new ResizeObserver(() => setShare(requestedShare)).observe(workspace);

  divider.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowLeft' ? previewShare - 5
      : event.key === 'ArrowRight' ? previewShare + 5
      : event.key === 'Home' ? 25 : event.key === 'End' ? 75 : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setShare(next);
      saveShare();
    } else if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = { pointer: event.pointerId, offset: event.clientX - divider.getBoundingClientRect().left };
    divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener('pointermove', (event) => {
    if (drag?.pointer !== event.pointerId) return;
    const bounds = workspace.getBoundingClientRect();
    const available = bounds.width - divider.getBoundingClientRect().width;
    if (available > 0) setShare((event.clientX - bounds.left - drag.offset) / available * 100);
  });
  function finishDrag() {
    const pointer = drag?.pointer;
    drag = undefined;
    if (pointer !== undefined && divider.hasPointerCapture(pointer)) divider.releasePointerCapture(pointer);
    saveShare();
  }
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);
  divider.addEventListener('lostpointercapture', finishDrag);
  divider.addEventListener('dblclick', () => {
    setShare(defaultShare);
    saveShare();
  });
}
