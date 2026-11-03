/** Fit a sanitized export to its painted content, using browser geometry and the embedded fonts. */
export async function fitExportBounds(root: SVGSVGElement) {
  const graph = root.querySelector<SVGSVGElement>(':scope > svg') ?? root;
  // DOM-only consumers have no SVG layout engine. Browser exports always measure real geometry.
  if (typeof graph.getScreenCTM !== 'function' || typeof graph.getBBox !== 'function') return;
  const clone = document.importNode(root, true);
  const measured = clone.querySelector<SVGSVGElement>(':scope > svg') ?? clone;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  const size = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (size?.length === 4) { clone.setAttribute('width', String(size[2])); clone.setAttribute('height', String(size[3])); }
  host.append(clone);
  document.body.append(host);
  try {
    // Canvas backgrounds and definitions must not keep the old diagram's dimensions alive.
    for (const rect of measured.querySelectorAll(':scope > rect')) rect.remove();
    measured.getBBox();
    await document.fonts?.ready;
    // Firefox's nested <svg> CTM omits its own viewBox transform. A child group reports
    // the content's user coordinates consistently, including negative viewBox origins.
    const origin = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    measured.append(origin);
    const screen = origin.getScreenCTM();
    origin.remove();
    if (!screen) throw new Error('Could not measure the export.');
    const inverse = screen.inverse();
    const definitions = new Set(['defs', 'clippath', 'mask', 'marker', 'pattern', 'filter', 'symbol']);
    const excluded = new WeakMap<Element, boolean>();
    function skip(node: Element): boolean {
      const cached = excluded.get(node);
      if (cached !== undefined) return cached;
      const style = getComputedStyle(node);
      const hidden = definitions.has(node.localName.toLowerCase()) || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
        || node !== measured && Boolean(node.parentElement && skip(node.parentElement));
      excluded.set(node, hidden);
      return hidden;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of measured.querySelectorAll<SVGGraphicsElement>('path, rect, circle, ellipse, polygon, polyline, line, text, image, use')) {
      if (skip(node)) continue;
      const box = node.getBBox();
      const matrix = node.getScreenCTM();
      if (!matrix || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || !box.width && !box.height) continue;
      const transform = inverse.multiply(matrix);
      const stroke = getComputedStyle(node).stroke === 'none' ? 0 : parseFloat(getComputedStyle(node).strokeWidth) / 2 || 0;
      for (const [x, y] of [[box.x - stroke, box.y - stroke], [box.x + box.width + stroke, box.y - stroke],
        [box.x - stroke, box.y + box.height + stroke], [box.x + box.width + stroke, box.y + box.height + stroke]]) {
        const point = new DOMPoint(x, y).matrixTransform(transform);
        left = Math.min(left, point.x); top = Math.min(top, point.y);
        right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
      }
    }
    const padding = 24;
    const x = Number.isFinite(left) ? Math.floor(left - padding) : 0;
    const y = Number.isFinite(top) ? Math.floor(top - padding) : 0;
    const width = Number.isFinite(right) ? Math.max(1, Math.ceil(right + padding) - x) : 2 * padding;
    const height = Number.isFinite(bottom) ? Math.max(1, Math.ceil(bottom + padding) - y) : 2 * padding;
    for (const rect of graph.querySelectorAll(':scope > rect')) {
      for (const [name, value] of Object.entries({ x, y, width, height })) rect.setAttribute(name, String(value));
    }
    graph.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    graph.setAttribute('width', String(width)); graph.setAttribute('height', String(height));
    if (graph !== root) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  } finally { host.remove(); }
}
