import type { ExportBoard } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { renderParentContext, simplifyTrail } from './navigation';

const placeholder = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#eee"/><path d="M8 8L56 56M56 8L8 56" stroke="#999" stroke-width="3"/></svg>');

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Freeze theme and embed resources before downloading or drawing onto a canvas. */
export async function prepareExportSvg(svg: string, dark: boolean): Promise<{ svg: string; warnings: string[] }> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid SVG from renderer');
  const root = doc.documentElement;
  root.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
  const warnings: string[] = [];
  const resources = new Map<string, Promise<string>>();
  function embed(url: string): Promise<string> {
    if (url.startsWith('#') || /^data:/i.test(url)) return Promise.resolve(url);
    if (!resources.has(url)) resources.set(url, (async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await dataUrl(await response.blob());
      } catch {
        warnings.push(`Could not embed ${url}; used a placeholder.`);
        return placeholder;
      }
    })());
    return resources.get(url)!;
  }
  async function css(text: string): Promise<string> {
    text = text.replace(/@media\s*(?:screen\s+and\s*)?\(prefers-color-scheme:\s*dark\)/g, `@media ${dark ? 'all' : 'not all'}`);
    // Imported styles cannot be made portable without a CSS dependency resolver.
    text = text.replace(/@import\s+[^;]+;/gi, () => {
      warnings.push('Removed an external stylesheet import.');
      return '';
    });
    const matches = [...text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)];
    for (const match of matches) text = text.replace(match[0], `url("${await embed(match[2].trim())}")`);
    return text;
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && /^\s*(javascript|vbscript):/i.test(attribute.value))) {
        node.removeAttributeNode(attribute);
      } else if (/href$/i.test(attribute.name) && node.localName !== 'a') {
        attribute.value = await embed(attribute.value);
      } else if (attribute.value.includes('url(')) attribute.value = await css(attribute.value);
    }
    if (node.localName === 'style') node.textContent = await css(node.textContent ?? '');
  }
  return { svg: new XMLSerializer().serializeToString(root), warnings: [...new Set(warnings)] };
}

/** Rasterize a prepared SVG at its native viewBox size, independent of viewport fit. */
export async function rasterizeSvg(svg: string): Promise<Blob> {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = Math.ceil(viewBox?.[2] ?? parseFloat(root.getAttribute('width') ?? ''));
  const height = Math.ceil(viewBox?.[3] ?? parseFloat(root.getAttribute('height') ?? ''));
  if (!(width > 0 && height > 0) || width * height > 64_000_000) throw new Error('Diagram dimensions exceed the PNG export limit.');
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

// Keep this runtime self-contained: its compiled function body is embedded in HTML.
// It consumes the same board IDs, hashes, parent and visited-trail model as Viewer.
function offlineViewer(restoreLinks: typeof restoreMissingLinks, normalizeTrail: typeof simplifyTrail, renderContext: typeof renderParentContext) {
  const boards: ExportBoard[] = JSON.parse(document.getElementById('zoomflow-data')!.textContent!);
  const byId = new Map(boards.map((board) => [board.id, board]));
  const stage = document.querySelector<HTMLElement>('.zf-stage')!;
  const crumbs = document.querySelector<HTMLElement>('.zf-breadcrumbs')!;
  const context = document.querySelector<HTMLElement>('.zf-context')!;
  const message = document.querySelector<HTMLElement>('.zf-message')!;
  let current = boards[0];
  let trail: string[] = [];
  function ancestors(board: ExportBoard): string[] {
    return board.parent ? [...ancestors(byId.get(board.parent)!), board.id] : [board.id];
  }
  function show(board: ExportBoard, visits: string[], replace = false) {
    current = board;
    trail = normalizeTrail(visits);
    message.textContent = '';
    if (board.empty) stage.textContent = 'This board is empty.';
    else {
      const doc = new DOMParser().parseFromString(board.svg, 'image/svg+xml');
      const svg = document.importNode(doc.documentElement, true);
      svg.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
      for (const node of [svg, ...svg.querySelectorAll('*')]) {
        for (const attr of [...node.attributes]) {
          if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) node.removeAttributeNode(attr);
        }
      }
      restoreLinks(svg, board.missingLinks ?? []);
      for (const link of svg.querySelectorAll('a')) {
        const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
        link.setAttribute('tabindex', '0');
        link.setAttribute('role', 'link');
        if (/^(https?:|mailto:)/i.test(href)) {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        } else if (href === 'root' || href.startsWith('root.')) {
          if (!byId.has(href)) link.setAttribute('data-missing', '');
        } else { link.removeAttribute('href'); link.removeAttribute('xlink:href'); }
      }
      stage.replaceChildren(svg);
    }
    stage.dataset.board = board.id;
    renderContext(context, board.parentContext ?? []);
    crumbs.replaceChildren();
    trail.forEach((id, index) => {
      const button = document.createElement('button');
      button.textContent = byId.get(id)!.name;
      if (index === trail.length - 1) button.setAttribute('aria-current', 'page');
      button.onclick = () => show(byId.get(id)!, trail.slice(0, index + 1));
      if (index) crumbs.append(document.createTextNode(' / '));
      crumbs.append(button);
    });
    history[replace ? 'replaceState' : 'pushState']({ zoomflowTrail: trail }, '', board.hash);
  }
  function restore() {
    let hash = location.hash || '#/';
    let board = boards.find((item) => item.hash === hash);
    while (!board && hash !== '#/') {
      hash = hash.slice(0, hash.lastIndexOf('/')) || '#/';
      if (hash === '#') hash = '#/';
      board = boards.find((item) => item.hash === hash);
    }
    board ??= boards[0];
    const saved = history.state?.zoomflowTrail;
    show(board, Array.isArray(saved) && saved.at(-1) === board.id && saved.every((id) => byId.has(id)) ? saved : ancestors(board), true);
  }
  function follow(event: MouseEvent | KeyboardEvent) {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (!link) return;
    const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) return;
    event.preventDefault();
    const board = byId.get(href);
    if (board) show(board, [...trail, board.id]);
    else if (href) message.textContent = `Missing board: ${href}`;
  }
  stage.addEventListener('click', follow);
  stage.addEventListener('keydown', (event) => { if (event.key === 'Enter') follow(event); });
  window.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'Escape' || event.key === 'Backspace') && current.parent) {
      event.preventDefault();
      show(byId.get(current.parent)!, [...trail, current.parent]);
    }
  });
  window.addEventListener('popstate', restore);
  window.addEventListener('hashchange', restore);
  restore();
}

export function offlineViewerScript(): string {
  return `(${offlineViewer.toString()})(${restoreMissingLinks.toString()}, ${simplifyTrail.toString()}, ${renderParentContext.toString()});`;
}
