/** Strip executable markup from a parsed SVG in place. Keep self-contained for offline HTML.
 * Run it on the inert parsed document, before importing into the page: an imported element can
 * start loading before it is removed. Keeps only SVG-namespaced elements on an allowlist of what
 * D2 emits, so scripts, `foreignObject`, SMIL animation (which can rewrite `href` or event
 * attributes) and HTML-namespaced elements such as `h:iframe` go whatever their prefix or case.
 * Removes event-handler attributes and script URLs. Only `image` and `feImage` keep `data:` URLs,
 * and `use` keeps only same-document `#fragment` references. Returns false, leaving the tree alone, when the root is not an SVG `svg` element. */
export function sanitizeSvg(root: Element): boolean {
  const ns = 'http://www.w3.org/2000/svg';
  // Shapes, text, Markdown (which D2 draws as SVG text), code, icons, LaTeX, shadows and fill
  // patterns. Rich HTML in `foreignObject` is removed, never rendered. Compare lowercased
  // names: SVG names are case-sensitive in browsers, but some DOMs lowercase them.
  const allowed = new Set(['a', 'circle', 'clipPath', 'defs', 'desc', 'ellipse', 'feBlend', 'feColorMatrix',
    'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
    'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
    'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting',
    'feSpotLight', 'feTile', 'feTurbulence', 'filter', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask',
    'metadata', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'stop', 'style', 'svg',
    'symbol', 'text', 'textPath', 'title', 'tspan', 'use', 'view'].map((name) => name.toLowerCase()));
  const safe = (node: Element) => node.namespaceURI === ns && allowed.has(node.localName.toLowerCase());
  if (!safe(root) || root.localName.toLowerCase() !== 'svg') return false;
  for (const node of [root, ...root.querySelectorAll('*')]) {
    // Skip descendants of an element already removed.
    if (!root.contains(node)) continue;
    if (!safe(node)) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) { node.removeAttributeNode(attribute); continue; }
      if (!/href$/i.test(attribute.name)) continue;
      // URL parsers ignore ASCII whitespace and control characters inside a scheme (`java\tscript:`).
      const url = [...attribute.value].filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join('');
      const name = node.localName.toLowerCase();
      if (/^(javascript|vbscript):/i.test(url) || /^data:/i.test(url) && name !== 'image' && name !== 'feimage' ||
        name === 'use' && !url.startsWith('#')) node.removeAttributeNode(attribute);
    }
  }
  return true;
}
