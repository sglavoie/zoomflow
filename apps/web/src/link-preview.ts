import { classifyHref, type Board } from '@zoomflow/core';
import type { RenderBoard, Viewer } from '@zoomflow/viewer';
import type { BoardSites } from './board-model';
import { pageListeners } from './canvas-guidance';
import type { PaneScope } from './pane-scope';
import { plural } from './text';

/** A card beside a link to another board, with a picture of that board and what it holds, so people can
 * look before they drill in. It follows pointer hover and keyboard focus. */
export function setupLinkPreview(scope: PaneScope, viewer: Viewer) {
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
  async function show(anchor: Element) {
    const target = classifyHref(anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '');
    const board = target.kind === 'board' ? compiledDocument?.boards.get(target.target) : undefined;
    if (!board || !compiledDocument) return;
    link = anchor;
    title.textContent = board.name;
    summary.textContent = describe(board);
    picture.hidden = true;
    anchor.setAttribute('aria-describedby', card.id);
    card.hidden = false;
    place(anchor);
    if (!pictures.has(board.id)) pictures.set(board.id, compiledDocument.render(board.target));
    const current = pictures;
    try {
      const svg = await current.get(board.id)!;
      // An image keeps the picture's styles and IDs apart from the diagram's.
      if (link !== anchor || current !== pictures) return;
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      picture.hidden = false;
      place(anchor);
    } catch { current.delete(board.id); }
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
  // Escape dismisses a shown card only, so the viewer does not also go up a board.
  pageListeners(viewer.stage, signal => addEventListener('keydown', event => {
    if (event.key !== 'Escape' || card.hidden) return;
    hide();
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
