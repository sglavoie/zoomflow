/** Self-contained so live diagrams and offline exports share the same spatial navigation. */
export function setupBoardMotion(stage: HTMLElement) {
  const animations = new Set<Animation>();
  const overlays = new Set<HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const refreshGeometry = () => stage.querySelector(':scope > svg')?.dispatchEvent(new Event('zf-viewportchange'));
  function cancel() {
    const moving = Boolean(stage.dataset.transition);
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const overlay of overlays) overlay.remove();
    overlays.clear();
    clearTimeout(timer);
    delete stage.dataset.transition;
    if (moving) refreshGeometry();
  }
  function bounds(element?: Element) {
    if (!element) return;
    const outer = stage.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.right < outer.left || box.left > outer.right || box.bottom < outer.top || box.top > outer.bottom) return;
    return { x: box.left - outer.left, y: box.top - outer.top, width: box.width, height: box.height };
  }
  function capture(anchor?: Element) {
    cancel();
    const svg = stage.querySelector(':scope > svg');
    if (!svg || reduced.matches) return;
    // An image isolates the old SVG's IDs and styles, and cannot receive canvas events or focus.
    const image = document.createElement('img');
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.className = 'zf-board-snapshot';
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    return { image, origin: bounds(anchor) };
  }
  function animate(element: Element, frames: Keyframe[], duration = 260) {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)', fill: 'both' });
    animations.add(animation);
    return animation.finished.catch(() => {}).finally(() => { animations.delete(animation); animation.cancel(); });
  }
  function highlight(target?: Element) {
    const box = bounds(target);
    if (!box) return;
    const ring = document.createElement('div');
    ring.className = 'zf-return-highlight';
    ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, { left: `${box.x - 5}px`, top: `${box.y - 5}px`, width: `${box.width + 10}px`, height: `${box.height + 10}px` });
    stage.append(ring);
    overlays.add(ring);
    const remove = () => { ring.remove(); overlays.delete(ring); };
    if (reduced.matches) timer = setTimeout(remove, 600);
    else void animate(ring, [{ opacity: 0.8 }, { opacity: 0 }], 700).then(remove);
  }
  function enter(snapshot: ReturnType<typeof capture>, content: Element, direction: 'in' | 'out' | 'across', target?: Element) {
    if (reduced.matches || !snapshot) { if (direction === 'out') highlight(target); return; }
    const origin = direction === 'out' ? bounds(target) : snapshot.origin;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const scale = origin ? Math.max(0.12, Math.min(0.72, Math.max(origin.width / width, origin.height / height))) : 0.92;
    const x = origin ? origin.x + origin.width / 2 - width * scale / 2 : width * (1 - scale) / 2;
    const y = origin ? origin.y + origin.height / 2 - height * scale / 2 : height * (1 - scale) / 2;
    const small = `translate(${x}px, ${y}px) scale(${scale})`;
    const enlarged = `translate(${origin ? (width / 2 - origin.x - origin.width / 2) * 0.18 : -width * 0.06}px, ${origin ? (height / 2 - origin.y - origin.height / 2) * 0.18 : -height * 0.06}px) scale(1.12)`;
    const image = snapshot.image;
    stage.append(image);
    overlays.add(image);
    stage.dataset.transition = direction;
    const base = { transform: 'none', transformOrigin: '0 0', opacity: 1 };
    const incoming = animate(content, [{ transform: direction === 'out' ? enlarged : direction === 'in' ? small : 'scale(0.98)', transformOrigin: '0 0', opacity: 0 }, base]);
    const outgoing = animate(image, [base, { transform: direction === 'out' ? small : enlarged, transformOrigin: '0 0', opacity: 0 }]);
    void Promise.all([incoming, outgoing]).then(() => {
      // A later navigation may already own the stage. Only finish this snapshot's transition.
      if (!overlays.has(image)) return;
      image.remove(); overlays.delete(image); delete stage.dataset.transition;
      refreshGeometry();
      if (direction === 'out') highlight(target);
    });
  }
  // New input acts on final geometry immediately; motion never delays a second action.
  for (const type of ['wheel', 'keydown', 'zf-suspend', 'zf-destroy']) stage.addEventListener(type, cancel);
  // Keep a clicked link under the pointer until its click handler navigates. Pointer movement can
  // immediately take over the viewport, and navigation itself cancels the old motion.
  // Incidental movement after a click is not a pan and must not cut the arrival short.
  stage.addEventListener('pointermove', event => { if (event.buttons || event.pointerType === 'touch') cancel(); });
  reduced.addEventListener('change', cancel);
  stage.addEventListener('zf-destroy', () => reduced.removeEventListener('change', cancel), { once: true });
  return { capture, enter, cancel };
}
