export type ImagePresentation = { frame?: boolean; title?: string; subtitle?: string };

/** Wrap an already prepared SVG, so clipboard, SVG, PNG and thumbnails share exact geometry. */
export function frameExportSvg(svg: string, options: ImagePresentation, dark = false, glyphs?: string): string {
  if (!options.frame && !glyphs) return svg;
  const ns = 'http://www.w3.org/2000/svg';
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const diagram = doc.documentElement;
  const view = diagram.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = view?.[2] ?? parseFloat(diagram.getAttribute('width') ?? '');
  const height = view?.[3] ?? parseFloat(diagram.getAttribute('height') ?? '');
  if (doc.querySelector('parsererror') || !Number.isFinite(width + height) || width <= 0 || height <= 0) throw new Error('Cannot frame an image without valid dimensions.');
  const pad = 48;
  const outerWidth = Math.max(640, width + pad * 2);
  const root = doc.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  // The caller renders just the heading glyphs with the same compiler fonts.
  // Keep their subsets inside the image so a downloaded SVG/PNG needs no installed font.
  const fonts = glyphs ? new DOMParser().parseFromString(glyphs, 'image/svg+xml') : undefined;
  const css = [...fonts?.querySelectorAll('style') ?? []].map((style) =>
    [...(style.textContent ?? '').matchAll(/@font-face\s*\{[^}]+\}/g)].map(([rule]) =>
      rule.replace(/d2-\d+-font-(regular|bold)/g, 'zf-frame-$1').replace(/}(?=$)/, rule.includes('-font-bold') ? 'font-weight:700;}' : '}')).join('\n')).join('\n');
  if (css) {
    const style = doc.createElementNS(ns, 'style');
    style.textContent = css;
    root.append(style);
    for (const caption of diagram.querySelectorAll('.zf-layer-label')) caption.setAttribute('font-family', 'zf-frame-regular');
  }
  if (!options.frame) {
    if (css) diagram.prepend(root.firstChild!);
    return new XMLSerializer().serializeToString(diagram);
  }
  const node = (tag: string, attributes: Record<string, string | number>, text?: string) => {
    const element = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const metrics = document.createElement('canvas').getContext('2d');
  // D2 subsets omit kerning tables; sum advances to match them in every engine.
  function lines(text: string, size: number, bold = false) {
    if (metrics) metrics.font = `${bold ? 700 : 400} ${size}px Geist, sans-serif`;
    const fits = (value: string) => (metrics ? Array.from(value).reduce((width, char) => width + metrics.measureText(char).width, 0) * 1.05
      : Array.from(value).reduce((width, char) => width + size * (char.charCodeAt(0) < 256 ? .7 : 1), 0)) <= outerWidth - pad * 2;
    const result: string[] = [];
    let line = '';
    for (const word of text.trim().split(/\s+/)) {
      const candidate = `${line}${line ? ' ' : ''}${word}`;
      if (fits(candidate)) { line = candidate; continue; }
      if (line) { result.push(line); line = ''; }
      // Split long words by Unicode code point, keeping emoji and CJK labels intact.
      for (const char of word) {
        if (line && !fits(line + char)) { result.push(line); line = ''; }
        line += char;
      }
    }
    if (line) result.push(line);
    return result;
  }
  const title = lines(Array.from(options.title ?? '').slice(0, 160).join(''), 26, true);
  const subtitle = lines(Array.from(options.subtitle ?? '').slice(0, 300).join(''), 15);
  const header = title.length * 34 + subtitle.length * 23 + (title.length || subtitle.length ? 24 : 0);
  const outerHeight = height + pad * 2 + header;
  root.setAttribute('viewBox', `0 0 ${outerWidth} ${outerHeight}`);
  root.setAttribute('width', String(outerWidth)); root.setAttribute('height', String(outerHeight));
  root.append(node('rect', { width: outerWidth, height: outerHeight, fill: dark ? '#101722' : '#f0f3f8' }),
    node('rect', { x: 16, y: 16, width: outerWidth - 32, height: outerHeight - 32, rx: 18, fill: dark ? '#182231' : '#ffffff', stroke: dark ? '#344358' : '#dce3ed' }));
  let y = pad + 26;
  for (const line of title) {
    root.append(node('text', { x: pad, y, fill: dark ? '#e4eaf2' : '#203044', 'font-family': css ? 'zf-frame-bold' : 'Geist, sans-serif', 'font-size': 26, 'font-weight': 700 }, line)); y += 34;
  }
  if (!title.length) y = pad + 15;
  for (const line of subtitle) {
    root.append(node('text', { x: pad, y, fill: dark ? '#adbbcd' : '#52657d', 'font-family': css ? 'zf-frame-regular' : 'Geist, sans-serif', 'font-size': 15 }, line)); y += 23;
  }
  if (!view) diagram.setAttribute('viewBox', `0 0 ${width} ${height}`);
  diagram.setAttribute('x', String((outerWidth - width) / 2)); diagram.setAttribute('y', String(pad + header));
  diagram.setAttribute('width', String(width)); diagram.setAttribute('height', String(height));
  root.append(diagram);
  return new XMLSerializer().serializeToString(root);
}
