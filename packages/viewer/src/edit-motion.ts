/** Follow stable shape identities across a recompile. All motion is interruptible and
 * uses the final viewport, so it never changes the user's zoom or delays an edit. */
export function setupEditMotion(stage: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set<Animation>();
  let frame = 0;
  let snapshot: { board: string | undefined; shapes: Map<string, DOMRect> } | undefined;
  const shapes = () => [...stage.querySelectorAll<SVGGraphicsElement>('[data-shape-id]')].map(shape => ({
    key: JSON.stringify([shape.dataset.shapeBoard, shape.dataset.shapeId]),
    element: (shape.closest('a') ?? shape) as SVGGraphicsElement,
  }));
  function cancel() {
    cancelAnimationFrame(frame);
    for (const animation of animations) animation.cancel();
    animations.clear();
    snapshot = undefined;
    delete stage.dataset.editMotion;
  }
  function animate(element: SVGGraphicsElement, frames: Keyframe[]) {
    const animation = element.animate(frames, { duration: 210, easing: 'cubic-bezier(.2,.75,.25,1)' });
    animations.add(animation);
    void animation.finished.catch(() => {}).finally(() => {
      animations.delete(animation);
      if (!animations.size) delete stage.dataset.editMotion;
    });
  }
  stage.addEventListener('zf-beforerender', event => {
    cancel();
    if (reduced.matches || !(event as CustomEvent).detail?.animate) return;
    const elements = shapes();
    if (elements.length > 150) return;
    snapshot = { board: stage.dataset.board, shapes: new Map(elements.map(({ key, element }) => [key, element.getBoundingClientRect()])) };
  });
  stage.addEventListener('zf-boardchange', () => {
    const before = snapshot;
    snapshot = undefined;
    if (!before || before.board !== stage.dataset.board || reduced.matches) { cancel(); return; }
    frame = requestAnimationFrame(() => {
      if (reduced.matches) return;
      for (const { key, element } of shapes()) {
        const old = before.shapes.get(key);
        if (!old) { animate(element, [{ opacity: 0 }, { opacity: 1 }]); continue; }
        const box = element.getBoundingClientRect();
        const matrix = element.parentElement && (element.parentElement as unknown as SVGGraphicsElement).getScreenCTM?.();
        if (!matrix?.a || !matrix.d || !box.width || !old.width) continue;
        const dx = old.x + old.width / 2 - box.x - box.width / 2;
        const dy = old.y + old.height / 2 - box.y - box.height / 2;
        if (Math.abs(dx) + Math.abs(dy) < 1) continue;
        const base = getComputedStyle(element).transform;
        animate(element, [{ transform: `translate(${dx / matrix.a}px, ${dy / matrix.d}px) ${base === 'none' ? '' : base}` }, { transform: base }]);
      }
      for (const edge of stage.querySelectorAll<SVGGraphicsElement>('[data-connection-id]')) animate(edge, [{ opacity: 0.25 }, { opacity: 1 }]);
      if (animations.size) stage.dataset.editMotion = 'true';
    });
  });
  for (const type of ['pointerdown', 'wheel', 'keydown', 'zf-sourcechange', 'zf-suspend', 'zf-destroy']) stage.addEventListener(type, cancel, { capture: true });
  reduced.addEventListener('change', cancel);
  stage.addEventListener('zf-destroy', () => reduced.removeEventListener('change', cancel), { once: true });
}
