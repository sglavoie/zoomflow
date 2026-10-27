import { boardLabel, classifyHref, indexBoards, parentContext, shapeClass, type Board, type Diagram, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { decorateLinks, splitHitArea } from './link-cues';
import { childToward, renderParentContext, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from './navigation';
import { setupBreadcrumbs } from './breadcrumbs';
import { followLink, linkTo, prepareLinks, resolveLink } from './links';
import { sanitizeSvg } from './sanitize';

export type RenderBoard = (target: string) => Promise<string>;
export type ViewerRoute = { hash: string; trail?: unknown };
export type ViewerOptions = {
  /** Mirror the current board in the page URL and history; otherwise keep the route in memory. */
  history?: boolean;
  /** Whether page-level Escape/Backspace should navigate this viewer. */
  active?: () => boolean;
  /** Whether a click or Enter on a link opens it; by default every one does. */
  follows?: (link: Element, event: MouseEvent | KeyboardEvent) => boolean;
  /** Other diagram files that links can open, by path relative to this document as authored.
   * Without it, file links show as missing and explain that the folder must be opened. */
  files?: { exists(path: string): boolean; open(path: string, hash: string): void; label?(path: string): string };
  /** Escape/Backspace on the root board: return true when it went somewhere, such as back to the file that opened this one. */
  onTopLevelBack?: () => boolean;
  /** With `history`, the open document: its key goes into every history entry as `zoomflowFile`. When Back or
   * Forward reaches another document's entry, `restore` gets that entry's state and returns true when it opens
   * the document; otherwise the entry's board opens in this one. */
  document?: { key(): string | undefined; restore(state: { zoomflowFile: string } & Record<string, unknown>): boolean };
};
export type TrailPrefixEntry = { name: string; activate(): void };
export const openFolderMessage = 'Open the folder that contains this file to follow links to other diagrams.';
export { prepareExportSvg, rasterizeSvg, offlineViewerScript } from './export';
export { setupViewport } from './viewport';
export { resolveRouteHash } from './navigation';
export { offlineViewerStyle } from './export-style';
export { viewerStyle } from './viewer-style';

/** DOM viewer with an injected renderer so callers can reuse compiled documents. */
export class Viewer {
  readonly stage = document.createElement('div');
  private readonly crumbs = document.createElement('nav');
  private readonly breadcrumbs = setupBreadcrumbs(this.crumbs);
  private readonly context = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly status = document.createElement('span');
  private readonly alert = document.createElement('span');
  private messageTimer?: ReturnType<typeof setTimeout>;
  private readonly announcement = document.createElement('div');
  private boards = new Map<string, Board>();
  private diagnostics: readonly LintDiagnostic[] = [];
  private render: RenderBoard = async () => '';
  private cache = new Map<string, Promise<string>>();
  private sourceShapes: readonly ShapeSource[] = [];
  private current = 'root';
  private trail: string[] = [];
  private trailPrefix: readonly TrailPrefixEntry[] = [];
  private revision = 0;
  private dark = false;
  private styles = new WeakMap<Element, string>();
  private transitions = new Set<Animation>();
  private readonly events = new AbortController();
  private keys?: AbortController;
  private readonly history: boolean;
  private memoryRoute: ViewerRoute = { hash: '#/' };

  constructor(private readonly host: HTMLElement, private readonly settings: ViewerOptions = {}) {
    this.history = settings.history ?? true;
    this.crumbs.className = 'zf-breadcrumbs';
    this.crumbs.setAttribute('aria-label', 'Breadcrumb');
    this.context.className = 'zf-context';
    this.context.setAttribute('role', 'group');
    this.context.setAttribute('aria-label', 'Parent connections');
    this.context.hidden = true;
    this.message.className = 'zf-message';
    // Fixed live regions: screen readers can miss text set as a region changes role.
    this.status.setAttribute('role', 'status');
    this.alert.setAttribute('role', 'alert');
    this.message.append(this.status, this.alert);
    this.announcement.className = 'zf-visually-hidden';
    this.announcement.setAttribute('aria-live', 'polite');
    this.stage.className = 'zf-stage';
    this.stage.setAttribute('role', 'region');
    this.stage.tabIndex = -1;
    this.stage.setAttribute('aria-label', 'Diagram');
    host.replaceChildren(this.crumbs, this.context, this.message, this.announcement, this.stage);
    const options = { signal: this.events.signal };
    this.stage.addEventListener('click', (event) => this.follow(event), options);
    // A board link's href is a board id, not a URL: a middle click must not open it in a new tab.
    this.stage.addEventListener('auxclick', (event) => followLink(event, this.resolve), options);
    this.stage.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.follow(event);
    }, options);
    if (this.history) watchHistory(window, () => {
      const file: unknown = history.state?.zoomflowFile;
      const owner = this.settings.document;
      if (owner && typeof file === 'string' && file !== owner.key() && owner.restore(history.state)) return;
      void this.fromLocation();
    }, options);
    this.resume();
  }

  private readonly goUp = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || this.settings.active?.() === false || event.altKey || event.ctrlKey || event.metaKey ||
      (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      const parent = this.boards.get(this.current)?.parent;
      if (parent) { event.preventDefault(); void this.navigate(parent); }
      else if (this.boards.has(this.current) && this.settings.onTopLevelBack?.()) event.preventDefault();
    }
  };

  /** Release page-level key listeners while the viewer is hidden, including an attached viewport's. */
  suspend() {
    this.keys?.abort();
    this.keys = undefined;
    this.stage.dispatchEvent(new Event('zf-suspend'));
  }

  /** Listen for page-level keys again after `suspend`. */
  resume() {
    if (this.keys || this.events.signal.aborted) return;
    this.keys = new AbortController();
    window.addEventListener('keydown', this.goUp, { signal: this.keys.signal });
    this.stage.dispatchEvent(new Event('zf-resume'));
  }

  setMessage(text: string, error = false) {
    clearTimeout(this.messageTimer);
    const region = error ? this.alert : this.status;
    // Clear, then set a repeated message later, so the unchanged text is announced again.
    const repeat = Boolean(text) && region.textContent === text;
    this.status.textContent = this.alert.textContent = '';
    if (repeat) this.messageTimer = setTimeout(() => { region.textContent = text; }, 100);
    else region.textContent = text;
  }

  setBusy(busy: boolean) { this.host.setAttribute('aria-busy', String(busy)); }

  setSourceShapes(sources: readonly ShapeSource[]) { this.sourceShapes = sources; }

  get currentBoard() { return this.boards.get(this.current); }

  get route(): ViewerRoute {
    return this.history ? { hash: location.hash, trail: history.state?.zoomflowTrail } : { ...this.memoryRoute };
  }

  /** Choose the board the next document opens on, without navigating now. */
  setRoute(route?: ViewerRoute) {
    if (!this.history) { this.memoryRoute = { hash: route?.hash || '#/', trail: route?.trail }; return; }
    history.replaceState({ ...history.state, zoomflowTrail: route?.trail }, '', `${location.pathname}${location.search}${route?.hash ?? '#/'}`);
  }

  /** Invalidate a render already in flight when the source changes. */
  cancelPendingRender() { ++this.revision; this.cancelTransition(); }

  highlightShapes(ids: readonly string[]) {
    for (const shape of this.stage.querySelectorAll<SVGElement>('[data-shape-id]')) {
      shape.classList.toggle('zf-source-selected', ids.includes(shape.dataset.shapeId!));
    }
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.applyTheme(this.stage);
    this.syncBackground(this.stage);
  }

  private syncBackground(container: HTMLElement) {
    const background = container.querySelector<SVGRectElement>('svg svg > rect');
    container.style.backgroundColor = background ? getComputedStyle(background).fill : '';
  }

  private applyTheme(root: Element) {
    for (const style of root.querySelectorAll('style')) {
      if (!this.styles.has(style)) this.styles.set(style, style.textContent ?? '');
      style.textContent = this.styles.get(style)!.replace(
        /@media\s*(?:screen\s+and\s*)?\(prefers-color-scheme:\s*dark\)/g,
        `@media ${this.dark ? 'all' : 'not all'}`,
      );
    }
  }

  async setDocument(diagram: Diagram, render: RenderBoard, diagnostics: readonly LintDiagnostic[] = [], preserveViewport = false) {
    this.boards = indexBoards(diagram);
    this.diagnostics = diagnostics;
    this.render = render;
    this.cache = new Map();
    // Preserve the requested route, falling back to its nearest existing ancestor.
    await this.fromLocation(preserveViewport);
  }

  private ancestors(id: string): string[] {
    const path: string[] = [];
    for (let board = this.boards.get(id); board; board = board.parent ? this.boards.get(board.parent) : undefined) path.unshift(board.id);
    return path;
  }

  private async fromLocation(preserveViewport = false) {
    if (!this.boards.size) return;
    const route = this.route;
    const byHash = new Map([...this.boards.values()].map((item) => [item.hash, item]));
    const board = byHash.get(resolveRouteHash(route.hash, (hash) => byHash.has(hash))) ?? this.boards.get('root')!;
    const trail = restoreTrail(route.trail, board.id, (id) => this.boards.has(id), () => this.ancestors(board.id));
    await this.navigate(board.id, 'replace', trail, preserveViewport, routeFallbackNotice(route.hash, board.hash, board.name));
  }

  private readonly resolve = (href: string) => resolveLink(href, (id) => this.boards.has(id), classifyHref,
    this.settings.files && ((path) => this.settings.files!.exists(path)));

  private fileLabel(path: string) {
    return this.settings.files?.label?.(path) ?? path.replace(/^.*\//, '').replace(/\.d2$/i, '');
  }

  /** Crumbs for the files this one was opened from, shown before its own boards. */
  setTrailPrefix(entries: readonly TrailPrefixEntry[]) {
    this.trailPrefix = [...entries];
    // Until a new document's first board renders, its trail can name boards it no longer has.
    if (this.trail.length && this.trail.every((id) => this.boards.has(id))) this.updateCrumbs();
  }

  private svgElement(svg: string, board: Board): SVGElement {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    // File content can contain labels and links; never insert executable markup. Sanitize while
    // the parsed SVG is still inert: importing an element into this document can start loading it.
    if (doc.querySelector('parsererror') || !sanitizeSvg(doc.documentElement)) throw new Error(`Invalid SVG for ${board.name}`);
    const element = document.importNode(doc.documentElement, true) as unknown as SVGElement;
    element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    restoreMissingLinks(element, this.diagnostics.filter((item) => item.board === board.id));
    prepareLinks(element, this.resolve, (id) => this.boards.get(id)?.hash);
    // The first group in document order carrying each class, and this board's source shapes.
    const groups = new Map<string, SVGGElement>();
    for (const node of element.querySelectorAll('g')) for (const name of node.classList) if (!groups.has(name)) groups.set(name, node);
    const sources = new Set(this.sourceShapes.filter((entry) => entry.board === board.id).map((entry) => entry.shape));
    for (const shape of board.diagram.shapes) {
      const group = groups.get(shapeClass(shape.id));
      if (group) {
        group.dataset.shapeId = shape.id;
        if (!group.closest('a') && sources.has(shape.id)) {
          group.setAttribute('tabindex', '0');
          group.setAttribute('role', 'button');
          group.setAttribute('aria-label', `Select source for ${group.querySelector('text')?.textContent || shape.id}`);
        }
      }
    }
    this.applyTheme(element);
    return element;
  }

  private follow(event: MouseEvent | KeyboardEvent) {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link && this.settings.follows?.(link, event) === false) { event.preventDefault(); return; }
    const action = followLink(event, this.resolve);
    if (action?.kind === 'missing') this.setMessage(`Missing board: ${boardLabel(action.target, this.boards)}`, true);
    else if (action?.kind === 'board') void this.navigate(action.target);
    else if (action?.kind === 'file') this.settings.files?.open(action.path, action.hash);
    else if (action?.kind === 'missing-file') this.setMessage(this.settings.files ? `Missing file: ${this.fileLabel(action.path)}` : openFolderMessage, true);
  }

  private cancelTransition() {
    for (const animation of this.transitions) animation.cancel();
    this.transitions.clear();
  }

  private async fadeIn(element: Element) {
    const animation = element.animate([{ opacity: 0.4 }, { opacity: 1 }],
      { duration: 160, easing: 'ease-out', fill: 'both' });
    this.transitions.add(animation);
    try { await animation.finished; } catch { /* A newer route cancels this transition. */ }
    this.transitions.delete(animation);
    animation.cancel();
  }

  async navigate(id: string, mode: 'push' | 'replace' = 'push', trail?: string[], preserveViewport = false, notice = '') {
    const board = this.boards.get(id);
    if (!board) return;
    const revision = ++this.revision;
    const active = document.activeElement;
    const focusStage = this.stage.contains(active);
    // A focused link wraps its shape; the stage or its <svg> holds every shape, so it names none.
    const focusedShape = active instanceof Element
      ? (active.closest<SVGElement>('[data-shape-id]') ?? (active.localName === 'a' ? active.querySelector<SVGElement>('[data-shape-id]') : null))?.dataset.shapeId : undefined;
    const focusCrumb = this.crumbs.contains(active);
    this.cancelTransition();
    this.setBusy(true);
    try {
      let rendered = this.cache.get(id);
      if (!rendered) {
        rendered = this.render(board.target);
        this.cache.set(id, rendered);
        const cache = this.cache;
        void rendered.catch(() => cache.delete(id));
      }
      const svg = await rendered;
      if (revision !== this.revision) return;
      const content = board.diagram.shapes.length ? this.svgElement(svg, board) : document.createElement('p');
      if (!board.diagram.shapes.length) content.textContent = 'This board is empty.';
      const fade = this.stage.hasChildNodes() && id !== this.current &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const keepFocus = document.activeElement === active;
      const sameBoard = id === this.current;
      const previous = this.current;
      this.stage.replaceChildren(content);
      decorateLinks(content, this.boards, board.id, splitHitArea, (target) => boardLabel(target, this.boards), (path) => this.fileLabel(path));
      this.syncBackground(this.stage);
      if (fade) void this.fadeIn(content);
      this.current = id;
      this.stage.setAttribute('aria-label', `${board.name} diagram`);
      this.announcement.textContent = `${board.name} board`;
      this.trail = simplifyTrail(trail ?? [...this.trail, id]);
      this.stage.dataset.board = id;
      // Viewports keep a view per board, so re-rendering the same board keeps its viewport anyway.
      this.stage.dispatchEvent(new Event('zf-boardchange'));
      if (!this.history) this.memoryRoute = { hash: board.hash, trail: this.trail };
      else {
        const key = this.settings.document?.key();
        const state = { ...history.state, zoomflowTrail: this.trail, ...key !== undefined && { zoomflowFile: key } };
        if (mode === 'replace' || location.hash === board.hash) history.replaceState(state, '', board.hash);
        else history.pushState(state, '', board.hash);
      }
      this.updateCrumbs();
      // Going up keeps the keyboard position: focus the link leading back down, which an
      // attached viewport reveals as it receives focus. Other crumb moves keep focus in the trail.
      const child = keepFocus && !sameBoard ? childToward(previous, id, (item) => this.boards.get(item)?.parent) : undefined;
      const link = child && linkTo(this.stage, child);
      if (keepFocus && focusStage) {
        const shape = preserveViewport && sameBoard && focusedShape
          ? [...this.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find((node) => node.dataset.shapeId === focusedShape) : undefined;
        const target = shape?.closest<SVGElement>('a') ?? (shape?.hasAttribute('tabindex') ? shape : link || this.stage);
        target.focus({ preventScroll: true });
      }
      else if (keepFocus && focusCrumb) (link || this.crumbs.querySelector<HTMLButtonElement>('button[aria-current]'))?.focus({ preventScroll: true });
      renderParentContext(this.context, parentContext(board, this.boards));
      this.setMessage(notice);
    } catch (error) {
      if (revision === this.revision) { this.cancelTransition(); this.setMessage(error instanceof Error ? error.message : String(error), true); }
    } finally {
      if (revision === this.revision) this.setBusy(false);
    }
  }

  private updateCrumbs() {
    const trail = this.trail;
    this.breadcrumbs.render([...this.trailPrefix, ...trail.map((id, index) => ({ name: this.boards.get(id)!.name,
      activate: () => { void this.navigate(id, 'push', trail.slice(0, index + 1)); } }))]);
  }

  /** Also tears down a viewport attached to this stage with setupViewport(). */
  destroy() { ++this.revision; clearTimeout(this.messageTimer); this.stage.dispatchEvent(new Event('zf-destroy')); this.events.abort(); this.keys?.abort(); this.breadcrumbs.destroy(); this.cancelTransition(); }
}
