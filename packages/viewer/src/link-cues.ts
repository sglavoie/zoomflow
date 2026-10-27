export type Rect = { left: number; top: number; right: number; bottom: number };

/** Grow a link's hit area from its shape's `own` bounds towards `expanded`, splitting the
 * whitespace with each overlapping obstacle at their midpoint. An obstacle that overlaps the
 * shape itself, rather than a gap beside it, limits the hit area to the shape. */
export function splitHitArea(own: Rect, expanded: Rect, obstacles: readonly { bounds: Rect; area: Rect }[]): Rect {
  const rect = { ...expanded };
  for (const { bounds: other, area } of obstacles) {
    if (area.right <= rect.left || area.left >= rect.right || area.bottom <= rect.top || area.top >= rect.bottom) continue;
    if (other.left >= own.right) rect.right = Math.min(rect.right, (own.right + other.left) / 2);
    else if (other.right <= own.left) rect.left = Math.max(rect.left, (own.left + other.right) / 2);
    else if (other.top >= own.bottom) rect.bottom = Math.min(rect.bottom, (own.bottom + other.top) / 2);
    else if (other.bottom <= own.top) rect.top = Math.max(rect.top, (own.top + other.bottom) / 2);
    else Object.assign(rect, own);
  }
  return rect;
}

/** Shared by the live viewer and serialized offline runtime. Call after mounting the SVG.
 * `split` is `splitHitArea`, passed in so this function stays self-contained. */
export function decorateLinks(svg: Element, boards: Map<string, { name: string; parent?: string }>, current: string,
  split: typeof splitHitArea,
  /** Name a missing board target; defaults to its raw ID. */
  describe: (target: string) => string = (target) => target) {
  const ns = 'http://www.w3.org/2000/svg';
  // Badges draw in a 32-unit box with a 24-unit circle; this scales that circle to 32 screen pixels.
  const badgeScale = 4 / 3;
  // Read live: the primary pointer can change, and an attached viewport re-measures when it does.
  const coarse = matchMedia('(pointer: coarse)');
  const cues: { link: SVGAElement; shape: SVGGraphicsElement; badge: SVGGElement; hit: SVGRectElement; x: number; y: number;
    toReference?: DOMMatrix; bounds?: Rect; obstacles: { node: Element; bounds: Rect; link: boolean; gap: number }[] }[] = [];
  function ancestor(parent: string, child: string): boolean {
    for (let id = boards.get(child)?.parent; id; id = boards.get(id)?.parent) if (id === parent) return true;
    return false;
  }
  for (const link of svg.querySelectorAll<SVGAElement>('a')) {
    const href = link.getAttribute('data-board') ?? link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
    const external = /^(https?:|mailto:)/i.test(href);
    const target = boards.get(href);
    if (!external && !target && !link.hasAttribute('data-missing')) continue;
    const name = link.querySelector('text')?.textContent?.trim() || href;
    const direction = target ? ancestor(href, current) ? 'parent' : ancestor(current, href) ? 'child' : 'peer' : undefined;
    const label = external ? `Open external link: ${name}${href.startsWith('mailto:') ? ' (email)' : ' (new tab)'}`
      : target ? direction === 'parent' ? `Return to ${target.name}` : direction === 'child' ? `Open ${target.name} board` : `Visit ${target.name} board` : `Missing board: ${describe(href)}`;
    link.dataset.linkKind = external ? 'external' : 'board';
    if (direction) link.dataset.linkDirection = direction;
    // One accessible name: a <title> as well would make screen readers announce it twice.
    link.setAttribute('aria-label', label);
  }
  function attachCues() {
    // Index free badges once; one moved into a link is taken.
    const icons = [...svg.querySelectorAll<SVGGElement>('g.appendix-icon')].flatMap((icon) => {
      const matrix = !icon.querySelector('title') && !icon.closest('a') && icon.transform.baseVal.consolidate()?.matrix;
      return matrix ? [{ icon, e: matrix.e, f: matrix.f }] : [];
    });
    for (const link of svg.querySelectorAll<SVGAElement>('a[data-link-kind]')) {
      if (link.querySelector('.appendix-icon')) continue;
      const external = link.dataset.linkKind === 'external';
      const direction = link.dataset.linkDirection;
      // D2 draws link badges at the top right, or 32 units left of a tooltip badge.
      // Tooltip badges carry a title and must keep their original content.
      const bounds = link.getBBox();
      if (!bounds.width && !bounds.height) continue;
      const index = icons.findIndex(({ e, f }) => {
        const dx = bounds.x + bounds.width - e - 16;
        return (Math.abs(dx) < 2 || Math.abs(dx - 32) < 2) && Math.abs(f + 16 - bounds.y) < 2;
      });
      if (index < 0) continue;
      const badge = icons.splice(index, 1)[0].icon;
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '16'); circle.setAttribute('cy', '16'); circle.setAttribute('r', '12');
      // Frozen exported SVGs supply their own theme; live CSS follows the appearance selector.
      const background = svg.querySelector('svg > rect');
      const text = link.querySelector('text');
      const surface = background ? getComputedStyle(background).fill : '#fff';
      const ink = text ? getComputedStyle(text).fill : '#52657d';
      circle.setAttribute('fill', `var(--zf-badge-surface, ${surface})`);
      circle.setAttribute('stroke', `var(--zf-badge-ink, ${ink})`);
      circle.setAttribute('stroke-opacity', '0.5');
      const arrow = document.createElementNS(ns, 'path');
      arrow.setAttribute('d', external ? 'M10 22 L22 10 M12 10 H22 V20'
        : direction === 'parent' ? 'M23 22 H16 V10 M10 16 L16 10 L22 16'
        : direction === 'peer' ? 'M8 16 H24 M18 10 L24 16 L18 22'
        : 'M9 10 H16 V22 M10 16 L16 22 L22 16');
      arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', `var(--zf-badge-ink, ${ink})`);
      arrow.setAttribute('transform', 'translate(4 4) scale(0.75)');
      arrow.setAttribute('stroke-width', '2'); arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round');
      badge.replaceChildren(circle, arrow);
      badge.setAttribute('aria-hidden', 'true');
      // Make the badge itself activate the same link as its shape.
      link.append(badge);
      const shape = link.querySelector<SVGGraphicsElement>('g:not(.appendix-icon)');
      const matrix = badge.transform.baseVal.consolidate()?.matrix;
      if (shape && matrix) {
        const hit = document.createElementNS(ns, 'rect');
        hit.classList.add('zf-link-hit');
        hit.setAttribute('fill', 'transparent');
        hit.setAttribute('aria-hidden', 'true');
        link.prepend(hit);
        cues.push({ link, shape, badge, hit, x: matrix.e + 16, y: matrix.f + 16, obstacles: [] });
      }
    }
  }
  // Geometry is measured once per board in the diagram's own user space ("reference" space,
  // fixed relative to every shape under pan and zoom), then mapped to the screen per frame.
  const graph = svg.querySelector<SVGGraphicsElement>(':scope > svg');
  const reference = graph ?? (svg as SVGGraphicsElement);
  function measure() {
    const screen = reference.getScreenCTM();
    if (!screen) return false;
    const inverse = screen.inverse();
    const bounds = (node: SVGGraphicsElement): Rect | undefined => {
      const box = node.getBBox();
      const matrix = node.getScreenCTM();
      if (!matrix) return undefined;
      const toReference = inverse.multiply(matrix);
      const start = new DOMPoint(box.x, box.y).matrixTransform(toReference);
      const end = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(toReference);
      return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
        right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) };
    };
    // Split available whitespace with neighboring shapes. Never expand a link's
    // hit area over another shape, including ordinary source-selection shapes.
    const obstacles = graph ? [...graph.children].filter((node) =>
      ['g', 'a'].includes(node.localName) && !node.classList.contains('appendix-icon')).flatMap((node) => {
        const shape = node.localName === 'a' ? node.querySelector('g:not(.appendix-icon)') ?? node : node;
        const box = bounds(shape as SVGGraphicsElement);
        return box ? [{ node, bounds: box, link: node.localName === 'a' }] : [];
      }) : [];
    for (const cue of cues) {
      const link = cue.link.getScreenCTM();
      const own = bounds(cue.shape);
      if (!link || !own) continue;
      cue.toReference = inverse.multiply(link);
      cue.bounds = own;
      // Nearest first by their larger axis gap, so each frame stops at the first one out of reach.
      cue.obstacles = obstacles.filter((obstacle) => obstacle.node !== cue.link && !obstacle.node.contains(cue.link))
        .map((obstacle) => ({ ...obstacle, gap: Math.max(obstacle.bounds.left - own.right, own.left - obstacle.bounds.right,
          obstacle.bounds.top - own.bottom, own.top - obstacle.bounds.bottom) }))
        .sort((a, b) => a.gap - b.gap);
    }
    return true;
  }
  let attached = false;
  let measured = false;
  function updateGeometry() {
    // Hidden mobile previews have no measurable SVG bounds. Associate their
    // badges once the SVG first becomes visible, before sizing the touch targets.
    if (!attached && svg.getClientRects().length) { attachCues(); attached = true; }
    if (!cues.length) return;
    if (!measured) measured = measure();
    const screen = reference.getScreenCTM();
    if (!measured || !screen || !screen.a || !screen.d) return;
    const touch = coarse.matches;
    // Expand touch targets to 44 screen pixels, expressed in reference units.
    const expand = (rect: Rect, enabled: boolean): Rect => {
      const dx = enabled ? Math.max(0, (44 / Math.abs(screen.a) - (rect.right - rect.left)) / 2) : 0;
      const dy = enabled ? Math.max(0, (44 / Math.abs(screen.d) - (rect.bottom - rect.top)) / 2) : 0;
      return { left: rect.left - dx, right: rect.right + dx, top: rect.top - dy, bottom: rect.bottom + dy };
    };
    // A hit area and an obstacle's area each grow by at most 22 screen pixels per side, so an
    // obstacle at least this far away on either axis can never overlap; without touch, only overlaps count.
    const reach = touch ? 44 / Math.min(Math.abs(screen.a), Math.abs(screen.d)) : 0;
    // Compute everything first, then write: no layout reads between attribute writes.
    const updates = cues.flatMap((cue) => {
      if (!cue.toReference || !cue.bounds) return [];
      const link = screen.multiply(cue.toReference);
      if (!link.a || !link.d) return [];
      const nearby: { bounds: Rect; area: Rect }[] = [];
      for (const obstacle of cue.obstacles) {
        if (obstacle.gap >= reach) break;
        nearby.push({ bounds: obstacle.bounds, area: expand(obstacle.bounds, touch && obstacle.link) });
      }
      const area = split(cue.bounds, expand(cue.bounds, touch), nearby);
      const fromReference = cue.toReference.inverse();
      const start = new DOMPoint(area.left, area.top).matrixTransform(fromReference);
      const end = new DOMPoint(area.right, area.bottom).matrixTransform(fromReference);
      return [{ cue, scale: 1 / Math.abs(link.a), start, end }];
    });
    for (const { cue, scale, start, end } of updates) {
      // Size badges in screen pixels, independently of diagram fit and zoom.
      const size = scale * badgeScale;
      cue.badge.setAttribute('transform', `translate(${cue.x - 16 * size} ${cue.y - 16 * size}) scale(${size})`);
      cue.hit.setAttribute('x', String(start.x));
      cue.hit.setAttribute('y', String(start.y));
      cue.hit.setAttribute('width', String(Math.max(0, end.x - start.x)));
      cue.hit.setAttribute('height', String(Math.max(0, end.y - start.y)));
    }
  }
  // Viewport changes fire on every pointermove and wheel event: measure once per frame.
  let frame = 0;
  svg.addEventListener('zf-viewportchange', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      // A replaced board's SVG is detached; skip its last pending frame.
      if (svg.isConnected) updateGeometry();
    });
  });
  updateGeometry();
  // Embedded fonts can still be loading on first paint; re-measure text once they settle.
  void document.fonts?.ready.then(() => { if (cues.length && svg.isConnected && measure()) updateGeometry(); });
  if (!svg.querySelector('a[data-link-kind]')) return;
  const hint = document.createElement('div');
  hint.className = 'zf-link-hint';
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
  svg.parentElement?.append(hint);
  let hovered: Element | null = null;
  let focused: Element | null = null;
  let focusLast = false;
  const anchor = (target: EventTarget | null) => target instanceof Element ? target.closest('a[data-link-kind]') : null;
  const update = () => {
    const label = (focusLast ? focused ?? hovered : hovered ?? focused)?.getAttribute('aria-label');
    if (hint.textContent !== (label ?? '')) hint.textContent = label ?? '';
    hint.hidden = !label;
  };
  svg.addEventListener('pointerover', (event) => { hovered = anchor(event.target); focusLast = false; update(); });
  svg.addEventListener('pointermove', (event) => { hovered = anchor(event.target); focusLast = false; update(); });
  svg.addEventListener('pointerout', (event) => { hovered = anchor((event as PointerEvent).relatedTarget); update(); });
  svg.addEventListener('focusin', (event) => { focused = anchor(event.target); focusLast = true; update(); });
  svg.addEventListener('focusout', (event) => { focused = anchor((event as FocusEvent).relatedTarget); update(); });
}
