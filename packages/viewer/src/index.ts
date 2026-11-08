import { viewerSvg, syncBackground } from './viewer-svg';
import { ViewerView, type ViewerViewContext } from './viewer-view';
import { boardLabel, classifyHref, indexBoards, parentContext, type Board, type Diagram, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { decorateLinks, splitHitArea } from './link-cues';
import { childToward, normalizeRouteHash, renderParentContext, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from './navigation';
import { setupBreadcrumbs } from './breadcrumbs';
import { followLink, linkTo, resolveLink } from './links';
import { layerDepths } from './layers';
import { setupBoardMotion } from './board-motion';
import type { DocumentView } from './document-view';
export { parseDocumentView, serializeDocumentView, type DocumentView } from './document-view';

export { ViewerRenderError, openFolderMessage, type RenderBoard, type ViewerRoute, type ViewerOptions, type TrailPrefixEntry } from './viewer-types';
import { ViewerRenderError, openFolderMessage, type RenderBoard, type ViewerRoute, type ViewerOptions, type TrailPrefixEntry } from './viewer-types';
export { prepareExportSvg, rasterizeSvg, offlineViewerScript } from './export';
export { setupViewport } from './viewport';
export { normalizeRouteHash, resolveRouteHash } from './navigation';
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
  private readonly motion = setupBoardMotion(this.stage);
  private readonly events = new AbortController();
  private keys?: AbortController;
  private readonly history: boolean;
  private memoryRoute: ViewerRoute = { hash: '#/' };
  private layerView: { root?: string; expanded: Set<string>; all: boolean; depth?: number } = { expanded: new Set(), all: false };
  private readonly layerViews = new Map<string, typeof this.layerView>();
  private layerDocument?: string;
  private hiddenShapes = new Map<string, Set<string>>();
  private readonly hiddenDocuments = new Map<string, Map<string, Set<string>>>();

  private readonly view = new ViewerView(this.viewContext());
  private viewContext(): ViewerViewContext {
    const viewer = this;
    return {
      get hiddenShapes() { return viewer.hiddenShapes; }, set hiddenShapes(value) { viewer.hiddenShapes = value; },
      get current() { return viewer.current; }, set current(value) { viewer.current = value; },
      get boards() { return viewer.boards; }, set boards(value) { viewer.boards = value; },
      get stage() { return viewer.stage; },
      get layerDocument() { return viewer.layerDocument; }, set layerDocument(value) { viewer.layerDocument = value; },
      get settings() { return viewer.settings; },
      get layerView() { return viewer.layerView; }, set layerView(value) { viewer.layerView = value; },
      get showBoard() { return viewer.showBoard.bind(viewer); },
      get ancestors() { return viewer.ancestors.bind(viewer); },
      get hiddenDocuments() { return viewer.hiddenDocuments; },
      get navigationError() { return viewer.navigationError.bind(viewer); },
      get cache() { return viewer.cache; }, set cache(value) { viewer.cache = value; },
      get render() { return viewer.render; }, set render(value) { viewer.render = value; },
      get svgElement() { return viewer.svgElement.bind(viewer); },
      get layerViews() { return viewer.layerViews; },
    };
  }
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
    let pointing = false;
    this.stage.addEventListener('pointerdown', () => { pointing = true; }, options);
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { pointing = false; }, options);
    // Shape IDs repeat across boards. Choose their board before the host handles a selection or edit.
    for (const type of ['click', 'contextmenu', 'focusin', 'keydown']) this.stage.addEventListener(type, event => {
      if (!this.layerView.root || !(event.target instanceof Element)) return;
      // Pointer selection activates on click: changing the toolbar during focus would move the shape
      // between the press and release and turn its click into a background click.
      if (type === 'focusin' && pointing) return;
      const shape = event.target.closest<SVGElement>('[data-shape-id]') ?? event.target.closest('a')?.querySelector<SVGElement>('[data-shape-id]');
      const board = shape?.dataset.shapeBoard ?? event.target.closest<SVGElement>('[data-connection-board]')?.dataset.connectionBoard;
      if (board && board !== this.current) this.activateBoard(board, 'replace');
    }, { ...options, capture: true });
    this.stage.addEventListener('click', (event) => this.follow(event), options);
    // Only the history-owning viewer has routes that another tab can reopen. Missing links and
    // in-memory viewers still need interception instead of opening an unusable address.
    this.stage.addEventListener('auxclick', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!this.history || !link?.getAttribute('href')?.startsWith('#')) followLink(event, this.resolve);
    }, options);
    this.stage.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.follow(event);
    }, options);
    if (this.history) watchHistory(window, () => {
      const file: unknown = history.state?.zoomflowFile;
      const owner = this.settings.document;
      if (owner && typeof file === 'string' && file !== owner.key() && owner.restore(history.state)) return;
      void this.fromLocation(false, true).catch((error) => this.navigationError(error));
    }, options);
    this.resume();
  }

  private readonly goUp = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || this.settings.active?.() === false || event.altKey || event.ctrlKey || event.metaKey ||
      (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      const parent = this.boards.get(this.current)?.parent;
      if (parent) { event.preventDefault(); void this.navigate(parent); }
      else if (this.boards.has(this.current) && this.settings.onTopLevelBack?.()) event.preventDefault();
      // Backspace goes up here, so with nowhere to go it does nothing, rather than WebKit's history Back.
      else if (event.key === 'Backspace') event.preventDefault();
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
  refreshName() { if (this.trail.length) this.updateCrumbs(); }
  get hasExportVisibilityChoices() { return this.view.hasExportVisibilityChoices; }
  isShapeHidden(shape: string, board = this.current) { return this.view.isShapeHidden(shape, board); }
  toggleShapeHidden(shape: string, board = this.current) { return this.view.toggleShapeHidden(shape, board); }
  resetExportVisibility() { return this.view.resetExportVisibility(); }
  refreshVisibility(key: string) { return this.view.refreshVisibility(key); }
  private saveLayers() { return this.view.saveLayers(); }
  get documentView(): DocumentView { return this.view.documentView; }
  async restoreDocumentView(view: DocumentView, focusBoard = this.current) { return this.view.restoreDocumentView(view, focusBoard); }
  private applyVisibility(root: Element = this.stage) { return this.view.applyVisibility(root); }
  exportView(diagram: Diagram, render: RenderBoard, key = this.layerDocument) { return this.view.exportView(diagram, render, key); }
  hiddenShapeCount(boards: Iterable<string> = this.boards.keys()) { return this.view.hiddenShapeCount(boards); }
  get layerState() { return this.view.layerState; }
  async setAllLayers(show: boolean) { return this.view.setAllLayers(show); }
  async setLayerDepth(depth: number) { return this.view.setLayerDepth(depth); }
  private refreshLayerExpansion() { return this.view.refreshLayerExpansion(); }
  async setLayerVisible(id: string, show: boolean) { return this.view.setLayerVisible(id, show); }
  private ensureLayerPath(id: string) { return this.view.ensureLayerPath(id); }
  private cachedRender(board: Board) { return this.view.cachedRender(board); }
  private async layerSvg(exporting = false) { return this.view.layerSvg(exporting); }
  async renderVisibleLayers() { return this.view.renderVisibleLayers(); }
  copyLayerDocument(key: string) { return this.view.copyLayerDocument(key); }

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
      shape.classList.toggle('zf-source-selected', ids.includes(shape.dataset.shapeId!) && (!shape.dataset.shapeBoard || shape.dataset.shapeBoard === this.current));
    }
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.applyTheme(this.stage);
    syncBackground(this.stage);
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
    const previous = { boards: this.boards, diagnostics: this.diagnostics, render: this.render, cache: this.cache,
      layerView: this.layerView, layerDocument: this.layerDocument, hiddenShapes: this.hiddenShapes };
    const boards = this.boards = indexBoards(diagram);
    const key = this.settings.document?.key() ?? '';
    if (key !== this.layerDocument) {
      if (this.layerDocument !== undefined) this.layerViews.set(this.layerDocument, this.layerView);
      if (this.layerDocument !== undefined) this.hiddenDocuments.set(this.layerDocument, this.hiddenShapes);
      this.hiddenShapes = this.hiddenDocuments.get(key) ?? new Map();
      this.layerView = this.layerViews.get(key) ?? { expanded: new Set(), all: false };
      this.layerDocument = key;
    }
    if (this.settings.view) {
      const saved = this.settings.view.read(key);
      this.hiddenShapes = new Map((saved.hidden ?? []).map(([board, ids]) => [board, new Set(ids)]));
      this.layerView = saved.layers ? { ...saved.layers, expanded: new Set(saved.layers.expanded) } : { expanded: new Set(), all: false };
    }
    this.layerView = { ...this.layerView, expanded: new Set(this.layerView.expanded) };
    if (this.layerView.root && !boards.has(this.layerView.root)) this.layerView.root = boards.has(this.current) ? this.current : 'root';
    this.refreshLayerExpansion();
    this.diagnostics = diagnostics;
    this.render = render;
    this.cache = new Map();
    // Preserve the requested route, falling back to its nearest existing ancestor.
    try { await this.fromLocation(preserveViewport); }
    catch (error) {
      // Keep the last good preview's navigation together with its SVG. A failed render must also reach the host,
      // which otherwise marks the new source ready and enables exports of a board that was never displayed.
      if (this.boards === boards) Object.assign(this, previous);
      throw new ViewerRenderError(error);
    }
  }

  private ancestors(id: string): string[] {
    const path: string[] = [];
    for (let board = this.boards.get(id); board; board = board.parent ? this.boards.get(board.parent) : undefined) path.unshift(board.id);
    return path;
  }

  private async fromLocation(preserveViewport = false, focusLayers = false) {
    if (!this.boards.size) return;
    const route = { ...this.route, hash: normalizeRouteHash(this.route.hash) };
    const byHash = new Map([...this.boards.values()].map((item) => [item.hash, item]));
    const board = byHash.get(resolveRouteHash(route.hash, (hash) => byHash.has(hash))) ?? this.boards.get('root')!;
    if (focusLayers && this.layerView.root) this.layerView.root = board.id;
    if (this.layerView.root && this.layerView.depth !== undefined &&
      (layerDepths(this.boards, this.layerView.root).get(board.id) ?? Infinity) > this.layerView.depth) this.layerView.root = board.id;
    this.ensureLayerPath(board.id);
    this.refreshLayerExpansion();
    const trail = restoreTrail(route.trail, board.id, (id) => this.boards.has(id), () => this.ancestors(board.id));
    await this.showBoard(board.id, 'replace', trail, preserveViewport, routeFallbackNotice(route.hash, board.hash, board.name));
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
    const element = viewerSvg(svg, board, this.boards, this.diagnostics, this.sourceShapes, this.resolve);
    this.applyTheme(element);
    return element;
  }

  private follow(event: MouseEvent | KeyboardEvent) {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link && this.settings.follows?.(link, event) === false) { event.preventDefault(); return; }
    if (this.history && (event.ctrlKey || event.metaKey || event.shiftKey) && link?.getAttribute('href')?.startsWith('#')) return;
    const action = followLink(event, this.resolve);
    if (action?.kind === 'missing') this.setMessage(`Missing board: ${boardLabel(action.target, this.boards)}`, true);
    else if (action?.kind === 'board') void this.navigate(action.target);
    else if (action?.kind === 'file') this.settings.files?.open(action.path, action.hash);
    else if (action?.kind === 'missing-file') this.setMessage(this.settings.files ? `Missing file: ${this.fileLabel(action.path)}` : openFolderMessage, true);
  }

  private cancelTransition() {
    this.motion.cancel();
  }

  async navigate(id: string, mode: 'push' | 'replace' = 'push', trail?: string[], preserveViewport = false, notice = '') {
    if (!this.boards.has(id)) return;
    const previous = this.layerView;
    try {
      // Opening a board focuses its subtree. Selecting a shape for editing uses activateBoard instead,
      // preserving the canvas until the user chooses a different starting board.
      if (this.layerView.root) this.layerView = { ...this.layerView, root: id };
      this.refreshLayerExpansion();
      await this.showBoard(id, mode, trail, preserveViewport, notice);
    }
    catch (error) { this.layerView = previous; this.navigationError(error); }
  }

  private navigationError(error: unknown) { this.setMessage(error instanceof Error ? error.message : String(error), true); }

  /** Change the board that editing acts on without replacing the connected canvas. */
  private activateBoard(id: string, mode: 'push' | 'replace', trail = this.ancestors(id)) {
    if (!this.boards.has(id) || !this.layerState.visible.has(id)) return;
    const changed = id !== this.current;
    this.current = id;
    this.recordRoute(mode, trail);
    this.updateCrumbs();
    this.stage.dataset.board = id;
    this.announcement.textContent = `${this.boards.get(id)!.name} layer selected`;
    renderParentContext(this.context, parentContext(this.boards.get(id)!, this.boards));
    if (changed) this.stage.dispatchEvent(new Event('zf-activeboardchange'));
  }

  private recordRoute(mode: 'push' | 'replace', trail: string[]) {
    const board = this.boards.get(this.current)!;
    this.trail = simplifyTrail(trail.filter(id => this.boards.has(id)));
    if (!this.history) this.memoryRoute = { hash: board.hash, trail: this.trail };
    else {
      const key = this.settings.document?.key();
      const state = { ...history.state, zoomflowTrail: this.trail, ...key !== undefined && { zoomflowFile: key } };
      if (mode === 'replace' || location.hash === board.hash) history.replaceState(state, '', board.hash);
      else history.pushState(state, '', board.hash);
    }
  }

  private async showBoard(id: string, mode: 'push' | 'replace', trail?: string[], preserveViewport = false, notice = '') {
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
    const down = childToward(id, this.current, item => this.boards.get(item)?.parent);
    const up = childToward(this.current, id, item => this.boards.get(item)?.parent);
    const snapshot = id !== this.current ? this.motion.capture(down ? linkTo(this.stage, down) : undefined) : undefined;
    this.setBusy(true);
    try {
      const combined = Boolean(this.layerView.root);
      let content: SVGElement | HTMLElement;
      if (combined) content = await this.layerSvg();
      else {
        const svg = await this.cachedRender(board);
        content = board.diagram.shapes.length ? this.svgElement(svg, board) : document.createElement('p');
      }
      if (revision !== this.revision) return;
      if (!combined && !board.diagram.shapes.length) content.textContent = 'This board is empty.';
      const keepFocus = document.activeElement === active;
      const sameBoard = id === this.current;
      const previous = this.current;
      this.stage.replaceChildren(content);
      if (combined) {
        const layers = [...content.querySelectorAll<SVGGElement>('[data-layer-board]')];
        for (const layer of layers) decorateLinks(layer.querySelector(':scope > svg')!, this.boards, layer.dataset.layerBoard!, splitHitArea,
          target => boardLabel(target, this.boards), path => this.fileLabel(path));
        content.addEventListener('zf-viewportchange', () => {
          for (const layer of layers) layer.querySelector(':scope > svg')!.dispatchEvent(new Event('zf-viewportchange'));
        });
      } else decorateLinks(content, this.boards, board.id, splitHitArea, (target) => boardLabel(target, this.boards), (path) => this.fileLabel(path));
      syncBackground(this.stage);
      this.current = id;
      this.applyVisibility();
      this.stage.setAttribute('aria-label', combined ? 'Connected layers diagram' : `${board.name} diagram`);
      this.announcement.textContent = `${board.name} board`;
      // A trail kept from before a document change, including one a breadcrumb drawn then passes, can name boards the
      // new document no longer has.
      this.trail = simplifyTrail((trail ?? [...this.trail, id]).filter((entry) => this.boards.has(entry)));
      this.stage.dataset.board = id;
      this.stage.dataset.layerRoot = this.layerView.root ?? '';
      // Viewports keep a view per board, so re-rendering the same board keeps its viewport anyway.
      this.stage.dispatchEvent(new Event('zf-boardchange'));
      this.recordRoute(mode, this.trail);
      this.updateCrumbs();
      // Going up keeps the keyboard position: focus the link leading back down, which an
      // attached viewport reveals as it receives focus. Other crumb moves keep focus in the trail.
      const child = keepFocus && !sameBoard ? childToward(previous, id, (item) => this.boards.get(item)?.parent) : undefined;
      const link = child && linkTo(this.stage, child);
      if (keepFocus && focusStage) {
        const shape = preserveViewport && sameBoard && focusedShape
          ? [...this.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find((node) => node.dataset.shapeId === focusedShape && node.dataset.shapeBoard === id) : undefined;
        const target = shape?.closest<SVGElement>('a') ?? (shape?.hasAttribute('tabindex') ? shape : link || this.stage);
        target.focus({ preventScroll: true });
      }
      else if (keepFocus && focusCrumb) (link || this.crumbs.querySelector<HTMLButtonElement>('button[aria-current]'))?.focus({ preventScroll: true });
      renderParentContext(this.context, parentContext(board, this.boards));
      this.setMessage(notice);
      this.stage.dispatchEvent(new Event('zf-layerchange'));
      this.saveLayers();
      if (!sameBoard) this.motion.enter(snapshot, content, down ? 'in' : up ? 'out' : 'across', up ? linkTo(this.stage, up) : undefined);
    } catch (error) {
      if (revision === this.revision) { this.cancelTransition(); throw error; }
    } finally {
      if (revision === this.revision) this.setBusy(false);
    }
  }

  private updateCrumbs() {
    const trail = this.trail;
    const file = this.settings.files?.name?.() ?? this.settings.name?.();
    this.breadcrumbs.render([...this.trailPrefix, ...trail.map((id, index) => ({ name: id === 'root' && file || this.boards.get(id)!.name,
      activate: () => { void this.navigate(id, 'push', trail.slice(0, index + 1)); } }))]);
  }

  /** Also tears down a viewport attached to this stage with setupViewport(). */
  destroy() { ++this.revision; clearTimeout(this.messageTimer); this.stage.dispatchEvent(new Event('zf-destroy')); this.events.abort(); this.keys?.abort(); this.breadcrumbs.destroy(); this.cancelTransition(); }
}
