export type Box = { x: number; y: number; width: number; height: number };

/** Keep a view inside the fitted diagram; a view wider or taller than it stays within its overhang. */
export function clampBox(base: Box, next: Box): Box {
  const xLimit = base.x + base.width - next.width;
  const yLimit = base.y + base.height - next.height;
  const x = Math.max(Math.min(base.x, xLimit), Math.min(Math.max(base.x, xLimit), next.x));
  const y = Math.max(Math.min(base.y, yLimit), Math.min(Math.max(base.y, yLimit), next.y));
  return { ...next, x, y };
}

/** Frame `target` with minimal movement from `box`, keeping the current zoom whenever it fits.
 * `available` is the visible user-space size at the current zoom, letterboxing included. */
export function revealBox(base: Box, box: Box, target: Box, available: { width: number; height: number },
  minZoom: number): Box {
  const factor = Math.max(1, target.width / available.width, target.height / available.height);
  const width = Math.min(base.width / minZoom, box.width * factor);
  const height = width * base.height / base.width;
  const centerX = Math.max(target.x + target.width - available.width * factor / 2,
    Math.min(target.x + available.width * factor / 2, box.x + box.width / 2));
  const centerY = Math.max(target.y + target.height - available.height * factor / 2,
    Math.min(target.y + available.height * factor / 2, box.y + box.height / 2));
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

/** Zoom the rendered SVG itself so links and shape selection keep working. */
export function setupViewport(stage: HTMLElement, host: HTMLElement) {
  return createViewport(stage, host, clampBox, revealBox);
}

/** `setupViewport` with its pure geometry injected, so the offline HTML runtime can serialize it. */
export function createViewport(stage: HTMLElement, host: HTMLElement, clamp: typeof clampBox, frame: typeof revealBox) {
  const coarse = matchMedia('(pointer: coarse)');
  let touch = coarse.matches;
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
  // A status names the zoom level and announces its changes.
  const amount = document.createElement('span');
  amount.setAttribute('role', 'status');
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
  hint.textContent = touch ? 'Pinch to zoom · Drag to pan' : 'Space + drag to pan · Scroll to zoom';
  hint.hidden = true;
  let guidance = '';
  let preferGuidance = false;
  stage.after(controls);
  host.append(hint);
  const teardown = new AbortController();
  const signal = teardown.signal;
  coarse.addEventListener('change', () => {
    touch = coarse.matches;
    updateControls();
    svg?.dispatchEvent(new Event('zf-viewportchange'));
  }, { signal });

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
  /** When a pointer last pressed or released; focus right after it came from that press. */
  let pointerAt = -Infinity;

  stage.addEventListener('pointerenter', () => { hovered = true; }, { signal });
  stage.addEventListener('pointerleave', () => { hovered = false; }, { signal });
  /** Page-level key listeners, released while a hidden viewport is suspended. */
  let windowEvents: AbortController | undefined;
  function listenToWindow() {
    if (windowEvents || signal.aborted) return;
    windowEvents = new AbortController();
    const options = { signal: windowEvents.signal };
    window.addEventListener('keydown', onKeyDown, options);
    window.addEventListener('keyup', onKeyUp, options);
    window.addEventListener('blur', releaseSpace, options);
  }
  function releaseSpace() { spaceHeld = false; stage.classList.remove('zf-pan-ready'); }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.target instanceof Element &&
      event.target.closest('button, [role="button"], input, textarea, select, [contenteditable="true"]')) return;
    // Auto-repeat would scroll the page mid-pan.
    if (event.repeat) { if (spaceHeld) event.preventDefault(); return; }
    // A hidden stage may never receive pointerleave; it must not claim Space page-wide.
    if (!stage.getClientRects().length) { hovered = false; return; }
    if (Math.abs(scale() - 1) <= zoomEpsilon || !hovered && !stage.contains(document.activeElement)) return;
    event.preventDefault();
    spaceHeld = true;
    stage.classList.add('zf-pan-ready');
  }
  function onKeyUp(event: KeyboardEvent) {
    if (event.code !== 'Space') return;
    releaseSpace();
  }
  listenToWindow();
  signal.addEventListener('abort', () => windowEvents?.abort());

  function scale() { return base && box ? base.width / box.width : 1; }
  function updateControls() {
    const currentScale = scale();
    const zoomed = Math.abs(currentScale - 1) > zoomEpsilon;
    amount.textContent = zoomed ? `${Math.round(currentScale * 100)}%` : 'Fit';
    amount.title = zoomed ? `${Math.round(currentScale * 100)}% of fitted size` : 'Diagram fitted to the available space';
    amount.setAttribute('aria-label', amount.title);
    const panHint = touch ? 'Pinch to zoom · Drag to pan' : 'Space + drag to pan · Scroll to zoom';
    hint.textContent = guidance && (preferGuidance || currentScale <= 1 + zoomEpsilon) ? guidance : panHint;
    hint.title = hint.textContent;
    hint.hidden = !svg || !guidance && !touch && currentScale <= 1 + zoomEpsilon;
    const focused = [out, fit, inside].find((button) => button === document.activeElement);
    out.disabled = !svg || currentScale <= minZoom + zoomEpsilon;
    inside.disabled = !svg || currentScale >= maxZoom - zoomEpsilon;
    fit.disabled = !svg || !zoomed;
    // A button disabled by its own press would drop keyboard focus to the page.
    if (focused?.disabled) ([focused === out ? inside : out, fit, inside].find((button) => !button.disabled) ?? stage).focus({ preventScroll: true });
    // Reserve gestures from the first contact: changing touch-action mid-pinch is too late.
    if (svg) svg.style.touchAction = 'none';
    stage.classList.toggle('zf-pan-ready', spaceHeld && zoomed);
  }
  function setBox(next: Box) {
    if (!base || !svg) return;
    box = clamp(base, next);
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    updateControls();
    svg.dispatchEvent(new Event('zf-viewportchange'));
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
  /** Frame targets with minimal movement; keep the current zoom whenever they fit. */
  function reveal(targets: readonly SVGGraphicsElement[]) {
    if (!svg || !base || !box || !targets.length || !stage.clientWidth || !stage.clientHeight) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    const bounds = targets.map((target) => target.getBoundingClientRect());
    const start = new DOMPoint(Math.min(...bounds.map((b) => b.left)),
      Math.min(...bounds.map((b) => b.top))).matrixTransform(inverse);
    const end = new DOMPoint(Math.max(...bounds.map((b) => b.right)),
      Math.max(...bounds.map((b) => b.bottom))).matrixTransform(inverse);
    // The visible canvas includes letterboxing around a wide or tall viewBox.
    // Frame against that actual viewport so keyboard navigation does not undo
    // the user's zoom just to fit a shape inside the nominal viewBox height.
    const viewport = svg.getBoundingClientRect();
    const availableWidth = Math.max(1, viewport.width - 32) / Math.abs(matrix.a);
    const availableHeight = Math.max(1, viewport.height - 32) / Math.abs(matrix.d);
    const { x, y, width, height } = frame(base, box,
      { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y },
      { width: availableWidth, height: availableHeight }, minZoom);
    // Ignore subpixel measurement noise (notably SVG bounds in Firefox).
    if (Math.max(Math.abs(x - box.x), Math.abs(width - box.width)) * Math.abs(matrix.a) > 0.25 ||
      Math.abs(y - box.y) * Math.abs(matrix.d) > 0.25) setBox({ x, y, width, height });
  }
  function focusTargets() {
    return [...stage.querySelectorAll<SVGGraphicsElement>('a[tabindex], [data-shape-id][tabindex]')]
      .filter((node) => node.localName === 'a' || !node.closest('a'));
  }
  function resetFocus() {
    const targets = focusTargets();
    const focused = targets.find((node) => node === document.activeElement);
    stage.tabIndex = focused ? -1 : 0;
    stage.setAttribute('aria-description', (targets.length
      ? 'Use arrow keys to move between shapes. Enter activates a shape. Plus and minus zoom; 0 fits the diagram. While zoomed, Shift plus arrow keys pan.'
      : 'Plus and minus zoom; 0 fits the diagram. While zoomed, arrow keys pan.') + ' Tab leaves the diagram.');
    for (const node of targets) node.setAttribute('tabindex', node === focused ? '0' : '-1');
  }
  stage.addEventListener('focusin', (event) => {
    const targets = focusTargets();
    const target = targets.find((node) => node === event.target || node.contains(event.target as Node));
    stage.tabIndex = target ? -1 : 0;
    for (const node of targets) node.setAttribute('tabindex', node === target ? '0' : '-1');
    // A click already shows what it pressed; only keyboard focus moves the view.
    if (target && performance.now() - pointerAt > 500) reveal([target]);
  }, { signal });
  for (const type of ['pointerdown', 'pointerup']) stage.addEventListener(type, () => { pointerAt = performance.now(); }, { capture: true, signal });
  const panStep = 64;
  stage.addEventListener('keydown', (event) => {
    // Leave modified keys to the browser (page zoom, history) and the host app.
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    // Mirror the zoom buttons. `+` needs Shift on many layouts, so accept it with Shift.
    const zoomKey = ({ '+': 'in', '=': 'in', '-': 'out', '_': 'out', '0': 'fit' } as Record<string, string>)[event.key];
    if (zoomKey) {
      if (!svg || !base) return;
      event.preventDefault();
      event.stopPropagation();
      if (zoomKey === 'fit') { setBox({ ...base }); return; }
      // Keep a focused shape in place; otherwise zoom about the view's center like the buttons.
      const focused = focusTargets().find((node) => node === document.activeElement)?.getBoundingClientRect();
      zoom(zoomKey === 'in' ? 1.5 : 1 / 1.5, focused && (focused.left + focused.right) / 2, focused && (focused.top + focused.bottom) / 2);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const targets = focusTargets();
    // Shift+Arrow always pans a zoomed view. Plain arrows pan from the stage itself only
    // when there is no shape to move to; otherwise they enter and move between shapes.
    if (event.key.startsWith('Arrow') && (event.shiftKey || event.target === stage && !targets.length)) {
      if (!svg || Math.abs(scale() - 1) <= zoomEpsilon) return;
      event.preventDefault();
      event.stopPropagation();
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 1 : -1;
      pan(horizontal ? sign * panStep : 0, horizontal ? 0 : sign * panStep);
      return;
    }
    if (event.shiftKey || !targets.length) return;
    event.preventDefault();
    event.stopPropagation();
    const active = targets.find((node) => node === document.activeElement);
    let next = event.key === 'End' ? targets.at(-1) : targets[0];
    if (active && event.key.startsWith('Arrow')) {
      const origin = active.getBoundingClientRect();
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const candidates = targets.filter((node) => node !== active).map((node) => {
        const bounds = node.getBoundingClientRect();
        const dx = (bounds.left + bounds.right - origin.left - origin.right) / 2;
        const dy = (bounds.top + bounds.bottom - origin.top - origin.bottom) / 2;
        const forward = (horizontal ? dx : dy) * sign;
        const across = Math.abs(horizontal ? dy : dx);
        return { node, forward, score: Math.hypot(dx, dy) + across * 2 };
      }).filter((item) => item.forward > 1).sort((a, b) => a.score - b.score);
      next = candidates[0]?.node ?? active;
    }
    if (next) { reveal([next]); next.focus({ preventScroll: true }); }
  }, { signal });
  const resize = new ResizeObserver(() => svg?.dispatchEvent(new Event('zf-viewportchange')));
  resize.observe(stage);
  signal.addEventListener('abort', () => resize.disconnect());
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
    resetFocus();
    svg?.dispatchEvent(new Event('zf-viewportchange'));
  }
  stage.addEventListener('zf-boardchange', reset, { signal });
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
    // Always claim a pinch, even at a zoom limit, so it never zooms the page instead.
    if (event.ctrlKey) event.preventDefault();
    // Compare relatively: a clamped scale can differ from the limit by rounding.
    if (Math.abs(Math.max(minZoom, Math.min(maxZoom, scale() * factor)) / scale() - 1) < 1e-9) return;
    event.preventDefault();
    zoom(factor, event.clientX, event.clientY);
  }, { passive: false, signal });
  stage.addEventListener('pointerdown', (event) => {
    const forcePan = event.pointerType === 'mouse' && Math.abs(scale() - 1) > zoomEpsilon && (spaceHeld || event.button === 1);
    if (!svg || !(event.target instanceof Element) || !svg.contains(event.target) ||
      (event.pointerType === 'mouse' && !forcePan && (event.button !== 0 || event.target.closest('a, [data-shape-id]')))) return;
    if (!pointers.size) { moved = false; panGesture = forcePan; }
    if (forcePan) event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    stage.setPointerCapture(event.pointerId);
  }, { signal });
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
  }, { signal });
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
  stage.addEventListener('pointerup', finish, { signal });
  stage.addEventListener('pointercancel', finish, { signal });
  stage.addEventListener('click', (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, { capture: true, signal });
  /** Release page-level listeners and controls; Viewer.destroy() triggers this through `zf-destroy`. */
  function destroy() {
    teardown.abort();
    controls.remove();
    hint.remove();
    stage.classList.remove('zf-pan-ready', 'zf-panning');
  }
  stage.addEventListener('zf-destroy', destroy, { signal });
  /** Release page-level listeners while the viewport is hidden; Viewer.suspend() and resume() forward here. */
  function suspend() { windowEvents?.abort(); windowEvents = undefined; releaseSpace(); hovered = false; }
  stage.addEventListener('zf-suspend', suspend, { signal });
  stage.addEventListener('zf-resume', listenToWindow, { signal });
  return {
    reveal,
    destroy,
    suspend,
    resume: listenToWindow,
    setGuidance(text: string, priority = false) { guidance = text; preferGuidance = priority; updateControls(); },
    refresh() { if (activeKey) reset(); },
    checkpoint(key: string) {
      remember();
      const saved = [...views].filter(([id]) => id.startsWith(`${key}\n`));
      return () => {
        if (documentKey === key) activeKey = undefined;
        for (const [id, view] of saved) views.set(id, view);
      };
    },
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
