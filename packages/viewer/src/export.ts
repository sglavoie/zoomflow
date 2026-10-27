import { boardLabel, classifyHref, type ExportBoard, shapeClass } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { childToward, renderParentContext, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from './navigation';
import { clampBox, createViewport, revealBox } from './viewport';
import { decorateLinks, splitHitArea } from './link-cues';
import { setupBreadcrumbs } from './breadcrumbs';
import { followLink, linkTo, prepareLinks, resolveLink } from './links';
import { sanitizeSvg } from './sanitize';

const placeholder = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#eee"/><path d="M8 8L56 56M56 8L8 56" stroke="#999" stroke-width="3"/></svg>');

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Embed resources before downloading or drawing onto a canvas. A `dark` boolean freezes the theme;
 * leaving it undefined keeps D2's `prefers-color-scheme` rules so the SVG follows its reader. */
export async function prepareExportSvg(svg: string, dark?: boolean): Promise<{ svg: string; warnings: string[] }> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || !sanitizeSvg(root)) throw new Error('Invalid SVG from renderer');
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
    if (dark !== undefined) text = text.replace(/@media\s*(?:screen\s+and\s*)?\(prefers-color-scheme:\s*dark\)/g, `@media ${dark ? 'all' : 'not all'}`);
    // Imported styles cannot be made portable without a CSS dependency resolver.
    text = text.replace(/@import\s+[^;]+;/gi, () => {
      warnings.push('Removed an external stylesheet import.');
      return '';
    });
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    const urls: string[] = [];
    for (const match of text.matchAll(pattern)) urls.push(await embed(match[2].trim()));
    // Replace in one pass, so a URL is never matched twice or read as a `$` pattern; escape it for its new quotes.
    let index = 0;
    return text.replace(pattern, () => `url("${urls[index++].replace(/["\\]/g, '\\$&')}")`);
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/href$/i.test(attribute.name) && node.localName !== 'a') {
        attribute.value = await embed(attribute.value);
      } else if (attribute.value.includes('url(')) attribute.value = await css(attribute.value);
    }
    if (node.localName === 'style') node.textContent = await css(node.textContent ?? '');
  }
  return { svg: new XMLSerializer().serializeToString(root), warnings: [...new Set(warnings)] };
}

// Canvas limits: 16384 px per side works in every engine, Safari included; the area caps memory.
const maxSide = 16_384;
const maxArea = 64_000_000;

/** The PNG size of an SVG root: its native viewBox size, scaled down to fit canvas limits. */
export function rasterSize(root: Element): { width: number; height: number; native: [number, number] } {
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const native: [number, number] = viewBox ? [viewBox[2], viewBox[3]]
    : [parseFloat(root.getAttribute('width') ?? ''), parseFloat(root.getAttribute('height') ?? '')];
  if (!native.every((side) => Number.isFinite(side) && side > 0)) throw new Error('Diagram has no valid size: its SVG viewBox is missing or invalid.');
  const [w, h] = native;
  const scale = Math.min(1, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)));
  const size = (side: number) => scale < 1 ? Math.max(1, Math.floor(side * scale)) : Math.ceil(side);
  return { width: size(w), height: size(h), native };
}

/** Rasterize a prepared SVG at its native viewBox size, independent of viewport fit.
 * Diagrams beyond canvas limits are scaled down to fit rather than failing. */
export async function rasterizeSvg(svg: string): Promise<Blob> {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const { width, height, native } = rasterSize(root);
  // Without a viewBox, a smaller width and height would crop instead of scaling.
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${native[0]} ${native[1]}`);
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
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

// Every helper the runtime uses. Each must be self-contained: the runtime receives their
// compiled source text, so they cannot reach module imports or one another directly.
const runtime = { classifyHref, shapeClass, boardLabel, sanitizeSvg, restoreMissingLinks, simplifyTrail, renderParentContext,
  createViewport, clampBox, revealBox, decorateLinks, splitHitArea, setupBreadcrumbs, resolveRouteHash, routeFallbackNotice,
  restoreTrail, watchHistory, childToward, resolveLink, prepareLinks, followLink, linkTo };

// Keep this runtime self-contained: its compiled function body is embedded in HTML.
// It consumes the same board IDs, hashes, parent and visited-trail model as Viewer.
function offlineViewer(lib: typeof runtime) {
  const boards: ExportBoard[] = JSON.parse(document.getElementById('zoomflow-data')!.textContent!);
  const byId = new Map(boards.map((board) => [board.id, board]));
  const exists = (id: string) => byId.has(id);
  const parentOf = (id: string) => byId.get(id)?.parent;
  const resolve = (href: string) => lib.resolveLink(href, exists, lib.classifyHref);
  // boardLabel reads only `name` and `parent`, which export boards share with live ones.
  const describe = (id: string) => lib.boardLabel(id, byId as unknown as Parameters<typeof boardLabel>[1]);
  const stage = document.querySelector<HTMLElement>('.zf-stage')!;
  const crumbs = document.querySelector<HTMLElement>('.zf-breadcrumbs')!;
  const breadcrumbs = lib.setupBreadcrumbs(crumbs);
  const context = document.querySelector<HTMLElement>('.zf-context')!;
  const statusRegion = document.querySelector<HTMLElement>('.zf-message > [role="status"]')!;
  const alertRegion = document.querySelector<HTMLElement>('.zf-message > [role="alert"]')!;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  // Same fixed live regions as Viewer.setMessage: a repeated message is set again after a pause.
  function setMessage(text: string, error = false) {
    clearTimeout(messageTimer);
    const region = error ? alertRegion : statusRegion;
    const repeat = Boolean(text) && region.textContent === text;
    statusRegion.textContent = alertRegion.textContent = '';
    if (repeat) messageTimer = setTimeout(() => { region.textContent = text; }, 100);
    else region.textContent = text;
  }
  const announcement = document.querySelector<HTMLElement>('.zf-visually-hidden')!;
  const area = document.createElement('div');
  area.className = 'zf-stage-area';
  stage.before(area);
  area.append(stage);
  lib.createViewport(stage, area, lib.clampBox, lib.revealBox);
  let current = boards[0];
  let trail: string[] = [];
  function ancestors(board: ExportBoard): string[] {
    return board.parent ? [...ancestors(byId.get(board.parent)!), board.id] : [board.id];
  }
  function syncBackground() {
    const background = stage.querySelector('svg > rect');
    stage.style.backgroundColor = background ? getComputedStyle(background).fill : '';
  }
  // D2's styles follow the reader's color scheme; keep the letterboxing around the SVG in step.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBackground);
  function show(board: ExportBoard, visits: string[], replace = false, notice = '') {
    const focusStage = stage.contains(document.activeElement);
    const focusCrumb = crumbs.contains(document.activeElement);
    const previous = current.id;
    current = board;
    trail = lib.simplifyTrail(visits);
    setMessage(notice);
    if (board.empty) stage.textContent = 'This board is empty.';
    else {
      const doc = new DOMParser().parseFromString(board.svg, 'image/svg+xml');
      // Sanitize while the parsed SVG is still inert, before importing it into this document.
      if (doc.querySelector('parsererror') || !lib.sanitizeSvg(doc.documentElement)) {
        stage.textContent = 'This board could not be displayed.';
        setMessage(`Invalid SVG for ${board.name}`, true);
      } else {
        const svg = document.importNode(doc.documentElement, true);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        lib.restoreMissingLinks(svg, board.missingLinks ?? [], lib.shapeClass);
        lib.prepareLinks(svg, resolve, (id) => byId.get(id)?.hash);
        stage.replaceChildren(svg);
        lib.decorateLinks(svg, byId, board.id, lib.splitHitArea, describe);
      }
    }
    syncBackground();
    stage.dataset.board = board.id;
    stage.dispatchEvent(new Event('zf-boardchange'));
    stage.setAttribute('aria-label', `${board.name} diagram`);
    announcement.textContent = `${board.name} board`;
    lib.renderParentContext(context, board.parentContext ?? []);
    const visited = trail;
    breadcrumbs.render(visited.map((id, index) => ({ name: byId.get(id)!.name,
      activate: () => show(byId.get(id)!, visited.slice(0, index + 1)) })));
    if (focusStage || focusCrumb) {
      // Going up keeps the keyboard position: focus the link leading back down, which the
      // viewport reveals as it receives focus. Other crumb moves keep focus in the trail.
      const child = lib.childToward(previous, board.id, parentOf);
      const link = child && lib.linkTo(stage, child);
      (link || (focusStage ? stage : crumbs.querySelector<HTMLButtonElement>('button[aria-current]')))?.focus({ preventScroll: true });
    }
    history[replace || location.hash === board.hash ? 'replaceState' : 'pushState']({ zoomflowTrail: trail }, '', board.hash);
  }
  function restore() {
    const requested = location.hash;
    const hash = lib.resolveRouteHash(requested, (item) => boards.some((entry) => entry.hash === item));
    const board = boards.find((item) => item.hash === hash) ?? boards[0];
    show(board, lib.restoreTrail(history.state?.zoomflowTrail, board.id, exists, () => ancestors(board)), true,
      lib.routeFallbackNotice(requested, board.hash, board.name));
  }
  function follow(event: MouseEvent | KeyboardEvent) {
    const action = lib.followLink(event, resolve);
    if (action?.kind === 'board') show(byId.get(action.target)!, [...trail, action.target]);
    else if (action?.kind === 'missing') setMessage(`Missing board: ${describe(action.target)}`, true);
  }
  stage.addEventListener('click', follow);
  stage.addEventListener('auxclick', (event) => lib.followLink(event, resolve));
  stage.addEventListener('keydown', (event) => { if (event.key === 'Enter') follow(event); });
  window.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey &&
      (event.key === 'Escape' || event.key === 'Backspace') && current.parent) {
      event.preventDefault();
      show(byId.get(current.parent)!, [...trail, current.parent]);
    }
  });
  lib.watchHistory(window, restore);
  restore();
}

export function offlineViewerScript(): string {
  const helpers = Object.entries(runtime).map(([name, helper]) => `${JSON.stringify(name)}: ${helper.toString()}`);
  return `(${offlineViewer.toString()})({ ${helpers.join(', ')} });`;
}
