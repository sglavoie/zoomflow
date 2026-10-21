/** Strip executable markup from a rendered SVG in place. Keep self-contained for offline HTML.
 * Removes scripts, foreign HTML and SMIL animation (which can rewrite `href` or event attributes),
 * event-handler attributes and script URLs. Anchors also lose `data:` URLs; images keep theirs. */
export function sanitizeSvg(root: Element) {
  const unsafe = ['script', 'foreignObject', 'set', 'animate', 'animateMotion', 'animateTransform'];
  for (const node of [root, ...root.querySelectorAll('*')]) {
    // Compare local names: SVG selectors are case-sensitive and some DOMs lowercase them.
    if (unsafe.some((name) => name.toLowerCase() === node.localName.toLowerCase())) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) { node.removeAttributeNode(attribute); continue; }
      if (!/href$/i.test(attribute.name)) continue;
      // URL parsers ignore ASCII whitespace and control characters inside a scheme (`java\tscript:`).
      const url = [...attribute.value].filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join('');
      if (/^(javascript|vbscript):/i.test(url) || node.localName === 'a' && /^data:/i.test(url)) node.removeAttributeNode(attribute);
    }
  }
}
