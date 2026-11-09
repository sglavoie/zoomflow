/** Learn by doing: each invitation waits for a successful edit or navigation.
 * Existing dismissals remain respected; progress is local to this browser. */
export function setupCanvasCoach(stage: HTMLElement, keys: (target: Element) => string | undefined) {
  const preference = 'zoomflow.canvas-hint-dismissed';
  let phase = 0;
  try {
    phase = localStorage.getItem(preference) === 'true' ? 3 : Math.max(0, Math.min(3, Number(localStorage.getItem('zoomflow.canvas-coach-step')) || 0));
  } catch { /* Optional preference. */ }
  const coach = document.createElement('div');
  coach.className = 'canvas-coach'; coach.hidden = true;
  coach.innerHTML = '<span><small></small><strong></strong><span></span></span><button type="button" aria-label="Dismiss editing hint">×</button>';
  const heading = coach.querySelector('strong')!;
  const instruction = coach.querySelector('span > span')!;
  stage.after(coach);
  let origin: string | undefined;
  let touch = matchMedia('(pointer: coarse)').matches;
  function advance(next: number) {
    phase = Math.max(phase, next);
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
    if (phase === 1 && edit.added) { origin = stage.dataset.board; advance(2); }
  });
  stage.addEventListener('zf-boardchange', () => {
    if (phase === 2 && origin && stage.dataset.board !== origin) advance(3);
    origin = stage.dataset.board;
    place();
  });
  let scheduled = 0;
  const schedule = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(place); };
  function place() {
    coach.hidden = true;
    if (phase === 3 || stage.dataset.transition || stage.dataset.walkthrough ||
      stage.parentElement?.querySelector('.canvas-rename:not([hidden])')) return;
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
  const observer = new MutationObserver(schedule);
  observer.observe(stage.parentElement!.parentElement!, { attributes: true, subtree: true,
    attributeFilter: ['aria-busy', 'data-preview-state', 'data-transition', 'class', 'data-walkthrough'] });
  stage.addEventListener('zf-viewportchange', schedule, { capture: true });
  const resize = new ResizeObserver(schedule); resize.observe(stage);
  stage.addEventListener('zf-destroy', () => { cancelAnimationFrame(scheduled); observer.disconnect(); resize.disconnect(); coach.remove(); });
}
