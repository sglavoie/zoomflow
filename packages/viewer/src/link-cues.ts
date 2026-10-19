/** Shared by the live viewer and serialized offline runtime. Call after mounting the SVG. */
export function decorateLinks(svg: Element, boards: Map<string, { name: string }>) {
  const ns = 'http://www.w3.org/2000/svg';
  for (const link of svg.querySelectorAll<SVGAElement>('a')) {
    const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
    const external = /^(https?:|mailto:)/i.test(href);
    const target = boards.get(href);
    if (!external && !target && !link.hasAttribute('data-missing')) continue;
    const name = link.querySelector('text')?.textContent?.trim() || href;
    const label = external ? `Open external link: ${name}${href.startsWith('mailto:') ? ' (email)' : ' (new tab)'}`
      : target ? `Open ${target.name} board` : `Missing board: ${href}`;
    link.dataset.linkKind = external ? 'external' : 'board';
    link.setAttribute('aria-label', label);
    const title = document.createElementNS(ns, 'title');
    title.textContent = label;
    link.prepend(title);

    // D2 draws link badges at the top right, or 32 units left of a tooltip badge.
    // Tooltip badges carry a title and must keep their original content.
    const bounds = link.getBBox();
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
    arrow.setAttribute('d', external ? 'M10 22 L22 10 M12 10 H22 V20' : 'M9 10 H16 V22 M10 16 L16 22 L22 16');
    arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', `var(--zf-badge-ink, ${ink})`);
    arrow.setAttribute('transform', 'translate(4 4) scale(0.75)');
    arrow.setAttribute('stroke-width', '2'); arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round');
    badge.replaceChildren(circle, arrow);
    badge.setAttribute('aria-hidden', 'true');
    // Make the badge itself activate the same link as its shape.
    link.append(badge);
  }
  if (!svg.querySelector('a[data-link-kind]')) return;
  const hint = document.createElement('div');
  hint.className = 'zf-link-hint';
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
  svg.parentElement?.append(hint);
  let hovered: Element | null = null;
  let focused: Element | null = null;
  const anchor = (target: EventTarget | null) => target instanceof Element ? target.closest('a[data-link-kind]') : null;
  const update = () => {
    const label = (hovered ?? focused)?.getAttribute('aria-label');
    hint.textContent = label ?? '';
    hint.hidden = !label;
  };
  svg.addEventListener('pointerover', (event) => { hovered = anchor(event.target); update(); });
  svg.addEventListener('pointerout', (event) => { hovered = anchor((event as PointerEvent).relatedTarget); update(); });
  svg.addEventListener('focusin', (event) => { focused = anchor(event.target); update(); });
  svg.addEventListener('focusout', (event) => { focused = anchor((event as FocusEvent).relatedTarget); update(); });
}
