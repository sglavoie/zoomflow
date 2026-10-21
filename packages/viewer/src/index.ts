import { classifyHref, indexBoards, parentContext, type Board, type Diagram, type LintDiagnostic, type ShapeSource } from '@zoomflow/core';
import { restoreMissingLinks } from './missing-links';
import { decorateLinks } from './link-cues';
import { renderParentContext, resolveRouteHash, routeFallbackNotice, simplifyTrail } from './navigation';
import { setupBreadcrumbs } from './breadcrumbs';

export type RenderBoard = (target: string) => Promise<string>;
export type ViewerRoute = { hash: string; trail?: unknown };
export type ViewerOptions = {
  /** Mirror the current board in the page URL and history; otherwise keep the route in memory. */
  history?: boolean;
  /** Whether page-level Escape/Backspace should navigate this viewer. */
  active?: () => boolean;
};
export { prepareExportSvg, rasterizeSvg, offlineViewerScript } from './export';
export { setupViewport } from './viewport';
export { offlineViewerStyle } from './export-style';
export { viewerStyle } from './viewer-style';

/** DOM viewer with an injected renderer so callers can reuse compiled documents. */
export class Viewer {
  readonly stage = document.createElement('div');
  private readonly crumbs = document.createElement('nav');
  private readonly breadcrumbs = setupBreadcrumbs(this.crumbs);
  private readonly context = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly announcement = document.createElement('div');
  private boards = new Map<string, Board>();
  private diagnostics: readonly LintDiagnostic[] = [];
  private render: RenderBoard = async () => '';
  private cache = new Map<string, Promise<string>>();
  private sourceShapes: readonly ShapeSource[] = [];
  private current = 'root';
  private trail: string[] = [];
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
    this.message.setAttribute('role', 'status');
    this.announcement.className = 'zf-visually-hidden';
    this.announcement.setAttribute('aria-live', 'polite');
    this.stage.className = 'zf-stage';
    this.stage.setAttribute('role', 'region');
    this.stage.tabIndex = -1;
    this.stage.setAttribute('aria-label', 'Diagram');
    host.replaceChildren(this.crumbs, this.context, this.message, this.announcement, this.stage);
    const options = { signal: this.events.signal };
    this.stage.addEventListener('click', (event) => this.follow(event), options);
    this.stage.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.follow(event);
    }, options);
    if (this.history) {
      // Traversals fire popstate then hashchange; render each history step once.
      let popped = false;
      window.addEventListener('popstate', () => { popped = true; void this.fromLocation(); }, options);
      window.addEventListener('hashchange', () => { if (!popped) void this.fromLocation(); popped = false; }, options);
    }
    this.resume();
  }

  private readonly goUp = (event: KeyboardEvent) => {
    if (event.defaultPrevented || this.settings.active?.() === false || event.altKey || event.ctrlKey || event.metaKey ||
      (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      const parent = this.boards.get(this.current)?.parent;
      if (parent) { event.preventDefault(); void this.navigate(parent); }
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
    this.message.setAttribute('role', error ? 'alert' : 'status');
    this.message.textContent = text;
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
    history.replaceState({ zoomflowTrail: route?.trail }, '', `${location.pathname}${location.search}${route?.hash ?? '#/'}`);
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
    const saved = route.trail;
    const trail = Array.isArray(saved) && saved.length > 0 && saved.at(-1) === board.id &&
      saved.every((id) => typeof id === 'string' && this.boards.has(id)) ? saved as string[] : this.ancestors(board.id);
    await this.navigate(board.id, 'replace', trail, preserveViewport, routeFallbackNotice(route.hash, board.hash, board.name));
  }

  private svgElement(svg: string, board: Board): SVGElement {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid SVG from renderer');
    const element = document.importNode(doc.documentElement, true) as unknown as SVGElement;
    element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // File content can contain labels and links; never insert executable markup.
    element.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
    for (const node of [element, ...element.querySelectorAll('*')]) {
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name) ||
          (/href$/i.test(attribute.name) && /^\s*(javascript|vbscript):/i.test(attribute.value))) node.removeAttributeNode(attribute);
      }
    }
    restoreMissingLinks(element, this.diagnostics.filter((item) => item.board === board.id));
    for (const link of element.querySelectorAll('a')) {
      const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
      const action = classifyHref(href, board.id);
      link.setAttribute('tabindex', '0');
      link.setAttribute('role', 'link');
      if (action.kind === 'external') {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      } else if (action.kind !== 'invalid' && !this.boards.has(action.target)) link.setAttribute('data-missing', '');
      else if (action.kind === 'invalid') {
        link.removeAttribute('href');
        link.removeAttribute('xlink:href');
      }
    }
    for (const shape of board.diagram.shapes) {
      // D2 uses padded URL-safe base64, including for non-ASCII identifiers.
      const encoded = btoa(Array.from(new TextEncoder().encode(shape.id), (byte) => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-').replace(/\//g, '_');
      const group = [...element.querySelectorAll('g')].find((node) => node.classList.contains(encoded));
      if (group) {
        group.dataset.shapeId = shape.id;
        if (!group.closest('a') && this.sourceShapes.some((entry) => entry.board === board.id && entry.shape === shape.id)) {
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
    if (!link) return;
    const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
    const action = classifyHref(href, this.current);
    if (action.kind === 'external') return;
    event.preventDefault();
    if (action.kind === 'invalid') return;
    if (!this.boards.has(action.target)) { this.setMessage(`Missing board: ${action.target}`, true); return; }
    void this.navigate(action.target);
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
    const focusedShape = active instanceof Element
      ? (active.closest<SVGElement>('[data-shape-id]') ?? active.querySelector<SVGElement>('[data-shape-id]'))?.dataset.shapeId : undefined;
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
      this.stage.replaceChildren(content);
      decorateLinks(content, this.boards, board.id);
      this.syncBackground(this.stage);
      if (fade) void this.fadeIn(content);
      this.current = id;
      this.stage.setAttribute('aria-label', `${board.name} diagram`);
      this.announcement.textContent = `${board.name} board`;
      this.trail = simplifyTrail(trail ?? [...this.trail, id]);
      this.stage.dataset.board = id;
      this.stage.dispatchEvent(new CustomEvent('zf-boardchange', { detail: { preserveViewport: preserveViewport && sameBoard } }));
      if (!this.history) this.memoryRoute = { hash: board.hash, trail: this.trail };
      else {
        const state = { ...history.state, zoomflowTrail: this.trail };
        if (mode === 'replace' || location.hash === board.hash) history.replaceState(state, '', board.hash);
        else history.pushState(state, '', board.hash);
      }
      this.updateCrumbs();
      if (keepFocus && focusStage) {
        const shape = preserveViewport && sameBoard && focusedShape
          ? [...this.stage.querySelectorAll<SVGElement>('[data-shape-id]')].find((node) => node.dataset.shapeId === focusedShape) : undefined;
        const target = shape?.closest<SVGElement>('a') ?? (shape?.hasAttribute('tabindex') ? shape : this.stage);
        target.focus({ preventScroll: true });
      }
      else if (keepFocus && focusCrumb) this.crumbs.querySelector<HTMLButtonElement>('button[aria-current]')?.focus({ preventScroll: true });
      renderParentContext(this.context, parentContext(board, this.boards));
      this.setMessage(notice);
    } catch (error) {
      if (revision === this.revision) { this.cancelTransition(); this.setMessage(String(error), true); }
    } finally {
      if (revision === this.revision) this.setBusy(false);
    }
  }

  private updateCrumbs() {
    const trail = this.trail;
    this.breadcrumbs.render(trail.map((id, index) => ({ name: this.boards.get(id)!.name,
      activate: () => { void this.navigate(id, 'push', trail.slice(0, index + 1)); } })));
  }

  /** Also tears down a viewport attached to this stage with setupViewport(). */
  destroy() { ++this.revision; this.stage.dispatchEvent(new Event('zf-destroy')); this.events.abort(); this.keys?.abort(); this.breadcrumbs.destroy(); this.cancelTransition(); }
}
