/** One way a divider can split its container. Each axis remembers its own share. */
export type SplitAxis = {
  container: HTMLElement;
  storageKey: string;
  /** Custom properties set on the container for the first and second track. */
  properties: [string, string];
  /** Smallest size of either side, in pixels, once the container has room for both. */
  minimum: number;
  defaultShare: () => number;
  describe: (share: number) => string;
  /** Stack the sides vertically; the divider then moves up and down. */
  rows?: boolean;
};

/** Resizable split between two workspace areas. `axis` returns undefined while the divider is not in use. */
export function setupSplit(divider: HTMLElement, axis: () => SplitAxis | undefined) {
  type State = { requested: number; customized: boolean; share: number };
  const states = new Map<string, State>();
  let drag: { pointer: number; offset: number } | undefined;
  function state(current: SplitAxis) {
    let saved = states.get(current.storageKey);
    if (saved) return saved;
    saved = { requested: current.defaultShare(), customized: false, share: 50 };
    try {
      const stored = Number(localStorage.getItem(current.storageKey));
      if (Number.isFinite(stored) && stored >= 25 && stored <= 75) { saved.requested = stored; saved.customized = true; }
    } catch { /* The split works when storage is unavailable. */ }
    states.set(current.storageKey, saved);
    return saved;
  }
  const size = (current: SplitAxis, box: DOMRect) => current.rows ? box.height : box.width;

  function setShare(value: number) {
    const current = axis();
    if (!current) return;
    const split = state(current);
    split.requested = Math.max(25, Math.min(75, value));
    const available = size(current, current.container.getBoundingClientRect()) - size(current, divider.getBoundingClientRect());
    const roomy = available >= current.minimum * 2;
    const minimum = roomy ? Math.max(25, current.minimum / available * 100) : 25;
    const maximum = roomy ? Math.min(75, (available - current.minimum) / available * 100) : 75;
    split.share = Math.max(minimum, Math.min(maximum, split.requested));
    current.container.style.setProperty(current.properties[0], `${split.share}fr`);
    current.container.style.setProperty(current.properties[1], `${100 - split.share}fr`);
    divider.setAttribute('aria-orientation', current.rows ? 'horizontal' : 'vertical');
    divider.setAttribute('aria-valuemin', String(Math.round(minimum)));
    divider.setAttribute('aria-valuemax', String(Math.round(maximum)));
    divider.setAttribute('aria-valuenow', String(Math.round(split.share)));
    divider.setAttribute('aria-valuetext', current.describe(split.share));
  }
  function saveShare() {
    const current = axis();
    if (!current) return;
    const split = state(current);
    split.customized = true;
    try { localStorage.setItem(current.storageKey, String(split.requested)); }
    catch { /* Resizing does not depend on storage. */ }
  }
  const observed = new Set<HTMLElement>();
  const resize = new ResizeObserver(() => refresh());
  function refresh() {
    const current = axis();
    if (!current) return;
    if (!observed.has(current.container)) { observed.add(current.container); resize.observe(current.container); }
    const split = state(current);
    setShare(split.customized ? split.requested : current.defaultShare());
  }
  refresh();

  divider.addEventListener('keydown', (event) => {
    const current = axis();
    if (!current) return;
    const share = state(current).share;
    const [back, forward] = current.rows ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const next = event.key === back ? share - 5
      : event.key === forward ? share + 5
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
    const current = axis();
    if (!current || event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    const box = divider.getBoundingClientRect();
    drag = { pointer: event.pointerId, offset: current.rows ? event.clientY - box.top : event.clientX - box.left };
    divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener('pointermove', (event) => {
    const current = axis();
    if (!current || drag?.pointer !== event.pointerId) return;
    const bounds = current.container.getBoundingClientRect();
    const available = size(current, bounds) - size(current, divider.getBoundingClientRect());
    const position = current.rows ? event.clientY - bounds.top : event.clientX - bounds.left;
    if (available > 0) setShare((position - drag.offset) / available * 100);
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
    const current = axis();
    if (!current) return;
    state(current).customized = false;
    setShare(current.defaultShare());
    try { localStorage.removeItem(current.storageKey); } catch { /* Reset works without storage. */ }
  });
  /** Finish a drag in progress, for example before the divider hides. */
  const endDrag = () => { if (drag) finishDrag(); };
  return { refresh, endDrag };
}
