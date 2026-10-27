import { atlasHash, boardLabel, classifyHref, type ExportBoard, parseAtlasHash, resolveFilePath, shapeClass } from '@zoomflow/core';
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
  restoreTrail, watchHistory, childToward, resolveLink, prepareLinks, followLink, linkTo, atlasHash, parseAtlasHash, resolveFilePath };

// Keep this runtime self-contained: its compiled function body is embedded in HTML.
// It consumes the same board IDs, hashes, parent and visited-trail model as Viewer.
// An atlas embeds several files: boards carry their `file`, and `#zoomflow-files` names each file.
function offlineViewer(lib: typeof runtime) {
  const boards: ExportBoard[] = JSON.parse(document.getElementById('zoomflow-data')!.textContent!);
  const fileData = document.getElementById('zoomflow-files');
  const names = new Map<string, string>(fileData ? (JSON.parse(fileData.textContent!) as { path: string; name: string }[]).map((file) => [file.path, file.name]) : []);
  type Doc = { file: string; boards: ExportBoard[]; byId: Map<string, ExportBoard>; byRoute: Map<string, ExportBoard> };
  const docs = new Map<string, Doc>();
  for (const board of boards) {
    const file = board.file ?? '';
    if (!docs.has(file)) docs.set(file, { file, boards: [], byId: new Map(), byRoute: new Map() });
    const owner = docs.get(file)!;
    owner.boards.push(board);
    owner.byId.set(board.id, board);
    // Routes within the file, as its own links name them.
    owner.byRoute.set(lib.parseAtlasHash(board.hash).hash, board);
  }
  const entry = docs.get(boards[0].file ?? '')!;
  let doc = entry;
  /** The project path a file link of the shown file opens, when the export holds that file. */
  const fileOf = (path: string) => {
    const target = names.size ? lib.resolveFilePath(doc.file, path, false) : undefined;
    return target !== undefined && docs.has(target) ? target : undefined;
  };
  const exists = (id: string) => doc.byId.has(id);
  const parentOf = (id: string) => doc.byId.get(id)?.parent;
  const resolve = (href: string) => lib.resolveLink(href, exists, lib.classifyHref, (path) => fileOf(path) !== undefined);
  // boardLabel reads only `name` and `parent`, which export boards share with live ones.
  const describe = (id: string) => lib.boardLabel(id, doc.byId as unknown as Parameters<typeof boardLabel>[1]);
  const describeFile = (path: string) => {
    const target = lib.resolveFilePath(doc.file, path, false);
    return (target !== undefined && names.get(target)) || (target ?? path).replace(/^.*\//, '').replace(/\.d2$/i, '');
  };
  /** The board a file link opens: its fragment's board, or the nearest existing ancestor. */
  function fileTarget(path: string, hash: string) {
    const target = docs.get(fileOf(path)!)!;
    // An authored fragment names boards as written, so `#/My Board` names `#/My%20Board`.
    const requested = (hash || '#/').split('/').map((segment, index) => {
      if (index === 0 || segment.startsWith('@')) return segment;
      try { return encodeURIComponent(decodeURIComponent(segment)); } catch { return segment; }
    }).join('/') || '#/';
    const route = lib.resolveRouteHash(requested, (item) => target.byRoute.has(item));
    const board = target.byRoute.get(route) ?? target.boards[0];
    return { target, board, notice: lib.routeFallbackNotice(requested, route, board.name) };
  }
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
  const viewport = lib.createViewport(stage, area, lib.clampBox, lib.revealBox);
  // Each file keeps its own saved views, as in the live viewer, so same-named boards never share one.
  viewport.setDocument(doc.file);
  let current = boards[0];
  let trail: string[] = [];
  /** The files passed through on the way to the shown one, each with the trail it was left on. */
  type Visit = { file: string; trail: string[] };
  let stack: Visit[] = [];
  function ancestors(board: ExportBoard, owner = doc): string[] {
    return board.parent ? [...ancestors(owner.byId.get(board.parent)!, owner), board.id] : [board.id];
  }
  function syncBackground() {
    const background = stage.querySelector('svg > rect');
    stage.style.backgroundColor = background ? getComputedStyle(background).fill : '';
  }
  // D2's styles follow the reader's color scheme; keep the letterboxing around the SVG in step.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBackground);
  function show(board: ExportBoard, visits: string[], replace = false, notice = '', owner = doc) {
    const focusStage = stage.contains(document.activeElement);
    const focusCrumb = crumbs.contains(document.activeElement);
    const previous = owner === doc ? current.id : undefined;
    if (owner !== doc) viewport.setDocument(owner.file);
    doc = owner;
    current = board;
    trail = lib.simplifyTrail(visits);
    setMessage(notice);
    if (board.empty) stage.textContent = 'This board is empty.';
    else {
      const parsed = new DOMParser().parseFromString(board.svg, 'image/svg+xml');
      // Sanitize while the parsed SVG is still inert, before importing it into this document.
      if (parsed.querySelector('parsererror') || !lib.sanitizeSvg(parsed.documentElement)) {
        stage.textContent = 'This board could not be displayed.';
        setMessage(`Invalid SVG for ${board.name}`, true);
      } else {
        const svg = document.importNode(parsed.documentElement, true);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        lib.restoreMissingLinks(svg, board.missingLinks ?? [], lib.shapeClass);
        lib.prepareLinks(svg, resolve, (id) => doc.byId.get(id)?.hash, (path, hash) => fileTarget(path, hash).board.hash);
        stage.replaceChildren(svg);
        lib.decorateLinks(svg, doc.byId, board.id, lib.splitHitArea, describe, describeFile);
      }
    }
    syncBackground();
    stage.dataset.board = board.id;
    if (names.size) stage.dataset.file = doc.file;
    stage.dispatchEvent(new Event('zf-boardchange'));
    stage.setAttribute('aria-label', `${board.name} diagram`);
    announcement.textContent = `${board.name} board`;
    lib.renderParentContext(context, board.parentContext ?? []);
    const visited = trail;
    const shown = doc;
    const files = stack;
    breadcrumbs.render([...files.map((visit, index) => ({ name: names.get(visit.file) ?? visit.file, activate: () => returnTo(index) })),
      // Like the live viewer, a file's root crumb is named after the file.
      ...visited.map((id, index) => ({ name: id === 'root' && names.get(shown.file) || shown.byId.get(id)!.name,
        activate: () => show(shown.byId.get(id)!, visited.slice(0, index + 1)) }))]);
    if (focusStage || focusCrumb) {
      // Going up keeps the keyboard position: focus the link leading back down, which the
      // viewport reveals as it receives focus. Other crumb moves keep focus in the trail.
      const child = previous && lib.childToward(previous, board.id, parentOf);
      const link = child && lib.linkTo(stage, child);
      (link || (focusStage ? stage : crumbs.querySelector<HTMLButtonElement>('button[aria-current]')))?.focus({ preventScroll: true });
    }
    history[replace || location.hash === board.hash ? 'replaceState' : 'pushState']({ zoomflowTrail: trail, zoomflowFiles: stack }, '', board.hash);
  }
  /** Open an earlier file of the stack where it was left. */
  function returnTo(index: number) {
    const visit = stack[index];
    const owner = docs.get(visit.file)!;
    stack = stack.slice(0, index);
    show(owner.byId.get(visit.trail.at(-1)!)!, visit.trail, false, '', owner);
  }
  function openFile(path: string, hash: string) {
    const { target, board, notice } = fileTarget(path, hash);
    if (target === doc) { show(board, [...trail, board.id], false, notice); return; }
    // Following a link back to a file already passed through returns to that point of the stack.
    const index = stack.findIndex((visit) => visit.file === target.file);
    stack = index >= 0 ? stack.slice(0, index) : [...stack, { file: doc.file, trail }];
    show(board, ancestors(board, target), false, notice, target);
  }
  const validVisit = (visit: unknown): visit is Visit => {
    const { file, trail: visits } = (visit ?? {}) as Partial<Visit>;
    const owner = typeof file === 'string' ? docs.get(file) : undefined;
    return Boolean(owner) && Array.isArray(visits) && visits.length > 0 && visits.every((id) => typeof id === 'string' && owner!.byId.has(id));
  };
  function restore() {
    const requested = location.hash;
    const { path, hash } = lib.parseAtlasHash(requested);
    const owner = path === undefined ? entry : docs.get(path);
    const target = owner ?? entry;
    const route = lib.resolveRouteHash(owner ? hash : '#/', (item) => target.byRoute.has(item));
    const board = target.byRoute.get(route) ?? target.boards[0];
    const saved = history.state?.zoomflowFiles;
    // Opened straight from an address, another file leads back to the entry file.
    stack = Array.isArray(saved) && saved.every(validVisit) ? saved.map((visit) => ({ file: visit.file, trail: [...visit.trail] }))
      : target === entry ? [] : [{ file: entry.file, trail: [entry.boards[0].id] }];
    const savedTrail = history.state?.zoomflowTrail;
    const notice = owner ? lib.routeFallbackNotice(hash, route, board.name) : `Missing file: ${path}; showing ${board.name}`;
    show(board, lib.restoreTrail(savedTrail, board.id, (id) => target.byId.has(id), () => ancestors(board, target)), true, notice, target);
  }
  function follow(event: MouseEvent | KeyboardEvent) {
    const action = lib.followLink(event, resolve);
    if (action?.kind === 'board') show(doc.byId.get(action.target)!, [...trail, action.target]);
    else if (action?.kind === 'file') openFile(action.path, action.hash);
    else if (action?.kind === 'missing') setMessage(`Missing board: ${describe(action.target)}`, true);
    else if (action?.kind === 'missing-file') setMessage(`Missing file: ${describeFile(action.path)}`, true);
  }
  stage.addEventListener('click', follow);
  stage.addEventListener('auxclick', (event) => lib.followLink(event, resolve));
  stage.addEventListener('keydown', (event) => { if (event.key === 'Enter') follow(event); });
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      (event.key !== 'Escape' && event.key !== 'Backspace')) return;
    if (current.parent) {
      event.preventDefault();
      show(doc.byId.get(current.parent)!, [...trail, current.parent]);
    } else if (stack.length) {
      // On a file's root board, go back to the file that opened it.
      event.preventDefault();
      returnTo(stack.length - 1);
    }
    // Backspace goes up here, so with nowhere to go it does nothing, rather than WebKit's history Back.
    else if (event.key === 'Backspace') event.preventDefault();
  });
  lib.watchHistory(window, restore);
  restore();
}

export function offlineViewerScript(): string {
  const helpers = Object.entries(runtime).map(([name, helper]) => `${JSON.stringify(name)}: ${helper.toString()}`);
  return `(${offlineViewer.toString()})({ ${helpers.join(', ')} });`;
}
