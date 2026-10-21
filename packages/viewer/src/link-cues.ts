/** Shared by the live viewer and serialized offline runtime. Call after mounting the SVG. */
export function decorateLinks(svg: Element, boards: Map<string, { name: string; parent?: string }>, current: string,
  /** Name a missing board target; defaults to its raw ID. */
  describe: (target: string) => string = (target) => target) {
  const ns = 'http://www.w3.org/2000/svg';
  const touch = matchMedia('(pointer: coarse)').matches;
  const cues: { link: SVGAElement; shape: SVGGraphicsElement; badge: SVGGElement; hit: SVGRectElement;
    x: number; y: number }[] = [];
  function ancestor(parent: string, child: string): boolean {
    for (let id = boards.get(child)?.parent; id; id = boards.get(id)?.parent) if (id === parent) return true;
    return false;
  }
  for (const link of svg.querySelectorAll<SVGAElement>('a')) {
    const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
    const external = /^(https?:|mailto:)/i.test(href);
    const target = boards.get(href);
    if (!external && !target && !link.hasAttribute('data-missing')) continue;
    const name = link.querySelector('text')?.textContent?.trim() || href;
    const direction = target ? ancestor(href, current) ? 'parent' : ancestor(current, href) ? 'child' : 'peer' : undefined;
    const label = external ? `Open external link: ${name}${href.startsWith('mailto:') ? ' (email)' : ' (new tab)'}`
      : target ? direction === 'parent' ? `Return to ${target.name}` : direction === 'child' ? `Open ${target.name} board` : `Visit ${target.name} board` : `Missing board: ${describe(href)}`;
    link.dataset.linkKind = external ? 'external' : 'board';
    if (direction) link.dataset.linkDirection = direction;
    link.setAttribute('aria-label', label);
    const title = document.createElementNS(ns, 'title');
    title.textContent = label;
    link.prepend(title);

  }
  function attachCues() {
    for (const link of svg.querySelectorAll<SVGAElement>('a[data-link-kind]')) {
      if (link.querySelector('.appendix-icon')) continue;
      const external = link.dataset.linkKind === 'external';
      const direction = link.dataset.linkDirection;
      // D2 draws link badges at the top right, or 32 units left of a tooltip badge.
      // Tooltip badges carry a title and must keep their original content.
      const bounds = link.getBBox();
      if (!bounds.width && !bounds.height) continue;
      const badge = [...svg.querySelectorAll<SVGGElement>('g.appendix-icon')].find((icon) => {
        if (icon.querySelector('title') || icon.closest('a')) return false;
        const matrix = icon.transform.baseVal.consolidate()?.matrix;
        const dx = matrix ? bounds.x + bounds.width - matrix.e - 16 : Infinity;
        return matrix && (Math.abs(dx) < 2 || Math.abs(dx - 32) < 2) && Math.abs(matrix.f + 16 - bounds.y) < 2;
      });
      if (!badge) continue;
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
        cues.push({ link, shape, badge, hit, x: matrix.e + 16, y: matrix.f + 16 });
      }
    }
  }
  let attached = false;
  function updateGeometry() {
    // Hidden mobile previews have no measurable SVG bounds. Associate their
    // badges once the SVG first becomes visible, before sizing the touch targets.
    if (!attached && svg.getClientRects().length) { attachCues(); attached = true; }
    if (!cues.length) return;
    // Size badges in screen pixels, independently of diagram fit and zoom.
    for (const cue of cues) {
      const matrix = cue.link.getScreenCTM();
      if (!matrix || !matrix.a || !matrix.d) continue;
      const scale = 1 / Math.abs(matrix.a);
      cue.badge.setAttribute('transform', `translate(${cue.x - 16 * scale} ${cue.y - 16 * scale}) scale(${scale})`);
    }
    const rectangles = cues.map((cue) => {
      const bounds = cue.shape.getBoundingClientRect();
      const dx = touch ? Math.max(0, (44 - bounds.width) / 2) : 0;
      const dy = touch ? Math.max(0, (44 - bounds.height) / 2) : 0;
      return { cue, bounds, left: bounds.left - dx, right: bounds.right + dx,
        top: bounds.top - dy, bottom: bounds.bottom + dy };
    });
    // Split available whitespace with neighboring shapes. Never expand a link's
    // hit area over another shape, including ordinary source-selection shapes.
    const graph = svg.querySelector(':scope > svg');
    const obstacles = graph ? [...graph.children].filter((node) =>
      ['g', 'a'].includes(node.localName) && !node.classList.contains('appendix-icon')).map((node) => {
        const shape = node.localName === 'a' ? node.querySelector('g:not(.appendix-icon)') ?? node : node;
        const bounds = shape.getBoundingClientRect();
        const dx = touch && node.localName === 'a' ? Math.max(0, (44 - bounds.width) / 2) : 0;
        const dy = touch && node.localName === 'a' ? Math.max(0, (44 - bounds.height) / 2) : 0;
        return { node, bounds, left: bounds.left - dx, right: bounds.right + dx,
          top: bounds.top - dy, bottom: bounds.bottom + dy };
      }) : [];
    for (const rect of rectangles) {
      for (const obstacle of obstacles) {
        if (obstacle.node === rect.cue.link || obstacle.node.contains(rect.cue.link)) continue;
        if (obstacle.right <= rect.left || obstacle.left >= rect.right || obstacle.bottom <= rect.top || obstacle.top >= rect.bottom) continue;
        const other = obstacle.bounds;
        const own = rect.bounds;
        if (other.left >= own.right) rect.right = Math.min(rect.right, (own.right + other.left) / 2);
        else if (other.right <= own.left) rect.left = Math.max(rect.left, (own.left + other.right) / 2);
        else if (other.top >= own.bottom) rect.bottom = Math.min(rect.bottom, (own.bottom + other.top) / 2);
        else if (other.bottom <= own.top) rect.top = Math.max(rect.top, (own.top + other.bottom) / 2);
        else { rect.left = own.left; rect.right = own.right; rect.top = own.top; rect.bottom = own.bottom; }
      }
      const matrix = rect.cue.link.getScreenCTM();
      if (!matrix || !matrix.a || !matrix.d) continue;
      const inverse = matrix.inverse();
      const start = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
      const end = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
      rect.cue.hit.setAttribute('x', String(start.x));
      rect.cue.hit.setAttribute('y', String(start.y));
      rect.cue.hit.setAttribute('width', String(Math.max(0, end.x - start.x)));
      rect.cue.hit.setAttribute('height', String(Math.max(0, end.y - start.y)));
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
