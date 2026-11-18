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
    // A link also contains an expanded hit area, badges and animated depth sheets.
    // Use the shape itself so hover/focus decorations cannot move the camera target.
    const box = (element.querySelector('[data-shape-id]') ?? element).getBoundingClientRect();
    if (!box.width || !box.height || box.right < outer.left || box.left > outer.right || box.bottom < outer.top || box.top > outer.bottom) return;
    return { x: box.left - outer.left - stage.clientLeft, y: box.top - outer.top - stage.clientTop, width: box.width, height: box.height };
  }
  function paint(anchor?: Element) {
    const shape = anchor?.querySelector('[data-shape-id]') ?? anchor;
    const surface = shape?.querySelector<SVGGraphicsElement>('rect, ellipse, circle, polygon, path');
    if (!surface) return;
    const style = getComputedStyle(surface);
    const matrix = surface.getScreenCTM();
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
    const box = surface.getBoundingClientRect();
    // SVG radii are in diagram units. Paths (diamonds, cylinders, etc.) keep a
    // simple bounding frame; even an oval's radius is bounded to a gentle corner.
    const radius = Number.parseFloat(style.getPropertyValue('rx') || style.borderTopLeftRadius) || 0;
    return { fill: style.fill === 'none' ? 'transparent' : style.fill, stroke: style.stroke === 'none' ? 'transparent' : style.stroke, strokeWidth: (Number.parseFloat(style.strokeWidth) || 0) * scale,
      radius: Math.min(radius * scale, box.width / 2, box.height / 2, surface.localName === 'rect' ? Infinity : 24) };
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
    const copy = svg.cloneNode(true) as SVGElement;
    // Offline exports hoist shared fonts and theme rules out of the board SVG.
    // An isolated image needs those rules too, or labels flash in a fallback font.
    const shared = document.getElementById('zoomflow-svg-style');
    if (shared) {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = shared.textContent;
      copy.prepend(style);
    }
    // Editor selection rings get their paint from the host stylesheet. Without it
    // they become opaque black rectangles in an image and obscure the zoom target.
    const rings = svg.querySelectorAll('.zf-selection');
    copy.querySelectorAll<SVGElement>('.zf-selection').forEach((ring, index) => {
      const style = getComputedStyle(rings[index]);
      for (const property of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'vector-effect']) ring.style.setProperty(property, style.getPropertyValue(property));
    });
    // Preserve the viewer's transparent canvas backgrounds in the isolated image too.
    // Otherwise a navigation snapshot would briefly paint over the stage's dot grid.
    const backgrounds = svg.querySelectorAll(':scope > rect, :scope > svg > rect');
    copy.querySelectorAll<SVGElement>(':scope > rect, :scope > svg > rect').forEach((rect, index) => {
      rect.style.opacity = getComputedStyle(backgrounds[index]).opacity;
    });
    // The frame replaces the whole clicked link, including its label and badges.
    // Hiding only the paint would leave a second label riding over the frame.
    const shape = anchor?.querySelector('[data-shape-id]') ?? anchor;
    const index = [...svg.querySelectorAll('[data-shape-id]')].indexOf(shape!);
    const copied = copy.querySelectorAll<SVGElement>('[data-shape-id]')[index];
    if (copied) (copied.closest('a') ?? copied).style.opacity = '0';
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    const stageBox = stage.getBoundingClientRect();
    return { image, origin: bounds(anchor), paint: paint(anchor), left: stageBox.left + stage.clientLeft, top: stageBox.top + stage.clientTop, width: stage.clientWidth, height: stage.clientHeight };
  }
  function animate(element: Element, frames: Keyframe[], duration = 260, easing = 'cubic-bezier(0.2, 0.75, 0.25, 1)') {
    const animation = element.animate(frames, { duration, easing, fill: 'both' });
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
    const outer = stage.getBoundingClientRect();
    // Breadcrumbs and parent context can move the stage between boards. Keep the
    // starting frame on the clicked shape's screen coordinates across that layout.
    const origin = direction === 'out' ? bounds(target) : snapshot.origin && { ...snapshot.origin,
      x: snapshot.origin.x + snapshot.left - outer.left - stage.clientLeft,
      y: snapshot.origin.y + snapshot.top - outer.top - stage.clientTop };
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const small = origin ? `translate(${origin.x}px, ${origin.y}px) scale(${origin.width / width}, ${origin.height / height})` : 'scale(0.92)';
    const enlarged = `translate(${-width * 0.06}px, ${-height * 0.06}px) scale(1.12)`;
    // Fill both stage axes so siblings actually travel past the stage edges.
    const zoom = origin ? Math.max(1.12, width / origin.width, height / origin.height) : 1.12;
    const through = origin ? `translate(${width / 2 - (origin.x + origin.width / 2) * zoom}px, ${height / 2 - (origin.y + origin.height / 2) * zoom}px) scale(${zoom})` : enlarged;
    const image = snapshot.image;
    Object.assign(image.style, { width: `${snapshot.width}px`, height: `${snapshot.height}px` });
    stage.append(image);
    overlays.add(image);
    stage.dataset.transition = direction;
    const base = { transform: 'none', transformOrigin: '0 0' };
    const incoming = { transform: direction === 'out' ? through : direction === 'in' ? small : 'scale(0.98)', transformOrigin: '0 0' };
    const imageBase = { transform: `translate(${snapshot.left - outer.left - stage.clientLeft}px, ${snapshot.top - outer.top - stage.clientTop}px)`, transformOrigin: '0 0' };
    const imageThrough = snapshot.origin ? `translate(${width / 2 - (snapshot.origin.x + snapshot.origin.width / 2) * zoom}px, ${height / 2 - (snapshot.origin.y + snapshot.origin.height / 2) * zoom}px) scale(${zoom})` : enlarged;
    const imageSmall = origin ? `translate(${origin.x}px, ${origin.y}px) scale(${origin.width / snapshot.width}, ${origin.height / snapshot.height})` : small;
    const outgoing = { transform: direction === 'out' ? imageSmall : direction === 'in' ? imageThrough : enlarged, transformOrigin: '0 0' };
    const duration = 520;
    // A soft spring-like settle with no overshoot beyond the stage.
    const easing = 'cubic-bezier(0.22, 0.85, 0.24, 1)';
    // Capture paint before the incoming SVG acquires its camera transform.
    const colors = direction === 'out' ? paint(target) : snapshot.paint;
    const pending = direction === 'across' ? [
      animate(content, [{ ...incoming, opacity: 0 }, { ...base, opacity: 1 }]),
      animate(image, [{ ...base, opacity: 1 }, { ...outgoing, opacity: 0 }]),
    ] : [
      animate(content, [incoming, base], duration, easing),
      animate(image, [imageBase, outgoing], duration, easing),
      // Keep labels separate in wall-clock time, independent of the movement ease.
      animate(content, [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], duration, 'linear'),
      animate(image, [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], duration, 'linear'),
    ];
    let frame: HTMLDivElement | undefined;
    if (direction !== 'across' && origin && colors) {
      frame = document.createElement('div');
      frame.className = 'zf-board-frame';
      frame.setAttribute('aria-hidden', 'true');
      Object.assign(frame.style, { borderColor: colors.stroke, borderWidth: `${colors.strokeWidth}px` });
      stage.append(frame);
      overlays.add(frame);
      const shapeBox = { left: `${origin.x}px`, top: `${origin.y}px`, width: `${origin.width}px`, height: `${origin.height}px`, borderRadius: `${colors.radius}px` };
      const stageBox = { left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, borderRadius: getComputedStyle(stage).borderTopLeftRadius };
      pending.push(animate(frame, direction === 'in' ? [shapeBox, stageBox] : [stageBox, shapeBox], duration, easing));
      pending.push(animate(frame, direction === 'in' ? [
        { backgroundColor: colors.fill, opacity: 1 },
        { backgroundColor: colors.fill, opacity: 1, offset: 0.3 },
        { backgroundColor: 'transparent', opacity: 1, offset: 0.8 },
        { backgroundColor: 'transparent', opacity: 0 },
      ] : [
        { backgroundColor: 'transparent', opacity: 0 },
        { backgroundColor: colors.fill, opacity: 1, offset: 0.4 },
        { backgroundColor: colors.fill, opacity: 1, offset: 0.65 },
        { backgroundColor: 'transparent', opacity: 0 },
      ], duration, 'linear'));
    }
    void Promise.all(pending).then(() => {
      // A later navigation may already own the stage. Only finish this snapshot's transition.
      if (!overlays.has(image)) return;
      image.remove(); overlays.delete(image);
      if (frame) { frame.remove(); overlays.delete(frame); }
      delete stage.dataset.transition;
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
