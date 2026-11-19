/** Learn by doing: each invitation waits for a successful edit or navigation.
 * Existing dismissals remain respected; progress is local to this browser. */
export function setupCanvasCoach(stage: HTMLElement, keys: (target: Element) => string | undefined) {
  const preference = 'zoomflow.canvas-hint-dismissed';
  const drillPreference = 'zoomflow.drill-hint-dismissed';
  const events = new AbortController();
  let drilled = false;
  let unlocked = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let hint: SVGCircleElement | undefined;
  let phase = 0;
  try {
    drilled = localStorage.getItem(drillPreference) === 'true';
    phase = localStorage.getItem(preference) === 'true' ? 3 : Math.max(0, Math.min(3, Number(localStorage.getItem('zoomflow.canvas-coach-step')) || 0));
  } catch { /* Optional preference. */ }
  const coach = document.createElement('div');
  coach.className = 'canvas-coach'; coach.hidden = true;
  coach.innerHTML = '<span><small></small><strong></strong><span></span></span><button type="button" aria-label="Dismiss editing hint">×</button>';
  const heading = coach.querySelector('strong')!;
  const instruction = coach.querySelector('span > span')!;
  stage.after(coach);
  let touch = matchMedia('(pointer: coarse)').matches;
  function stopHint() {
    const changed = !drilled;
    drilled = true;
    hint?.remove(); hint = undefined;
    try { localStorage.setItem(drillPreference, 'true'); } catch { /* Optional preference. */ }
    if (changed) window.dispatchEvent(new Event('zf-drillhintdismissed'));
  }
  window.addEventListener('zf-drillhintdismissed', () => {
    drilled = true; hint?.remove(); hint = undefined;
  }, { signal: events.signal });
  function ready() {
    return stage.querySelector('svg') && !stage.hasAttribute('data-arrival-motion') &&
      !stage.hasAttribute('data-preview-state') && !stage.closest('[aria-busy="true"]');
  }
  function waitForIdle() {
    if (unlocked) return;
    if (!ready()) { clearTimeout(idle); idle = undefined; return; }
    idle ??= setTimeout(() => { idle = undefined; unlocked = true; place(); }, 4000);
  }
  function showHint() {
    const badge = !drilled && phase < 3 && ready() && !stage.dataset.transition && !stage.dataset.walkthrough
      ? stage.querySelector('a[data-link-direction="child"] .appendix-icon') : null;
    if (hint?.parentElement === badge) return;
    hint?.remove(); hint = undefined;
    if (!badge) return;
    hint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hint.setAttribute('class', 'zf-drill-hint');
    hint.setAttribute('cx', '16'); hint.setAttribute('cy', '16'); hint.setAttribute('r', '16');
    hint.setAttribute('aria-hidden', 'true');
    badge.append(hint);
  }
  stage.addEventListener('zf-drill', () => {
    unlocked = true; clearTimeout(idle); stopHint();
    if (phase === 2) advance(3); else place();
  }, { signal: events.signal });
  for (const type of ['pointerdown', 'keydown', 'wheel', 'input']) window.addEventListener(type, () => {
    clearTimeout(idle); idle = undefined; waitForIdle();
  }, { capture: true, passive: true, signal: events.signal });
  window.addEventListener('storage', event => {
    if (event.key === drillPreference || event.key === preference || event.key === null) {
      try {
        if (localStorage.getItem(drillPreference) === 'true' || localStorage.getItem(preference) === 'true') stopHint();
      } catch { /* Optional preference. */ }
    }
  }, { signal: events.signal });
  stage.addEventListener('zf-arrivalend', () => { showHint(); waitForIdle(); }, { signal: events.signal });
  function advance(next: number) {
    phase = Math.max(phase, next);
    if (phase === 3) stopHint();
    try {
      localStorage.setItem('zoomflow.canvas-coach-step', String(phase));
      if (phase === 3) localStorage.setItem(preference, 'true');
    } catch { /* Optional preference. */ }
    place();
  }
  coach.querySelector('button')!.addEventListener('click', () => advance(3));
  stage.addEventListener('pointerdown', event => { touch = event.pointerType === 'touch'; });
  stage.addEventListener('zf-canvasedit', event => {
    const edit = (event as CustomEvent<{ added: boolean; renamed: boolean }>).detail;
    if (phase === 0 && edit.renamed) advance(1);
    if (phase === 1 && edit.added) advance(2);
  });
  stage.addEventListener('zf-boardchange', place);
  const pane = stage.closest('.document-pane') ?? stage.parentElement!.parentElement!;
  let scheduled = 0;
  const schedule = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(place); };
  function place() {
    showHint(); waitForIdle();
    coach.hidden = true;
    if (!unlocked || !ready()) return;
    if (phase === 3 || stage.dataset.transition || stage.dataset.walkthrough ||
      pane.querySelector('.canvas-rename:not([hidden]), .board-menu:not([hidden]), .flow-builder-toolbar > details[open], .board-appearance > details[open], dialog[open]')) return;
    const selected = stage.querySelector<SVGGraphicsElement>('.zf-canvas-selected');
    const shape = phase === 2 ? stage.querySelector<SVGGraphicsElement>('a[data-link-direction="child"]')
      : selected && keys(selected)?.includes('F2 renames') ? selected
      : [...stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].find(node => !node.closest('a') && keys(node)?.includes('F2 renames'));
    if (!shape) return;
    const name = shape.querySelector('text')?.textContent ?? 'this step';
    heading.textContent = ['Make it yours', 'Keep the idea moving', 'There’s more inside'][phase];
    coach.querySelector('small')!.textContent = `${phase + 1} of 3`;
    instruction.textContent = phase === 0 ? touch ? 'Tap a step, then More → Rename.' : 'Double-click a step to rename it. Or focus it and press F2.'
      : phase === 1 ? `${touch ? 'Tap' : 'Select'} a step and use + to add the next one.`
      : `${touch ? 'Tap' : 'Click'} the arrow on ${name} to explore its detail board.`;
    const box = shape.getBoundingClientRect();
    const canvas = stage.getBoundingClientRect();
    if (!box.width || box.left < canvas.left || box.right > canvas.right || box.top < canvas.top || box.bottom > canvas.bottom) return;
    coach.hidden = false;
    const outer = coach.offsetParent!.getBoundingClientRect();
    coach.style.maxWidth = `${Math.min(270, canvas.width - 24)}px`;
    const width = coach.offsetWidth, height = coach.offsetHeight;
    const centered = box.x + box.width / 2 - width / 2;
    const below = { x: centered, y: box.bottom + (selected ? 68 : 16) };
    const above = { x: centered, y: box.top - height - 24 };
    const candidates = [selected || phase === 2 ? above : below,
      { x: box.right + 24, y: box.top + box.height / 2 - height / 2 },
      { x: box.left - width - 24, y: box.top + box.height / 2 - height / 2 }, selected || phase === 2 ? below : above];
    const obstacles = [...stage.querySelectorAll('a, [data-shape-id]'),
      ...stage.parentElement!.querySelectorAll('.board-selection:not([hidden]), .canvas-add:not([hidden])')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const fits = candidates.map(point => ({ ...point, x: Math.max(canvas.left + 12, Math.min(point.x, canvas.right - width - 12)) }))
      .find(point => point.y >= canvas.top + 8 && point.y + height <= canvas.bottom - 8 &&
        obstacles.every(rect => point.x + width + 8 <= rect.left || point.x >= rect.right + 8 || point.y + height + 8 <= rect.top || point.y >= rect.bottom + 8));
    if (!fits) { coach.hidden = true; return; }
    coach.style.left = `${fits.x - outer.left}px`;
    coach.style.top = `${fits.y - outer.top}px`;
  }
  const observer = new MutationObserver(records => { if (records.some(record => record.target !== coach)) schedule(); });
  observer.observe(pane, { attributes: true, subtree: true,
    attributeFilter: ['aria-busy', 'data-preview-state', 'data-arrival-motion', 'data-transition', 'class', 'data-walkthrough', 'open', 'hidden'] });
  stage.addEventListener('zf-viewportchange', schedule, { capture: true });
  const resize = new ResizeObserver(schedule); resize.observe(stage);
  stage.addEventListener('zf-destroy', () => { clearTimeout(idle); events.abort(); hint?.remove(); cancelAnimationFrame(scheduled); observer.disconnect(); resize.disconnect(); coach.remove(); });
}
