type Box = { x: number; y: number; width: number; height: number };

/** Zoom the rendered SVG itself so links and shape selection keep working. */
export function setupViewport(stage: HTMLElement, host: HTMLElement) {
  const minZoom = 0.1;
  const maxZoom = 8;
  const zoomEpsilon = 0.001;
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
  fit.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>';
  fit.title = 'Fit diagram';
  fit.setAttribute('aria-label', 'Fit diagram');
  const inside = document.createElement('button');
  inside.type = 'button';
  inside.textContent = '+';
  inside.title = 'Zoom in';
  inside.setAttribute('aria-label', 'Zoom in');
  controls.append(out, amount, fit, inside);
  const hint = document.createElement('div');
  hint.className = 'zf-pan-hint';
  hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag to pan · Pinch to zoom' : 'Space + drag to pan · Scroll to zoom';
  hint.hidden = true;
  host.append(controls, hint);

  let svg: SVGSVGElement | null = null;
  let base: Box | null = null;
  let box: Box | null = null;
  type View = { scale: number; centerX: number; centerY: number };
  const views = new Map<string, View>();
  let documentKey = '';
  let activeKey: string | undefined;
  function remember() {
    if (activeKey && base && box) views.set(activeKey, { scale: scale(),
      centerX: (box.x + box.width / 2 - base.x) / base.width,
      centerY: (box.y + box.height / 2 - base.y) / base.height });
  }
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
      event.target.closest('button, [role="button"], input, textarea, select, [contenteditable="true"]')) return;
    if (Math.abs(scale() - 1) <= zoomEpsilon || !hovered && !stage.contains(document.activeElement)) return;
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
    const currentScale = scale();
    const zoomed = Math.abs(currentScale - 1) > zoomEpsilon;
    amount.textContent = zoomed ? `${Math.round(currentScale * 100)}%` : 'Fit';
    amount.title = zoomed ? `${Math.round(currentScale * 100)}% of fitted size` : 'Diagram fitted to the available space';
    amount.setAttribute('aria-label', amount.title);
    hint.hidden = !svg || currentScale <= 1 + zoomEpsilon;
    out.disabled = !svg || currentScale <= minZoom + zoomEpsilon;
    inside.disabled = !svg || currentScale >= maxZoom - zoomEpsilon;
    fit.disabled = !svg || !zoomed;
    // Reserve gestures from the first contact: changing touch-action mid-pinch is too late.
    if (svg) svg.style.touchAction = 'none';
    stage.classList.toggle('zf-pan-ready', spaceHeld && zoomed);
  }
  function setBox(next: Box) {
    if (!base || !svg) return;
    const xLimit = base.x + base.width - next.width;
    const yLimit = base.y + base.height - next.height;
    const x = Math.max(Math.min(base.x, xLimit), Math.min(Math.max(base.x, xLimit), next.x));
    const y = Math.max(Math.min(base.y, yLimit), Math.min(Math.max(base.y, yLimit), next.y));
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
    const nextScale = Math.max(minZoom, Math.min(maxZoom, scale() * factor));
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
  function reset() {
    remember();
    activeKey = `${documentKey}\n${stage.dataset.board ?? 'root'}`;
    const previous = views.get(activeKey);
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
  stage.addEventListener('zf-boardchange', reset);
  reset();
  out.addEventListener('click', () => zoom(1 / 1.5));
  inside.addEventListener('click', () => zoom(1.5));
  fit.addEventListener('click', () => { if (base) setBox({ ...base }); });
  stage.addEventListener('wheel', (event) => {
    if (!svg || !(event.target instanceof Node) || !svg.contains(event.target)) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? stage.clientHeight : 1;
    // Trackpad pinch is delivered as ctrl+wheel. Bound individual jumps from coarse wheels.
    const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
    const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
    if (Math.max(minZoom, Math.min(maxZoom, scale() * factor)) === scale()) return;
    event.preventDefault();
    zoom(factor, event.clientX, event.clientY);
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    const forcePan = event.pointerType === 'mouse' && Math.abs(scale() - 1) > zoomEpsilon && (spaceHeld || event.button === 1);
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
  return {
    refresh() { if (activeKey) reset(); },
    copyDocument(key: string) {
      remember();
      for (const [id, view] of [...views]) if (id.startsWith(`${documentKey}\n`)) views.set(`${key}${id.slice(documentKey.length)}`, { ...view });
      if (activeKey) activeKey = `${key}${activeKey.slice(documentKey.length)}`;
      documentKey = key;
    },
    setDocument(key: string, reset = false) {
      remember();
      activeKey = undefined;
      documentKey = key;
      if (reset) this.forget(key);
    },
    forget(key: string) {
      for (const id of views.keys()) if (id.startsWith(`${key}\n`)) views.delete(id);
      if (documentKey === key) activeKey = undefined;
    },
  };

}
