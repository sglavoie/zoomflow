/** Explicit first-open motion, shared with the serialized offline runtime.
 * Rendering, edits and navigation never request arrival themselves. */
export function setupArrivalMotion(stage: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set<Animation>();
  const elements = new Set<Element>();
  const events = new AbortController();
  function cancel() {
    const active = stage.hasAttribute('data-arrival-motion');
    delete stage.dataset.arrivalMotion;
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const element of elements) element.classList.remove('zf-arrival-shape');
    elements.clear();
    if (active) {
      stage.dispatchEvent(new Event('zf-arrivalend'));
      stage.querySelector(':scope > svg')?.dispatchEvent(new Event('zf-viewportchange'));
    }
  }
  function animate(element: SVGGraphicsElement, frames: Keyframe[], delay: number, duration: number) {
    const animation = element.animate(frames, { delay, duration, fill: 'both', easing: 'cubic-bezier(.2,.75,.25,1)' });
    animations.add(animation);
    void animation.finished.then(() => {
      if (!animations.delete(animation)) return;
      animation.cancel();
      element.classList.remove('zf-arrival-shape');
      elements.delete(element);
      if (!animations.size) cancel();
    }, () => {});
  }
  function arrive() {
    cancel();
    const shapes = [...stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].map(shape => ({
      id: shape.dataset.shapeId!, element: shape,
      box: shape.getBoundingClientRect(),
    })).filter(shape => shape.box.width && shape.box.height);
    if (reduced.matches || !shapes.length || shapes.length > 60) {
      stage.dispatchEvent(new Event('zf-arrivalend'));
      return;
    }
    // Treat shapes whose centers share a row as left-to-right, then read down.
    shapes.sort((a, b) => Math.abs(a.box.y + a.box.height / 2 - b.box.y - b.box.height / 2) < Math.min(a.box.height, b.box.height) / 2
      ? a.box.x - b.box.x : a.box.y - b.box.y);
    const gap = Math.min(40, 260 / Math.max(1, shapes.length - 1));
    const visible = new Map(shapes.map((shape, index) => [shape.id, index * gap + 180]));
    // Apply the viewport's final fit to link cues before hiding or scaling paint.
    stage.querySelector(':scope > svg')?.dispatchEvent(new Event('zf-arrivalstart'));
    stage.dataset.arrivalMotion = 'true';
    for (const [index, { element }] of shapes.entries()) {
      const base = getComputedStyle(element).transform;
      element.classList.add('zf-arrival-shape');
      elements.add(element);
      animate(element, [{ opacity: 0, transform: `${base === 'none' ? '' : base} scale(.96)` },
        { opacity: 1, transform: base }], index * gap, 180);
      // The link's badge and hit area keep their screen geometry during arrival.
      // Only fade its decorative siblings; scale the shape itself.
      for (const decoration of element.closest('a')?.querySelectorAll<SVGGraphicsElement>(':scope > .appendix-icon, :scope > .zf-depth-stack') ?? [])
        animate(decoration, [{ opacity: 0 }, { opacity: 1 }], index * gap, 180);
    }
    for (const edge of stage.querySelectorAll<SVGGraphicsElement>('[data-connection-id]')) {
      const delay = Math.max(visible.get(edge.dataset.connectionFrom!) ?? shapes.length * gap,
        visible.get(edge.dataset.connectionTo!) ?? shapes.length * gap, 180);
      animate(edge, [{ opacity: 0 }, { opacity: 1 }], delay, 160);
      for (const path of edge.querySelectorAll<SVGPathElement>('path.connection')) {
        const length = path.getTotalLength();
        if (length) animate(path, [{ strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }], delay, 160);
      }
    }
  }
  for (const type of ['pointerdown', 'wheel', 'keydown', 'zf-beforerender', 'zf-boardchange', 'zf-sourcechange', 'zf-suspend', 'zf-destroy'])
    stage.addEventListener(type, cancel, { capture: true, signal: events.signal });
  // Zoom controls sit beside the stage. Restore geometry before they handle input.
  for (const type of ['pointerdown', 'wheel', 'keydown'])
    stage.parentElement?.addEventListener(type, cancel, { capture: true, signal: events.signal });
  reduced.addEventListener('change', cancel);
  stage.addEventListener('zf-destroy', () => { events.abort(); reduced.removeEventListener('change', cancel); }, { once: true });
  return { arrive };
}
