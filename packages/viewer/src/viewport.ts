type Box = { x: number; y: number; width: number; height: number };

/** Zoom the rendered SVG itself so links and shape selection keep working. */
export function setupViewport(stage: HTMLElement, host: HTMLElement) {
  const controls = document.createElement('div');
  controls.className = 'zf-zoom-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Diagram zoom');
  const out = document.createElement('button');
  out.type = 'button';
  out.textContent = '−';
  out.title = 'Zoom out';
  out.setAttribute('aria-label', 'Zoom out');
  const amount = document.createElement('span');
  amount.setAttribute('aria-live', 'off');
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.textContent = 'Fit';
  fit.title = 'Fit diagram';
  fit.setAttribute('aria-label', 'Fit diagram');
  const inside = document.createElement('button');
  inside.type = 'button';
  inside.textContent = '+';
  inside.title = 'Zoom in';
  inside.setAttribute('aria-label', 'Zoom in');
  controls.append(out, amount, fit, inside);
  host.append(controls);

  let svg: SVGSVGElement | null = null;
  let base: Box | null = null;
  let box: Box | null = null;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let moved = false;
  let suppressClick = false;
  let panGesture = false;
  let spaceHeld = false;
  let hovered = false;

  stage.addEventListener('pointerenter', () => { hovered = true; });
  stage.addEventListener('pointerleave', () => { hovered = false; });
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat || event.target instanceof Element &&
      event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (scale() <= 1.001 || !hovered && !stage.contains(document.activeElement)) return;
    event.preventDefault();
    spaceHeld = true;
    stage.classList.add('zf-pan-ready');
  });
  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    spaceHeld = false;
    stage.classList.remove('zf-pan-ready');
  });
  window.addEventListener('blur', () => { spaceHeld = false; stage.classList.remove('zf-pan-ready'); });

  function scale() { return base && box ? base.width / box.width : 1; }
  function updateControls() {
    amount.textContent = `${Math.round(scale() * 100)}%`;
    out.disabled = !svg || scale() <= 1.001;
    inside.disabled = !svg || scale() >= 7.999;
    fit.disabled = !svg || scale() <= 1.001;
    if (svg) svg.style.touchAction = scale() > 1.001 ? 'none' : 'pan-y';
    stage.classList.toggle('zf-pan-ready', spaceHeld && scale() > 1.001);
  }
  function setBox(next: Box) {
    if (!base || !svg) return;
    const x = Math.max(base.x, Math.min(base.x + base.width - next.width, next.x));
    const y = Math.max(base.y, Math.min(base.y + base.height - next.height, next.y));
    box = { ...next, x, y };
    svg.setAttribute('viewBox', `${x} ${y} ${next.width} ${next.height}`);
    updateControls();
  }
  function svgPoint(clientX: number, clientY: number) {
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }
  function zoom(factor: number, clientX?: number, clientY?: number) {
    if (!base || !box) return;
    const old = box;
    const nextScale = Math.max(1, Math.min(8, scale() * factor));
    const width = base.width / nextScale;
    const height = base.height / nextScale;
    const point = clientX === undefined || clientY === undefined ?
      { x: old.x + old.width / 2, y: old.y + old.height / 2 } : svgPoint(clientX, clientY);
    if (!point) return;
    const fractionX = (point.x - old.x) / old.width;
    const fractionY = (point.y - old.y) / old.height;
    setBox({ x: point.x - fractionX * width, y: point.y - fractionY * height, width, height });
  }
  function pan(dx: number, dy: number) {
    if (!box || !svg) return;
    const matrix = svg.getScreenCTM();
    if (!matrix || !matrix.a || !matrix.d) return;
    setBox({ ...box, x: box.x - dx / matrix.a, y: box.y - dy / matrix.d });
  }
  function fittedBox(element: SVGSVGElement, fallback: Box): Box {
    const graph = element.querySelector<SVGSVGElement>(':scope > svg');
    const matrix = element.getScreenCTM();
    if (!graph || !matrix) return fallback;
    const inverse = matrix.inverse();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const child of graph.children) {
      if (!(child instanceof SVGGraphicsElement) || !['g', 'a'].includes(child.localName) || child.classList.contains('appendix-icon')) continue;
      const graphic = child.localName === 'a' ? child.querySelector('g:not(.appendix-icon)') ?? child : child;
      const bounds = graphic.getBoundingClientRect();
      if (!bounds.width && !bounds.height) continue;
      for (const [x, y] of [[bounds.left, bounds.top], [bounds.right, bounds.bottom]]) {
        const point = new DOMPoint(x, y).matrixTransform(inverse);
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return fallback;
    const margin = Math.max(16, Math.min(32, Math.min(right - left, bottom - top) * 0.12));
    return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: bottom - top + margin * 2 };
  }
  function reset(preserveViewport = false) {
    const previous = base && box && preserveViewport ? {
      scale: scale(),
      centerX: (box.x + box.width / 2 - base.x) / base.width,
      centerY: (box.y + box.height / 2 - base.y) / base.height,
    } : null;
    svg = stage.querySelector<SVGSVGElement>(':scope > svg');
    const values = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const original = values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
      ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null;
    base = svg && original ? fittedBox(svg, original) : null;
    box = base && { ...base };
    if (svg && base) {
      if (previous) {
        const width = base.width / previous.scale;
        const height = base.height / previous.scale;
        setBox({ x: base.x + base.width * previous.centerX - width / 2,
          y: base.y + base.height * previous.centerY - height / 2, width, height });
      } else svg.setAttribute('viewBox', `${base.x} ${base.y} ${base.width} ${base.height}`);
    }
    pointers.clear();
    stage.classList.remove('zf-panning');
    updateControls();
  }
  stage.addEventListener('zf-boardchange', (event) => reset((event as CustomEvent<{ preserveViewport?: boolean }>).detail?.preserveViewport));
  reset();
  out.addEventListener('click', () => zoom(1 / 1.5));
  inside.addEventListener('click', () => zoom(1.5));
  fit.addEventListener('click', () => { if (base) setBox({ ...base }); });
  stage.addEventListener('wheel', (event) => {
    if (!svg || !(event.target instanceof Node) || !svg.contains(event.target)) return;
    const factor = Math.exp(-event.deltaY * 0.0015);
    if (Math.max(1, Math.min(8, scale() * factor)) === scale()) return;
    event.preventDefault();
    zoom(factor, event.clientX, event.clientY);
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    const forcePan = event.pointerType === 'mouse' && scale() > 1.001 && (spaceHeld || event.button === 1);
    if (!svg || !(event.target instanceof Element) || !svg.contains(event.target) ||
      (event.pointerType === 'mouse' && !forcePan && (event.button !== 0 || event.target.closest('a, [data-shape-id]')))) return;
    if (!pointers.size) { moved = false; panGesture = forcePan; }
    if (forcePan) event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    const prior = pointers.get(event.pointerId)!;
    pointers.set(event.pointerId, { ...prior, x: event.clientX, y: event.clientY });
    const after = [...pointers.values()];
    if (after.length > 1) {
      const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const previousMid = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const mid = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      const previousDistance = distance(before);
      if (previousDistance) zoom(distance(after) / previousDistance, previousMid.x, previousMid.y);
      pan(mid.x - previousMid.x, mid.y - previousMid.y);
      moved = true;
    } else if (moved || Math.hypot(event.clientX - prior.startX, event.clientY - prior.startY) >= 5) {
      pan(event.clientX - prior.x, event.clientY - prior.y);
      moved = true;
    }
    if (moved) stage.classList.add('zf-panning');
  });
  function finish(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      stage.classList.remove('zf-panning');
      if (moved || panGesture) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 150);
      }
      panGesture = false;
    }
  }
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
  stage.addEventListener('click', (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, { capture: true });
}
