import { clampBox, revealBox, type Box } from './viewport-geometry';
import { setupMinimap } from './minimap';
export { clampBox, revealBox, type Box } from './viewport-geometry';

/** Zoom the rendered SVG itself so links and shape selection keep working. */
export function setupViewport(stage: HTMLElement, host: HTMLElement) {
  const viewport = createViewport(stage, host, clampBox, revealBox);
  setupMinimap(stage, viewport);
  return viewport;
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
  fit.append('Overview');
  fit.title = 'Overview: show every shape at a comfortable reading size (0)';
  fit.className = 'zf-fit';
  fit.setAttribute('aria-label', 'Overview (fit diagram)');
  const inside = document.createElement('button');
  inside.type = 'button';
  inside.textContent = '+';
  inside.title = 'Zoom in';
  inside.setAttribute('aria-label', 'Zoom in');
  controls.append(out, amount, fit, inside);
  const hint = document.createElement('div');
  hint.className = 'zf-pan-hint';
  hint.textContent = touch ? 'Pinch to zoom · Drag to pan' : '⌘/Ctrl + drag to pan · Space + drag while zoomed · Scroll to zoom';
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
  let boardBounds: Box | null = null;
  type View = { scale: number; centerX: number; centerY: number };
  const views = new Map<string, View>();
  let documentKey = '';
  let activeKey: string | undefined;
  let presentingView = false;
  let preserveOnRender = false;
  let editAnchor: { key: string; shape: string; board?: string; x: number; y: number; pixels: number } | undefined;
  // Capture just before replacement, after any asynchronous render finishes. A pending edit never
  // overrides a pan or navigation that happened while it was compiling.
  stage.addEventListener('zf-beforerender', event => {
    preserveOnRender = Boolean((event as CustomEvent).detail?.animate);
    editAnchor = undefined;
    if (!activeKey || !svg) return;
    const focused = document.activeElement;
    const shape = focused instanceof Element && stage.contains(focused)
      ? focused.closest<SVGElement>('[data-shape-id]') ?? (focused.localName === 'a' ? focused.querySelector<SVGElement>('[data-shape-id]') : null)
      : stage.querySelector<SVGElement>('.zf-canvas-selected, .zf-source-selected');
    const matrix = svg.getScreenCTM();
    if (!shape?.dataset.shapeId || !matrix?.a) return;
    const bounds = shape.getBoundingClientRect();
    editAnchor = { key: activeKey, shape: shape.dataset.shapeId, board: shape.dataset.shapeBoard,
      x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, pixels: Math.abs(matrix.a) };
  }, { signal });
  function remember() {
    if (presentingView) return;
    if (activeKey && base && box) views.set(activeKey, { scale: scale(),
      centerX: (box.x + box.width / 2 - base.x) / base.width,
      centerY: (box.y + box.height / 2 - base.y) / base.height });
  }
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let moved = false;
  let suppressClick = false;
  let panGesture = false;
  let modifierPan = false;
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
    // A keyboard action can refocus the canvas within 500 ms of a pointer press.
    // Capture before rename fields or dialogs handle the key and restore focus.
    window.addEventListener('keydown', () => { pointerAt = -Infinity; }, { ...options, capture: true });
    window.addEventListener('keydown', onKeyDown, options);
    window.addEventListener('keyup', onKeyUp, options);
    window.addEventListener('blur', releaseSpace, options);
  }
  function releaseSpace() { spaceHeld = false; stage.classList.remove('zf-pan-ready'); }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.target instanceof Element &&
      event.target.closest('button, [role="button"], input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
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
  function updateGrid() {
    // Navigation's CSS camera is temporary; retain the board's final grid scale.
    if (stage.dataset.transition) return;
    const matrix = svg?.getScreenCTM();
    stage.toggleAttribute('data-canvas-grid', Boolean(matrix));
    if (!matrix) return;
    // Keep the grid outside the SVG: downloaded images retain their original background.
    // CSS tiles use the stage's padding box, whereas the SVG matrix uses screen coordinates.
    const bounds = stage.getBoundingClientRect();
    const spacing = 24 * Math.abs(matrix.a);
    stage.style.setProperty('--zf-grid-size', `${spacing}px`);
    stage.style.setProperty('--zf-grid-radius', `${0.7 * Math.abs(matrix.a)}px`);
    stage.style.setProperty('--zf-grid-x', `${matrix.e - bounds.left - stage.clientLeft - spacing / 2}px`);
    stage.style.setProperty('--zf-grid-y', `${matrix.f - bounds.top - stage.clientTop - spacing / 2}px`);
  }
  stage.addEventListener('zf-viewportchange', updateGrid, { capture: true, signal });
  function updateControls() {
    updateGrid();
    const currentScale = scale();
    const zoomed = Math.abs(currentScale - 1) > zoomEpsilon;
    const offset = Boolean(base && box && (Math.abs(box.x - base.x) > zoomEpsilon || Math.abs(box.y - base.y) > zoomEpsilon));
    amount.textContent = zoomed || offset ? `${Math.round(currentScale * 100)}%` : 'Fitted';
    amount.title = zoomed || offset ? `${Math.round(currentScale * 100)}% of fitted size` : 'Current zoom: fitted. Overview returns to this view.';
    amount.setAttribute('aria-label', amount.title);
    const panHint = touch ? 'Pinch to zoom · Drag to pan' : '⌘/Ctrl + drag to pan · Space + drag while zoomed · Scroll to zoom';
    hint.textContent = guidance && (preferGuidance || touch || currentScale <= 1 + zoomEpsilon) ? guidance : panHint;
    hint.title = hint.textContent;
    hint.hidden = !svg || !guidance && !touch && currentScale <= 1 + zoomEpsilon;
    const focused = [out, fit, inside].find((button) => button === document.activeElement);
    out.disabled = !svg || currentScale <= minZoom + zoomEpsilon;
    inside.disabled = !svg || currentScale >= maxZoom - zoomEpsilon;
    fit.disabled = !svg || !zoomed && !offset;
    // A button disabled by its own press would drop keyboard focus to the page.
    if (focused?.disabled) ([focused === out ? inside : out, fit, inside].find((button) => !button.disabled) ?? stage).focus({ preventScroll: true });
    // Reserve gestures from the first contact: changing touch-action mid-pinch is too late.
    if (svg) svg.style.touchAction = 'none';
    stage.classList.toggle('zf-pan-ready', spaceHeld && zoomed);
  }
  function setBox(next: Box, constrain = true) {
    if (!base || !svg) return;
    box = constrain ? clamp(base, next) : next;
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
    setBox({ ...box, x: box.x - dx / matrix.a, y: box.y - dy / matrix.d }, !modifierPan);
  }
  /** Frame targets with minimal movement; keep the current zoom whenever they fit. */
  function reveal(targets: readonly SVGGraphicsElement[], animated = false) {
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
      Math.abs(y - box.y) * Math.abs(matrix.d) > 0.25) {
      if (animated) animateBox(clamp(base, { x, y, width, height }));
      else setBox({ x, y, width, height });
    }
  }
  function focusTargets() {
    return [...stage.querySelectorAll<SVGGraphicsElement>('a[tabindex], [data-shape-id][tabindex], [data-flow-connection][tabindex]')]
      .filter((node) => node.localName === 'a' || !node.closest('a'));
  }
  let cameraFrame = 0;
  let cameraRevision = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const stopCamera = () => { ++cameraRevision; cancelAnimationFrame(cameraFrame); };
  for (const type of ['pointerdown', 'wheel', 'keydown', 'zf-beforerender', 'zf-walkthroughend', 'zf-destroy']) stage.addEventListener(type, stopCamera, { signal });
  reducedMotion.addEventListener('change', stopCamera, { signal });
  function animateBox(next: Box) {
    if (!box) return;
    stopCamera();
    const revision = cameraRevision;
    const previous = { ...box };
    if (reducedMotion.matches) { setBox(next, false); return; }
    const start = performance.now();
    const move = (time: number) => {
      if (revision !== cameraRevision) return;
      const progress = Math.min(1, (time - start) / 280);
      const ease = 1 - (1 - progress) ** 3;
      setBox({ x: previous.x + (next.x - previous.x) * ease, y: previous.y + (next.y - previous.y) * ease,
        width: previous.width + (next.width - previous.width) * ease, height: previous.height + (next.height - previous.height) * ease }, false);
      if (progress < 1) cameraFrame = requestAnimationFrame(move);
    };
    cameraFrame = requestAnimationFrame(move);
  }
  stage.addEventListener('zf-presentationchange', event => {
    stopCamera();
    if ((event as CustomEvent).detail.active) { remember(); presentingView = true; }
    else {
      presentingView = false;
      const previous = activeKey ? views.get(activeKey) : undefined;
      const target = svg;
      requestAnimationFrame(() => {
        if (presentingView || !svg || svg !== target || !base) return;
        base = fittedBox(svg, base);
        const width = base.width / (previous?.scale ?? 1), height = base.height / (previous?.scale ?? 1);
        setBox(previous ? { x: base.x + previous.centerX * base.width - width / 2,
          y: base.y + previous.centerY * base.height - height / 2, width, height } : { ...base }, false);
      });
    }
  }, { signal });
  type WalkthroughStep = { shape: string; board: string; neighbors?: string[]; presenting?: boolean };
  let presentationStep: WalkthroughStep | undefined;
  stage.addEventListener('zf-walkthroughstep', event => {
    const detail = (event as CustomEvent<WalkthroughStep>).detail;
    const { shape, board, neighbors = [], presenting } = detail;
    presentationStep = presenting ? detail : undefined;
    if (!presenting && cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = 0; }
    stopCamera();
    const revision = cameraRevision;
    cameraFrame = requestAnimationFrame(() => {
      if (!stage.dataset.walkthrough || revision !== cameraRevision) return;
      const shapes = [...stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].filter(node => !node.dataset.shapeBoard || node.dataset.shapeBoard === board);
      const target = shapes.find(node => node.dataset.shapeId === shape);
      if (!target) return;
      if (!presenting || !svg || !box || !base) { reveal([target], true); return; }
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const inverse = matrix.inverse();
      const bounds = shapes.filter(node => node === target || neighbors.includes(node.dataset.shapeId!)).map(node => node.getBoundingClientRect());
      const from = new DOMPoint(Math.min(...bounds.map(b => b.left)), Math.min(...bounds.map(b => b.top))).matrixTransform(inverse);
      const to = new DOMPoint(Math.max(...bounds.map(b => b.right)), Math.max(...bounds.map(b => b.bottom))).matrixTransform(inverse);
      const current = target.getBoundingClientRect();
      const center = new DOMPoint(current.x + current.width / 2, current.y + current.height / 2).matrixTransform(inverse);
      // Keep the current shape in the middle third, fitting every outgoing destination.
      // Reserve symmetric space for the title and card so neither covers the path.
      const area = stage.parentElement!;
      const inset = Math.max(area.querySelector('.zf-walkthrough')?.getBoundingClientRect().height ?? 0,
        area.querySelector('.zf-present-title')?.getBoundingClientRect().height ?? 0) + 24;
      const availableWidth = Math.max(1, stage.clientWidth - 48);
      const availableHeight = Math.max(1, stage.clientHeight - 2 * inset);
      const width = Math.max(to.x - from.x, 1.51 * Math.max(center.x - from.x, to.x - center.x)) + 32;
      const height = 2 * Math.max(center.y - from.y, to.y - center.y) + 32;
      const pixels = Math.min(1.75, availableWidth / width, availableHeight / height);
      const w = stage.clientWidth / pixels, h = stage.clientHeight / pixels;
      // Allow a small horizontal shift towards the destinations to keep phone labels larger.
      const cameraX = Math.max(center.x - w / 6.1, Math.min(center.x + w / 6.1, (from.x + to.x) / 2));
      const next = { x: cameraX - w / 2, y: center.y - h / 2, width: w, height: h };
      animateBox(next);
    });
  }, { signal });
  function resetFocus() {
    const targets = focusTargets();
    const focused = targets.find((node) => node === document.activeElement);
    stage.tabIndex = focused ? -1 : 0;
    stage.setAttribute('aria-description', (targets.length
      ? `Use arrow keys to move between shapes${stage.querySelector('[data-flow-connection]') ? ' and connections' : ''}. Enter activates a shape. Plus and minus zoom; 0 fits the diagram. While zoomed, Shift plus arrow keys pan.`
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
  let refitAfterArrival = false;
  function refit() {
    // Font loading and ResizeObserver can settle during arrival. Fit the final
    // shapes after that paint is removed, preserving the user's zoom and center.
    if (stage.dataset.arrivalMotion) { refitAfterArrival = true; return; }
    // Refit the baseline as the available space changes, retaining the chosen magnification
    // and position. Otherwise desktop padding shrinks the content to tiny text on a phone.
    if (presentingView && presentationStep) {
      stage.dispatchEvent(new CustomEvent('zf-walkthroughstep', { detail: presentationStep }));
    } else if (svg && base && box && stage.clientWidth && stage.clientHeight) {
      const next = fittedBox(svg, base);
      const magnification = scale();
      const centerX = (box.x + box.width / 2 - base.x) / base.width;
      const centerY = (box.y + box.height / 2 - base.y) / base.height;
      base = next;
      const width = base.width / magnification;
      const height = base.height / magnification;
      setBox({ x: base.x + base.width * centerX - width / 2,
        y: base.y + base.height * centerY - height / 2, width, height }, false);
    }
    svg?.dispatchEvent(new Event('zf-viewportchange'));
  }
  stage.addEventListener('zf-arrivalend', () => {
    if (refitAfterArrival) { refitAfterArrival = false; refit(); }
  }, { signal });
  const resize = new ResizeObserver(refit);
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
      const graphic = child.localName === 'a' ? child.querySelector(':scope > g:not(.appendix-icon, .zf-depth-stack)') ?? child : child;
      // Firefox includes invisible, non-scaling hit strokes in a connection's bounds.
      // Measure its visible children so adding editing targets cannot change the fit.
      const graphics = child.hasAttribute('data-connection-id') ? [...child.children].filter(node =>
        node instanceof SVGGraphicsElement && !node.classList.contains('zf-connection-hit')) : [graphic];
      for (const node of graphics) {
        const bounds = node.getBoundingClientRect();
        if (!bounds.width && !bounds.height) continue;
        for (const [x, y] of [[bounds.left, bounds.top], [bounds.right, bounds.bottom]]) {
          const point = new DOMPoint(x, y).matrixTransform(inverse);
          left = Math.min(left, point.x);
          top = Math.min(top, point.y);
          right = Math.max(right, point.x);
          bottom = Math.max(bottom, point.y);
        }
      }
    }
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return fallback;
    let margin = Math.max(16, Math.min(32, Math.min(right - left, bottom - top) * 0.12));
    if (touch && stage.clientWidth < 600 && !stage.dataset.layerRoot) {
      const text = element.querySelector('text');
      const fontSize = text && parseFloat(getComputedStyle(text).fontSize);
      if (fontSize) {
        // Spend optional padding before clipping a flow that can fit at 11 px.
        // Retain a stroke's clearance, plus a small tolerance for SVG matrix rounding.
        const readableMargin = Math.min((stage.clientWidth * fontSize / 11.01 - (right - left)) / 2,
          (stage.clientHeight * fontSize / 11.01 - (bottom - top)) / 2);
        if (readableMargin >= 1) margin = Math.min(margin, readableMargin);
      }
    }
    const width = right - left + margin * 2;
    const height = bottom - top + margin * 2;
    boardBounds = { x: left - margin, y: top - margin, width, height };
    // Fit every shape with breathing room, magnifying small diagrams by at most 1.5×.
    const padding = Math.max(1, Math.min(stage.clientWidth / width, stage.clientHeight / height) / 1.5);
    return { x: (left + right - width * padding) / 2, y: (top + bottom - height * padding) / 2,
      width: width * padding, height: height * padding };
  }
  function reset() {
    const preserveView = preserveOnRender;
    preserveOnRender = false;
    remember();
    activeKey = `${documentKey}\n${stage.dataset.layerRoot ? `layers:${stage.dataset.layerRoot}` : stage.dataset.board ?? 'root'}`;
    const previous = views.get(activeKey);
    svg = stage.querySelector<SVGSVGElement>(':scope > svg');
    const values = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const original = values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
      ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null;
    boardBounds = original;
    base = svg && original ? fittedBox(svg, original) : null;
    box = base && { ...base };
    if (svg && base) {
      if (previous) {
        const width = base.width / previous.scale;
        const height = base.height / previous.scale;
        setBox({ x: base.x + base.width * previous.centerX - width / 2,
          y: base.y + base.height * previous.centerY - height / 2, width, height }, false);
      } else {
        svg.setAttribute('viewBox', `${base.x} ${base.y} ${base.width} ${base.height}`);
        // On a phone, keep the whole diagram unless fitted labels fall below 11 px.
        // When they do, aim for 14 px; Overview still returns to the whole diagram.
        if (touch && stage.clientWidth < 600 && !stage.dataset.layerRoot) {
          const text = svg.querySelector('text');
          const pixels = text && parseFloat(getComputedStyle(text).fontSize) * Math.abs(text.getScreenCTM()?.a ?? 1);
          if (pixels && pixels < 11) {
            const factor = Math.min(2.5, 14 / pixels);
            setBox({ x: base.x, y: base.y + base.height * (1 - 1 / factor) / 2,
              width: base.width / factor, height: base.height / factor });
          }
        }
      }
      if (editAnchor?.key === activeKey) {
        const anchor = editAnchor;
        const shape = [...svg.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')]
          .find(node => node.dataset.shapeId === anchor.shape && node.dataset.shapeBoard === anchor.board);
        if (shape) {
          const factor = Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height) / anchor.pixels;
          const width = base.width * factor;
          const height = base.height * factor;
          setBox({ x: box!.x + (box!.width - width) / 2, y: box!.y + (box!.height - height) / 2, width, height }, false);
          const bounds = shape.getBoundingClientRect();
          setBox({ ...box!, x: box!.x + (bounds.left + bounds.width / 2 - anchor.x) / anchor.pixels,
            y: box!.y + (bounds.top + bounds.height / 2 - anchor.y) / anchor.pixels }, false);
        }
      }
    }
    editAnchor = undefined;
    pointers.clear();
    moved = panGesture = modifierPan = false;
    stage.classList.remove('zf-panning');
    updateControls();
    resetFocus();
    svg?.dispatchEvent(new Event('zf-viewportchange'));
    // Text-only shapes (notably Markdown) change bounds when embedded fonts replace fallback
    // glyphs. Refit only for pending faces; an edit's anchored view must stay untouched.
    const rendered = svg;
    if (rendered && document.fonts && !preserveView) {
      const fonts = new Map<string, string>();
      for (const text of rendered.querySelectorAll('text')) {
        const style = getComputedStyle(text);
        const face = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        fonts.set(face, (fonts.get(face) ?? '') + text.textContent);
      }
      const pending = [...fonts].filter(([face, text]) => !document.fonts.check(face, text));
      if (pending.length) void Promise.allSettled(pending.map(([face, text]) => document.fonts.load(face, text))).then(() => {
        if (!signal.aborted && svg === rendered && rendered.isConnected) refit();
      });
    }
  }
  stage.addEventListener('zf-boardchange', reset, { signal });
  reset();
  out.addEventListener('click', () => { stopCamera(); zoom(1 / 1.5); });
  inside.addEventListener('click', () => { stopCamera(); zoom(1.5); });
  fit.addEventListener('click', () => { stopCamera(); if (base) setBox({ ...base }); });
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
    const modified = event.pointerType === 'mouse' && event.button === 0 && (event.ctrlKey || event.metaKey);
    const forcePan = modified || event.pointerType === 'mouse' && Math.abs(scale() - 1) > zoomEpsilon && (spaceHeld || event.button === 1);
    if (!svg || !(event.target instanceof Element) || !(svg.contains(event.target) || forcePan && event.target === stage) ||
      (event.pointerType === 'mouse' && !forcePan && (event.button !== 0 || event.target.closest('a, [data-shape-id], [data-flow-connection]')))) return;
    if (!pointers.size) { moved = false; panGesture = forcePan; modifierPan = modified; }
    // Claim forced panning before shape editing or native link dragging can begin.
    if (forcePan) { event.preventDefault(); event.stopImmediatePropagation(); }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    // A modifier click still opens a link in another tab; capture only once it becomes a drag.
    if (!modified) stage.setPointerCapture(event.pointerId);
  }, { capture: true, signal });
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
      if (modifierPan && !stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId);
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
      if (moved || panGesture && !modifierPan) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 150);
      }
      panGesture = modifierPan = false;
    }
  }
  stage.addEventListener('pointerup', finish, { signal });
  stage.addEventListener('pointercancel', finish, { signal });
  // The workspace can turn a held touch into a branch move. Release its pending pan before that drag begins.
  stage.addEventListener('zf-cancelgesture', () => {
    for (const id of pointers.keys()) if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
    pointers.clear();
    moved = panGesture = modifierPan = false;
    stage.classList.remove('zf-panning');
  }, { signal });
  // macOS can send a context menu for Ctrl + left-click during the pan gesture.
  stage.addEventListener('contextmenu', (event) => {
    if (!modifierPan && !event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
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
    stage.removeAttribute('data-canvas-grid');
    for (const name of ['size', 'radius', 'x', 'y']) stage.style.removeProperty(`--zf-grid-${name}`);
  }
  stage.addEventListener('zf-destroy', destroy, { signal });
  /** Release page-level listeners while the viewport is hidden; Viewer.suspend() and resume() forward here. */
  function suspend() { windowEvents?.abort(); windowEvents = undefined; releaseSpace(); hovered = false; }
  stage.addEventListener('zf-suspend', suspend, { signal });
  stage.addEventListener('zf-resume', listenToWindow, { signal });
  return {
    mapView() {
      const matrix = svg?.getScreenCTM();
      if (!svg || !boardBounds || !matrix || !matrix.a || !matrix.d) return null;
      const bounds = svg.getBoundingClientRect();
      const inverse = matrix.inverse();
      const start = new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse);
      const end = new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse);
      return { board: { ...boardBounds }, visible: { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y } };
    },
    panTo(x: number, y: number) {
      stopCamera();
      if (box) setBox({ ...box, x: x - box.width / 2, y: y - box.height / 2 });
    },
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
