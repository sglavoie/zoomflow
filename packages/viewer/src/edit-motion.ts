/** Follow stable shape identities across a recompile. All motion is interruptible and
 * uses the final viewport, so it never changes the user's zoom or delays an edit. */
export function setupEditMotion(stage: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<Animation, () => void>();
  const events = new AbortController();
  let frame = 0;
  type ShapeSnapshot = { box: DOMRect; fill: string; image: string; stroke: string; strokeWidth: number; radius: number };
  let snapshot: { board: string | undefined; shapes: Map<string, ShapeSnapshot> } | undefined;
  const shapes = () => [...stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].map(shape => ({
    key: JSON.stringify([shape.dataset.shapeBoard, shape.dataset.shapeId]),
    shape, element: (shape.closest('a') ?? shape) as SVGGraphicsElement,
  }));
  function cancel() {
    cancelAnimationFrame(frame);
    for (const [animation, cleanup] of animations) { animation.cancel(); cleanup(); }
    animations.clear();
    snapshot = undefined;
    delete stage.dataset.editMotion;
  }
  function animate(element: Element, frames: Keyframe[], duration = 210, cleanup = () => {}) {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    animations.set(animation, cleanup);
    void animation.finished.then(() => {
      if (!animations.delete(animation)) return;
      animation.cancel(); cleanup();
      if (!animations.size) delete stage.dataset.editMotion;
    }, () => {});
  }
  function capture(shape: SVGGraphicsElement): ShapeSnapshot {
    const surface = shape.querySelector<SVGGraphicsElement>('.shape rect, .shape ellipse, .shape circle, .shape polygon, .shape path, rect, ellipse, circle, polygon, path') ?? shape;
    const style = getComputedStyle(surface);
    // Resolve the viewer's two-stop lighting while its SVG paint server still exists.
    const id = /#(zf-lit-[\w-]+)/.exec(style.fill)?.[1];
    const gradient = id && [...stage.querySelectorAll('linearGradient')].find(node => node.id === id);
    const stops = gradient ? [...gradient.querySelectorAll('stop')].map(stop => getComputedStyle(stop).stopColor) : [];
    const matrix = surface.getScreenCTM();
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
    const box = shape.getBoundingClientRect();
    const radius = Number.parseFloat(style.getPropertyValue('rx') || style.borderTopLeftRadius) || 0;
    return { box, fill: stops[0] ?? (style.fill === 'none' ? 'transparent' : style.fill),
      image: stops.length === 2 ? `linear-gradient(${stops.join(', ')})` : '',
      stroke: style.stroke === 'none' ? 'transparent' : style.stroke,
      strokeWidth: (Number.parseFloat(style.strokeWidth) || 0) * scale,
      radius: Math.min(radius * scale, box.width / 2, box.height / 2, surface.localName === 'rect' ? Infinity : 24) };
  }
  function collapse(old: ShapeSnapshot) {
    if (!old.box.width || !old.box.height) return;
    const bounds = stage.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'zf-edit-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box',
      left: `${old.box.left - bounds.left - stage.clientLeft}px`, top: `${old.box.top - bounds.top - stage.clientTop}px`,
      width: `${old.box.width}px`, height: `${old.box.height}px`, backgroundColor: old.fill, backgroundImage: old.image,
      border: `${old.strokeWidth}px solid ${old.stroke}`, borderRadius: `${old.radius}px`, transformOrigin: 'center' });
    stage.append(ghost);
    animate(ghost, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.1)', opacity: 0 }], 200, () => ghost.remove());
  }
  stage.addEventListener('zf-beforerender', event => {
    cancel();
    if (reduced.matches || !(event as CustomEvent).detail?.animate) return;
    const elements = shapes();
    if (elements.length > 150) return;
    snapshot = { board: stage.dataset.board, shapes: new Map(elements.map(({ key, shape }) => [key, capture(shape)])) };
  }, { signal: events.signal });
  stage.addEventListener('zf-boardchange', () => {
    const before = snapshot;
    snapshot = undefined;
    if (!before || before.board !== stage.dataset.board || reduced.matches) { cancel(); return; }
    frame = requestAnimationFrame(() => {
      const elements = shapes();
      if (reduced.matches || elements.length > 150) return;
      for (const { key, shape, element } of elements) {
        const old = before.shapes.get(key)?.box;
        if (!old) {
          const base = getComputedStyle(shape).transform;
          shape.classList.add('zf-edit-enter');
          animate(shape, [{ opacity: 0, transform: `${base === 'none' ? '' : base} scale(.9)` }, { opacity: 1, transform: base }],
            220, () => shape.classList.remove('zf-edit-enter'));
          continue;
        }
        const box = shape.getBoundingClientRect();
        const matrix = element.parentElement && (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM?.();
        if (!matrix?.a || !matrix.d || !box.width || !old.width) continue;
        const dx = old.x + old.width / 2 - box.x - box.width / 2;
        const dy = old.y + old.height / 2 - box.y - box.height / 2;
        if (Math.abs(dx) + Math.abs(dy) < 1) continue;
        const base = getComputedStyle(element).transform;
        animate(element, [{ transform: `translate(${dx / matrix.a}px, ${dy / matrix.d}px) ${base === 'none' ? '' : base}` }, { transform: base }]);
      }
      const remaining = new Set(elements.map(({ key }) => key));
      for (const [key, old] of before.shapes) if (!remaining.has(key)) collapse(old);
      for (const edge of stage.querySelectorAll<SVGGraphicsElement>('[data-connection-id]')) animate(edge, [{ opacity: 0.25 }, { opacity: 1 }]);
      if (animations.size) stage.dataset.editMotion = 'true';
    });
  }, { signal: events.signal });
  for (const type of ['pointerdown', 'wheel', 'keydown', 'zf-sourcechange', 'zf-suspend', 'zf-destroy']) stage.addEventListener(type, cancel, { capture: true, signal: events.signal });
  reduced.addEventListener('change', cancel);
  stage.addEventListener('zf-destroy', () => { events.abort(); reduced.removeEventListener('change', cancel); }, { once: true });
}
