import { classifyHref, type Board } from '@zoomflow/core';
import { resolveRouteHash, type RenderBoard, type Viewer } from '@zoomflow/viewer';
import type { BoardSites } from './board-model';
import { pageListeners } from './canvas-guidance';
import type { PaneScope } from './pane-scope';
import { plural } from './text';

/** An authored `#/…` fragment in the board hash form, so `#/My Board` names `#/My%20Board`. */
export function boardRoute(hash: string) {
  return hash.split('/').map((segment, index) => {
    if (index === 0 || segment.startsWith('@')) return segment;
    try { return encodeURIComponent(decodeURIComponent(segment)); } catch { return segment; }
  }).join('/') || '#/';
}

/** Other diagram files that links open, by path relative to the document as authored. */
export type LinkedFiles = {
  label(path: string): string;
  /** Why a link to this file cannot open it, or undefined when it can. */
  missing(path: string): string | undefined;
  /** The file's compiled boards, compiled on first use. */
  compile(path: string): Promise<{ boards: Map<string, Board>; render: RenderBoard }>;
};

/** A card beside a link to another board or file, with a picture of that board and what it holds, so people
 * can look before they drill in. It follows pointer hover and keyboard focus. */
export function setupLinkPreview(scope: PaneScope, viewer: Viewer, files: LinkedFiles) {
  const card = document.createElement('div');
  card.className = 'link-preview';
  card.id = scope.id('link-preview');
  card.setAttribute('role', 'tooltip');
  card.hidden = true;
  card.innerHTML = '<img alt="" /><strong></strong><span></span>';
  scope.root.append(card);
  const [picture, title, summary] = card.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
  let compiledDocument: { boards: Map<string, Board>; sites: BoardSites; render: RenderBoard } | undefined;
  /** One picture per board for each compiled document. */
  let pictures = new Map<string, Promise<string>>();
  /** One picture per board of each linked file's compile. */
  const filePictures = new WeakMap<object, Map<string, Promise<string>>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let link: Element | undefined;

  function describe(board: Board) {
    const owner = compiledDocument!.sites.owner(board.id);
    const kind = owner === board.id ? compiledDocument!.sites.builder(board.id)?.kind : undefined;
    const count = board.diagram.shapes.length;
    if (kind === 'flow') return `Flow · ${plural(count, 'step')}`;
    if (kind === 'mind map') return `Mind map · ${plural(count, 'topic')}`;
    return plural(count, 'shape');
  }
  function hide() {
    clearTimeout(timer);
    card.hidden = true;
    link?.removeAttribute('aria-describedby');
    link = undefined;
  }
  function open(anchor: Element, name: string, description: string) {
    link = anchor;
    title.textContent = name;
    summary.textContent = description;
    picture.hidden = true;
    anchor.setAttribute('aria-describedby', card.id);
    card.hidden = false;
    place(anchor);
  }
  async function showPicture(anchor: Element, current: Map<string, Promise<string>>, key: string, render: () => Promise<string>) {
    if (!current.has(key)) current.set(key, render());
    const document = pictures;
    try {
      const svg = await current.get(key)!;
      // An image keeps the picture's styles and IDs apart from the diagram's.
      if (link !== anchor || document !== pictures) return;
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      picture.hidden = false;
      place(anchor);
    } catch { current.delete(key); }
  }
  async function show(anchor: Element) {
    const target = classifyHref(anchor.getAttribute('data-board') ?? anchor.getAttribute('data-file') ?? anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '');
    if (target.kind === 'file') { await showFile(anchor, target.path, target.hash); return; }
    const board = target.kind === 'board' ? compiledDocument?.boards.get(target.target) : undefined;
    if (!board || !compiledDocument) return;
    open(anchor, board.name, describe(board));
    await showPicture(anchor, pictures, board.id, () => compiledDocument!.render(board.target));
  }
  /** The linked file's board: its root, or the fragment's board or nearest existing ancestor. */
  async function showFile(anchor: Element, path: string, hash: string) {
    const label = files.label(path);
    const missing = files.missing(path);
    open(anchor, label, missing ?? 'Diagram file');
    if (missing) return;
    const current = pictures;
    let file: Awaited<ReturnType<LinkedFiles['compile']>>;
    try { file = await files.compile(path); } catch { return; }
    if (link !== anchor || current !== pictures) return;
    const byHash = new Map([...file.boards.values()].map((board) => [board.hash, board]));
    const board = byHash.get(resolveRouteHash(boardRoute(hash), (item) => byHash.has(item))) ?? file.boards.get('root');
    if (!board) return;
    title.textContent = board.id === 'root' ? label : `${label} · ${board.name}`;
    summary.textContent = plural(board.diagram.shapes.length, 'shape');
    place(anchor);
    if (!filePictures.has(file)) filePictures.set(file, new Map());
    await showPicture(anchor, filePictures.get(file)!, board.id, () => file.render(board.target));
  }
  /** Below the link, or above it when there is no room below. */
  function place(anchor: Element) {
    const box = anchor.getBoundingClientRect();
    const { width, height } = card.getBoundingClientRect();
    const below = box.bottom + 8 + height <= innerHeight;
    card.style.left = `${Math.max(8, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 8))}px`;
    card.style.top = `${below ? box.bottom + 8 : Math.max(8, box.top - height - 8)}px`;
  }
  const linkAt = (target: EventTarget | null) => target instanceof Element ? target.closest('a') : null;
  viewer.stage.addEventListener('pointerover', event => {
    const anchor = linkAt(event.target);
    if (event.pointerType === 'touch' || !anchor || anchor === link) return;
    hide();
    timer = setTimeout(() => void show(anchor), 400);
  });
  viewer.stage.addEventListener('pointerout', event => {
    if (linkAt(event.relatedTarget) !== linkAt(event.target)) hide();
  });
  viewer.stage.addEventListener('focusin', event => {
    const anchor = linkAt(event.target);
    if (anchor && anchor.matches(':focus-visible')) { hide(); void show(anchor); }
  });
  viewer.stage.addEventListener('focusout', hide);
  for (const type of ['wheel', 'pointerdown', 'zf-boardchange', 'zf-sourcechange']) viewer.stage.addEventListener(type, hide);
  // Escape dismisses a shown card only, so the viewer does not also go up a board. Elsewhere, such as in the
  // source, Escape also does its own work.
  pageListeners(viewer.stage, signal => addEventListener('keydown', event => {
    if (event.key !== 'Escape' || card.hidden) return;
    hide();
    const focused = document.activeElement;
    if (focused && focused !== document.body && !viewer.stage.contains(focused)) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, signal }));

  return {
    /** The compiled document, whose boards the links open. */
    compiled(boards: Map<string, Board>, sites: BoardSites, render: RenderBoard) {
      compiledDocument = { boards, sites, render };
      pictures = new Map();
      hide();
    },
  };
}
