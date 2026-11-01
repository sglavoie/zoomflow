import { boardLabel, classifyHref, indexBoards, parentContext, shapeClass, type Board, type Diagram, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { decorateLinks, splitHitArea } from './link-cues';
import { childToward, normalizeRouteHash, renderParentContext, resolveRouteHash, restoreTrail, routeFallbackNotice, simplifyTrail, watchHistory } from './navigation';
import { setupBreadcrumbs } from './breadcrumbs';
import { followLink, linkTo, prepareLinks, resolveLink } from './links';
import { sanitizeSvg } from './sanitize';
import { composeLayers, layerDepths, visibleLayers } from './layers';
import { diagramHiddenShapes, filterHiddenSvg, markHiddenShapes, removeHiddenShapes, visibleDiagram } from './visibility';
import { associateShapeBadges } from './shape-badges';
import { fitExportBounds } from './export-bounds';
import type { DocumentView } from './document-view';
export { parseDocumentView, serializeDocumentView, type DocumentView } from './document-view';

export type RenderBoard = (target: string) => Promise<string>;
/** Compilation succeeded, but its preview could not be rendered or read as SVG. */
export class ViewerRenderError extends Error {
  constructor(cause: unknown) { super('The preview could not be drawn.', { cause }); }
}
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
  /** `name`: the open file's name, which its root board's crumb shows in place of Root. */
  files?: { exists(path: string): boolean; open(path: string, hash: string): void; label?(path: string): string; name?(): string | undefined };
  /** Escape/Backspace on the root board: return true when it went somewhere, such as back to the file that opened this one. */
  onTopLevelBack?: () => boolean;
  /** With `history`, the open document: its key goes into every history entry as `zoomflowFile`. When Back or
   * Forward reaches another document's entry, `restore` gets that entry's state and returns true when it opens
   * the document; otherwise the entry's board opens in this one. */
  document?: { key(): string | undefined; restore(state: { zoomflowFile: string } & Record<string, unknown>): boolean };
  /** The host owns persistence and shares explicit visibility choices across viewers and exports. */
  view?: { read(key: string): DocumentView; write(key: string, patch: DocumentView): void };
};
export type TrailPrefixEntry = { name: string; activate(): void };
export const openFolderMessage = 'Open the folder that contains this file to follow links to other diagrams.';
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
  private transitions = new Set<Animation>();
  private readonly events = new AbortController();
  private keys?: AbortController;
  private readonly history: boolean;
  private memoryRoute: ViewerRoute = { hash: '#/' };
  private layerView: { root?: string; expanded: Set<string>; all: boolean; depth?: number } = { expanded: new Set(), all: false };
  private readonly layerViews = new Map<string, typeof this.layerView>();
  private layerDocument?: string;
  private hiddenShapes = new Map<string, Set<string>>();
  private readonly hiddenDocuments = new Map<string, Map<string, Set<string>>>();

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
      const board = shape?.dataset.shapeBoard;
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
  get hasExportVisibilityChoices() { return [...this.hiddenShapes.values()].some(ids => ids.size > 0); }

  isShapeHidden(shape: string, board = this.current) {
    return diagramHiddenShapes(this.boards, this.hiddenShapes).get(board)?.has(shape) ?? false;
  }

  /** Unhiding a descendant clears the parent choices hiding it; other explicit choices are preserved. */
  toggleShapeHidden(shape: string, board = this.current) {
    const model = this.boards.get(board);
    if (!model?.diagram.shapes.some(item => item.id === shape)) return;
    const choices = this.hiddenShapes.get(board) ?? new Set<string>();
    if (this.isShapeHidden(shape, board)) {
      for (const [origin, selected] of this.hiddenShapes) for (const id of selected) {
        if (diagramHiddenShapes(this.boards, new Map([[origin, new Set([id])]])).get(board)?.has(shape)) selected.delete(id);
      }
    } else choices.add(shape);
    this.hiddenShapes.set(board, choices);
    this.applyVisibility();
    this.saveVisibility();
    this.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  /** Restore every board in this document without changing its source or layer layout. */
  resetExportVisibility() {
    this.hiddenShapes = new Map();
    this.applyVisibility();
    this.saveVisibility();
    this.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  private saveVisibility() {
    if (this.layerDocument !== undefined) this.settings.view?.write(this.layerDocument,
      { hidden: [...this.hiddenShapes].map(([board, ids]) => [board, [...ids]]) });
  }

  /** A sibling viewer changed this document's canonical visibility choices. */
  refreshVisibility(key: string) {
    if (key !== this.layerDocument || !this.settings.view) return;
    this.hiddenShapes = new Map((this.settings.view.read(key).hidden ?? []).map(([board, ids]) => [board, new Set(ids)]));
    this.applyVisibility();
    this.stage.dispatchEvent(new Event('zf-visibilitychange'));
  }

  private saveLayers() {
    if (this.layerDocument !== undefined) this.settings.view?.write(this.layerDocument,
      { layers: { ...this.layerView, expanded: [...this.layerView.expanded] } });
  }

  private applyVisibility(root: Element = this.stage) {
    const hidden = diagramHiddenShapes(this.boards, this.hiddenShapes);
    for (const node of root.querySelectorAll('.zf-hidden-label')) node.remove();
    for (const board of this.boards.values()) {
      const container = this.layerView.root
        ? [...root.querySelectorAll<SVGElement>('[data-layer-board]')].find(node => node.dataset.layerBoard === board.id)
        : board.id === this.current ? root : undefined;
      if (container) markHiddenShapes(container, board, hidden.get(board.id)!);
    }
    for (const connector of root.querySelectorAll<SVGElement>('.zf-layer-connectors [data-layer-source]')) {
      connector.toggleAttribute('data-export-hidden', hidden.get(connector.dataset.layerParent!)?.has(connector.dataset.layerSource!) ?? false);
    }
  }

  /** Snapshot choices so an asynchronous export uses one consistent view, including search metadata. */
  exportView(diagram: Diagram, render: RenderBoard, key = this.layerDocument) {
    const choices = this.settings.view && key !== undefined
      ? new Map((this.settings.view.read(key).hidden ?? []).map(([board, ids]) => [board, new Set(ids)]))
      : key === this.layerDocument ? this.hiddenShapes : this.hiddenDocuments.get(key ?? '') ?? new Map<string, Set<string>>();
    const boards = indexBoards(diagram);
    const hidden = diagramHiddenShapes(boards, choices);
    const byTarget = new Map([...boards.values()].map(board => [board.target, board]));
    return { diagram: visibleDiagram(diagram, hidden), render: async (target: string) => {
      const svg = await render(target);
      const board = byTarget.get(target);
      return board ? filterHiddenSvg(svg, board, hidden.get(board.id)!) : svg;
    } };
  }

  hiddenShapeCount(boards: Iterable<string> = this.boards.keys()) {
    const hidden = diagramHiddenShapes(this.boards, this.hiddenShapes);
    let count = 0;
    for (const id of boards) {
      count += hidden.get(id)?.size ?? 0;
    }
    return count;
  }

  get layerState() {
    const root = this.layerView.root;
    const visible = new Set(root ? visibleLayers(this.boards, root, this.layerView.expanded).map(board => board.id) : [this.current]);
    const depths = layerDepths(this.boards, root ?? this.current);
    const available = new Set(depths.keys());
    let maxDepth = 0;
    let visibleDepth = 0;
    for (const [id, depth] of depths) {
      maxDepth = Math.max(maxDepth, depth);
      if (visible.has(id)) visibleDepth = Math.max(visibleDepth, depth);
    }
    const uniform = [...depths].every(([id, depth]) => visible.has(id) === (depth <= visibleDepth));
    return { enabled: Boolean(root), root, available, expanded: this.layerView.expanded as ReadonlySet<string>, visible,
      depth: uniform ? visibleDepth : null, visibleDepth, maxDepth,
      all: root === this.current && [...available].every(id => visible.has(id)) };
  }

  /** Show the active board and all its descendants, or return to that board alone. */
  async setAllLayers(show: boolean) {
    await this.changeLayers(() => {
      this.layerView = show ? { root: this.current, expanded: new Set(this.boards.keys()), all: true }
        : { expanded: new Set(), all: false };
    });
  }

  /** Show the view's starting board plus a chosen number of descendant levels. */
  async setLayerDepth(depth: number) {
    if (!Number.isSafeInteger(depth) || depth < 0 || !this.boards.has(this.current)) return;
    await this.changeLayers(() => {
      this.layerView = { root: this.layerView.root ?? this.current, expanded: new Set(), all: false, depth };
      this.refreshLayerExpansion();
    });
  }

  private refreshLayerExpansion() {
    if (!this.layerView.root) return;
    if (this.layerView.all) this.layerView.expanded = new Set(this.boards.keys());
    else if (this.layerView.depth !== undefined) this.layerView.expanded = new Set(
      [...layerDepths(this.boards, this.layerView.root)].filter(([, depth]) => depth <= this.layerView.depth!).map(([id]) => id));
  }

  /** Hiding a parent collapses its subtree but remembers the children's choices. */
  async setLayerVisible(id: string, show: boolean) {
    if (this.boards.get(id)?.kind !== 'layers') return;
    const root = this.layerView.root ?? this.current;
    if (id === root || !this.layerState.available.has(id)) return;
    await this.changeLayers(() => {
      this.layerView = { ...this.layerView, expanded: new Set(this.layerView.expanded), all: false, depth: undefined };
      this.layerView.root ??= this.current;
      if (show) this.ensureLayerPath(id);
      else this.layerView.expanded.delete(id);
    });
  }

  private ensureLayerPath(id: string) {
    if (!this.layerView.root) return;
    const path = this.ancestors(id);
    const from = path.indexOf(this.layerView.root);
    if (from < 0 || path.slice(from + 1).some(child => this.boards.get(child)?.kind !== 'layers')) this.layerView.root = id;
    else for (const child of path.slice(from + 1)) this.layerView.expanded.add(child);
  }

  private async changeLayers(change: () => void) {
    const before = this.layerView;
    change();
    const next = this.layerView;
    this.stage.dispatchEvent(new Event('zf-layerchange'));
    let active = this.current;
    const visible = this.layerState.visible;
    while (!visible.has(active) && this.boards.get(active)?.parent) active = this.boards.get(active)!.parent!;
    try { await this.showBoard(active, 'replace', this.ancestors(active)); }
    catch (error) {
      if (this.layerView === next) { this.layerView = before; this.stage.dispatchEvent(new Event('zf-layerchange')); }
      this.navigationError(error);
    }
  }

  private cachedRender(board: Board) {
    let rendered = this.cache.get(board.id);
    if (!rendered) {
      rendered = this.render(board.target);
      const cache = this.cache;
      cache.set(board.id, rendered);
      void rendered.catch(() => cache.delete(board.id));
    }
    return rendered;
  }

  private async layerSvg(exporting = false) {
    let boards = visibleLayers(this.boards, this.layerView.root!, this.layerView.expanded);
    const hidden = exporting ? diagramHiddenShapes(this.boards, this.hiddenShapes) : undefined;
    const trim = Boolean(hidden && boards.some(board => hidden.get(board.id)?.size));
    if (trim) {
      const retained = new Set([boards[0].id]);
      for (const board of boards) if (!board.diagram.shapes.length || board.diagram.shapes.some(shape => !hidden!.get(board.id)!.has(shape.id))) {
        for (const id of this.ancestors(board.id)) retained.add(id);
      }
      boards = boards.filter(board => retained.has(board.id));
    }
    const items: { board: Board; svg: SVGElement }[] = [];
    // Bound render work when a large hierarchy is expanded at once.
    for (let i = 0; i < boards.length; i += 4) {
      items.push(...await Promise.all(boards.slice(i, i + 4).map(async board => {
        const svg = this.svgElement(await this.cachedRender(board), board);
        const omitted = hidden?.get(board.id);
        if (trim && omitted?.size) {
          markHiddenShapes(svg, board, omitted);
          removeHiddenShapes(svg);
          await fitExportBounds(svg as SVGSVGElement);
          board = { ...board, diagram: { ...board.diagram, shapes: board.diagram.shapes.filter(shape => !omitted.has(shape.id)),
            connections: board.diagram.connections.filter(edge => !omitted.has(edge.src) && !omitted.has(edge.dst)) } };
        }
        return { board, svg };
      })));
    }
    const svg = composeLayers(items);
    if (trim) svg.setAttribute('data-export-trim', '');
    return svg;
  }

  /** A fresh full-size SVG of the visible layers, without selection rings or viewport transforms. */
  async renderVisibleLayers() {
    if (!this.layerView.root) return undefined;
    const svg = await this.layerSvg(true);
    this.applyVisibility(svg);
    removeHiddenShapes(svg);
    return new XMLSerializer().serializeToString(svg);
  }

  /** Saving a draft under a new key preserves its view and leaves the original document's choices available. */
  copyLayerDocument(key: string) {
    if (this.layerDocument !== undefined) this.layerViews.set(this.layerDocument, this.layerView);
    this.layerView = { ...this.layerView, expanded: new Set(this.layerView.expanded) };
    if (this.layerDocument !== undefined) this.hiddenDocuments.set(this.layerDocument, this.hiddenShapes);
    this.hiddenShapes = new Map([...this.hiddenShapes].map(([board, shapes]) => [board, new Set(shapes)]));
    this.layerDocument = key;
    this.saveVisibility();
    this.saveLayers();
  }

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
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    // File content can contain labels and links; never insert executable markup. Sanitize while
    // the parsed SVG is still inert: importing an element into this document can start loading it.
    if (doc.querySelector('parsererror') || !sanitizeSvg(doc.documentElement)) throw new Error(`Invalid SVG for ${board.name}`);
    const element = document.importNode(doc.documentElement, true) as unknown as SVGElement;
    element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    associateShapeBadges(element, board);
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
        group.dataset.shapeBoard = board.id;
        if (!group.closest('a')) {
          group.setAttribute('tabindex', '0');
          group.setAttribute('role', 'button');
          group.setAttribute('aria-label', `Select ${sources.has(shape.id) ? 'source for ' : ''}${group.querySelector('text')?.textContent || shape.id}`);
        }
      }
    }
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
      const fade = this.stage.hasChildNodes() && id !== this.current &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      this.syncBackground(this.stage);
      if (fade) void this.fadeIn(content);
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
    } catch (error) {
      if (revision === this.revision) { this.cancelTransition(); throw error; }
    } finally {
      if (revision === this.revision) this.setBusy(false);
    }
  }

  private updateCrumbs() {
    const trail = this.trail;
    const file = this.settings.files?.name?.();
    this.breadcrumbs.render([...this.trailPrefix, ...trail.map((id, index) => ({ name: id === 'root' && file || this.boards.get(id)!.name,
      activate: () => { void this.navigate(id, 'push', trail.slice(0, index + 1)); } }))]);
  }

  /** Also tears down a viewport attached to this stage with setupViewport(). */
  destroy() { ++this.revision; clearTimeout(this.messageTimer); this.stage.dispatchEvent(new Event('zf-destroy')); this.events.abort(); this.keys?.abort(); this.breadcrumbs.destroy(); this.cancelTransition(); }
}
